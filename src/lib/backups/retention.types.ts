/**
 * Backup Retention Types
 *
 * Type definitions for backup retention policy and cleanup operations.
 * Provides type-safe interfaces for the retention cleanup system.
 *
 * US-010: Backup Retention Policy - Step 1: Foundation
 */

import type { Backup, BackupType } from '@nextmavens/audit-logs-database';

/**
 * Retention cleanup status
 * Tracks the lifecycle of a backup through the cleanup process
 */
export enum RetentionStatus {
  /** Backup is active and not expiring soon */
  ACTIVE = 'active',
  /** Backup will expire soon (within notification window) */
  EXPIRING_SOON = 'expiring_soon',
  /** User has been notified about impending deletion */
  NOTIFIED = 'notified',
  /** Backup is being cleaned up (deletion in progress) */
  CLEANING_UP = 'cleaning_up',
  /** Backup has been deleted from both database and Telegram */
  DELETED = 'deleted',
  /** Cleanup failed (will be retried) */
  FAILED = 'failed',
}

/**
 * Cleanup notification channels
 * Defines where users receive deletion warnings
 */
export enum NotificationChannel {
  /** Send notification via Telegram */
  TELEGRAM = 'telegram',
  /** Send notification via email */
  EMAIL = 'email',
  /** Send in-app notification */
  IN_APP = 'in_app',
  /** Multiple notification channels */
  MULTIPLE = 'multiple',
}

/**
 * Backup with retention metadata
 * Extends the base Backup interface with retention-specific fields
 */
export interface BackupWithRetention extends Backup {
  /** Current retention status */
  retention_status: RetentionStatus;
  /** Timestamp when user was notified about deletion */
  notified_at?: Date;
  /** Timestamp when cleanup started */
  cleanup_started_at?: Date;
  /** Timestamp when cleanup completed */
  cleanup_completed_at?: Date;
  /** Number of cleanup attempts */
  cleanup_attempts: number;
  /** Error message if cleanup failed */
  cleanup_error?: string;
}

/**
 * Retention cleanup configuration
 * Configures the retention policy behavior
 */
export interface RetentionConfig {
  /** Default retention period in days (default: 30) */
  defaultRetentionDays: number;
  /** Notification period before deletion in days (default: 7) */
  notificationDays: number;
  /** Whether cleanup is enabled */
  cleanupEnabled: boolean;
  /** Cleanup interval in hours (default: 24 = daily) */
  cleanupIntervalHours: number;
  /** Maximum number of cleanup retries */
  maxCleanupRetries: number;
  /** Batch size for cleanup operations */
  cleanupBatchSize: number;
  /** Notification channels to use */
  notificationChannels: NotificationChannel[];
  /** Whether to hard delete (true) or soft delete (false) */
  hardDelete: boolean;
}

/**
 * Result of a retention cleanup operation
 */
export interface CleanupResult {
  /** Number of backups successfully cleaned up */
  successful: number;
  /** Number of backups that failed cleanup */
  failed: number;
  /** Number of backups skipped (already deleted or not eligible) */
  skipped: number;
  /** Total processing time in milliseconds */
  duration_ms: number;
  /** Details of failed cleanups */
  errors: Array<{
    backupId: string;
    projectId: string;
    error: string;
  }>;
}

/**
 * Result of notifying users about impending deletion
 */
export interface NotificationResult {
  /** Number of users successfully notified */
  successful: number;
  /** Number of notifications that failed */
  failed: number;
  /** Timestamp when notifications were sent */
  notified_at: Date;
  /** Details of failed notifications */
  errors: Array<{
    backupId: string;
    projectId: string;
    error: string;
  }>;
}

/**
 * Backup eligible for cleanup
 * Represents a backup that meets cleanup criteria
 */
export interface EligibleBackup {
  /** Backup ID */
  id: string;
  /** Project ID */
  project_id: string;
  /** Backup type */
  type: BackupType;
  /** Telegram file ID (if applicable) */
  file_id: string;
  /** Telegram message ID (for deletion) */
  message_id?: number;
  /** Expiration timestamp */
  expires_at: Date;
  /** Days until expiration (negative = already expired) */
  days_until_expiration: number;
  /** Whether user has been notified */
  notified: boolean;
}

/**
 * Cleanup job payload
 * Data passed to the cleanup job handler
 */
export interface RetentionCleanupPayload {
  /** Optional: specific project ID to clean up (undefined = all projects) */
  project_id?: string;
  /** Optional: specific backup type to clean up (undefined = all types) */
  type?: BackupType;
  /** Maximum number of backups to clean up in this job */
  batch_size: number;
  /** Whether to send notifications before cleanup */
  notify_first: boolean;
  /** Dry run mode: report what would be deleted without deleting */
  dry_run: boolean;
}

/**
 * Notification job payload
 * Data passed to the notification job handler
 */
export interface NotificationPayload {
  /** Optional: specific project ID to notify (undefined = all eligible) */
  project_id?: string;
  /** Optional: specific backup type to notify (undefined = all types) */
  type?: BackupType;
  /** Maximum number of notifications to send in this job */
  batch_size: number;
}

/**
 * Retention statistics for monitoring
 * Provides metrics about backup retention
 */
export interface RetentionStats {
  /** Total number of active backups */
  total_backups: number;
  /** Number of backups expiring soon */
  expiring_soon: number;
  /** Number of backups pending notification */
  pending_notification: number;
  /** Number of backups pending cleanup */
  pending_cleanup: number;
  /** Number of backups that failed cleanup */
  failed_cleanup: number;
  /** Total size of all backups in bytes */
  total_size_bytes: number;
  /** Total size of backups eligible for cleanup in bytes */
  cleanup_size_bytes: number;
}

/**
 * Default retention configuration
 * Can be overridden by environment variables or database settings
 */
export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  defaultRetentionDays: 30,
  notificationDays: 7,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  maxCleanupRetries: 3,
  cleanupBatchSize: 100,
  notificationChannels: [NotificationChannel.TELEGRAM],
  hardDelete: true,
} as const;

/**
 * Validation constants for retention operations
 */
export const RETENTION_VALIDATION = {
  /** Minimum retention period in days */
  MIN_RETENTION_DAYS: 1,
  /** Maximum retention period in days (365 days = 1 year) */
  MAX_RETENTION_DAYS: 365,
  /** Minimum notification period in days */
  MIN_NOTIFICATION_DAYS: 1,
  /** Maximum notification period in days */
  MAX_NOTIFICATION_DAYS: 30,
  /** Minimum cleanup interval in hours */
  MIN_CLEANUP_INTERVAL_HOURS: 1,
  /** Maximum cleanup interval in hours (7 days) */
  MAX_CLEANUP_INTERVAL_HOURS: 168,
  /** Minimum batch size */
  MIN_BATCH_SIZE: 1,
  /** Maximum batch size */
  MAX_BATCH_SIZE: 1000,
  /** Maximum cleanup retries */
  MAX_CLEANUP_RETRIES: 10,
} as const;
