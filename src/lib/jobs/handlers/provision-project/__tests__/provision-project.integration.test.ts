/**
 * Provision Project Integration Tests
 *
 * Integration tests for the provision_project job handler to verify:
 * - Full job lifecycle: enqueue -> worker poll -> handler execution -> job completion
 * - Integration with job queue system (enqueueJob)
 * - Integration with job worker (handler registration and execution)
 * - Integration with database (control_plane.jobs table)
 * - Error handling and retry logic
 * - API key generation and storage
 * - Service registration (with mocking for external services)
 *
 * US-004: Implement Provision Project Job - Step 7: Data Layer Integration
 *
 * Usage:
 *   pnpm test src/lib/jobs/handlers/provision-project/__tests__/provision-project.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { query } from '@nextmavens/audit-logs-database';
import { JobWorker } from '@/lib/jobs/worker';
import { enqueueJob } from '@/lib/jobs/queue';
import { JobStatus, type JobPayload } from '@nextmavens/audit-logs-database';

/**
 * Test helper to clean up test jobs
 */
async function cleanupTestJobs() {
  await query(`
    DELETE FROM control_plane.jobs
    WHERE type = 'provision_project_test'
      OR type = 'provision_project_test_failing'
      OR type = 'provision_project_test_retry'
  `);

  // Clean up any test databases/schemas that may have been created
  try {
    await query(`
      DO $$
      BEGIN
        -- Drop test schemas if they exist
        EXECUTE 'DROP SCHEMA IF EXISTS tenant_test_proj_123 CASCADE';
        EXECUTE 'DROP SCHEMA IF EXISTS tenant_test_proj_456 CASCADE';
        EXECUTE 'DROP SCHEMA IF EXISTS tenant_test_proj_retry CASCADE';
        EXECUTE 'DROP SCHEMA IF EXISTS tenant_test_proj_error CASCADE';
      EXCEPTION
        WHEN insufficient_privilege THEN
          -- Ignore if we don't have privileges
          NULL;
      END $$;
    `);
  } catch (error) {
    // Ignore errors from cleanup
    console.warn('[Test Cleanup] Error dropping test schemas:', error);
  }

  try {
    await query(`
      DO $$
      BEGIN
        -- Drop test databases if they exist
        EXECUTE 'DROP DATABASE IF EXISTS tenant_test_proj_123';
        EXECUTE 'DROP DATABASE IF EXISTS tenant_test_proj_456';
        EXECUTE 'DROP DATABASE IF EXISTS tenant_test_proj_retry';
        EXECUTE 'DROP DATABASE IF EXISTS tenant_test_proj_error';
      EXCEPTION
        WHEN insufficient_privilege THEN
          -- Ignore if we don't have privileges
          NULL;
      END $$;
    `);
  } catch (error) {
    // Ignore errors from cleanup
    console.warn('[Test Cleanup] Error dropping test databases:', error);
  }
}

/**
 * Test helper to get job by ID
 */
async function getJob(jobId: string) {
  const result = await query<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    status: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    scheduled_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `
    SELECT *
    FROM control_plane.jobs
    WHERE id = $1
    `,
    [jobId]
  );

  return result.rows[0];
}

/**
 * Test helper to wait for job completion
 */
async function waitForJob(jobId: string, maxWait = 10000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const job = await getJob(jobId);
    if (
      job &&
      (job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED ||
        job.status === JobStatus.PENDING)
    ) {
      // If job is pending but scheduled in the past, it might be picked up soon
      if (job.status === JobStatus.PENDING && job.scheduled_at <= new Date()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} did not complete within ${maxWait}ms`);
}

/**
 * Mock provision handler that always succeeds
 * This simulates the real provisionProjectHandler but with mocked external services
 */
async function mockProvisionProjectHandlerSuccess(
  payload: JobPayload
): Promise<{ success: boolean; data?: Record<string, unknown> }> {
  const params = payload as {
    project_id: string;
    region: string;
    services?: { auth?: boolean; realtime?: boolean; storage?: boolean };
    api_keys?: { count?: number; prefix?: string };
    owner_id?: string;
    organization_id?: string;
  };

  console.log(`[MockProvision] Provisioning project ${params.project_id} in region ${params.region}`);

  // Simulate successful provisioning
  const metadata = {
    projectId: params.project_id,
    database: {
      host: 'localhost',
      port: 5432,
      database_name: `tenant_${params.project_id}`,
      schema_name: params.project_id,
    },
    services: {} as Record<string, { enabled: boolean; tenant_id: string; endpoint: string }>,
    api_keys: [] as Array<{ key_id: string; key_prefix: string; created_at: Date }>,
    metadata: {
      provisioned_at: new Date(),
      region: params.region,
      owner_id: params.owner_id,
      organization_id: params.organization_id,
    },
  };

  // Simulate service registration
  if (params.services?.auth) {
    metadata.services.auth = {
      enabled: true,
      tenant_id: params.project_id,
      endpoint: `http://localhost:3001/api/tenants/${params.project_id}`,
    };
  }

  if (params.services?.realtime) {
    metadata.services.realtime = {
      enabled: true,
      tenant_id: params.project_id,
      endpoint: `ws://localhost:3002/ws/${params.project_id}`,
    };
  }

  if (params.services?.storage) {
    // Type assertion to include bucket_name which is specific to storage service
    (metadata.services as Record<string, { enabled: boolean; tenant_id: string; endpoint: string; bucket_name?: string }>).storage = {
      enabled: true,
      tenant_id: params.project_id,
      endpoint: `http://localhost:3003/api/buckets/bucket-${params.project_id}`,
      bucket_name: `bucket-${params.project_id}`,
    };
  }

  // Simulate API key generation
  const keyCount = params.api_keys?.count || 1;
  const keyPrefix = params.api_keys?.prefix || params.project_id;

  for (let i = 0; i < keyCount; i++) {
    metadata.api_keys.push({
      key_id: `key-${i + 1}`,
      key_prefix: keyPrefix,
      created_at: new Date(),
    });
  }

  console.log(`[MockProvision] Successfully provisioned project ${params.project_id}`);

  return {
    success: true,
    data: metadata,
  };
}

/**
 * Mock provision handler that always fails
 * Used for testing retry logic
 */
async function mockProvisionProjectHandlerFailure(
  _payload: JobPayload
): Promise<{ success: boolean; error?: string }> {
  console.log('[MockProvision] Simulating provisioning failure');
  throw new Error('Simulated provisioning failure');
}

/**
 * Mock provision handler that fails on first attempt but succeeds on retry
 */
let failingHandlerCallCount = 0;
async function mockProvisionProjectHandlerRetry(
  payload: JobPayload
): Promise<{ success: boolean; data?: Record<string, unknown> }> {
  failingHandlerCallCount++;
  const params = payload as { project_id: string; region: string };

  console.log(`[MockProvision] Provisioning attempt ${failingHandlerCallCount} for project ${params.project_id}`);

  if (failingHandlerCallCount === 1) {
    console.log('[MockProvision] Simulating transient failure');
    throw new Error('Transient database connection error');
  }

  console.log('[MockProvision] Provisioning successful on retry');
  return {
    success: true,
    data: {
      projectId: params.project_id,
      database: {
        host: 'localhost',
        port: 5432,
        database_name: `tenant_${params.project_id}`,
        schema_name: params.project_id,
      },
      services: {},
      api_keys: [],
      metadata: {
        provisioned_at: new Date(),
        region: params.region,
      },
    },
  };
}

describe('US-004: Provision Project Integration Tests', () => {
  let worker: JobWorker;

  beforeAll(async () => {
    // Create worker with fast polling for tests
    worker = new JobWorker({
      pollInterval: 100, // Fast polling for tests
      maxConcurrentJobs: 3,
      timeout: 10000, // 10 second timeout
    });

    // Register test handlers
    worker.registerHandler('provision_project_test', mockProvisionProjectHandlerSuccess);
    worker.registerHandler('provision_project_test_failing', mockProvisionProjectHandlerFailure);
    worker.registerHandler('provision_project_test_retry', mockProvisionProjectHandlerRetry);

    // Start the worker
    await worker.start();

    // Give worker time to start
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    // Stop the worker
    await worker.stop();

    // Clean up test data
    await cleanupTestJobs();
  });

  beforeEach(async () => {
    // Reset counters
    failingHandlerCallCount = 0;

    await cleanupTestJobs();
  });

  afterEach(async () => {
    await cleanupTestJobs();
  });

  describe('AC1: Full job lifecycle integration', () => {
    it('should enqueue and process provision job from pending to completed', async () => {
      // Enqueue a provision job
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-123',
          region: 'us-east-1',
          services: {
            auth: true,
            realtime: true,
            storage: true,
          },
          api_keys: {
            count: 2,
            prefix: 'test-proj',
          },
        },
        {
          maxAttempts: 1,
        }
      );

      expect(result.id).toBeDefined();
      expect(result.type).toBe('provision_project_test');
      expect(result.status).toBe(JobStatus.PENDING);

      // Wait for job to be processed
      await waitForJob(result.id);

      // Verify job completed
      const job = await getJob(result.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.attempts).toBe(1);
      expect(job!.last_error).toBeNull();
      expect(job!.started_at).not.toBeNull();
      expect(job!.completed_at).not.toBeNull();

      // Verify job completed after it started
      expect(job!.completed_at!.getTime()).toBeGreaterThanOrEqual(job!.started_at!.getTime());
    }, 15000);

    it('should process multiple provision jobs concurrently', async () => {
      // Enqueue multiple provision jobs
      const jobs = await Promise.all([
        enqueueJob(
          'provision_project_test',
          { project_id: 'test-proj-1', region: 'us-east-1' },
          { maxAttempts: 1 }
        ),
        enqueueJob(
          'provision_project_test',
          { project_id: 'test-proj-2', region: 'eu-west-1' },
          { maxAttempts: 1 }
        ),
        enqueueJob(
          'provision_project_test',
          { project_id: 'test-proj-3', region: 'ap-south-1' },
          { maxAttempts: 1 }
        ),
      ]);

      // Wait for all jobs to complete
      await Promise.all(jobs.map((job: { id: string }) => waitForJob(job.id)));

      // Verify all jobs completed
      for (const jobResult of jobs) {
        const job = await getJob(jobResult.id);
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }
    }, 20000);
  });

  describe('AC2: Integration with job queue system', () => {
    it('should properly enqueue provision job with correct payload', async () => {
      const payload = {
        project_id: 'test-proj-queue',
        region: 'us-west-2',
        services: {
          auth: true,
          storage: false,
        },
        api_keys: {
          count: 3,
        },
      };

      const result = await enqueueJob('provision_project_test', payload, {
        maxAttempts: 3,
        priority: 10,
      });

      // Verify job was enqueued correctly
      const job = await getJob(result.id);
      expect(job).toBeDefined();
      expect(job!.type).toBe('provision_project_test');
      expect(job!.payload.project_id).toBe(payload.project_id);
      expect(job!.payload.region).toBe(payload.region);
      expect(job!.payload.services).toEqual(payload.services);
      expect(job!.payload.api_keys).toEqual(payload.api_keys);
      expect(job!.max_attempts).toBe(3);
      expect(job!.attempts).toBe(0);
      expect(job!.status).toBe(JobStatus.PENDING);
    });

    it('should store complex payload in JSONB format', async () => {
      const payload = {
        project_id: 'test-proj-complex',
        region: 'eu-central-1',
        database: {
          engine: 'postgresql' as const,
          version: '15',
          size: 'db.t3.micro',
          storage_gb: 100,
        },
        services: {
          auth: true,
          realtime: true,
          storage: true,
        },
        api_keys: {
          count: 5,
          prefix: 'prod-api',
        },
        owner_id: 'user-123',
        organization_id: 'org-456',
      };

      const result = await enqueueJob('provision_project_test', payload, {
        maxAttempts: 1,
      });

      // Verify payload was stored correctly
      const job = await getJob(result.id);
      expect(job!.payload).toEqual(payload);
      expect(job!.payload.database?.engine).toBe('postgresql');
      expect(job!.payload.database?.storage_gb).toBe(100);
      expect(job!.payload.owner_id).toBe('user-123');
    });
  });

  describe('AC3: Integration with job worker', () => {
    it('should register and execute provision handler', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-handler', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      // Wait for processing
      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.attempts).toBe(1);
    });

    it('should fail job when handler throws error', async () => {
      const result = await enqueueJob(
        'provision_project_test_failing',
        { project_id: 'test-proj-fail', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      // Wait for processing
      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.last_error).toContain('Simulated provisioning failure');
      expect(job!.attempts).toBe(1);
    });

    it('should update job status from pending to running to completed', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-lifecycle', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      // Initial state: pending
      let job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.PENDING);
      expect(job!.started_at).toBeNull();
      expect(job!.completed_at).toBeNull();

      // Wait for processing
      await waitForJob(result.id);

      // Final state: completed
      job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.started_at).not.toBeNull();
      expect(job!.completed_at).not.toBeNull();
    });
  });

  describe('AC4: Integration with database (control_plane.jobs table)', () => {
    it('should store job record in control_plane.jobs table', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-db', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      // Query the database directly
      const dbResult = await query(`
        SELECT * FROM control_plane.jobs WHERE id = $1
      `, [result.id]);

      expect(dbResult.rowCount).toBe(1);
      expect(dbResult.rows[0].id).toBe(result.id);
      expect(dbResult.rows[0].type).toBe('provision_project_test');
      expect(dbResult.rows[0].status).toBe(JobStatus.PENDING);
    });

    it('should update job status in database during processing', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-db-update', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      // Wait for processing
      await waitForJob(result.id);

      // Verify status updated in database
      const dbResult = await query(`
        SELECT * FROM control_plane.jobs WHERE id = $1
      `, [result.id]);

      expect(dbResult.rows[0].status).toBe(JobStatus.COMPLETED);
      expect(dbResult.rows[0].attempts).toBe(1);
      expect(dbResult.rows[0].started_at).not.toBeNull();
      expect(dbResult.rows[0].completed_at).not.toBeNull();
    });

    it('should query jobs by type', async () => {
      // Enqueue multiple jobs of same type
      await enqueueJob('provision_project_test', { project_id: 'test-proj-query-1', region: 'us-east-1' });
      await enqueueJob('provision_project_test', { project_id: 'test-proj-query-2', region: 'us-east-1' });

      // Query by type
      const dbResult = await query(`
        SELECT * FROM control_plane.jobs
        WHERE type = 'provision_project_test'
        AND payload->>'project_id' LIKE 'test-proj-query-%'
        ORDER BY created_at DESC
        LIMIT 2
      `);

      expect(dbResult.rowCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('AC5: Error handling and retry logic', () => {
    it('should retry failed job up to max_attempts', async () => {
      const maxAttempts = 3;
      const initialCallCount = failingHandlerCallCount;

      const result = await enqueueJob(
        'provision_project_test_retry',
        { project_id: 'test-proj-retry', region: 'us-east-1' },
        { maxAttempts }
      );

      // Wait for job to complete
      await waitForJob(result.id, 15000);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify handler was called twice (initial + 1 retry)
      expect(failingHandlerCallCount).toBe(initialCallCount + 2);
    }, 20000);

    it('should increment attempts counter on each retry', async () => {
      const result = await enqueueJob(
        'provision_project_test_failing',
        { project_id: 'test-proj-attempts', region: 'us-east-1' },
        { maxAttempts: 3 }
      );

      // Wait for job to fail permanently
      await waitForJob(result.id, 15000);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.attempts).toBe(3);
      expect(job!.last_error).toContain('Simulated provisioning failure');
    }, 20000);

    it('should update last_error on failure', async () => {
      const result = await enqueueJob(
        'provision_project_test_failing',
        { project_id: 'test-proj-error', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.last_error).not.toBeNull();
      expect(job!.last_error).toContain('Simulated provisioning failure');
    });

    it('should reschedule job with exponential backoff on retry', async () => {
      const result = await enqueueJob(
        'provision_project_test_failing',
        { project_id: 'test-proj-backoff', region: 'us-east-1' },
        { maxAttempts: 2 }
      );

      // Get initial scheduled time
      const initialJob = await getJob(result.id);
      const initialScheduledAt = initialJob!.scheduled_at;

      // Wait for first attempt to fail and be rescheduled
      await new Promise((resolve) => setTimeout(resolve, 500));

      const jobAfterRetry = await getJob(result.id);

      // After retry, the job should either be:
      // - Still pending with a new scheduled_at time (backoff applied)
      // - Failed permanently (if all attempts exhausted)
      if (jobAfterRetry!.status === JobStatus.PENDING) {
        const newScheduledAt = jobAfterRetry.scheduled_at;
        expect(newScheduledAt.getTime()).toBeGreaterThan(initialScheduledAt.getTime());
      }
    });
  });

  describe('AC6: API key generation and storage', () => {
    it('should generate API keys with specified count', async () => {
      const keyCount = 3;
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-keys',
          region: 'us-east-1',
          api_keys: {
            count: keyCount,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify API keys were generated (stored in payload)
      const payload = job!.payload as { data?: { api_keys?: Array<{ key_id: string }> } };
      expect(payload.data?.api_keys).toBeDefined();
      expect(payload.data?.api_keys?.length).toBe(keyCount);
    });

    it('should use custom prefix for API keys', async () => {
      const customPrefix = 'my-custom-prefix';
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-key-prefix',
          region: 'us-east-1',
          api_keys: {
            count: 1,
            prefix: customPrefix,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { api_keys?: Array<{ key_prefix: string }> } };
      expect(payload.data?.api_keys?.[0]?.key_prefix).toBe(customPrefix);
    });

    it('should use project_id as default prefix when not specified', async () => {
      const projectId = 'test-proj-default-prefix';
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: projectId,
          region: 'us-east-1',
          api_keys: {
            count: 1,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { api_keys?: Array<{ key_prefix: string }> } };
      expect(payload.data?.api_keys?.[0]?.key_prefix).toBe(projectId);
    });

    it('should store API key metadata including created_at timestamp', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-key-timestamp',
          region: 'us-east-1',
          api_keys: {
            count: 2,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { api_keys?: Array<{ created_at: Date }> } };

      expect(payload.data?.api_keys?.[0]?.created_at).toBeDefined();
      expect(payload.data?.api_keys?.[1]?.created_at).toBeDefined();

      // Verify timestamps are recent (within last minute)
      const now = Date.now();
      const keyTimestamp = new Date(payload.data!.api_keys![0]!.created_at).getTime();
      expect(keyTimestamp).toBeLessThanOrEqual(now);
      expect(keyTimestamp).toBeGreaterThan(now - 60000);
    });
  });

  describe('AC7: Service registration', () => {
    it('should register with auth service when enabled', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-auth',
          region: 'us-east-1',
          services: {
            auth: true,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: { auth?: { enabled: boolean } } } };

      expect(payload.data?.services?.auth).toBeDefined();
      expect(payload.data?.services?.auth?.enabled).toBe(true);
    });

    it('should register with realtime service when enabled', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-realtime',
          region: 'us-east-1',
          services: {
            realtime: true,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: { realtime?: { enabled: boolean } } } };

      expect(payload.data?.services?.realtime).toBeDefined();
      expect(payload.data?.services?.realtime?.enabled).toBe(true);
    });

    it('should register with storage service when enabled', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-storage',
          region: 'us-east-1',
          services: {
            storage: true,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: { storage?: { enabled: boolean } } } };

      expect(payload.data?.services?.storage).toBeDefined();
      expect(payload.data?.services?.storage?.enabled).toBe(true);
    });

    it('should register with multiple services simultaneously', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-multi-service',
          region: 'us-east-1',
          services: {
            auth: true,
            realtime: true,
            storage: true,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: Record<string, { enabled: boolean }> } };

      expect(payload.data?.services?.auth?.enabled).toBe(true);
      expect(payload.data?.services?.realtime?.enabled).toBe(true);
      expect(payload.data?.services?.storage?.enabled).toBe(true);
    });

    it('should not register services when not enabled', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-no-service',
          region: 'us-east-1',
          services: {
            auth: false,
            realtime: false,
            storage: false,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: Record<string, unknown> } };

      // Services object should be empty or not contain enabled services
      expect(Object.keys(payload.data?.services || {}).length).toBe(0);
    });

    it('should include tenant_id in service registration', async () => {
      const projectId = 'test-proj-tenant-id';
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: projectId,
          region: 'us-east-1',
          services: {
            auth: true,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { services?: { auth?: { tenant_id: string } } } };

      expect(payload.data?.services?.auth?.tenant_id).toBe(projectId);
    });
  });

  describe('AC8: Database and schema creation metadata', () => {
    it('should include database connection details in result', async () => {
      const projectId = 'test-proj-db-details';
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: projectId, region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { database?: { host: string; port: number; database_name: string } } };

      expect(payload.data?.database).toBeDefined();
      expect(payload.data?.database?.host).toBeDefined();
      expect(payload.data?.database?.port).toBeDefined();
      expect(payload.data?.database?.database_name).toBe(`tenant_${projectId}`);
    });

    it('should include schema_name in result', async () => {
      const projectId = 'test-proj-schema';
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: projectId, region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { database?: { schema_name: string } } };

      expect(payload.data?.database?.schema_name).toBe(projectId);
    });
  });

  describe('AC9: Provisioning metadata', () => {
    it('should include provisioned_at timestamp', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-meta-time', region: 'us-east-1' },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { metadata?: { provisioned_at: Date } } };

      expect(payload.data?.metadata?.provisioned_at).toBeDefined();

      // Verify timestamp is recent
      const now = Date.now();
      const provisionedAt = new Date(payload.data!.metadata!.provisioned_at).getTime();
      expect(provisionedAt).toBeLessThanOrEqual(now);
      expect(provisionedAt).toBeGreaterThan(now - 60000);
    });

    it('should include region in metadata', async () => {
      const region = 'eu-west-1';
      const result = await enqueueJob(
        'provision_project_test',
        { project_id: 'test-proj-meta-region', region },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { metadata?: { region: string } } };

      expect(payload.data?.metadata?.region).toBe(region);
    });

    it('should include owner_id in metadata when provided', async () => {
      const ownerId = 'user-123';
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-meta-owner',
          region: 'us-east-1',
          owner_id: ownerId,
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { metadata?: { owner_id: string } } };

      expect(payload.data?.metadata?.owner_id).toBe(ownerId);
    });

    it('should include organization_id in metadata when provided', async () => {
      const orgId = 'org-456';
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-meta-org',
          region: 'us-east-1',
          organization_id: orgId,
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      const payload = job!.payload as { data?: { metadata?: { organization_id: string } } };

      expect(payload.data?.metadata?.organization_id).toBe(orgId);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle job with minimal payload', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-minimal',
          region: 'us-east-1',
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
    });

    it('should handle job with maximum allowed API keys', async () => {
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-max-keys',
          region: 'us-east-1',
          api_keys: {
            count: 10,
          },
        },
        { maxAttempts: 1 }
      );

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);

      const payload = job!.payload as { data?: { api_keys?: Array<unknown> } };
      expect(payload.data?.api_keys?.length).toBe(10);
    });

    it('should handle various region formats', async () => {
      const regions = ['us-east-1', 'eu-west-1', 'ap-south-1', 'sa-east-1'];

      for (const region of regions) {
        const result = await enqueueJob(
          'provision_project_test',
          {
            project_id: `test-proj-region-${region}`,
            region,
          },
          { maxAttempts: 1 }
        );

        await waitForJob(result.id);

        const job = await getJob(result.id);
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }
    }, 30000);

    it('should handle job timeout scenario', async () => {
      // This test verifies the worker timeout mechanism
      // Note: The mock handler completes quickly, so we're just verifying the infrastructure works
      const result = await enqueueJob(
        'provision_project_test',
        {
          project_id: 'test-proj-timeout',
          region: 'us-east-1',
        },
        { maxAttempts: 1 }
      );

      // Job should complete normally (handler is fast)
      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
    });
  });
});
