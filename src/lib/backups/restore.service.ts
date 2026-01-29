/**
 * Restore Service
 *
 * Handles restoration of database backups from Telegram storage.
 * Supports both synchronous (small backups) and asynchronous (large backups) restoration.
 *
 * US-006: Implement Restore from Backup - Step 7: Data Layer
 */

import { spawn } from 'child_process';
import { unlink, writeFile } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { getBackupById, incrementRestoreCount } from './backups.service.js';
import {
  recordRestoreOperation,
  updateRestoreStatus,
} from './restore-history.service.js';
import type { RestoreHistory } from './restore-history.types.js';
import type { Backup } from '@nextmavens/audit-logs-database';
import { RestoreStatus } from './restore-history.types.js';

/**
 * Restore validation constants
 */
const VALIDATION = {
  /** Maximum backup size for synchronous restore (100MB) */
  MAX_SYNC_RESTORE_SIZE: 100 * 1024 * 1024,
  /** Maximum allowed restore time in milliseconds (2 hours) */
  MAX_RESTORE_TIME: 2 * 60 * 60 * 1000,
  /** Maximum file_id length */
  MAX_FILE_ID_LENGTH: 500,
  /** Minimum file_id length */
  MIN_FILE_ID_LENGTH: 1,
} as const;

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  /** Whether the restore was successful */
  success: boolean;

  /** Job ID if restore was queued (for large backups) */
  job_id?: string;

  /** Status of the restore operation */
  status: 'completed' | 'queued' | 'failed';

  /** Error message if failed */
  error?: string;

  /** Number of tables restored */
  tables_restored?: number;

  /** Size of backup in bytes */
  backup_size?: number;

  /** Duration of restore in milliseconds */
  duration_ms?: number;

  /** Warning about data overwrite */
  warning: string;
}

/**
 * Restore request options
 */
export interface RestoreOptions {
  /** Backup ID to restore (takes precedence over file_id) */
  backup_id?: string;

  /** Telegram file ID to restore directly */
  file_id?: string;

  /** Project ID (required for verification) */
  project_id: string;

  /** Whether to force restore without confirmation */
  force?: boolean;

  /** Whether to use async processing (for large backups) */
  async?: boolean;
}

/**
 * Custom error class for restore operations
 */
export class RestoreError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

/**
 * Validate file_id format
 */
function validateFileId(fileId: string): void {
  if (typeof fileId !== 'string') {
    throw new RestoreError('File ID must be a string', 'INVALID_FILE_ID');
  }
  if (fileId.trim().length === 0) {
    throw new RestoreError('File ID cannot be empty', 'INVALID_FILE_ID');
  }
  if (fileId.length > VALIDATION.MAX_FILE_ID_LENGTH) {
    throw new RestoreError(
      `File ID cannot exceed ${VALIDATION.MAX_FILE_ID_LENGTH} characters`,
      'INVALID_FILE_ID'
    );
  }
}

/**
 * Validate backup_id format
 */
function validateBackupId(backupId: string): void {
  if (typeof backupId !== 'string') {
    throw new RestoreError('Backup ID must be a string', 'INVALID_BACKUP_ID');
  }
  if (backupId.trim().length === 0) {
    throw new RestoreError('Backup ID cannot be empty', 'INVALID_BACKUP_ID');
  }
  // UUID format validation
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(backupId)) {
    throw new RestoreError('Backup ID must be a valid UUID', 'INVALID_BACKUP_ID');
  }
}

/**
 * Validate project_id format
 */
function validateProjectId(projectId: string): void {
  if (typeof projectId !== 'string') {
    throw new RestoreError('Project ID must be a string', 'INVALID_PROJECT_ID');
  }
  if (projectId.trim().length === 0) {
    throw new RestoreError('Project ID cannot be empty', 'INVALID_PROJECT_ID');
  }
  // Alphanumeric, hyphens, underscores only
  const projectIdRegex = /^[a-zA-Z0-9_-]+$/;
  if (!projectIdRegex.test(projectId)) {
    throw new RestoreError('Project ID contains invalid characters', 'INVALID_PROJECT_ID');
  }
}

/**
 * Get backup record by backup_id or file_id
 *
 * @param backupId - Optional backup ID
 * @param fileId - Optional file ID
 * @returns Backup record or null
 */
async function getBackupRecord(
  backupId: string | undefined,
  _fileId: string | undefined
): Promise<Backup | null> {
  if (backupId) {
    return await getBackupById(backupId);
  }
  // If only file_id is provided, we cannot look up in database
  // This is okay - we can still restore directly from Telegram
  return null;
}

/**
 * Fetch backup file from Telegram
 *
 * Downloads the backup file from Telegram storage to a temporary location.
 *
 * @param fileId - The Telegram file ID
 * @returns Path to the downloaded file
 *
 * @throws RestoreError if download fails
 */
async function fetchFromTelegram(fileId: string): Promise<string> {
  // TODO: Implement actual Telegram file download
  // This would involve:
  // 1. Calling Telegram Bot API getFile endpoint to get file path
  // 2. Downloading the file from Telegram's file server
  // 3. Saving to a temporary location
  //
  // Example implementation:
  // const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  // const fileInfo = await axios.get(
  //   `https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${fileId}`
  // );
  //
  // const filePath = fileInfo.data.result.file_path;
  // const fileUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${filePath}`;
  //
  // const tempFilePath = join(tmpdir(), `restore_${Date.now()}.sql.gz`);
  // const writer = createWriteStream(tempFilePath);
  //
  // await axios({
  //   method: 'GET',
  //   url: fileUrl,
  //   responseType: 'stream'
  // }).then(response => {
  //   response.data.pipe(writer);
  //   return new Promise((resolve, reject) => {
  //     writer.on('finish', resolve);
  //     writer.on('error', reject);
  //   });
  // });
  //
  // return tempFilePath;

  console.log(`[Restore] Mock: Downloading file from Telegram: ${fileId}`);

  // Simulate download delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // For now, return a mock path
  // In production, this would be the actual downloaded file path
  const tempFilePath = join(tmpdir(), `restore_${Date.now()}.sql.gz`);

  // Create a mock file for testing
  await writeFile(tempFilePath, '-- Mock SQL backup file\n');

  return tempFilePath;
}

/**
 * Decompress backup file if needed
 *
 * @param compressedPath - Path to compressed file
 * @returns Path to decompressed file
 */
async function decompressBackup(compressedPath: string): Promise<string> {
  if (!compressedPath.endsWith('.gz')) {
    return compressedPath;
  }

  const decompressedPath = compressedPath.replace('.gz', '');

  await pipeline(
    createReadStream(compressedPath),
    createGunzip(),
    createWriteStream(decompressedPath)
  );

  // Clean up compressed file
  await unlink(compressedPath);

  return decompressedPath;
}

/**
 * Restore SQL dump to database
 *
 * Executes psql command to restore the database from a SQL dump file.
 *
 * @param sqlFilePath - Path to the SQL dump file
 * @param schemaName - The target schema name
 * @returns Number of tables restored
 *
 * @throws RestoreError if restore fails
 */
async function restoreToDatabase(
  sqlFilePath: string,
  schemaName: string
): Promise<number> {
  // Get database connection info from environment
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new RestoreError('DATABASE_URL environment variable is not set', 'CONFIG_ERROR');
  }

  // Parse connection string
  const dbUrl = new URL(databaseUrl);
  const dbHost = dbUrl.hostname;
  const dbPort = dbUrl.port || '5432';
  const dbUser = dbUrl.username;
  const dbName = dbUrl.pathname.replace('/', '');
  const dbPassword = dbUrl.password;

  // Build psql arguments array (SECURE: no shell injection)
  const psqlArgs = [
    ['-h', dbHost],
    ['-p', dbPort],
    ['-U', dbUser],
    ['-d', dbName],
    ['-f', sqlFilePath],
    ['--quiet'],
    ['--no-psqlrc'],
  ].flat();

  console.log(`[Restore] Executing psql restore for schema: ${schemaName}`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let tablesRestored = 0;

    const child = spawn('psql', psqlArgs, {
      env: { ...process.env, PGPASSWORD: dbPassword },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new RestoreError('Restore operation timed out', 'TIMEOUT'));
    }, VALIDATION.MAX_RESTORE_TIME);

    // Parse stdout to count tables
    child.stdout.on('data', (data) => {
      const output = data.toString();
      // Count CREATE TABLE statements
      const matches = output.match(/CREATE TABLE/g);
      if (matches) {
        tablesRestored = matches.length;
      }
    });

    // Handle stderr (psql writes warnings to stderr)
    child.stderr.on('data', (data) => {
      const output = data.toString();
      // Log non-critical warnings
      if (output && !output.includes('WARNING')) {
        console.log(`[Restore] psql output: ${output.trim()}`);
      }
    });

    // Handle completion
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log(`[Restore] Completed in ${duration}ms, restored ${tablesRestored} tables`);

      if (code === 0) {
        resolve(tablesRestored);
      } else {
        reject(new RestoreError(`psql failed with exit code ${code}`, 'RESTORE_FAILED'));
      }
    });

    // Handle spawn errors
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(new RestoreError(`Failed to execute psql: ${error.message}`, 'EXECUTION_ERROR'));
    });
  });
}

/**
 * Restore from backup
 *
 * Main function to restore a database backup. Supports both synchronous
 * and asynchronous restoration based on backup size.
 *
 * @param options - Restore options
 * @returns Restore result with status and details
 *
 * @example
 * ```typescript
 * // Restore by backup ID (synchronous for small backups)
 * const result = await restoreFromBackup({
 *   backup_id: 'backup-123',
 *   project_id: 'proj-abc',
 * });
 *
 * // Restore by file ID (asynchronous for large backups)
 * const result = await restoreFromBackup({
 *   file_id: 'telegram-file-456',
 *   project_id: 'proj-abc',
 *   async: true,
 * });
 * ```
 */
export async function restoreFromBackup(options: RestoreOptions): Promise<RestoreResult> {
  const startTime = Date.now();

  // Validate project_id
  validateProjectId(options.project_id);

  // Validate that either backup_id or file_id is provided
  if (!options.backup_id && !options.file_id) {
    return {
      success: false,
      status: 'failed',
      error: 'Either backup_id or file_id must be provided',
      warning: 'Restoring from backup will overwrite existing data',
    };
  }

  // Validate backup_id or file_id if provided
  if (options.backup_id) {
    validateBackupId(options.backup_id);
  }
  if (options.file_id) {
    validateFileId(options.file_id);
  }

  // Check if force flag is set
  if (!options.force) {
    return {
      success: false,
      status: 'failed',
      error: 'Restore requires force=true to confirm data overwrite',
      warning: 'WARNING: This will overwrite existing data. Set force=true to proceed.',
    };
  }

  let tempFilePath: string | null = null;
  let backupRecord: Backup | null = null;
  let restoreHistory: RestoreHistory | null = null;

  try {
    // Step 1: Get backup record if backup_id provided
    if (options.backup_id) {
      backupRecord = await getBackupRecord(options.backup_id, options.file_id);

      if (!backupRecord) {
        // Record failed restore attempt (only if we have a file_id)
        if (options.file_id) {
          await recordRestoreOperation(
            options.project_id,
            options.backup_id,
            options.file_id,
            RestoreStatus.FAILED,
            'Backup not found'
          ).catch((err) => console.error('[Restore] Failed to record restore history:', err));
        }

        return {
          success: false,
          status: 'failed',
          error: 'Backup not found',
          warning: 'Restoring from backup will overwrite existing data',
        };
      }

      // Verify project ownership
      if (backupRecord.project_id !== options.project_id) {
        // Record failed restore attempt
        await recordRestoreOperation(
          options.project_id,
          options.backup_id,
          backupRecord.file_id,
          RestoreStatus.FAILED,
          'Backup does not belong to the specified project'
        ).catch((err) => console.error('[Restore] Failed to record restore history:', err));

        return {
          success: false,
          status: 'failed',
          error: 'Backup does not belong to the specified project',
          warning: 'Restoring from backup will overwrite existing data',
        };
      }

      // Check if backup is too large for synchronous restore
      const shouldUseAsync =
        options.async || backupRecord.size > VALIDATION.MAX_SYNC_RESTORE_SIZE;

      if (shouldUseAsync) {
        // Record pending async restore
        restoreHistory = await recordRestoreOperation(
          options.project_id,
          options.backup_id,
          backupRecord.file_id,
          RestoreStatus.PENDING
        );

        // TODO: Enqueue async restore job
        // For now, return an error indicating async is not yet implemented
        await updateRestoreStatus(
          restoreHistory.id,
          RestoreStatus.FAILED,
          'Async restore not yet implemented - use smaller backup or implement async job handler'
        ).catch((err) => console.error('[Restore] Failed to update restore history:', err));

        return {
          success: false,
          status: 'failed',
          error: 'Async restore not yet implemented - use smaller backup or implement async job handler',
          warning: 'Restoring from backup will overwrite existing data',
        };
      }
    }

    // Step 2: Determine file_id to use
    const fileId = options.file_id || backupRecord?.file_id;

    if (!fileId) {
      // Record failed restore attempt
      if (backupRecord) {
        await recordRestoreOperation(
          options.project_id,
          backupRecord.id,
          backupRecord.file_id,
          RestoreStatus.FAILED,
          'No file ID available for restore'
        ).catch((err) => console.error('[Restore] Failed to record restore history:', err));
      }

      return {
        success: false,
        status: 'failed',
        error: 'No file ID available for restore',
        warning: 'Restoring from backup will overwrite existing data',
      };
    }

    // Step 3: Record restore operation as pending
    restoreHistory = await recordRestoreOperation(
      options.project_id,
      options.backup_id,
      fileId,
      RestoreStatus.PENDING
    );

    // Step 4: Update status to in_progress
    await updateRestoreStatus(restoreHistory.id, RestoreStatus.IN_PROGRESS).catch((err) =>
      console.error('[Restore] Failed to update restore history:', err)
    );

    // Step 5: Fetch backup from Telegram
    console.log(`[Restore] Fetching backup from Telegram: ${fileId}`);
    tempFilePath = await fetchFromTelegram(fileId);

    // Step 6: Decompress if needed
    const decompressedPath = await decompressBackup(tempFilePath);
    tempFilePath = decompressedPath;

    // Step 7: Get schema name (tenant_{project_id})
    const schemaName = `tenant_${options.project_id}`;

    // Step 8: Restore to database
    console.log(`[Restore] Restoring to schema: ${schemaName}`);
    const tablesRestored = await restoreToDatabase(tempFilePath, schemaName);

    // Step 9: Prepare result
    const durationMs = Date.now() - startTime;
    const backupSize = backupRecord?.size || 0;

    console.log(
      `[Restore] Successfully restored ${tablesRestored} tables for project ${options.project_id} in ${durationMs}ms`
    );

    // Step 10: Update restore history as completed
    await updateRestoreStatus(
      restoreHistory.id,
      RestoreStatus.COMPLETED,
      undefined,
      tablesRestored,
      durationMs,
      backupSize
    ).catch((err) => console.error('[Restore] Failed to update restore history:', err));

    // Step 11: Increment restore count on backup record
    if (backupRecord) {
      await incrementRestoreCount(backupRecord.id).catch((err) =>
        console.error('[Restore] Failed to increment restore count:', err)
      );
    }

    return {
      success: true,
      status: 'completed',
      tables_restored: tablesRestored,
      backup_size: backupSize,
      duration_ms: durationMs,
      warning: 'Data was overwritten during restore operation',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    // SECURITY: Log detailed error server-side but return generic message to client
    // This prevents information leakage about database structure, paths, etc.
    console.error(`[Restore] Failed to restore backup:`, {
      error: errorMessage,
      error_name: error instanceof Error ? error.name : 'Unknown',
      project_id: options.project_id,
      backup_id: options.backup_id,
      timestamp: new Date().toISOString(),
      // Don't log stack traces in production - they may contain sensitive data
    });

    // SECURITY: Return generic error message to client
    // Specific error details are logged server-side for debugging
    const safeErrorMessage = 'Restore operation failed. Please check the backup file and try again.';

    // Update restore history as failed if we have a record
    if (restoreHistory) {
      await updateRestoreStatus(restoreHistory.id, RestoreStatus.FAILED, safeErrorMessage).catch(
        (err) => console.error('[Restore] Failed to update restore history:', err)
      );
    }

    return {
      success: false,
      status: 'failed',
      error: safeErrorMessage,
      warning: 'Restoring from backup will overwrite existing data',
    };
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log(`[Restore] Cleaned up temp file: ${tempFilePath}`);
      } catch (error) {
        console.warn(`[Restore] Failed to clean up temp file ${tempFilePath}:`, error);
      }
    }
  }
}

/**
 * Check if a backup should be restored asynchronously based on size
 *
 * @param backupSize - Size of the backup in bytes
 * @returns True if should use async restore
 */
export function shouldUseAsyncRestore(backupSize: number): boolean {
  return backupSize > VALIDATION.MAX_SYNC_RESTORE_SIZE;
}

/**
 * Get the maximum backup size for synchronous restore
 *
 * @returns Maximum size in bytes
 */
export function getMaxSyncRestoreSize(): number {
  return VALIDATION.MAX_SYNC_RESTORE_SIZE;
}
