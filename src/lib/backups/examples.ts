/**
 * Backup Telegram Integration Service - Usage Examples
 *
 * This file contains practical examples of using the BackupTelegramIntegration service.
 *
 * US-002: Send Backup to Telegram - Step 7: Data Layer Integration
 */

import { BackupTelegramIntegration } from './backup-telegram.integration.js';
import type { BackupType } from '@nextmavens/audit-logs-database';
import { BackupService } from 'telegram-deployment-bot';

// ============================================================================
// Example 1: Basic Backup Send and Record
// ============================================================================

async function example1_basicBackup() {
  // Initialize the Telegram service
  const telegramService = new BackupService({
    telegramClient: {} as any, // Your initialized Telegram client
    defaultChatId: process.env.TELEGRAM_CHAT_ID,
  });

  // Create the integration
  const integration = new BackupTelegramIntegration(telegramService);

  // Send and record a backup
  const result = await integration.sendAndRecord({
    projectId: 'proj-abc123',
    type: 'database' as BackupType,
    file: '/backups/my-database-backup.sql',
    filename: 'production-db-2026-01-29.sql',
  });

  if (result.success) {
    console.log('✅ Backup successful!');
    console.log('   Telegram File ID:', result.telegramMetadata?.fileId);
    console.log('   Database Record ID:', result.databaseRecord?.id);
    console.log('   Size:', result.databaseRecord?.size, 'bytes');
  } else {
    console.error('❌ Backup failed:', result.error);
    if (result.details) {
      console.error('   Telegram Success:', result.details.telegramSuccess);
      console.error('   Database Success:', result.details.databaseSuccess);
    }
  }
}

// ============================================================================
// Example 2: Backup with Custom Expiration
// ============================================================================

async function example2_customExpiration() {
  const integration = new BackupTelegramIntegration({} as any);

  // Create a backup with 60-day retention
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 60);

  const result = await integration.sendAndRecord({
    projectId: 'proj-xyz789',
    type: 'storage' as BackupType,
    file: '/backups/storage-files.tar.gz',
    expires_at: expirationDate,
  });

  if (result.success) {
    console.log('✅ Storage backup created!');
    console.log('   Expires on:', result.databaseRecord?.expires_at.toISOString());
  }
}

// ============================================================================
// Example 3: Batch Backups (Database + Logs + Storage)
// ============================================================================

async function example3_batchBackups() {
  const integration = new BackupTelegramIntegration({} as any);

  const backups = [
    {
      projectId: 'proj-batch001',
      type: 'database' as BackupType,
      file: '/backups/db.sql',
      caption: 'Weekly database backup',
    },
    {
      projectId: 'proj-batch001',
      type: 'logs' as BackupType,
      file: '/backups/logs.json',
      caption: 'Weekly logs archive',
    },
    {
      projectId: 'proj-batch001',
      type: 'storage' as BackupType,
      file: '/backups/storage.tar.gz',
      caption: 'Weekly storage backup',
    },
  ];

  const results = await integration.sendAndRecordMultiple(backups);

  // Process results
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`Batch backup complete: ${successful} succeeded, ${failed} failed`);

  // Log detailed results
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} Backup ${index + 1}:`, result.success ? 'Success' : result.error);
  });
}

// ============================================================================
// Example 4: Conditional Backup (Send Only if File Exists)
// ============================================================================

async function example4_conditionalBackup() {
  const integration = new BackupTelegramIntegration({} as any);
  const fs = await import('fs/promises');

  const backupPath = '/backups/conditional-backup.sql';

  try {
    // Check if file exists
    await fs.access(backupPath);

    // File exists, proceed with backup
    const result = await integration.sendAndRecord({
      projectId: 'proj-cond123',
      type: 'database' as BackupType,
      file: backupPath,
    });

    if (result.success) {
      console.log('✅ Conditional backup successful');
    }
  } catch {
    console.log('⚠️ Backup file does not exist, skipping');
  }
}

// ============================================================================
// Example 5: Backup with Buffer (In-Memory Data)
// ============================================================================

async function example5_bufferBackup() {
  const integration = new BackupTelegramIntegration({} as any);

  // Create backup data in memory
  const backupData = Buffer.from('-- SQL Dump\nCREATE TABLE test (id INT);');

  const result = await integration.sendAndRecord({
    projectId: 'proj-buffer456',
    type: 'database' as BackupType,
    file: backupData,
    filename: 'in-memory-backup.sql',
  });

  if (result.success) {
    console.log('✅ In-memory backup sent successfully');
    console.log('   File ID:', result.telegramMetadata?.fileId);
  }
}

// ============================================================================
// Example 6: Error Handling with Retry
// ============================================================================

async function example6_retryOnError() {
  const integration = new BackupTelegramIntegration({} as any);

  const maxRetries = 3;
  let attempts = 0;
  let success = false;

  while (attempts < maxRetries && !success) {
    attempts++;

    const result = await integration.sendAndRecord({
      projectId: 'proj-retry789',
      type: 'database' as BackupType,
      file: '/backups/retry-test.sql',
    });

    if (result.success) {
      console.log(`✅ Backup succeeded on attempt ${attempts}`);
      success = true;
    } else {
      console.error(`❌ Attempt ${attempts} failed:`, result.error);

      // Check if it's a retriable error
      if (result.details?.telegramError?.includes('timeout')) {
        console.log('   Retrying in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        // Not retriable, break
        console.log('   Non-retriable error, giving up');
        break;
      }
    }
  }

  if (!success) {
    console.error(`❌ Backup failed after ${attempts} attempts`);
  }
}

// ============================================================================
// Example 7: Recording External Backup (Already on Telegram)
// ============================================================================

async function example7_recordExternalBackup() {
  const integration = new BackupTelegramIntegration({} as any);

  // You have a file that was already uploaded to Telegram externally
  const externalMetadata = {
    id: 'backup-external-001',
    projectId: 'proj-ext123',
    type: 'database' as BackupType,
    filename: 'external-backup.sql',
    fileId: 'BAADBAADrwADBREAAfh4iZF7hBxIh9sZ9h9',
    size: 1024000,
    createdAt: new Date(),
  };

  // Record it in the database without sending to Telegram
  const record = await integration.recordInDatabaseOnly(
    externalMetadata,
    new Date('2026-12-31')
  );

  console.log('✅ External backup recorded in database');
  console.log('   Record ID:', record.id);
  console.log('   Project ID:', record.project_id);
  console.log('   File ID:', record.file_id);
}

// ============================================================================
// Example 8: Scheduled Backup (e.g., Daily)
// ============================================================================

async function example8_scheduledBackup() {
  const integration = new BackupTelegramIntegration({} as any);

  const projectId = 'proj-scheduled001';
  const backupType = 'database' as BackupType;

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `scheduled-backup-${timestamp}.sql`;

  const result = await integration.sendAndRecord({
    projectId,
    type: backupType,
    file: `/backups/daily/${filename}`,
    filename,
    caption: `📅 Daily backup for ${timestamp}`,
  });

  if (result.success) {
    console.log('✅ Scheduled backup completed');
  } else {
    console.error('❌ Scheduled backup failed:', result.error);
    // Could trigger an alert here
  }
}

// ============================================================================
// Example 9: Query Backup History
// ============================================================================

async function example9_queryBackupHistory() {
  const { queryByProject, getBackupStats } = await import('./backups.service.js');

  const projectId = 'proj-query123';

  // Get all backups for a project
  const backups = await queryByProject(projectId, {
    limit: 10,
    offset: 0,
  });

  console.log(`📊 Found ${backups.total} backups for project ${projectId}`);
  backups.data.forEach((backup) => {
    console.log(`   - ${backup.type}: ${backup.size} bytes, created ${backup.created_at}`);
  });

  // Get statistics
  const stats = await getBackupStats(projectId);
  console.log('\n📈 Backup Statistics:');
  console.log(`   Total backups: ${stats.total_backups}`);
  console.log(`   Total size: ${stats.total_size} bytes`);
  console.log(`   By type:`, stats.by_type);
  console.log(`   Expiring soon: ${stats.expiring_soon}`);
}

// ============================================================================
// Example 10: Integration with Express Route
// ============================================================================

async function example10_expressRoute() {
  // This would be in your Express route handler
  /*
  app.post('/api/projects/:projectId/backups', async (req, res) => {
    const { projectId } = req.params;
    const { type, file } = req.body;

    const integration = new BackupTelegramIntegration(telegramService);

    try {
      const result = await integration.sendAndRecord({
        projectId,
        type,
        file,
      });

      if (result.success) {
        res.json({
          success: true,
          backup: result.databaseRecord,
          telegram: result.telegramMetadata,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error,
          details: result.details,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });
  */
}

// Export examples for testing
export {
  example1_basicBackup,
  example2_customExpiration,
  example3_batchBackups,
  example4_conditionalBackup,
  example5_bufferBackup,
  example6_retryOnError,
  example7_recordExternalBackup,
  example8_scheduledBackup,
  example9_queryBackupHistory,
  example10_expressRoute,
};
