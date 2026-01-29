/**
 * Backup Retention Cleanup Job Handler
 *
 * Handles background jobs for cleaning up expired backups.
 * Integrates with the existing job queue system.
 *
 * US-010: Backup Retention Policy - Step 1: Foundation
 *
 * Job Types:
 * - 'cleanup_expired_backups': Deletes expired backups from database and Telegram
 * - 'notify_backup_expiration': Sends notifications before backup deletion
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 *
 * // Enqueue a cleanup job
 * await enqueueJob('cleanup_expired_backups', {
 *   project_id: 'proj-123',
 *   batch_size: 100,
 *   notify_first: true,
 *   dry_run: false,
 * });
 *
 * // Enqueue a notification job
 * await enqueueJob('notify_backup_expiration', {
 *   project_id: 'proj-123',
 *   batch_size: 100,
 * });
 * ```
 */

import type {
  RetentionCleanupPayload,
  NotificationPayload,
  CleanupResult,
  NotificationResult,
} from '../../backups/retention.types.js';
import {
  cleanupExpiredBackups,
  sendExpirationNotifications,
  RetentionError,
} from '../../backups/retention.service.js';

/**
 * Cleanup Expired Backups Job Handler
 *
 * Processes the 'cleanup_expired_backups' job type.
 * Deletes expired backups from both database and Telegram.
 *
 * @param payload - Job payload containing cleanup parameters
 * @returns Job result with cleanup statistics
 *
 * @example
 * ```typescript
 * // Enqueue cleanup for all projects
 * await enqueueJob('cleanup_expired_backups', {
 *   batch_size: 100,
 *   notify_first: true,
 *   dry_run: false,
 * });
 *
 * // Enqueue cleanup for specific project
 * await enqueueJob('cleanup_expired_backups', {
 *   project_id: 'proj-123',
 *   type: 'database',
 *   batch_size: 50,
 *   notify_first: false,
 *   dry_run: false,
 * });
 * ```
 */
export const cleanupExpiredBackupsHandler = {
  type: 'cleanup_expired_backups',

  async handle(payload: Record<string, unknown>): Promise<CleanupResult> {
    console.log('[Job] Starting cleanup_expired_backups job');
    console.log('[Job] Payload:', JSON.stringify(payload, null, 2));

    try {
      // Validate and parse payload
      const validatedPayload = validateCleanupPayload(payload as unknown as RetentionCleanupPayload);

      // Execute cleanup
      const result = await cleanupExpiredBackups(validatedPayload);

      console.log('[Job] Cleanup completed:', JSON.stringify(result, null, 2));

      // Log statistics
      if (result.successful > 0 || result.failed > 0) {
        console.log(`[Job] Cleanup summary: ${result.successful} successful, ${result.failed} failed, ${result.skipped} skipped in ${result.duration_ms}ms`);
      }

      return result;
    } catch (error) {
      console.error('[Job] Cleanup job failed:', error);

      if (error instanceof RetentionError) {
        throw error;
      }

      throw new Error(`Cleanup job failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

/**
 * Notify Backup Expiration Job Handler
 *
 * Processes the 'notify_backup_expiration' job type.
 * Sends notifications to users about backups expiring soon.
 *
 * @param payload - Job payload containing notification parameters
 * @returns Job result with notification statistics
 *
 * @example
 * ```typescript
 * // Enqueue notifications for all projects
 * await enqueueJob('notify_backup_expiration', {
 *   batch_size: 100,
 * });
 *
 * // Enqueue notifications for specific project
 * await enqueueJob('notify_backup_expiration', {
 *   project_id: 'proj-123',
 *   type: 'database',
 *   batch_size: 50,
 * });
 * ```
 */
export const notifyBackupExpirationHandler = {
  type: 'notify_backup_expiration',

  async handle(payload: Record<string, unknown>): Promise<NotificationResult> {
    console.log('[Job] Starting notify_backup_expiration job');
    console.log('[Job] Payload:', JSON.stringify(payload, null, 2));

    try {
      // Validate and parse payload
      const validatedPayload = validateNotificationPayload(payload as unknown as NotificationPayload);

      // Send notifications
      const result = await sendExpirationNotifications(validatedPayload);

      console.log('[Job] Notification completed:', JSON.stringify(result, null, 2));

      // Log statistics
      if (result.successful > 0 || result.failed > 0) {
        console.log(`[Job] Notification summary: ${result.successful} successful, ${result.failed} failed`);
      }

      return result;
    } catch (error) {
      console.error('[Job] Notification job failed:', error);

      if (error instanceof RetentionError) {
        throw error;
      }

      throw new Error(`Notification job failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
};

/**
 * Validate cleanup job payload
 */
function validateCleanupPayload(payload: RetentionCleanupPayload): RetentionCleanupPayload {
  // Validate batch_size
  if (!payload.batch_size || typeof payload.batch_size !== 'number') {
    throw new Error('batch_size is required and must be a number');
  }

  if (payload.batch_size < 1) {
    throw new Error('batch_size must be at least 1');
  }

  if (payload.batch_size > 1000) {
    throw new Error('batch_size cannot exceed 1000');
  }

  // Validate project_id if provided
  if (payload.project_id !== undefined) {
    if (typeof payload.project_id !== 'string') {
      throw new Error('project_id must be a string');
    }

    if (payload.project_id.trim().length === 0) {
      throw new Error('project_id cannot be empty');
    }
  }

  // Validate type if provided
  if (payload.type !== undefined) {
    const validTypes = ['database', 'storage', 'logs'];
    if (!validTypes.includes(payload.type)) {
      throw new Error(`type must be one of: ${validTypes.join(', ')}`);
    }
  }

  // Validate boolean flags
  if (payload.notify_first !== undefined && typeof payload.notify_first !== 'boolean') {
    throw new Error('notify_first must be a boolean');
  }

  if (payload.dry_run !== undefined && typeof payload.dry_run !== 'boolean') {
    throw new Error('dry_run must be a boolean');
  }

  return payload;
}

/**
 * Validate notification job payload
 */
function validateNotificationPayload(payload: NotificationPayload): NotificationPayload {
  // Validate batch_size
  if (!payload.batch_size || typeof payload.batch_size !== 'number') {
    throw new Error('batch_size is required and must be a number');
  }

  if (payload.batch_size < 1) {
    throw new Error('batch_size must be at least 1');
  }

  if (payload.batch_size > 1000) {
    throw new Error('batch_size cannot exceed 1000');
  }

  // Validate project_id if provided
  if (payload.project_id !== undefined) {
    if (typeof payload.project_id !== 'string') {
      throw new Error('project_id must be a string');
    }

    if (payload.project_id.trim().length === 0) {
      throw new Error('project_id cannot be empty');
    }
  }

  // Validate type if provided
  if (payload.type !== undefined) {
    const validTypes = ['database', 'storage', 'logs'];
    if (!validTypes.includes(payload.type)) {
      throw new Error(`type must be one of: ${validTypes.join(', ')}`);
    }
  }

  return payload;
}

/**
 * Helper function to enqueue a cleanup job
 *
 * @param payload - Cleanup job parameters
 * @returns Job ID
 */
export async function enqueueCleanupJob(payload: RetentionCleanupPayload): Promise<string> {
  const { enqueueJob } = await import('../queue.js');

  const result = await enqueueJob('cleanup_expired_backups', payload as unknown as Record<string, unknown>, {
    maxAttempts: 3,
    priority: 5,
  });

  console.log(`[Job] Enqueued cleanup job ${result.id}`);
  return result.id;
}

/**
 * Helper function to enqueue a notification job
 *
 * @param payload - Notification job parameters
 * @returns Job ID
 */
export async function enqueueNotificationJob(payload: NotificationPayload): Promise<string> {
  const { enqueueJob } = await import('../queue.js');

  const result = await enqueueJob('notify_backup_expiration', payload as unknown as Record<string, unknown>, {
    maxAttempts: 3,
    priority: 7,
  });

  console.log(`[Job] Enqueued notification job ${result.id}`);
  return result.id;
}
