/**
 * Export Backup Job Handler
 *
 * Handles project backup exports by:
 * 1. Generating a SQL dump of the project's schema
 * 2. Uploading the dump to Telegram storage
 * 3. Sending a notification when complete
 *
 * This job supports retry logic for transient failures (e.g., network issues,
 * temporary storage unavailability). Unlike rotate_key, this is NOT a one-shot job.
 *
 * US-007: Implement Export Backup Job
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { exportBackupHandler } from '@/lib/jobs/handlers/export-backup.handler';
 *
 * // Register the handler
 * worker.registerHandler('export_backup', exportBackupHandler);
 *
 * // Enqueue an export backup job
 * await enqueueJob('export_backup', { project_id: 'proj-123' });
 * ```
 */

import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import { spawn } from 'child_process';
import { unlink, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGzip } from 'zlib';

/**
 * Export backup handler payload
 */
interface ExportBackupPayload extends JobPayload {
  /**
   * The ID of the project to export
   * Used to identify which project schema to dump
   */
  project_id: string;

  /**
   * Optional backup format
   * @default 'sql'
   */
  format?: 'sql' | 'tar';

  /**
   * Optional compression flag
   * @default true
   */
  compress?: boolean;

  /**
   * Optional notification email
   * If provided, sends notification when backup is complete
   */
  notify_email?: string;

  /**
   * Optional Telegram storage path
   * If not provided, uses default path: /backups/{project_id}/{timestamp}.sql
   */
  storage_path?: string;
}

/**
 * Backup export metadata
 */
interface BackupMetadata extends Record<string, unknown> {
  /**
   * The ID of the project that was exported
   */
  projectId: string;

  /**
   * The format of the backup file
   */
  format: string;

  /**
   * Whether the backup was compressed
   */
  compressed: boolean;

  /**
   * Size of the backup file in bytes
   */
  sizeBytes: number;

  /**
   * Storage location where backup was uploaded
   */
  storagePath: string;

  /**
   * Timestamp when backup was created
   */
  createdAt: Date;

  /**
   * Duration of the export process in milliseconds
   */
  durationMs: number;

  /**
   * Number of tables included in the backup
   */
  tableCount: number;
}

/**
 * Input validation patterns
 */
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  STORAGE_PATH_PATTERN: /^[a-zA-Z0-9_/._-]+$/,
  SCHEMA_NAME_PATTERN: /^[a-zA-Z0-9_-]+$/,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

/**
 * Default configuration values
 */
const DEFAULT_BACKUP_CONFIG = {
  /**
   * Default backup format
   */
  format: 'sql' as const,

  /**
   * Default compression setting
   */
  compress: true,

  /**
   * Default storage path template
   * Variables: {project_id}, {timestamp}, {format}
   */
  storagePathTemplate: '/backups/{project_id}/{timestamp}.{format}',

  /**
   * Maximum time allowed for backup generation (milliseconds)
   */
  maxBackupTime: 30 * 60 * 1000, // 30 minutes

  /**
   * Maximum backup size (bytes) - 10GB
   */
  maxBackupSize: 10 * 1024 * 1024 * 1024,
} as const;

/**
 * Export Backup Job Handler
 *
 * Generates a SQL dump of the project's schema, uploads it to Telegram storage,
 * and sends a notification when complete.
 *
 * This job supports retry logic for transient failures such as:
 * - Network connectivity issues
 * - Temporary storage unavailability
 * - Database connection errors
 *
 * @param payload - Job payload containing project_id and optional configuration
 * @returns Promise resolving to job execution result with backup metadata
 *
 * @throws Error if project_id is missing
 * @throws Error if project not found
 * @throws Error if backup generation fails
 * @throws Error if upload to storage fails
 * @throws Error if backup size exceeds maximum
 * @throws Error if backup generation times out
 *
 * @example
 * ```typescript
 * const result = await exportBackupHandler({
 *   project_id: 'proj-123',
 *   format: 'sql',
 *   compress: true,
 *   notify_email: 'admin@example.com'
 * });
 *
 * if (result.success) {
 *   console.log('Backup created:', result.data.storagePath);
 * } else {
 *   console.error('Backup failed:', result.error);
 * }
 * ```
 */
export async function exportBackupHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  // Validate payload
  const { project_id, format, compress, notify_email, storage_path } = payload as ExportBackupPayload;

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
    if (format && !['sql', 'tar'].includes(format)) {
      return {
        success: false,
        error: 'Invalid backup format',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid backup parameters';
    return {
      success: false,
      error: message,
    };
  }

  console.log(`[ExportBackup] Starting backup for project ID: ${project_id}`);
  const startTime = Date.now();

  let tempFilePath: string | null = null;

  try {
    // Step 1: Validate project exists and get schema info
    console.log(`[ExportBackup] Validating project ${project_id}`);
    const projectInfo = await validateAndGetProjectInfo(project_id);

    if (!projectInfo) {
      // Generic error message (don't reveal project existence)
      return {
        success: false,
        error: 'Backup operation failed',
      };
    }

    console.log(`[ExportBackup] Project found: ${projectInfo.name}, schema: ${projectInfo.schema_name}`);

    // Step 2: Generate SQL dump using pg_dump
    const backupFormat = format || DEFAULT_BACKUP_CONFIG.format;
    const shouldCompress = compress !== undefined ? compress : DEFAULT_BACKUP_CONFIG.compress;

    console.log(`[ExportBackup] Generating SQL dump in ${backupFormat} format (compress: ${shouldCompress})`);

    const dumpResult = await generateSqlDump(
      projectInfo.schema_name,
      backupFormat,
      shouldCompress
    );

    tempFilePath = dumpResult.filePath;
    const { sizeBytes, tableCount } = dumpResult;

    console.log(`[ExportBackup] Dump generated: ${sizeBytes} bytes, ${tableCount} tables`);

    // Step 3: Verify backup size
    if (sizeBytes > DEFAULT_BACKUP_CONFIG.maxBackupSize) {
      await cleanupTempFile(tempFilePath);
      // Generic error (don't reveal internal limits)
      return {
        success: false,
        error: 'Backup size exceeds maximum allowed',
      };
    }

    // Step 4: Upload to Telegram storage
    const storagePath = storage_path || generateStoragePath(project_id, backupFormat);
    console.log(`[ExportBackup] Uploading backup to storage: ${storagePath}`);

    await uploadToTelegramStorage(tempFilePath, storagePath);

    // Step 5: Send notification if email provided
    if (notify_email) {
      await sendNotification(
        notify_email,
        project_id,
        storagePath,
        sizeBytes,
        backupFormat
      ).catch(() => {
        // Notification failure should not fail the backup
        console.warn(`[ExportBackup] Failed to send notification to ${notify_email}`);
      });
    }

    // Step 6: Prepare result metadata
    const durationMs = Date.now() - startTime;
    const metadata: BackupMetadata = {
      projectId: project_id,
      format: backupFormat,
      compressed: shouldCompress,
      sizeBytes,
      storagePath,
      createdAt: new Date(),
      durationMs,
      tableCount,
    };

    console.log(`[ExportBackup] Successfully completed backup for project ${project_id} in ${durationMs}ms`);

    // Cleanup temp file
    await cleanupTempFile(tempFilePath);

    return {
      success: true,
      data: metadata,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Log detailed error for debugging (but don't expose to user)
    console.error(`[ExportBackup] Failed to export backup for project ${project_id}:`, {
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
 * Generate storage path for backup file
 *
 * Creates a unique storage path based on project ID, timestamp, and format.
 *
 * SECURITY: Validates project ID and prevents path traversal.
 * Uses safe path joining to prevent directory traversal attacks.
 *
 * @param projectId - The project ID
 * @param format - The backup format
 * @returns The generated storage path
 *
 * @example
 * ```typescript
 * const path = generateStoragePath('proj-123', 'sql');
 * // Returns: /backups/proj-123/20250129-143000.sql
 * ```
 */
function generateStoragePath(projectId: string, format: string): string {
  // Security: Validate project ID before using in path
  validateProjectId(projectId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
  const date = new Date().toISOString().split('T')[0];

  // Security: Use safe path construction (prevent path traversal)
  const safePath = join(
    '/backups',
    projectId,
    `${date}-${timestamp}.${format}`
  );

  // Ensure path is normalized (resolve any .. or . components)
  const normalized = safePath.replace(/\/+/g, '/');

  // Double-check no path traversal (defense in depth)
  if (normalized.includes('..') || !normalized.startsWith('/backups/')) {
    throw new Error('Path traversal detected in storage path generation');
  }

  return normalized;
}

/**
 * Convenience function to enqueue an export_backup job
 *
 * @param projectId - The ID of the project to export
 * @param options - Optional configuration for the backup
 * @returns Promise resolving to the job ID
 *
 * @example
 * ```typescript
 * import { enqueueExportBackupJob } from '@/lib/jobs/handlers/export-backup.handler';
 *
 * // Basic backup with defaults
 * const jobId1 = await enqueueExportBackupJob('proj-123');
 *
 * // Backup with custom options
 * const jobId2 = await enqueueExportBackupJob('proj-123', {
 *   format: 'sql',
 *   compress: true,
 *   notify_email: 'admin@example.com',
 *   storage_path: '/custom/path/backup.sql'
 * });
 * ```
 */
export async function enqueueExportBackupJob(
  projectId: string,
  options?: Partial<Omit<ExportBackupPayload, 'project_id'>>
): Promise<string> {
  const { enqueueJob } = await import('@/lib/jobs/queue.js');

  const payload: ExportBackupPayload = {
    project_id: projectId,
    ...options,
  };

  const result = await enqueueJob('export_backup', payload, {
    maxAttempts: 3, // Supports retry logic
  });

  return result.id;
}

/**
 * Validate project ID format and content
 *
 * Performs security validation to prevent command injection and path traversal.
 *
 * @param id - The project ID to validate
 * @throws Error if validation fails
 */
function validateProjectId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('Project ID is required and must be a string');
  }

  // Length check
  if (id.length > VALIDATIONS.PROJECT_ID_MAX_LENGTH) {
    throw new Error('Project ID exceeds maximum length');
  }

  // Pattern check (alphanumeric, hyphens, underscores only)
  if (!VALIDATIONS.PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Project ID contains invalid characters');
  }

  // Path traversal prevention
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Project ID cannot contain path traversal sequences');
  }
}

/**
 * Validate schema name format and content
 *
 * Performs security validation to prevent command injection.
 *
 * @param name - The schema name to validate
 * @throws Error if validation fails
 */
function validateSchemaName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Schema name is required and must be a string');
  }

  // Pattern check
  if (!VALIDATIONS.SCHEMA_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
}

/**
 * Validate storage path format and content
 *
 * Performs security validation to prevent path traversal attacks.
 *
 * @param path - The storage path to validate
 * @throws Error if validation fails
 */
function validateStoragePath(path: string): void {
  if (!path) {
    return; // Empty path is allowed (will use default)
  }

  // Reject absolute paths
  if (path.startsWith('/')) {
    throw new Error('Absolute paths not allowed in storage_path');
  }

  // Reject path traversal
  if (path.includes('..')) {
    throw new Error('Path traversal not allowed in storage_path');
  }

  // Pattern check
  if (!VALIDATIONS.STORAGE_PATH_PATTERN.test(path)) {
    throw new Error('Storage path contains invalid characters');
  }
}

/**
 * Validate backup configuration
 *
 * Checks if the backup configuration is valid before starting the export.
 *
 * @param config - The backup configuration to validate
 * @returns True if configuration is valid, throws error otherwise
 *
 * @throws Error if format is invalid
 * @throws Error if project_id is missing
 *
 * @example
 * ```typescript
 * const config: ExportBackupPayload = {
 *   project_id: 'proj-123',
 *   format: 'sql',
 *   compress: true
 * };
 *
 * if (await validateBackupConfig(config)) {
 *   // Proceed with backup
 * }
 * ```
 */
export async function validateBackupConfig(
  config: ExportBackupPayload
): Promise<boolean> {
  if (!config.project_id) {
    throw new Error('project_id is required');
  }

  // Security: Validate project_id
  validateProjectId(config.project_id);

  if (config.format && !['sql', 'tar'].includes(config.format)) {
    throw new Error(`Invalid format: ${config.format}. Must be 'sql' or 'tar'`);
  }

  // Security: Validate storage_path if provided
  if (config.storage_path) {
    validateStoragePath(config.storage_path);
  }

  // Validate email format if provided
  if (config.notify_email && !VALIDATIONS.EMAIL_PATTERN.test(config.notify_email)) {
    throw new Error('Invalid email format');
  }

  return true;
}

/**
 * Validate project exists and get its information
 *
 * Queries the database to verify the project exists and retrieves its schema name.
 * Project schemas follow the pattern: tenant_{project_id}
 *
 * @param projectId - The project ID to validate
 * @returns Project information including schema name, or null if not found
 *
 * @throws Error if database query fails
 */
async function validateAndGetProjectInfo(
  projectId: string
): Promise<{ id: string; name: string; schema_name: string } | null> {
  const queryText = `
    SELECT
      id,
      name,
      id as schema_name
    FROM control_plane.projects
    WHERE id = $1
      AND status = 'ACTIVE'
  `;

  try {
    const result = await query(queryText, [projectId]);

    if (result.rows.length === 0) {
      return null;
    }

    const project = result.rows[0] as {
      id: string;
      name: string;
      schema_name: string;
    };

    return project;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to validate project: ${message}`);
  }
}

/**
 * Generate SQL dump using pg_dump
 *
 * Executes pg_dump command to create a backup of the project's schema.
 * The dump includes all tables, data, and schema definitions.
 *
 * SECURITY: Uses spawn with argument array to prevent command injection.
 * Password is passed via environment object, not command line.
 *
 * @param schemaName - The name of the schema to dump
 * @param format - Backup format ('sql' or 'tar')
 * @param compress - Whether to compress the output
 * @returns Object containing file path, size in bytes, and table count
 *
 * @throws Error if pg_dump command fails
 * @throws Error if temp file creation fails
 */
async function generateSqlDump(
  schemaName: string,
  format: string,
  compress: boolean
): Promise<{ filePath: string; sizeBytes: number; tableCount: number }> {
  // Security: Validate schema name to prevent command injection
  validateSchemaName(schemaName);

  // Generate safe temp file path (no user input in filename)
  const timestamp = Date.now();
  const tempFileName = `backup_${timestamp}.${format}${compress ? '.gz' : ''}`;
  const tempFilePath = join(tmpdir(), tempFileName);

  // Get database connection info from environment
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Parse connection string to get components
  const dbUrl = new URL(databaseUrl);
  const dbHost = dbUrl.hostname;
  const dbPort = dbUrl.port || '5432';
  const dbUser = dbUrl.username;
  const dbName = dbUrl.pathname.replace('/', '');
  const dbPassword = dbUrl.password;

  // Build pg_dump arguments array (SECURE: no shell injection)
  const pgDumpArgs = [
    ['-h', dbHost],
    ['-p', dbPort],
    ['-U', dbUser],
    ['-d', dbName],
    ['-n', schemaName], // Schema name is validated above
    ['--no-owner'],
    ['--no-acl'],
    ['--format', format === 'tar' ? 't' : 'p'], // 't' for tar, 'p' for plain SQL
  ].flat();

  console.log(`[ExportBackup] Executing pg_dump for schema: ${schemaName}`);

  try {
    // Execute pg_dump with timeout (SECURE: spawn with args array)
    await execWithTimeout(
      'pg_dump',
      pgDumpArgs,
      {
        PGPASSWORD: dbPassword, // Pass via environment (secure)
      },
      DEFAULT_BACKUP_CONFIG.maxBackupTime,
      tempFilePath,
      compress && format === 'sql'
    );

    // Get file stats
    const fileStats = await stat(tempFilePath);
    const sizeBytes = fileStats.size;

    // Count tables in the dump (parse SQL or tar file)
    const tableCount = await countTablesInDumpSafe(tempFilePath, format);

    return {
      filePath: tempFilePath,
      sizeBytes,
      tableCount,
    };
  } catch (error) {
    // Clean up temp file on error
    await cleanupTempFile(tempFilePath).catch(() => {});

    // Don't expose internal error details
    throw new Error(`Failed to generate SQL dump`);
  }
}

/**
 * Execute command with timeout and stream output to file
 *
 * A helper function to run commands with proper timeout handling
 * and stream output directly to a file (avoiding shell injection).
 *
 * @param command - Command to execute
 * @param args - Command arguments (array for security)
 * @param env - Environment variables (for password)
 * @param timeout - Timeout in milliseconds
 * @param outputPath - Path to write output
 * @param compress - Whether to compress output
 * @returns Promise that resolves when command completes
 *
 * @throws Error if command fails or times out
 */
async function execWithTimeout(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeout: number,
  outputPath: string,
  compress: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    // Create output stream
    const outputStream = createWriteStream(outputPath);

    // Handle stdout
    if (compress) {
      // Add compression
      const gzip = createGzip();
      child.stdout.pipe(gzip).pipe(outputStream);
    } else {
      child.stdout.pipe(outputStream);
    }

    // Handle stderr (pg_dump writes progress to stderr)
    let stderrOutput = '';
    child.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    // Handle completion
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      outputStream.close();

      if (code === 0) {
        // Log pg_dump output (non-error messages)
        if (stderrOutput && !stderrOutput.includes('SAVEPOINT')) {
          console.log(`[ExportBackup] pg_dump output: ${stderrOutput.trim()}`);
        }
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    // Handle spawn errors
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      outputStream.close();
      reject(error);
    });
  });
}

/**
 * Count tables in a dump file (SAFE VERSION)
 *
 * Parses the dump file to count the number of tables included.
 * For SQL format, counts CREATE TABLE statements.
 * For tar format, returns an estimate based on file size.
 *
 * SECURITY: Uses spawn with arguments array instead of shell commands
 * to prevent command injection through file paths.
 *
 * @param filePath - Path to the dump file
 * @param format - Dump format ('sql' or 'tar')
 * @returns Number of tables in the dump
 */
async function countTablesInDumpSafe(
  filePath: string,
  format: string
): Promise<number> {
  try {
    if (format === 'sql') {
      // For compressed files, use zcat via spawn
      if (filePath.endsWith('.gz')) {
        const zcat = spawn('zcat', [filePath], { stdio: 'pipe' });
        const grep = spawn('grep', ['-c', 'CREATE TABLE'], { stdio: ['pipe', 'pipe', 'pipe'] });

        let grepOutput = '';

        grep.stdout.on('data', (data) => {
          grepOutput += data.toString();
        });

        zcat.stdout.pipe(grep.stdin);

        return new Promise((resolve) => {
          grep.on('close', () => {
            const count = parseInt(grepOutput.trim(), 10) || 0;
            resolve(count);
          });

          grep.on('error', () => resolve(0));
          zcat.on('error', () => resolve(0));
        });
      } else {
        // For non-compressed files, use grep safely
        return new Promise((resolve) => {
          const grep = spawn('grep', ['-c', 'CREATE TABLE', filePath], {
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let grepOutput = '';

          grep.stdout.on('data', (data) => {
            grepOutput += data.toString();
          });

          grep.on('close', () => {
            const count = parseInt(grepOutput.trim(), 10) || 0;
            resolve(count);
          });

          grep.on('error', () => resolve(0));
        });
      }
    } else {
      // For tar format, we can't easily parse without tar tools
      // Return an estimate based on typical table counts
      // TODO: Implement proper tar parsing if needed
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Upload backup file to Telegram storage
 *
 * Uploads the generated backup file to the configured Telegram storage.
 * This is a mock implementation with detailed TODOs for real Telegram API integration.
 *
 * @param filePath - Path to the backup file
 * @param storagePath - Target path in Telegram storage
 *
 * @throws Error if upload fails
 */
async function uploadToTelegramStorage(
  filePath: string,
  storagePath: string
): Promise<void> {
  // TODO: Implement actual Telegram storage upload
  // This would involve:
  // 1. Reading the backup file
  // 2. Uploading to Telegram Bot API file upload endpoint
  // 3. Getting a file ID or URL back
  // 4. Storing the file metadata for later retrieval
  //
  // Example implementation:
  // const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  // const formData = new FormData();
  // formData.append('document', createReadStream(filePath));
  //
  // const response = await axios.post(
  //   `https://api.telegram.org/bot${telegramBotToken}/sendDocument`,
  //   formData,
  //   { headers: formData.getHeaders() }
  // );
  //
  // const fileId = response.data.result.document.file_id;
  // console.log(`[ExportBackup] Uploaded to Telegram, file_id: ${fileId}`);

  console.log(`[ExportBackup] Mock: Uploaded ${filePath} to Telegram storage path: ${storagePath}`);

  // Simulate upload delay
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Send notification when backup is complete
 *
 * Sends an email notification to the specified recipient with backup details.
 * This is a mock implementation with detailed TODOs for real notification service.
 *
 * @param email - Recipient email address
 * @param projectId - Project ID that was backed up
 * @param _storagePath - Storage path of the backup
 * @param sizeBytes - Size of the backup in bytes
 * @param _format - Backup format
 *
 * @throws Error if notification sending fails
 */
async function sendNotification(
  email: string,
  projectId: string,
  _storagePath: string,
  sizeBytes: number,
  _format: string
): Promise<void> {
  // TODO: Implement actual notification sending
  // This would involve:
  // 1. Using an email service (SendGrid, AWS SES, Resend, etc.)
  // 2. Formatting a professional email with backup details
  // 3. Sending to the specified recipient
  // 4. Handling delivery failures and retries
  //
  // Example implementation:
  // const emailService = new EmailService({
  //   apiKey: process.env.SENDGRID_API_KEY,
  //   from: 'backups@nextmavens.com'
  // });
  //
  // await emailService.send({
  //   to: email,
  //   subject: `Backup Complete: ${projectId}`,
  //   html: `
  //     <h2>Backup Successfully Completed</h2>
  //     <p>Project: ${projectId}</p>
  //     <p>Storage Path: ${storagePath}</p>
  //     <p>Size: ${formatBytes(sizeBytes)}</p>
  //     <p>Format: ${format}</p>
  //     <p>Completed: ${new Date().toISOString()}</p>
  //   `
  // });

  // Log notification details
  console.log(
    `[ExportBackup] Mock: Sent notification to ${email} for project ${projectId}, size: ${sizeBytes} bytes`
  );
}

/**
 * Clean up temporary file
 *
 * Removes the temporary backup file after upload or on error.
 *
 * @param filePath - Path to the temporary file
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
    console.log(`[ExportBackup] Cleaned up temp file: ${filePath}`);
  } catch (error) {
    // Log but don't throw - cleanup failures are not critical
    console.warn(`[ExportBackup] Failed to clean up temp file ${filePath}:`, error);
  }
}
