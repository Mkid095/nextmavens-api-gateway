# Job Handlers

This directory contains implementations of background job handlers for the Telegram Platform PaaS.

## Overview

Each handler is responsible for processing a specific type of job in the background job queue. Handlers are registered with the JobWorker and executed when jobs are dequeued.

## Available Handlers

### 1. Provision Project Handler
**File**: `provision-project.handler.ts`

Provisions a new project by:
- Creating tenant database
- Setting up tenant schema
- Registering with services (auth, realtime, storage)
- Generating API keys

**Usage**:
```typescript
import { enqueueProvisionProjectJob } from '@/lib/jobs/handlers/provision-project.handler';

await enqueueProvisionProjectJob({
  projectId: 'proj-123',
  projectName: 'My Project',
  ownerId: 'user-456',
  region: 'us-east-1',
});
```

### 2. Rotate Key Handler
**File**: `rotate-key.handler.ts`

Rotates API keys by:
- Creating new key version
- Marking old key as expired after 24h grace period

**Usage**:
```typescript
import { enqueueRotateKeyJob } from '@/lib/jobs/handlers/rotate-key.handler';

await enqueueRotateKeyJob('key-123');
```

### 3. Deliver Webhook Handler
**File**: `deliver-webhook.handler.ts`

Delivers webhooks to external endpoints with:
- Retry with exponential backoff (5 attempts)
- Delivery status tracking
- Automatic disabling after 5 consecutive failures

**Usage**:
```typescript
import { enqueueDeliverWebhookJob } from '@/lib/jobs/handlers/deliver-webhook.handler';

await enqueueDeliverWebhookJob({
  webhookId: 'webhook-123',
  projectId: 'proj-123',
  url: 'https://example.com/webhook',
  payload: { event: 'project.created' },
});
```

### 4. Export Backup Handler
**File**: `export-backup.handler.ts`

Exports project backups by:
- Generating SQL dump of project schema
- Uploading to Telegram storage
- Sending notification when complete

**Usage**:
```typescript
import { enqueueExportBackupJob } from '@/lib/jobs/handlers/export-backup.handler';

await enqueueExportBackupJob({
  projectId: 'proj-123',
  exportType: 'full',
});
```

### 5. Check Usage Limits Handler
**File**: `check-usage-limits.handler.ts`

Periodically checks project quotas and:
- Suspends projects exceeding hard caps (100%)
- Sends warnings at 90% threshold
- Sends warnings at 80% threshold

**Usage**:
```typescript
import { enqueueCheckUsageLimitsJob } from '@/lib/jobs/handlers/check-usage-limits.handler';

// Check all projects
await enqueueCheckUsageLimitsJob({ checkAll: true });

// Check specific project
await enqueueCheckUsageLimitsJob({ projectIds: ['proj-123'] });

// Dry run (don't actually suspend)
await enqueueCheckUsageLimitsJob({ checkAll: true, enforceLimits: false });
```

### 6. Auto Suspend Handler
**File**: `auto-suspend.handler.ts`

Detects and responds to abuse patterns:
- **Excessive Usage**: Usage rate exceeds 10x normal baseline
- **Error Spike**: Error rate exceeds 50% of total requests
- **Suspicious Pattern**: Anomalous behavior detected

**Usage**:
```typescript
import { enqueueAutoSuspendJob, AbusePatternType } from '@/lib/jobs/handlers/auto-suspend.handler';

// Suspend for excessive usage
await enqueueAutoSuspendJob({
  projectId: 'proj-123',
  patternType: AbusePatternType.EXCESSIVE_USAGE,
  metrics: {
    requests_per_minute: 5000,
    baseline_requests_per_minute: 500,
  },
  enforceAction: true,
});
```

**Monitoring Integration**: See `MONITORING_INTEGRATION.md` for details on integrating with external monitoring systems (Prometheus, Grafana, Datadog).

## Handler Patterns

### One-Shot Jobs
These jobs run once and should not be retried:
- `rotate_key`
- `auto_suspend`

```typescript
const result = await enqueueJob('job_type', payload, {
  maxAttempts: 1, // No retry
});
```

### Scheduled Jobs
These jobs run on a schedule via cron:
- `check_usage_limits`

```typescript
// Run hourly via cron
await enqueueJob('check_usage_limits', { check_all: true });
```

### Retryable Jobs
These jobs should be retried on failure:
- `provision_project`
- `deliver_webhook`
- `export_backup`

```typescript
const result = await enqueueJob('job_type', payload, {
  maxAttempts: 3, // Retry up to 3 times
  delayMs: 5000,  // Initial delay before retry
});
```

## Creating a New Handler

1. **Create the handler file**:

```typescript
// src/lib/jobs/handlers/my-handler.handler.ts
import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';

export interface MyHandlerPayload extends JobPayload {
  // Define your payload fields
  project_id: string;
  // ...
}

export async function myHandler(payload: JobPayload): Promise<JobExecutionResult> {
  const config = payload as MyHandlerPayload;

  try {
    // Your handler logic here
    console.log(`Processing job for project ${config.project_id}`);

    // Return success
    return {
      success: true,
      data: { /* result data */ },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Convenience function for enqueueing
export async function enqueueMyJob(options: MyHandlerPayload): Promise<string> {
  const result = await enqueueJob('my_job_type', options);
  return result.id;
}
```

2. **Register the handler with the worker**:

```typescript
// src/lib/jobs/worker.ts or jobs-worker.ts
import { myHandler } from '@/lib/jobs/handlers/my-handler.handler';

worker.registerHandler('my_job_type', myHandler);
```

3. **Add tests**:

```typescript
// src/lib/jobs/handlers/__tests__/my-handler.test.ts
import { describe, it, expect } from 'vitest';
import { myHandler } from '../my-handler.handler';

describe('My Handler', () => {
  it('should process successfully', async () => {
    const result = await myHandler({
      project_id: 'test-123',
      // ... other fields
    });

    expect(result.success).toBe(true);
  });
});
```

## Data Layer Functions

Handlers export data layer functions for:

- **Metric Collection**: `getProjectMetrics()`, `getProjectBaseline()`
- **Project Information**: `getProjectDetails()`, `getProjectOwner()`
- **Audit Logging**: `recordAbuseDetection()`, `recordQuotaCheck()`

These can be imported and used by other handlers or services:

```typescript
import { getProjectMetrics, getProjectBaseline } from '@/lib/jobs/handlers/auto-suspend.handler';

const metrics = await getProjectMetrics('proj-123');
const baseline = await getProjectBaseline('proj-123');
```

## Testing

Run all handler tests:

```bash
cd /home/ken/api-gateway
pnpm test src/lib/jobs/handlers
```

Run specific handler tests:

```bash
pnpm test src/lib/jobs/handlers/auto-suspend.handler
pnpm test src/lib/jobs/handlers/check-usage-limits.handler
```

Run integration tests:

```bash
pnpm test src/lib/jobs/handlers/__tests__/*.integration.test.ts
```

## Monitoring Integration

The `auto-suspend` handler provides integration with external monitoring systems. See [MONITORING_INTEGRATION.md](./MONITORING_INTEGRATION.md) for:

- Prometheus Alertmanager setup
- Grafana webhook configuration
- Datadog integration
- Custom monitoring systems
- API endpoint documentation

## Best Practices

1. **Type Safety**: Always define proper TypeScript interfaces for payloads
2. **Error Handling**: Wrap operations in try-catch and return appropriate error messages
3. **Logging**: Use consistent logging format: `[HandlerName] Action: details`
4. **Idempotency**: Design handlers to be idempotent where possible
5. **Validation**: Validate payload fields before processing
6. **Documentation**: Add JSDoc comments with usage examples
7. **Testing**: Write unit and integration tests for all handlers
8. **Retry Strategy**: Choose appropriate retry strategy based on job type

## Common Patterns

### With Retry and Backoff

```typescript
import { enqueueJob } from '../queue';

const result = await enqueueJob('job_type', payload, {
  maxAttempts: 3,
  delayMs: 5000,
});
```

### One-Shot (No Retry)

```typescript
const result = await enqueueJob('job_type', payload, {
  maxAttempts: 1,
});
```

### Scheduled Job

```typescript
// Run every hour via cron
cron.schedule('0 * * * *', async () => {
  await enqueueJob('check_usage_limits', { check_all: true });
});
```

### Batch Processing

```typescript
const projectIds = ['proj-1', 'proj-2', 'proj-3'];

for (const projectId of projectIds) {
  await enqueueJob('job_type', { project_id: projectId });
}
```

## Related Documentation

- [Job Queue](../queue.ts) - Job enqueueing and queue management
- [Job Worker](../worker.ts) - Job processing and execution
- [Job Types](../../types/jobs.types.ts) - Type definitions
- [Monitoring Integration](./MONITORING_INTEGRATION.md) - External monitoring setup
