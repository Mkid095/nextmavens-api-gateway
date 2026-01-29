/**
 * Integration Tests for Backup Telegram Integration Service
 *
 * Tests the integration between Telegram backup service and database layer.
 *
 * US-002: Send Backup to Telegram - Step 7: Data Layer Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupTelegramIntegration } from '../backup-telegram.integration';
import type {
  BackupMetadata,
  BackupSendResult,
  BackupType as TelegramBackupType,
} from 'telegram-deployment-bot';
import type { Backup, BackupType } from '@nextmavens/audit-logs-database';

// Mock the telegram service
class MockTelegramBackupService {
  async sendBackup(options: {
    projectId: string;
    type: TelegramBackupType;
    file: string | Buffer;
    filename?: string;
    caption?: string;
    chatId?: string;
  }): Promise<BackupSendResult> {
    // Simulate successful send
    return {
      success: true,
      metadata: {
        id: `backup_${Date.now()}`,
        projectId: options.projectId,
        type: options.type as unknown as BackupType,
        filename: options.filename || 'backup.sql',
        fileId: 'telegram-file-123',
        size: 1024000,
        createdAt: new Date(),
      },
    };
  }
}

// Mock the database service
vi.mock('../backups.service', () => ({
  createBackup: vi.fn(async (input) => ({
    id: 'db-backup-123',
    project_id: input.project_id,
    type: input.type,
    file_id: input.file_id,
    size: input.size,
    created_at: new Date(),
    expires_at: input.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })),
  BackupError: class extends Error {
    constructor(message: string, public code?: string) {
      super(message);
      this.name = 'BackupError';
    }
  },
}));

describe('BackupTelegramIntegration', () => {
  let integration: BackupTelegramIntegration;
  let mockTelegramService: MockTelegramBackupService;

  beforeEach(() => {
    mockTelegramService = new MockTelegramBackupService();
    integration = new BackupTelegramIntegration(
      mockTelegramService as unknown as typeof mockTelegramService
    );
  });

  describe('sendAndRecord', () => {
    it('should successfully send backup to Telegram and record in database', async () => {
      const mockFile = Buffer.from('mock backup data');

      const result = await integration.sendAndRecord({
        projectId: 'proj-123',
        type: 'database' as BackupType,
        file: mockFile,
        filename: 'test-backup.sql',
      });

      expect(result.success).toBe(true);
      expect(result.telegramMetadata).toBeDefined();
      expect(result.databaseRecord).toBeDefined();
      expect(result.telegramMetadata?.fileId).toBe('telegram-file-123');
      expect(result.databaseRecord?.project_id).toBe('proj-123');
      expect(result.details?.telegramSuccess).toBe(true);
      expect(result.details?.databaseSuccess).toBe(true);
    });

    it('should handle Telegram send failure', async () => {
      // Mock a failing telegram service
      const failingService = {
        async sendBackup() {
          return {
            success: false,
            error: 'Telegram API error',
          };
        },
      };

      const failingIntegration = new BackupTelegramIntegration(
        failingService as unknown as typeof mockTelegramService
      );

      const result = await failingIntegration.sendAndRecord({
        projectId: 'proj-123',
        type: 'database' as BackupType,
        file: Buffer.from('data'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to send backup to Telegram');
      expect(result.details?.telegramSuccess).toBe(false);
      expect(result.details?.telegramError).toBe('Telegram API error');
    });

    it('should handle database record failure', async () => {
      // Mock a service that fails database insertion
      const { createBackup, BackupError } = await import('../backups.service');

      vi.mocked(createBackup).mockRejectedValueOnce(
        new BackupError('Database connection failed', 'DB_ERROR')
      );

      const result = await integration.sendAndRecord({
        projectId: 'proj-123',
        type: 'database' as BackupType,
        file: Buffer.from('data'),
      });

      expect(result.success).toBe(false);
      expect(result.details?.telegramSuccess).toBe(true);
      expect(result.details?.databaseSuccess).toBe(false);
      expect(result.details?.databaseError).toBeDefined();
    });

    it('should support custom expiration date', async () => {
      const customExpiration = new Date('2026-12-31');

      const result = await integration.sendAndRecord({
        projectId: 'proj-123',
        type: 'storage' as BackupType,
        file: '/path/to/file.sql',
        expires_at: customExpiration,
      });

      expect(result.success).toBe(true);
      expect(result.databaseRecord?.expires_at).toEqual(customExpiration);
    });

    it('should handle different backup types', async () => {
      const types: BackupType[] = ['database', 'storage', 'logs'];

      for (const type of types) {
        const result = await integration.sendAndRecord({
          projectId: 'proj-123',
          type,
          file: Buffer.from('data'),
        });

        expect(result.success).toBe(true);
        expect(result.telegramMetadata?.type).toBe(type);
        expect(result.databaseRecord?.type).toBe(type);
      }
    });
  });

  describe('sendAndRecordMultiple', () => {
    it('should send and record multiple backups sequentially', async () => {
      const backups = [
        {
          projectId: 'proj-123',
          type: 'database' as BackupType,
          file: Buffer.from('db data'),
        },
        {
          projectId: 'proj-123',
          type: 'logs' as BackupType,
          file: Buffer.from('log data'),
        },
        {
          projectId: 'proj-123',
          type: 'storage' as BackupType,
          file: Buffer.from('storage data'),
        },
      ];

      const results = await integration.sendAndRecordMultiple(backups);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results[0].telegramMetadata?.type).toBe('database');
      expect(results[1].telegramMetadata?.type).toBe('logs');
      expect(results[2].telegramMetadata?.type).toBe('storage');
    });

    it('should continue processing even if one backup fails', async () => {
      // Create a service that fails on the second backup
      let callCount = 0;
      const conditionalService = {
        async sendBackup(options: {
          projectId: string;
          type: TelegramBackupType;
          file: string | Buffer;
        }) {
          callCount++;
          if (callCount === 2) {
            return {
              success: false,
              error: 'Simulated failure',
            };
          }
          return {
            success: true,
            metadata: {
              id: `backup_${Date.now()}`,
              projectId: options.projectId,
              type: options.type as unknown as BackupType,
              filename: 'backup.sql',
              fileId: 'telegram-file-123',
              size: 1024,
              createdAt: new Date(),
            },
          };
        },
      };

      const conditionalIntegration = new BackupTelegramIntegration(
        conditionalService as unknown as typeof mockTelegramService
      );

      const backups = [
        {
          projectId: 'proj-123',
          type: 'database' as BackupType,
          file: Buffer.from('data1'),
        },
        {
          projectId: 'proj-123',
          type: 'logs' as BackupType,
          file: Buffer.from('data2'),
        },
        {
          projectId: 'proj-123',
          type: 'storage' as BackupType,
          file: Buffer.from('data3'),
        },
      ];

      const results = await conditionalIntegration.sendAndRecordMultiple(backups);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });

  describe('sendToTelegramOnly', () => {
    it('should send backup to Telegram without recording', async () => {
      const result = await integration.sendToTelegramOnly({
        projectId: 'proj-123',
        type: 'database' as BackupType,
        file: Buffer.from('data'),
        filename: 'test.sql',
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.fileId).toBe('telegram-file-123');
    });
  });

  describe('recordInDatabaseOnly', () => {
    it('should record backup in database without sending to Telegram', async () => {
      const metadata: BackupMetadata = {
        id: 'backup-123',
        projectId: 'proj-456',
        type: 'database' as BackupType,
        filename: 'manual-backup.sql',
        fileId: 'existing-telegram-file',
        size: 2048000,
        createdAt: new Date(),
      };

      const result = await integration.recordInDatabaseOnly(metadata);

      expect(result.project_id).toBe('proj-456');
      expect(result.file_id).toBe('existing-telegram-file');
      expect(result.size).toBe(2048000);
    });

    it('should support custom expiration when recording only', async () => {
      const metadata: BackupMetadata = {
        id: 'backup-123',
        projectId: 'proj-456',
        type: 'logs' as BackupType,
        filename: 'logs.json',
        fileId: 'telegram-logs-123',
        size: 512000,
        createdAt: new Date(),
      };

      const customExpiration = new Date('2026-06-30');
      const result = await integration.recordInDatabaseOnly(
        metadata,
        customExpiration
      );

      expect(result.expires_at).toEqual(customExpiration);
    });
  });

  describe('createBackupTelegramIntegration', () => {
    it('should create a BackupTelegramIntegration instance', () => {
      const service = new MockTelegramBackupService();
      const integrationInstance = new BackupTelegramIntegration(
        service as unknown as typeof mockTelegramService
      );

      expect(integrationInstance).toBeInstanceOf(BackupTelegramIntegration);
    });
  });

  describe('Type conversion', () => {
    it('should correctly convert backup types between systems', async () => {
      const types = [
        'database',
        'storage',
        'logs',
      ] as const satisfies readonly BackupType[];

      for (const type of types) {
        const result = await integration.sendAndRecord({
          projectId: 'proj-123',
          type,
          file: Buffer.from('data'),
        });

        expect(result.success).toBe(true);
        expect(result.telegramMetadata?.type).toBe(type);
        expect(result.databaseRecord?.type).toBe(type);
      }
    });
  });
});
