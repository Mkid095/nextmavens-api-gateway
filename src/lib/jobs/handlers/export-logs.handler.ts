/**
 * Export Logs Job Handler
 *
 * Handles project audit log exports by:
 * 1. Querying audit logs from the database with filters
 * 2. Formatting logs in JSON or text format
 * 3. Uploading the export to Telegram storage (optional)
 * 4. Recording the export in backup history
 * 5. Sending a notification when complete
 *
 * This job supports retry logic for transient failures (e.g., network issues,
 * temporary storage unavailability).
 *
 * US-008: Export Logs
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { exportLogsHandler } from '@/lib/jobs/handlers/export-logs.handler';
 *
 * // Register the handler
 * worker.registerHandler('export_logs', exportLogsHandler);
 *
 * // Enqueue an export logs job
 * await enqueueJob('export_logs', { project_id: 'proj-123' });
 * ```
 */

import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import type { BackupHistoryInput, BackupHistoryType } from '@nextmavens/audit-logs-database';
import { recordBackup } from '@nextmavens/audit-logs-database';
import { unlink, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGzip } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { enqueueJob } from '../queue.js';
import type {
  LogsExportMetadata,
  LogExportFormat
} from '@/api/routes/backup/logs-export.types.js';

/**
 * Export logs handler payload
 */
interface ExportLogsPayload extends JobPayload {
  /**
   * The ID of the project to export logs for
   */
  project_id: string;

  /**
   * Optional export format
   * @default 'json'
   */
  format?: LogExportFormat;

  /**
   * Optional date range filter
   */
  date_range?: {
    from: string;
    to: string;
  };

  /**
   * Optional action type filter
   */
  action_filter?: string[];

  /**
   * Optional actor type filter
   */
  actor_type_filter?: ('user' | 'system' | 'api_key')[];

  /**
   * Optional maximum number of entries
   * @default 10000
   */
  max_entries?: number;

  /**
   * Optional notification email
   */
  notify_email?: string;

  /**
   * Whether to send to Telegram storage
   * @default true
   */
  send_to_telegram?: boolean;

  /**
   * Optional Telegram storage path
   */
  storage_path?: string;

  /**
   * Optional compression flag
   */
  compress?: boolean;
}

/**
 * Audit log entry from database
 */
interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_type: 'user' | 'system' | 'api_key';
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * Input validation patterns
 */
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  STORAGE_PATH_PATTERN: /^[a-zA-Z0-9_/._-]+$/,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

/**
 * Default configuration values
 */
const DEFAULT_EXPORT_CONFIG = {
  /**
   * Default export format
   */
  format: 'json' as const,

  /**
   * Default maximum number of entries
   */
  maxEntries: 10000,

  /**
   * Default send to Telegram setting
   */
  sendToTelegram: true,

  /**
   * Default storage path template
   * Variables: {project_id}, {timestamp}, {format}
   */
  storagePathTemplate: '/logs/{project_id}/{timestamp}.{format}',

  /**
   * Maximum time allowed for export generation (milliseconds)
   */
  maxExportTime: 30 * 60 * 1000, // 30 minutes

  /**
   * Maximum export size (bytes) - 5GB
   */
  maxExportSize: 5 * 1024 * 1024 * 1024,

  /**
   * Size threshold for automatic compression (bytes) - 10MB
   */
  compressThreshold: 10 * 1024 * 1024,

  /**
   * Batch size for querying logs
   */
  queryBatchSize: 1000,
} as const;

/**
 * Export Logs Job Handler
 *
 * Queries audit logs from the database, formats them for export,
 * uploads to Telegram storage (optional), and records in backup history.
 *
 * This job supports retry logic for transient failures such as:
 * - Network connectivity issues
 * - Temporary storage unavailability
 * - Database connection errors
 *
 * @param payload - Job payload containing project_id and optional configuration
 * @returns Promise resolving to job execution result with export metadata
 *
 * @throws Error if project_id is missing
 * @throws Error if project not found
 * @throws Error if export generation fails
 * @throws Error if upload to storage fails
 * @throws Error if export size exceeds maximum
 *
 * @example
 * ```typescript
 * const result = await exportLogsHandler({
 *   project_id: 'proj-123',
 *   format: 'json',
 *   date_range: { from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' },
 *   send_to_telegram: true
 * });
 *
 * if (result.success) {
 *   console.log('Logs exported:', result.data.entryCount, 'entries');
 * } else {
 *   console.error('Export failed:', result.error);
 * }
 * ```
 */
export async function exportLogsHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  // Validate payload
  const {
    project_id,
    format,
    date_range,
    action_filter,
    actor_type_filter,
    max_entries,
    notify_email,
    send_to_telegram,
    storage_path,
    compress
  } = payload as ExportLogsPayload;

  // Validate project_id with security checks
  if (!project_id) {
    return {
      success: false,
      error: 'Missing required field: project_id',
    };
  }

  // Security: Validate project_id format
  try {
    validateProjectId(project_id);
    validateStoragePath(storage_path || '');
    if (format && !['json', 'text'].includes(format)) {
      return {
        success: false,
        error: 'Invalid export format',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid export parameters';
    return {
      success: false,
      error: message,
    };
  }

  console.log(`[ExportLogs] Starting log export for project ID: ${project_id}`);
  const startTime = Date.now();

  let tempFilePath: string | null = null;

  try {
    // Step 1: Validate project exists
    console.log(`[ExportLogs] Validating project ${project_id}`);
    const projectExists = await validateProjectExists(project_id);

    if (!projectExists) {
      // Generic error message (don't reveal project existence)
      return {
        success: false,
        error: 'Export operation failed',
      };
    }

    console.log(`[ExportLogs] Project validated successfully`);

    // Step 2: Query audit logs with filters
    const exportFormat = format || DEFAULT_EXPORT_CONFIG.format;
    const maxEntries = max_entries || DEFAULT_EXPORT_CONFIG.maxEntries;
    const shouldSendToTelegram = send_to_telegram !== undefined
      ? send_to_telegram
      : DEFAULT_EXPORT_CONFIG.sendToTelegram;

    console.log(`[ExportLogs] Querying audit logs (format: ${exportFormat}, max: ${maxEntries})`);

    const logs = await queryAuditLogs(project_id, {
      dateRange: date_range,
      actionFilter: action_filter,
      actorTypeFilter: actor_type_filter,
      maxEntries,
    });

    console.log(`[ExportLogs] Retrieved ${logs.length} log entries`);

    if (logs.length === 0) {
      return {
        success: false,
        error: 'No logs found matching the specified criteria',
      };
    }

    // Step 3: Format and write to temp file
    console.log(`[ExportLogs] Formatting logs as ${exportFormat}`);

    const shouldCompress = compress !== undefined
      ? compress
      : false; // Will auto-determine based on size

    tempFilePath = await formatAndWriteLogs(logs, exportFormat);

    // Get file size
    const fileStats = await stat(tempFilePath);
    const sizeBytes = fileStats.size;

    console.log(`[ExportLogs] Export file created: ${sizeBytes} bytes`);

    // Auto-compress if file is large and not already compressed
    let finalFilePath = tempFilePath;
    let finalSizeBytes = sizeBytes;
    let wasCompressed = false;

    if (
      !shouldCompress &&
      sizeBytes > DEFAULT_EXPORT_CONFIG.compressThreshold &&
      tempFilePath.endsWith('.json')
    ) {
      console.log(`[ExportLogs] Auto-compressing large file (${sizeBytes} bytes)`);
      const compressedPath = await compressFile(tempFilePath);
      finalFilePath = compressedPath;

      // Clean up uncompressed file
      await unlink(tempFilePath);

      const compressedStats = await stat(compressedPath);
      finalSizeBytes = compressedStats.size;
      wasCompressed = true;

      console.log(`[ExportLogs] Compressed to ${finalSizeBytes} bytes`);
    } else if (shouldCompress && !tempFilePath.endsWith('.gz')) {
      // Manual compression requested
      console.log(`[ExportLogs] Compressing file as requested`);
      const compressedPath = await compressFile(tempFilePath);
      finalFilePath = compressedPath;

      // Clean up uncompressed file
      await unlink(tempFilePath);

      const compressedStats = await stat(compressedPath);
      finalSizeBytes = compressedStats.size;
      wasCompressed = true;
    }

    // Verify export size
    if (finalSizeBytes > DEFAULT_EXPORT_CONFIG.maxExportSize) {
      await cleanupTempFile(finalFilePath);
      return {
        success: false,
        error: 'Export size exceeds maximum allowed',
      };
    }

    // Step 4: Upload to Telegram storage (if requested)
    let fileId: string | undefined;
    let storagePath: string | undefined;

    if (shouldSendToTelegram) {
      const targetPath = storage_path || generateStoragePath(project_id, exportFormat, wasCompressed);
      console.log(`[ExportLogs] Uploading to Telegram storage: ${targetPath}`);

      fileId = await uploadToTelegramStorage(finalFilePath, targetPath);
      storagePath = targetPath;
    }

    // Step 5: Record export in backup history (non-blocking)
    let backupHistoryId: string | undefined;
    if (fileId) {
      try {
        console.log(`[ExportLogs] Recording export in history for project ${project_id}`);

        const backupInput: BackupHistoryInput = {
          project_id: project_id,
          type: 'logs' as BackupHistoryType,
          file_id: fileId,
          size: finalSizeBytes,
        };

        const recordResult = await recordBackup(backupInput);

        if (recordResult.success && recordResult.backup.id) {
          backupHistoryId = recordResult.backup.id;
          console.log(`[ExportLogs] Successfully recorded export in history: ${backupHistoryId}`);
        } else {
          console.warn(`[ExportLogs] Failed to record export in history: ${recordResult.error || 'Unknown error'}`);
        }
      } catch (error) {
        // Recording failure should NOT fail the export job
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[ExportLogs] Failed to record export in history: ${errorMessage}`);
      }
    }

    // Step 6: Send notification if email provided
    if (notify_email) {
      await sendNotification(
        notify_email,
        project_id,
        logs.length,
        finalSizeBytes,
        exportFormat
      ).catch(() => {
        // Notification failure should not fail the export
        console.warn(`[ExportLogs] Failed to send notification to ${notify_email}`);
      });
    }

    // Step 7: Prepare result metadata
    const durationMs = Date.now() - startTime;
    const metadata: LogsExportMetadata = {
      projectId: project_id,
      format: exportFormat,
      compressed: wasCompressed,
      sizeBytes: finalSizeBytes,
      storagePath,
      fileId,
      createdAt: new Date(),
      durationMs,
      entryCount: logs.length,
      dateRange: date_range,
      sentToTelegram: shouldSendToTelegram,
      backupHistoryId,
    };

    console.log(`[ExportLogs] Successfully completed log export for project ${project_id} in ${durationMs}ms`);

    // Cleanup temp file
    await cleanupTempFile(finalFilePath);

    return {
      success: true,
      data: metadata,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ExportLogs] Failed to export logs for project ${project_id}:`, {
      error: errorMessage,
      timestamp: new Date().toISOString(),
      stack: error instanceof Error ? error.stack : undefined
    });

    // Cleanup temp file on error
    if (tempFilePath) {
      await cleanupTempFile(tempFilePath).catch(() => {
        // Ignore cleanup errors
      });
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Generate storage path for log export file
 *
 * Creates a unique storage path based on project ID, timestamp, and format.
 *
 * @param projectId - The project ID
 * @param format - The export format
 * @param compressed - Whether the file is compressed
 * @returns The generated storage path
 */
function generateStoragePath(projectId: string, format: string, compressed: boolean): string {
  // Security: Validate project ID before using in path
  validateProjectId(projectId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
  const date = new Date().toISOString().split('T')[0];
  const ext = compressed ? `${format}.gz` : format;

  // Security: Use safe path construction
  const safePath = join(
    '/logs',
    projectId,
    `${date}-${timestamp}.${ext}`
  );

  // Ensure path is normalized
  const normalized = safePath.replace(/\/+/g, '/');

  // Double-check no path traversal
  if (normalized.includes('..') || !normalized.startsWith('/logs/')) {
    throw new Error('Path traversal detected in storage path generation');
  }

  return normalized;
}

/**
 * Validate project ID format and content
 *
 * @param id - The project ID to validate
 * @throws Error if validation fails
 */
function validateProjectId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('Project ID is required and must be a string');
  }

  if (id.length > VALIDATIONS.PROJECT_ID_MAX_LENGTH) {
    throw new Error('Project ID exceeds maximum length');
  }

  if (!VALIDATIONS.PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Project ID contains invalid characters');
  }

  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Project ID cannot contain path traversal sequences');
  }
}

/**
 * Validate storage path format and content
 *
 * @param path - The storage path to validate
 * @throws Error if validation fails
 */
function validateStoragePath(path: string): void {
  if (!path) {
    return; // Empty path is allowed (will use default)
  }

  if (path.startsWith('/')) {
    throw new Error('Absolute paths not allowed in storage_path');
  }

  if (path.includes('..')) {
    throw new Error('Path traversal not allowed in storage_path');
  }

  if (!VALIDATIONS.STORAGE_PATH_PATTERN.test(path)) {
    throw new Error('Storage path contains invalid characters');
  }
}

/**
 * Validate project exists
 *
 * @param projectId - The project ID to validate
 * @returns True if project exists, false otherwise
 */
async function validateProjectExists(projectId: string): Promise<boolean> {
  const queryText = `
    SELECT 1
    FROM control_plane.projects
    WHERE id = $1
      AND status = 'ACTIVE'
  `;

  try {
    const result = await query(queryText, [projectId]);
    return result.rows.length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to validate project: ${message}`);
  }
}

/**
 * Query audit logs with filters
 *
 * @param projectId - The project ID
 * @param filters - Optional filters
 * @returns Array of audit log entries
 */
async function queryAuditLogs(
  projectId: string,
  filters?: {
    dateRange?: { from: string; to: string };
    actionFilter?: string[];
    actorTypeFilter?: ('user' | 'system' | 'api_key')[];
    maxEntries?: number;
  }
): Promise<AuditLogEntry[]> {
  const conditions: string[] = ['target_id = $1'];
  const params: (string | number)[] = [projectId];
  let paramIndex = 2;

  // Add date range filter
  if (filters?.dateRange) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.dateRange.from);
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.dateRange.to);
  }

  // Add action filter
  if (filters?.actionFilter && filters.actionFilter.length > 0) {
    const actionParams = filters.actionFilter.map(() => `$${paramIndex++}`);
    conditions.push(`action IN (${actionParams.join(', ')})`);
    params.push(...filters.actionFilter);
  }

  // Add actor type filter
  if (filters?.actorTypeFilter && filters.actorTypeFilter.length > 0) {
    const actorParams = filters.actorTypeFilter.map(() => `$${paramIndex++}`);
    conditions.push(`actor_type IN (${actorParams.join(', ')})`);
    params.push(...filters.actorTypeFilter);
  }

  // Add limit
  const maxEntries = filters?.maxEntries || DEFAULT_EXPORT_CONFIG.maxEntries;
  conditions.push(`true LIMIT $${paramIndex++}`);
  params.push(maxEntries);

  const queryText = `
    SELECT
      id,
      actor_id,
      actor_type,
      action,
      target_type,
      target_id,
      metadata,
      ip_address,
      user_agent,
      created_at
    FROM control_plane.audit_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  try {
    const result = await query(queryText, params);
    return result.rows as AuditLogEntry[];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to query audit logs: ${message}`);
  }
}

/**
 * Format and write logs to temp file
 *
 * @param logs - Array of audit log entries
 * @param format - Export format
 * @returns Path to the temp file
 */
async function formatAndWriteLogs(
  logs: AuditLogEntry[],
  format: LogExportFormat
): Promise<string> {
  const timestamp = Date.now();
  const extension = format === 'json' ? 'json' : 'txt';
  const tempFileName = `logs_export_${timestamp}.${extension}`;
  const tempFilePath = join(tmpdir(), tempFileName);

  if (format === 'json') {
    // Format as JSON array
    const jsonData = JSON.stringify(logs, null, 2);
    await writeFile(tempFilePath, jsonData, 'utf-8');
  } else {
    // Format as text
    const textData = logs.map(log => formatLogAsText(log)).join('\n' + '='.repeat(80) + '\n');
    const header = `Audit Logs Export\nGenerated: ${new Date().toISOString()}\nTotal Entries: ${logs.length}\n${'='.repeat(80)}\n\n`;
    await writeFile(tempFilePath, header + textData, 'utf-8');
  }

  return tempFilePath;
}

/**
 * Format a single log entry as text
 *
 * @param log - Audit log entry
 * @returns Formatted text string
 */
function formatLogAsText(log: AuditLogEntry): string {
  return `
Timestamp: ${log.created_at}
Action: ${log.action}
Actor: ${log.actor_type} (${log.actor_id})
Target: ${log.target_type} (${log.target_id})
Metadata: ${JSON.stringify(log.metadata, null, 2)}
IP Address: ${log.ip_address || 'N/A'}
User Agent: ${log.user_agent || 'N/A'}
`;
}

/**
 * Compress a file using gzip
 *
 * @param filePath - Path to the file to compress
 * @returns Path to the compressed file
 */
async function compressFile(filePath: string): Promise<string> {
  const compressedPath = `${filePath}.gz`;

  await pipeline(
    createReadStream(filePath),
    createGzip(),
    createWriteStream(compressedPath)
  );

  return compressedPath;
}

/**
 * Upload log export file to Telegram storage
 *
 * @param filePath - Path to the log export file
 * @param storagePath - Target path in Telegram storage
 * @returns The file_id from Telegram storage
 */
async function uploadToTelegramStorage(
  filePath: string,
  storagePath: string
): Promise<string> {
  // TODO: Implement actual Telegram storage upload
  // This would involve:
  // 1. Reading the export file
  // 2. Uploading to Telegram Bot API file upload endpoint
  // 3. Getting a file ID or URL back
  // 4. Storing the file metadata for later retrieval

  console.log(`[ExportLogs] Mock: Uploaded ${filePath} to Telegram storage path: ${storagePath}`);

  // Simulate upload delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Return a mock file_id
  return storagePath;
}

/**
 * Send notification when export is complete
 *
 * @param email - Recipient email address
 * @param projectId - Project ID
 * @param entryCount - Number of log entries exported
 * @param sizeBytes - Size of the export in bytes
 * @param _format - Export format (unused but kept for interface consistency)
 */
async function sendNotification(
  email: string,
  projectId: string,
  entryCount: number,
  sizeBytes: number,
  _format: string
): Promise<void> {
  // TODO: Implement actual notification sending
  // This would involve:
  // 1. Using an email service (SendGrid, AWS SES, Resend, etc.)
  // 2. Formatting a professional email with export details
  // 3. Sending to the specified recipient
  // 4. Handling delivery failures and retries

  console.log(
    `[ExportLogs] Mock: Sent notification to ${email} for project ${projectId}, entries: ${entryCount}, size: ${sizeBytes} bytes`
  );
}

/**
 * Clean up temporary file
 *
 * @param filePath - Path to the temporary file
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
    console.log(`[ExportLogs] Cleaned up temp file: ${filePath}`);
  } catch (error) {
    console.warn(`[ExportLogs] Failed to clean up temp file ${filePath}:`, error);
  }
}

/**
 * Convenience function to enqueue an export_logs job
 *
 * @param projectId - The ID of the project to export logs for
 * @param options - Optional configuration for the export
 * @returns Promise resolving to the job ID
 */
export async function enqueueExportLogsJob(
  projectId: string,
  options?: Partial<Omit<ExportLogsPayload, 'project_id'>>
): Promise<string> {
  const payload: ExportLogsPayload = {
    project_id: projectId,
    ...options,
  };

  const result = await enqueueJob('export_logs', payload, {
    maxAttempts: 3, // Supports retry logic
  });

  return result.id;
}
