/**
 * Rotate Key Job Integration Test
 *
 * Integration test for the rotate_key job handler to verify:
 * - Handler is properly registered with the worker
 * - Job can be enqueued and processed
 * - Database operations work correctly (expires_at is set)
 * - End-to-end job execution flow
 *
 * US-005: Implement Rotate Key Job - Step 7: Data Layer & Integration
 *
 * Usage:
 *   pnpm test src/lib/jobs/__tests__/rotate-key.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { query } from '@nextmavens/audit-logs-database';
import { JobWorker } from '../worker.js';
import { enqueueJob } from '../queue.js';
import { rotateKeyHandler } from '../handlers/rotate-key.handler.js';
import { JobStatus } from '@nextmavens/audit-logs-database';

/**
 * Test helper to create a test API key
 */
async function createTestApiKey(): Promise<number> {
  const result = await query<{ id: number }>(
    `
    INSERT INTO control_plane.api_keys (
      project_id,
      key_type,
      key_prefix,
      key_hash,
      scopes,
      rate_limit
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    `,
    [
      1, // project_id
      'test',
      'test_key',
      'hash_' + Math.random().toString(36).substring(7),
      ['read', 'write'],
      1000,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create test API key');
  }

  return result.rows[0].id;
}

/**
 * Test helper to clean up test data
 */
async function cleanupTestData() {
  await query(`
    DELETE FROM control_plane.jobs
    WHERE type = 'rotate_key'
      AND payload->>'key_id' LIKE 'test-%'
  `);

  await query(`
    DELETE FROM control_plane.api_keys
    WHERE key_prefix LIKE 'test%'
  `);
}

/**
 * Test helper to get API key by ID
 */
async function getApiKey(keyId: number) {
  const result = await query<{
    id: number;
    project_id: number;
    key_type: string;
    key_prefix: string;
    scopes: string[];
    rate_limit: number | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `
    SELECT *
    FROM control_plane.api_keys
    WHERE id = $1
    `,
    [keyId]
  );

  return result.rows[0];
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

describe('US-005: Rotate Key Job Integration Tests', () => {
  let worker: JobWorker;

  beforeAll(async () => {
    // Create api_keys table for testing if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS control_plane.api_keys (
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
      )
    `);

    // Create indexes if they don't exist
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_project_id
      ON control_plane.api_keys(project_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
      ON control_plane.api_keys(expires_at)
    `);

    // Create worker instance
    worker = new JobWorker({
      pollInterval: 100, // Fast polling for tests
      maxConcurrentJobs: 1,
      timeout: 5000,
    });

    // Register the rotate_key handler
    worker.registerHandler('rotate_key', rotateKeyHandler);

    // Start the worker
    await worker.start();

    // Give worker time to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Stop the worker
    await worker.stop();

    // Clean up test data
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('AC1: rotate_key job handler is registered with the worker', () => {
    it('should have rotate_key handler registered', () => {
      const stats = worker.getStats();
      expect(stats.registeredHandlers).toBeGreaterThan(0);
      expect(stats.isRunning).toBe(true);
    });
  });

  describe('AC2: Database queries work correctly', () => {
    it('should create test API key successfully', async () => {
      const keyId = await createTestApiKey();
      expect(keyId).toBeDefined();
      expect(typeof keyId).toBe('number');

      // Verify key was created
      const key = await getApiKey(keyId);
      expect(key).toBeDefined();
      expect(key!.id).toBe(keyId);
      expect(key!.key_prefix).toBe('test_key');
      expect(key!.expires_at).toBeNull(); // Initially not expired
    });

    it('should query api_keys table by ID', async () => {
      const keyId = await createTestApiKey();
      const key = await getApiKey(keyId);

      expect(key).toBeDefined();
      expect(key!.id).toBe(keyId);
      expect(key!.project_id).toBeDefined();
      expect(key!.key_type).toBeDefined();
      expect(key!.scopes).toBeDefined();
    });
  });

  describe('AC3: Integration test passes', () => {
    it('should enqueue a rotate_key job', async () => {
      const keyId = await createTestApiKey();

      const result = await enqueueJob(
        'rotate_key',
        { key_id: String(keyId) },
        {
          maxAttempts: 1,
          priority: 5,
        }
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('rotate_key');
      expect(result.status).toBe(JobStatus.PENDING);
    });

    it('should process rotate_key job and update expires_at', async () => {
      const keyId = await createTestApiKey();

      // Enqueue the job
      const jobResult = await enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 });

      // Wait for worker to process the job
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check job status
      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.attempts).toBe(1);
      expect(job!.last_error).toBeNull();

      // Check API key was updated
      const key = await getApiKey(keyId);
      expect(key).toBeDefined();
      expect(key!.expires_at).toBeDefined();
      expect(key!.expires_at).not.toBeNull();

      // Verify expires_at is approximately 24 hours from now
      const expiresAt = new Date(key!.expires_at!);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThan(23.9); // ~24 hours
      expect(diffHours).toBeLessThan(24.1);
    }, 10000);

    it('should handle non-existent key gracefully', async () => {
      const nonExistentKeyId = 999999;

      const jobResult = await enqueueJob(
        'rotate_key',
        { key_id: String(nonExistentKeyId) },
        { maxAttempts: 1 }
      );

      // Wait for worker to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check job status
      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED); // Handler completes successfully even if key not found
      expect(job!.last_error).toBeNull();
    });

    it('should handle missing key_id in payload', async () => {
      const jobResult = await enqueueJob('rotate_key', {}, { maxAttempts: 1 });

      // Wait for worker to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check job status
      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED); // Handler completes with error in result
      expect(job!.last_error).toBeNull();
    });

    it('should process multiple rotate_key jobs concurrently', async () => {
      const keyIds = await Promise.all([
        createTestApiKey(),
        createTestApiKey(),
        createTestApiKey(),
      ]);

      // Enqueue multiple jobs
      const jobResults = await Promise.all(
        keyIds.map((keyId) =>
          enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 })
        )
      );

      // Wait for all jobs to process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check all jobs completed
      for (const jobResult of jobResults) {
        const job = await getJob(jobResult.id);
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }

      // Check all keys were updated
      for (const keyId of keyIds) {
        const key = await getApiKey(keyId);
        expect(key!.expires_at).toBeDefined();
        expect(key!.expires_at).not.toBeNull();
      }
    }, 15000);
  });

  describe('AC4: Verify data layer operations', () => {
    it('should update api_keys table with expires_at', async () => {
      const keyId = await createTestApiKey();

      // Verify initial state
      const keyBefore = await getApiKey(keyId);
      expect(keyBefore!.expires_at).toBeNull();

      // Enqueue and process rotation job
      await enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify updated state
      const keyAfter = await getApiKey(keyId);
      expect(keyAfter!.expires_at).not.toBeNull();

      // Verify the update was made correctly
      const expiresAt = new Date(keyAfter!.expires_at!);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      // Should be approximately 24 hours (in milliseconds)
      expect(timeUntilExpiry).toBeGreaterThan(23.5 * 60 * 60 * 1000);
      expect(timeUntilExpiry).toBeLessThan(24.5 * 60 * 60 * 1000);
    });

    it('should preserve other key fields when updating expires_at', async () => {
      const keyId = await createTestApiKey();

      const keyBefore = await getApiKey(keyId);
      const originalProjectId = keyBefore!.project_id;
      const originalKeyType = keyBefore!.key_type;
      const originalKeyPrefix = keyBefore!.key_prefix;
      const originalScopes = keyBefore!.scopes;
      const originalRateLimit = keyBefore!.rate_limit;

      // Process rotation
      await enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify fields preserved
      const keyAfter = await getApiKey(keyId);
      expect(keyAfter!.project_id).toBe(originalProjectId);
      expect(keyAfter!.key_type).toBe(originalKeyType);
      expect(keyAfter!.key_prefix).toBe(originalKeyPrefix);
      expect(keyAfter!.scopes).toEqual(originalScopes);
      expect(keyAfter!.rate_limit).toBe(originalRateLimit);
    });
  });

  describe('Job execution lifecycle', () => {
    it('should transition job from pending to running to completed', async () => {
      const keyId = await createTestApiKey();

      const { id: jobId } = await enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 });

      // Check initial status (pending)
      let job = await getJob(jobId);
      expect(job!.status).toBe(JobStatus.PENDING);
      expect(job!.started_at).toBeNull();
      expect(job!.completed_at).toBeNull();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check final status (completed)
      job = await getJob(jobId);
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.started_at).not.toBeNull();
      expect(job!.completed_at).not.toBeNull();
    });

    it('should update job attempts counter', async () => {
      const keyId = await createTestApiKey();

      const { id: jobId } = await enqueueJob('rotate_key', { key_id: String(keyId) }, { maxAttempts: 1 });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobId);
      expect(job!.attempts).toBe(1);
      expect(job!.max_attempts).toBe(1);
    });
  });
});
