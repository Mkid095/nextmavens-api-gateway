# Backup Telegram Integration Service

## Overview

The `BackupTelegramIntegration` service provides a unified interface for sending backups to Telegram and recording metadata in the database. This integration layer combines the Telegram backup service with the database backup layer, ensuring that all backup operations are tracked.

## Installation

The integration service is part of the `@nextmavens/api-gateway` package and requires:

1. `@nextmavens/audit-logs-database` - Database layer
2. `telegram-deployment-bot` - Telegram service

## Usage

### Basic Usage

```typescript
import { BackupTelegramIntegration } from '@/lib/backups';
import { BackupService } from 'telegram-deployment-bot';

// Create the integration service
const telegramService = new BackupService({
  telegramClient: telegramClient,
  defaultChatId: process.env.TELEGRAM_CHAT_ID,
});

const backupIntegration = new BackupTelegramIntegration(telegramService);

// Send a backup and record it
const result = await backupIntegration.sendAndRecord({
  projectId: 'proj-123',
  type: 'database', // BackupType.DATABASE
  file: '/path/to/backup.sql',
  filename: 'my-backup.sql', // Optional
  caption: 'Monthly database backup', // Optional
  chatId: '-1001234567890', // Optional, uses default if not provided
  expires_at: new Date('2026-12-31'), // Optional, defaults to 30 days
});

if (result.success) {
  console.log('Backup sent to Telegram:', result.telegramMetadata?.fileId);
  console.log('Recorded in database:', result.databaseRecord?.id);
} else {
  console.error('Backup failed:', result.error);
  console.error('Details:', result.details);
}
```

### Send Multiple Backups

```typescript
// Send multiple backups in sequence
const backups = [
  {
    projectId: 'proj-123',
    type: 'database' as BackupType,
    file: '/path/to/db.sql',
  },
  {
    projectId: 'proj-123',
    type: 'logs' as BackupType,
    file: '/path/to/logs.json',
  },
  {
    projectId: 'proj-123',
    type: 'storage' as BackupType,
    file: '/path/to/storage.tar.gz',
  },
];

const results = await backupIntegration.sendAndRecordMultiple(backups);

// Check results
results.forEach((result, index) => {
  if (result.success) {
    console.log(`Backup ${index + 1} succeeded`);
  } else {
    console.error(`Backup ${index + 1} failed:`, result.error);
  }
});
```

### Send to Telegram Only (No Database Record)

```typescript
// Send backup without recording in database
const result = await backupIntegration.sendToTelegramOnly({
  projectId: 'proj-123',
  type: 'database' as BackupType,
  file: Buffer.from('backup data'),
  filename: 'temp-backup.sql',
});

if (result.success) {
  console.log('File ID:', result.metadata?.fileId);
}
```

### Record in Database Only (No Telegram Send)

```typescript
// Record existing backup metadata in database
const metadata = {
  id: 'backup-123',
  projectId: 'proj-456',
  type: 'database' as BackupType,
  filename: 'manual-backup.sql',
  fileId: 'existing-telegram-file-id',
  size: 2048000,
  createdAt: new Date(),
};

const record = await backupIntegration.recordInDatabaseOnly(
  metadata,
  new Date('2026-12-31') // Optional expiration
);

console.log('Recorded:', record.id);
```

## Types

### IntegratedBackupOptions

```typescript
interface IntegratedBackupOptions {
  projectId: string;           // Project identifier
  type: BackupType;            // 'database' | 'storage' | 'logs'
  file: string | Buffer;       // File path or buffer
  filename?: string;           // Optional custom filename
  caption?: string;            // Optional caption
  chatId?: string;             // Optional chat ID
  expires_at?: Date;           // Optional expiration date
}
```

### IntegratedBackupResult

```typescript
interface IntegratedBackupResult {
  success: boolean;                    // Overall success status
  telegramMetadata?: BackupMetadata;   // Telegram response (if successful)
  databaseRecord?: Backup;             // Database record (if successful)
  error?: string;                      // Error message (if failed)
  details?: {
    telegramSuccess: boolean;          // Telegram send status
    databaseSuccess: boolean;          // Database record status
    telegramError?: string;            // Telegram error details
    databaseError?: string;            // Database error details
  };
}
```

## Error Handling

The integration service provides detailed error information through the `details` field:

```typescript
const result = await backupIntegration.sendAndRecord(options);

if (!result.success) {
  if (result.details) {
    if (!result.details.telegramSuccess) {
      console.error('Telegram error:', result.details.telegramError);
      // Handle Telegram failure
    }
    if (!result.details.databaseSuccess) {
      console.error('Database error:', result.details.databaseError);
      // Handle database failure
    }
  }
}
```

## Backup Types

The integration supports three backup types:

- **`database`**: SQL dumps and database backups
- **`storage`**: File storage backups
- **`logs`**: Log file archives

## Retention Policy

By default, backups expire after 30 days. You can customize this:

```typescript
const result = await backupIntegration.sendAndRecord({
  projectId: 'proj-123',
  type: 'database' as BackupType,
  file: '/path/to/backup.sql',
  expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
});
```

## Integration with Job Queue

For async backup operations, use the job queue:

```typescript
import { enqueueJob } from '@/lib/jobs/queue';

// Enqueue an export backup job
await enqueueJob('export_backup', {
  project_id: 'proj-123',
});

// The job handler will use the integration service internally
```

## Best Practices

1. **Always check the result details**: The integration may partially succeed (Telegram OK, DB failed, or vice versa)

2. **Use appropriate backup types**: Choose the correct type for better organization and filtering

3. **Set meaningful captions**: Helps identify backups in Telegram

4. **Handle large files**: Telegram has a 50MB limit for bots. The service will return an error if the file is too large

5. **Use unique filenames**: The service can generate unique filenames, but custom ones are supported

6. **Monitor expiration**: Implement cleanup jobs to delete expired backups

## Testing

The integration service includes comprehensive tests:

```bash
# Run integration tests
pnpm test src/lib/backups/__tests__/backup-telegram.integration.test.ts
```

## Related Documentation

- [Database Backups Service](./backups.service.ts)
- [Telegram Backup Service](../../../telegram-service/src/services/backup.service.ts)
- [Backup Types](../../../database/types/backups.types.ts)
- [Backup History Types](../../../database/src/jobs/types.backup.ts)
