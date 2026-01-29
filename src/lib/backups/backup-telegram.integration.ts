/**
 * Backup Telegram Integration Service
 *
 * Integrates Telegram backup service with the database layer to provide
 * a unified interface for sending backups to Telegram and recording metadata.
 *
 * US-002: Send Backup to Telegram - Step 7: Data Layer Integration
 */

import type {
  Backup,
  BackupType,
  CreateBackupInput,
} from '@nextmavens/audit-logs-database';
import {
  createBackup,
  BackupError,
} from './backups.service.js';
import type {
  BackupMetadata,
  BackupSendResult,
  SendBackupOptions,
  IBackupService,
  BackupType as TelegramBackupType,
} from 'telegram-deployment-bot';

/**
 * Options for integrated backup send operation
 */
export interface IntegratedBackupOptions {
  /** Project identifier */
  projectId: string;

  /** Type of backup */
  type: BackupType;

  /** File path or buffer to send */
  file: string | Buffer;

  /** Optional custom filename (will be generated if not provided) */
  filename?: string;

  /** Optional caption for the file */
  caption?: string;

  /** Chat ID to send to (uses default if not provided) */
  chatId?: string;

  /** Optional expiration date (defaults to 30 days from creation) */
  expires_at?: Date;
}

/**
 * Result of integrated backup send operation
 */
export interface IntegratedBackupResult {
  /** Whether the operation was successful */
  success: boolean;

  /** Backup metadata from Telegram (if successful) */
  telegramMetadata?: BackupMetadata;

  /** Database backup record (if successful) */
  databaseRecord?: Backup;

  /** Error message (if failed) */
  error?: string;

  /** Detailed error information */
  details?: {
    /** Telegram send succeeded */
    telegramSuccess: boolean;

    /** Database record succeeded */
    databaseSuccess: boolean;

    /** Telegram error (if any) */
    telegramError?: string;

    /** Database error (if any) */
    databaseError?: string;
  };
}

/**
 * Convert our BackupType to Telegram service BackupType
 */
function toTelegramBackupType(type: BackupType): TelegramBackupType {
  // Both use the same enum values
  return type as unknown as TelegramBackupType;
}

/**
 * Convert Telegram BackupMetadata to CreateBackupInput
 */
function toCreateBackupInput(
  metadata: BackupMetadata,
  expiresAt?: Date
): CreateBackupInput {
  return {
    project_id: metadata.projectId,
    type: metadata.type as unknown as BackupType,
    file_id: metadata.fileId,
    size: metadata.size,
    expires_at: expiresAt,
  };
}

/**
 * Backup Telegram Integration Service
 *
 * Provides unified interface for sending backups to Telegram and
 * recording them in the database.
 */
export class BackupTelegramIntegration {
  /**
   * Create a new backup telegram integration service
   * @param telegramService - Telegram backup service instance
   */
  constructor(private readonly telegramService: IBackupService) {}

  /**
   * Send backup to Telegram and record in database
   *
   * This method:
   * 1. Sends the backup file to Telegram using the Telegram service
   * 2. Records the backup metadata in the database
   * 3. Returns a combined result with both Telegram and database information
   *
   * @param options - Integrated backup options
   * @returns Promise resolving to integrated backup result
   *
   * @example
   * ```typescript
   * const result = await backupIntegration.sendAndRecord({
   *   projectId: 'proj-123',
   *   type: BackupType.DATABASE,
   *   file: '/path/to/backup.sql',
   * });
   *
   * if (result.success) {
   *   console.log('Backup sent:', result.telegramMetadata?.fileId);
   *   console.log('Recorded:', result.databaseRecord?.id);
   * }
   * ```
   */
  async sendAndRecord(
    options: IntegratedBackupOptions
  ): Promise<IntegratedBackupResult> {
    const details: IntegratedBackupResult['details'] = {
      telegramSuccess: false,
      databaseSuccess: false,
    };

    try {
      // Step 1: Send to Telegram
      const telegramOptions: SendBackupOptions = {
        projectId: options.projectId,
        type: toTelegramBackupType(options.type),
        file: options.file,
        filename: options.filename,
        caption: options.caption,
        chatId: options.chatId,
      };

      const telegramResult: BackupSendResult =
        await this.telegramService.sendBackup(telegramOptions);

      if (!telegramResult.success || !telegramResult.metadata) {
        details.telegramSuccess = false;
        details.telegramError = telegramResult.error;

        return {
          success: false,
          error: `Failed to send backup to Telegram: ${telegramResult.error}`,
          details,
        };
      }

      details.telegramSuccess = true;

      // Step 2: Record in database
      const dbInput = toCreateBackupInput(
        telegramResult.metadata,
        options.expires_at
      );

      const databaseRecord = await createBackup(dbInput);

      details.databaseSuccess = true;

      return {
        success: true,
        telegramMetadata: telegramResult.metadata,
        databaseRecord,
        details,
      };
    } catch (error) {
      // Handle errors
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      if (error instanceof BackupError) {
        details.databaseSuccess = false;
        details.databaseError = errorMessage;
      } else {
        details.telegramSuccess = false;
        details.telegramError = errorMessage;
      }

      return {
        success: false,
        error: errorMessage,
        details,
      };
    }
  }

  /**
   * Send multiple backups to Telegram and record them in database
   *
   * @param backups - Array of backup options
   * @returns Promise resolving to array of results
   *
   * @example
   * ```typescript
   * const results = await backupIntegration.sendAndRecordMultiple([
   *   {
   *     projectId: 'proj-123',
   *     type: BackupType.DATABASE,
   *     file: '/path/to/db.sql',
   *   },
   *   {
   *     projectId: 'proj-123',
   *     type: BackupType.LOGS,
   *     file: '/path/to/logs.json',
   *   },
   * ]);
   * ```
   */
  async sendAndRecordMultiple(
    backups: IntegratedBackupOptions[]
  ): Promise<IntegratedBackupResult[]> {
    // Process backups sequentially to avoid overwhelming the Telegram API
    const results: IntegratedBackupResult[] = [];

    for (const backup of backups) {
      const result = await this.sendAndRecord(backup);
      results.push(result);
    }

    return results;
  }

  /**
   * Send backup to Telegram only (without recording)
   *
   * @param options - Backup options
   * @returns Promise resolving to Telegram backup result
   */
  async sendToTelegramOnly(
    options: Omit<IntegratedBackupOptions, 'expires_at'>
  ): Promise<BackupSendResult> {
    const telegramOptions: SendBackupOptions = {
      projectId: options.projectId,
      type: toTelegramBackupType(options.type),
      file: options.file,
      filename: options.filename,
      caption: options.caption,
      chatId: options.chatId,
    };

    return this.telegramService.sendBackup(telegramOptions);
  }

  /**
   * Record backup in database only (without sending to Telegram)
   *
   * @param metadata - Backup metadata
   * @param expiresAt - Optional expiration date
   * @returns Promise resolving to database backup record
   */
  async recordInDatabaseOnly(
    metadata: BackupMetadata,
    expiresAt?: Date
  ): Promise<Backup> {
    const input = toCreateBackupInput(metadata, expiresAt);
    return createBackup(input);
  }
}

/**
 * Create a backup telegram integration service from a Telegram backup service
 * @param telegramService - Telegram backup service instance
 * @returns Backup telegram integration service instance
 */
export function createBackupTelegramIntegration(
  telegramService: IBackupService
): BackupTelegramIntegration {
  return new BackupTelegramIntegration(telegramService);
}
