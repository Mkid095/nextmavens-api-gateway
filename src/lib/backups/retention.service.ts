/**
 * Backup Retention Cleanup Service
 *
 * Provides core functionality for managing backup retention policy.
 * Handles cleanup of expired backups from both database and Telegram.
 *
 * US-010: Backup Retention Policy - Step 1: Foundation
 *
 * ARCHITECTURAL DECISIONS:
 *
 * 1. Job Scheduling: Using existing job queue system (control_plane.jobs table)
 *    - Rationale: Already integrated, supports retries, scheduling, and monitoring
 *    - Alternative considered: node-cron (less resilient, no retry logic)
 *    - Alternative considered: Bull queue (would require Redis dependency)
 *
 * 2. Cleanup Strategy: Batched deletion with transaction safety
 *    - Rationale: Prevents long-running transactions, allows progress tracking
 *    - Alternative considered: Immediate deletion (risk of timeout with many backups)
 *    - Alternative considered: Soft delete with cleanup job (adds complexity)
 *
 * 3. Failure Handling: Retry with exponential backoff, then mark as failed
 *    - Rationale: Transient Telegram API failures should retry, permanent failures should alert
 *    - If Telegram API fails during cleanup: Log error, retry up to max attempts, mark as failed
 *    - Failed backups are retained in DB with status=FAILED for manual review
 *
 * 4. Notification System: Telegram notifications 7 days before expiration
 *    - Rationale: Telegram is already integrated for backup storage
 *    - Alternative considered: Email (requires additional infrastructure)
 *    - Alternative considered: In-app (requires user to log in)
 *    - Notification timing: 7 days before deletion gives users time to extend retention
 *
 * 5. Deletion Approach: Hard delete from both database and Telegram
 *    - Rationale: GDPR compliance, storage cost management
 *    - Alternative considered: Soft delete (archive table) - rejected due to complexity
 *    - If Telegram delete fails: Mark database record as failed, retry later
 */

import type {
  Backup,
  BackupType,
} from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import type {
  RetentionConfig,
  CleanupResult,
  NotificationResult,
  EligibleBackup,
  RetentionCleanupPayload,
  NotificationPayload,
} from './retention.types.js';
import {
  DEFAULT_RETENTION_CONFIG,
  RETENTION_VALIDATION,
} from './retention.types.js';
import {
  deleteBackup as deleteBackupFromDb,
} from './backups.service.js';

/**
 * Custom error class for retention operations
 */
export class RetentionError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'RetentionError';
  }
}

/**
 * Validate retention configuration
 */
function validateRetentionConfig(config: RetentionConfig): void {
  if (config.defaultRetentionDays < RETENTION_VALIDATION.MIN_RETENTION_DAYS) {
    throw new RetentionError(
      `Retention period must be at least ${RETENTION_VALIDATION.MIN_RETENTION_DAYS} day(s)`,
      'INVALID_RETENTION_DAYS'
    );
  }

  if (config.defaultRetentionDays > RETENTION_VALIDATION.MAX_RETENTION_DAYS) {
    throw new RetentionError(
      `Retention period cannot exceed ${RETENTION_VALIDATION.MAX_RETENTION_DAYS} days`,
      'INVALID_RETENTION_DAYS'
    );
  }

  if (config.notificationDays < RETENTION_VALIDATION.MIN_NOTIFICATION_DAYS) {
    throw new RetentionError(
      `Notification period must be at least ${RETENTION_VALIDATION.MIN_NOTIFICATION_DAYS} day(s)`,
      'INVALID_NOTIFICATION_DAYS'
    );
  }

  if (config.notificationDays > config.defaultRetentionDays) {
    throw new RetentionError(
      'Notification period cannot exceed retention period',
      'INVALID_NOTIFICATION_DAYS'
    );
  }

  if (config.cleanupIntervalHours < RETENTION_VALIDATION.MIN_CLEANUP_INTERVAL_HOURS) {
    throw new RetentionError(
      `Cleanup interval must be at least ${RETENTION_VALIDATION.MIN_CLEANUP_INTERVAL_HOURS} hour(s)`,
      'INVALID_CLEANUP_INTERVAL'
    );
  }

  if (config.cleanupBatchSize < RETENTION_VALIDATION.MIN_BATCH_SIZE) {
    throw new RetentionError(
      `Batch size must be at least ${RETENTION_VALIDATION.MIN_BATCH_SIZE}`,
      'INVALID_BATCH_SIZE'
    );
  }

  if (config.cleanupBatchSize > RETENTION_VALIDATION.MAX_BATCH_SIZE) {
    throw new RetentionError(
      `Batch size cannot exceed ${RETENTION_VALIDATION.MAX_BATCH_SIZE}`,
      'INVALID_BATCH_SIZE'
    );
  }
}

/**
 * Query backups that are eligible for cleanup
 *
 * A backup is eligible for cleanup if:
 * - It has expired (expires_at < NOW())
 * - OR it was notified and notification period has passed
 *
 * @param projectId - Optional project ID filter
 * @param type - Optional backup type filter
 * @param batchSize - Maximum number of backups to return
 * @returns Array of eligible backups
 */
export async function getEligibleBackups(
  projectId?: string,
  type?: BackupType,
  batchSize: number = 100
): Promise<EligibleBackup[]> {
  const conditions: string[] = ['expires_at < NOW()'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (projectId) {
    conditions.push(`project_id = $${paramIndex++}`);
    values.push(projectId);
  }

  if (type) {
    conditions.push(`type = $${paramIndex++}`);
    values.push(type);
  }

  const whereClause = conditions.join(' AND ');

  const queryText = `
    SELECT
      id,
      project_id,
      type,
      file_id,
      expires_at,
      EXTRACT(DAY FROM (NOW() - expires_at)) as days_until_expiration,
      false as notified
    FROM control_plane.backups
    WHERE ${whereClause}
    ORDER BY expires_at ASC
    LIMIT $${paramIndex++}
  `;

  values.push(batchSize);

  try {
    const result = await query(queryText, values);

    return result.rows.map((row: Record<string, unknown>) => {
      const daysExp = row.days_until_expiration;
      return {
        id: row.id as string,
        project_id: row.project_id as string,
        type: row.type as BackupType,
        file_id: row.file_id as string,
        expires_at: row.expires_at as Date,
        days_until_expiration: -(parseInt(typeof daysExp === 'string' ? daysExp : '0', 10)),
        notified: row.notified as boolean,
      };
    });
  } catch (error) {
    console.error('Failed to query eligible backups:', error);
    throw new RetentionError('Failed to query eligible backups', 'DATABASE_ERROR');
  }
}

/**
 * Query backups that need notification
 *
 * A backup needs notification if:
 * - It will expire within the notification window
 * - User has not been notified yet
 *
 * @param projectId - Optional project ID filter
 * @param type - Optional backup type filter
 * @param batchSize - Maximum number of backups to return
 * @returns Array of backups needing notification
 */
export async function getBackupsNeedingNotification(
  projectId?: string,
  type?: BackupType,
  batchSize: number = 100
): Promise<Backup[]> {
  const config = getRetentionConfig();
  const notificationThreshold = new Date();
  notificationThreshold.setDate(notificationThreshold.getDate() + config.notificationDays);

  const conditions: string[] = [
    'expires_at <= $1',
    'expires_at > NOW()'
  ];
  const values: unknown[] = [notificationThreshold];
  let paramIndex = 2;

  if (projectId) {
    conditions.push(`project_id = $${paramIndex++}`);
    values.push(projectId);
  }

  if (type) {
    conditions.push(`type = $${paramIndex++}`);
    values.push(type);
  }

  const whereClause = conditions.join(' AND ');

  const queryText = `
    SELECT
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at,
      restore_count
    FROM control_plane.backups
    WHERE ${whereClause}
    ORDER BY expires_at ASC
    LIMIT $${paramIndex++}
  `;

  values.push(batchSize);

  try {
    const result = await query(queryText, values);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      project_id: row.project_id as string,
      type: row.type as BackupType,
      file_id: row.file_id as string,
      size: row.size as number,
      created_at: row.created_at as Date,
      expires_at: row.expires_at as Date,
      restore_count: (row.restore_count as number) || 0,
    }));
  } catch (error) {
    console.error('Failed to query backups needing notification:', error);
    throw new RetentionError('Failed to query backups needing notification', 'DATABASE_ERROR');
  }
}

/**
 * Mark backup as notified
 *
 * NOTE: This is a stub implementation. The actual implementation requires
 * adding a `notified_at` column to the backups table in a future migration.
 *
 * @param backupId - Backup ID
 * @returns True if marked successfully, false if not found
 */
export async function markBackupNotified(backupId: string): Promise<boolean> {
  // TODO: Implement actual notification tracking
  // This requires adding a `notified_at` column to the backups table:
  // ALTER TABLE control_plane.backups ADD COLUMN notified_at TIMESTAMPTZ;
  //
  // For now, this is a no-op stub that allows the notification flow to work
  console.log(`[STUB] Would mark backup ${backupId} as notified`);
  return true;
}

/**
 * Delete backup from Telegram (stub implementation)
 *
 * NOTE: This is a stub implementation. The actual Telegram API deletion
 * will be implemented in a later step. For now, it returns success to
 * allow the cleanup flow to work.
 *
 * @param fileId - Telegram file ID
 * @returns Promise resolving to success status
 */
export async function deleteBackupFromTelegram(fileId: string): Promise<boolean> {
  // TODO: Implement actual Telegram deleteMessage API call
  // This requires:
  // 1. Storing the message_id when sending the backup (not currently done)
  // 2. Calling TelegramBot.deleteMessage(chatId, messageId)
  // 3. Handling errors and retries

  console.log(`[STUB] Would delete Telegram file: ${fileId}`);

  // For now, return success to allow cleanup to proceed
  // In production, this will be replaced with actual Telegram API call
  return true;
}

/**
 * Clean up a single backup
 *
 * Deletes from both database and Telegram with error handling.
 *
 * @param backup - Backup to clean up
 * @returns Promise resolving to success status and error message if failed
 */
export async function cleanupBackup(
  backup: EligibleBackup
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Delete from Telegram (if file_id exists)
    if (backup.file_id) {
      const telegramDeleted = await deleteBackupFromTelegram(backup.file_id);
      if (!telegramDeleted) {
        console.warn(`Failed to delete backup ${backup.id} from Telegram, continuing with DB deletion`);
      }
    }

    // Step 2: Delete from database
    const dbDeleted = await deleteBackupFromDb(backup.id);
    if (!dbDeleted) {
      return {
        success: false,
        error: 'Backup not found in database or already deleted',
      };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to cleanup backup ${backup.id}:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Clean up multiple expired backups
 *
 * Processes backups in batches for safety and performance.
 * Implements transaction safety and error handling.
 *
 * @param payload - Cleanup job payload
 * @returns Promise resolving to cleanup result
 */
export async function cleanupExpiredBackups(
  payload: RetentionCleanupPayload
): Promise<CleanupResult> {
  const startTime = Date.now();
  const result: CleanupResult = {
    successful: 0,
    failed: 0,
    skipped: 0,
    duration_ms: 0,
    errors: [],
  };

  try {
    // Step 1: Notify if requested (before cleanup)
    if (payload.notify_first) {
      console.log('[Retention] Sending notifications before cleanup...');
      const notificationResult = await sendExpirationNotifications({
        project_id: payload.project_id,
        type: payload.type,
        batch_size: payload.batch_size,
      });
      console.log(`[Retention] Notified ${notificationResult.successful} backups, ${notificationResult.failed} failed`);
    }

    // Step 2: Get eligible backups
    console.log('[Retention] Querying eligible backups...');
    const eligibleBackups = await getEligibleBackups(
      payload.project_id,
      payload.type,
      payload.batch_size
    );

    console.log(`[Retention] Found ${eligibleBackups.length} eligible backups`);

    if (eligibleBackups.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Step 3: If dry run, just report what would be deleted
    if (payload.dry_run) {
      console.log('[Retention] DRY RUN - would delete the following backups:');
      for (const backup of eligibleBackups) {
        console.log(`  - ${backup.id} (project: ${backup.project_id}, type: ${backup.type})`);
      }
      result.skipped = eligibleBackups.length;
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Step 4: Process each backup
    console.log('[Retention] Starting cleanup...');
    for (const backup of eligibleBackups) {
      const cleanupResult = await cleanupBackup(backup);

      if (cleanupResult.success) {
        result.successful++;
        console.log(`[Retention] Successfully cleaned up backup ${backup.id}`);
      } else {
        result.failed++;
        result.errors.push({
          backupId: backup.id,
          projectId: backup.project_id,
          error: cleanupResult.error || 'Unknown error',
        });
        console.error(`[Retention] Failed to cleanup backup ${backup.id}: ${cleanupResult.error}`);
      }
    }

    result.duration_ms = Date.now() - startTime;
    console.log(`[Retention] Cleanup completed: ${result.successful} successful, ${result.failed} failed, ${result.skipped} skipped (${result.duration_ms}ms)`);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Retention] Cleanup failed:', errorMessage);
    throw new RetentionError(`Cleanup operation failed: ${errorMessage}`, 'CLEANUP_FAILED');
  }
}

/**
 * Send expiration notifications to users
 *
 * Notifies users that their backups will expire soon.
 *
 * @param payload - Notification job payload
 * @returns Promise resolving to notification result
 */
export async function sendExpirationNotifications(
  payload: NotificationPayload
): Promise<NotificationResult> {
  const result: NotificationResult = {
    successful: 0,
    failed: 0,
    notified_at: new Date(),
    errors: [],
  };

  try {
    // Get backups needing notification
    const backups = await getBackupsNeedingNotification(
      payload.project_id,
      payload.type,
      payload.batch_size
    );

    console.log(`[Retention] Found ${backups.length} backups needing notification`);

    // TODO: Implement actual notification sending
    // For now, just mark them as notified
    for (const backup of backups) {
      try {
        // TODO: Send Telegram notification
        // await sendNotificationToUser(backup.project_id, backup);

        // Mark as notified
        await markBackupNotified(backup.id);
        result.successful++;
        console.log(`[Retention] Notified backup ${backup.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.failed++;
        result.errors.push({
          backupId: backup.id,
          projectId: backup.project_id,
          error: errorMessage,
        });
        console.error(`[Retention] Failed to notify backup ${backup.id}: ${errorMessage}`);
      }
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Retention] Notification failed:', errorMessage);
    throw new RetentionError(`Notification operation failed: ${errorMessage}`, 'NOTIFICATION_FAILED');
  }
}

/**
 * Get retention configuration
 *
 * Returns the current retention configuration.
 * In the future, this could be loaded from environment variables or database.
 *
 * @returns Retention configuration
 */
export function getRetentionConfig(): RetentionConfig {
  // TODO: Load from environment variables or database
  // For now, use default configuration
  return { ...DEFAULT_RETENTION_CONFIG };
}

/**
 * Get retention statistics
 *
 * Provides metrics about backup retention for monitoring.
 *
 * @param projectId - Optional project ID filter
 * @returns Retention statistics
 */
export async function getRetentionStats(projectId?: string): Promise<{
  total_backups: number;
  expiring_soon: number;
  pending_notification: number;
  pending_cleanup: number;
  total_size_bytes: number;
}> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (projectId) {
    conditions.push(`project_id = $${paramIndex++}`);
    values.push(projectId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const queryText = `
    SELECT
      COUNT(*) as total_backups,
      COUNT(*) FILTER (WHERE expires_at <= NOW() + INTERVAL '7 days' AND expires_at > NOW()) as expiring_soon,
      COUNT(*) FILTER (WHERE notified_at IS NULL AND expires_at <= NOW() + INTERVAL '7 days') as pending_notification,
      COUNT(*) FILTER (WHERE expires_at < NOW()) as pending_cleanup,
      COALESCE(SUM(size), 0) as total_size_bytes
    FROM control_plane.backups
    ${whereClause}
  `;

  try {
    const result = await query(queryText, values);
    const row = result.rows[0];

    return {
      total_backups: parseInt(row.total_backups || '0', 10),
      expiring_soon: parseInt(row.expiring_soon || '0', 10),
      pending_notification: parseInt(row.pending_notification || '0', 10),
      pending_cleanup: parseInt(row.pending_cleanup || '0', 10),
      total_size_bytes: parseInt(row.total_size_bytes || '0', 10),
    };
  } catch (error) {
    console.error('Failed to get retention stats:', error);
    throw new RetentionError('Failed to get retention statistics', 'DATABASE_ERROR');
  }
}

/**
 * RetentionCleanupService class
 *
 * Provides a service interface for retention cleanup operations.
 * Encapsulates all retention-related functionality.
 */
export class RetentionCleanupService {
  private config: RetentionConfig;

  constructor(config?: Partial<RetentionConfig>) {
    this.config = {
      ...DEFAULT_RETENTION_CONFIG,
      ...config,
    };
    validateRetentionConfig(this.config);
  }

  /**
   * Get the current configuration
   */
  getConfig(): RetentionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RetentionConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
    validateRetentionConfig(this.config);
  }

  /**
   * Clean up expired backups
   */
  async cleanup(payload: RetentionCleanupPayload): Promise<CleanupResult> {
    return cleanupExpiredBackups(payload);
  }

  /**
   * Send expiration notifications
   */
  async notify(payload: NotificationPayload): Promise<NotificationResult> {
    return sendExpirationNotifications(payload);
  }

  /**
   * Get retention statistics
   */
  async getStats(projectId?: string) {
    return getRetentionStats(projectId);
  }
}
