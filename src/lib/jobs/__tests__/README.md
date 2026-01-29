# Rotate Key Job - Step 7 Integration

## Overview

This directory contains the integration tests for the rotate_key job handler as part of US-005 (Implement Rotate Key Job) - Step 7: Data Layer & Integration.

## Integration Points

### 1. Handler Registration

The `rotate_key` handler is registered with the JobWorker:

```typescript
import { JobWorker } from '@/lib/jobs/worker.js';
import { rotateKeyHandler } from '@/lib/jobs/handlers/rotate-key.handler.js';

const worker = new JobWorker();
worker.registerHandler('rotate_key', rotateKeyHandler);
```

### 2. Job Enqueueing

Jobs can be enqueued using the job queue:

```typescript
import { enqueueJob } from '@/lib/jobs/queue.js';

const result = await enqueueJob(
  'rotate_key',
  { key_id: '123' },
  { maxAttempts: 1 } // One-shot job, no retry
);
```

### 3. Database Operations

The handler performs the following database operations:

1. **Query existing key**: Fetches the API key from `control_plane.api_keys`
2. **Update expires_at**: Sets the expiration timestamp to 24 hours from now
3. **Return result**: Provides the old key ID, expiration time, and grace period

### 4. API Keys Table

The test creates a simplified `api_keys` table with the following schema:

```sql
CREATE TABLE control_plane.api_keys (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    key_type TEXT NOT NULL DEFAULT 'api',
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY['read']::TEXT[],
    rate_limit INTEGER DEFAULT NULL,
    expires_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run only rotate_key integration tests
pnpm test src/lib/jobs/__tests__/rotate-key.integration.test.ts

# Run typecheck
pnpm typecheck
```

## Test Coverage

The integration tests verify:

1. **Handler Registration**: Confirms the handler is registered with the worker
2. **Database Operations**: Verifies api_keys table queries work correctly
3. **End-to-End Flow**: Tests enqueuing, processing, and database updates
4. **Error Handling**: Validates graceful handling of missing/invalid keys
5. **Concurrency**: Ensures multiple jobs can be processed
6. **Data Integrity**: Confirms other fields are preserved when updating expires_at

## Acceptance Criteria

- [x] rotate_key job handler is registered with the worker
- [x] Database queries work correctly (api_keys table operations)
- [x] Integration test passes
- [x] Typecheck passes

## Next Steps

- Implement actual API key generation (currently mocked)
- Add webhook notifications when key rotation completes
- Create API endpoint to trigger key rotation manually
- Add metrics/monitoring for key rotation operations
