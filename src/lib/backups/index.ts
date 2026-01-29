/**
 * Backups Data Layer
 *
 * Exports all backup-related data layer functions, types, and integration services.
 *
 * US-003: Create Backup History Table - Step 7: Data Layer
 * US-002: Send Backup to Telegram - Step 7: Data Layer Integration
 * US-006: Implement Restore from Backup - Step 1: Foundation
 * US-010: Backup Retention Policy - Step 1: Foundation
 */

// Data layer functions
export {
  createBackup,
  queryByProject,
  getBackupById,
  updateBackup,
  deleteBackup,
  queryByTypeAndDateRange,
  getBackupStats,
  deleteExpiredBackups,
} from './backups.service.js';

export { BackupError } from './backups.service.js';

// Integration service
export {
  BackupTelegramIntegration,
  createBackupTelegramIntegration,
} from './backup-telegram.integration.js';

export type {
  IntegratedBackupOptions,
  IntegratedBackupResult,
} from './backup-telegram.integration.js';

// Restore service
export {
  restoreFromBackup,
  shouldUseAsyncRestore,
  getMaxSyncRestoreSize,
} from './restore.service.js';

export { RestoreError } from './restore.service.js';

export type {
  RestoreResult,
  RestoreOptions,
} from './restore.service.js';

// Retention cleanup service
export {
  cleanupExpiredBackups,
  sendExpirationNotifications,
  getEligibleBackups,
  getBackupsNeedingNotification,
  markBackupNotified,
  deleteBackupFromTelegram,
  cleanupBackup,
  getRetentionStats,
  getRetentionConfig,
  RetentionCleanupService,
  RetentionError,
} from './retention.service.js';

export type {
  BackupWithRetention,
  CleanupResult,
  NotificationResult,
  EligibleBackup,
  RetentionCleanupPayload,
  NotificationPayload,
  RetentionStats as BackupRetentionStats,
} from './retention.types.js';

export {
  RetentionStatus,
  NotificationChannel,
  DEFAULT_RETENTION_CONFIG,
  RETENTION_VALIDATION,
} from './retention.types.js';

// Retention configuration
export {
  getConfig as getRetentionConfigFromEnv,
  validateRetentionConfig,
  config,
  RETENTION_DAYS,
  NOTIFICATION_DAYS,
  CLEANUP_ENABLED,
  CLEANUP_INTERVAL_HOURS,
  CLEANUP_BATCH_SIZE,
  MAX_CLEANUP_RETRIES,
} from './retention.config.js';

export type { RetentionConfig } from './retention.types.js';

// Re-export types from the database package
export type {
  Backup,
  BackupType,
  CreateBackupInput,
  BackupQuery,
  BackupResponse,
  BackupStats,
} from '@nextmavens/audit-logs-database';
