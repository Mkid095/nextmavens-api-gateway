/**
 * Backups Data Layer
 *
 * Exports all backup-related data layer functions, types, and integration services.
 *
 * US-003: Create Backup History Table - Step 7: Data Layer
 * US-002: Send Backup to Telegram - Step 7: Data Layer Integration
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

// Re-export types from the database package
export type {
  Backup,
  BackupType,
  CreateBackupInput,
  BackupQuery,
  BackupResponse,
  BackupStats,
} from '@nextmavens/audit-logs-database';
