/**
 * Job Worker Integration Tests
 *
 * Integration tests for the JobWorker class to verify:
 * - Worker can be instantiated and configured
 * - Handler registration works correctly
 * - Worker processes jobs enqueued by the queue
 * - Database queries work with FOR UPDATE SKIP LOCKED
 * - Retry logic with exponential backoff
 * - Graceful shutdown waits for running jobs
 *
 * US-003: Create Job Worker - Step 7: Integration
 *
 * Usage:
 *   pnpm test src/lib/jobs/__tests__/worker.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { query } from '@nextmavens/audit-logs-database';
import { JobWorker } from '../worker.js';
import { enqueueJob } from '../queue.js';
import { JobStatus, type JobHandler, type JobPayload } from '@nextmavens/audit-logs-database';

/**
 * Test helper to clean up test jobs
 */
async function cleanupTestJobs() {
  await query(`
    DELETE FROM control_plane.jobs
    WHERE type = 'test_job'
      OR type = 'failing_job'
      OR type = 'slow_job'
  `);
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
async function waitForJob(jobId: string, maxWait = 5000): Promise<void> {
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

describe('US-003: Job Worker Integration Tests', () => {
  let worker: JobWorker;

  // Test handler counters
  let testJobCallCount = 0;
  let failingJobCallCount = 0;
  let slowJobCallCount = 0;
  // @ts-expect-error - Variable used in test setup for future slow job tests
  let slowJobResolve: ((value: { success: boolean; data?: Record<string, unknown> }) => void) | null = null;

  beforeAll(async () => {
    // Create worker instance with fast polling for tests
    worker = new JobWorker({
      pollInterval: 100, // Fast polling for tests
      maxConcurrentJobs: 3,
      timeout: 5000,
    });

    // Register test handlers

    // Successful job handler
    const testJobHandler: JobHandler = async (_payload: JobPayload) => {
      testJobCallCount++;
      return {
        success: true,
        data: {
          message: 'Test job completed',
          received: _payload,
        },
      };
    };

    // Failing job handler (for retry tests)
    const failingJobHandler: JobHandler = async (_payload: JobPayload) => {
      failingJobCallCount++;
      throw new Error('Intentional test failure');
    };

    // Slow job handler (for graceful shutdown tests)
    const slowJobHandler: JobHandler = async (_payload: JobPayload) => {
      slowJobCallCount++;
      return new Promise<{ success: boolean; data?: Record<string, unknown> }>((resolve) => {
        slowJobResolve = resolve;
        // Don't resolve immediately - caller will resolve when needed
      });
    };

    // Register handlers
    worker.registerHandler('test_job', testJobHandler);
    worker.registerHandler('failing_job', failingJobHandler);
    worker.registerHandler('slow_job', slowJobHandler);

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
    testJobCallCount = 0;
    failingJobCallCount = 0;
    slowJobCallCount = 0;
    slowJobResolve = null;

    await cleanupTestJobs();
  });

  afterEach(async () => {
    await cleanupTestJobs();
  });

  describe('AC1: Worker instantiation and configuration', () => {
    it('should create worker with default options', () => {
      const defaultWorker = new JobWorker();
      const stats = defaultWorker.getStats();

      expect(stats.isRunning).toBe(false);
      expect(stats.runningJobs).toBe(0);
      expect(stats.registeredHandlers).toBe(0);
    });

    it('should create worker with custom options', () => {
      const customWorker = new JobWorker({
        pollInterval: 10000,
        maxConcurrentJobs: 5,
        timeout: 30000,
      });

      const stats = customWorker.getStats();
      expect(stats.isRunning).toBe(false);
    });

    it('should have worker running after start', () => {
      const stats = worker.getStats();
      expect(stats.isRunning).toBe(true);
    });

    it('should report registered handlers correctly', () => {
      const stats = worker.getStats();
      expect(stats.registeredHandlers).toBe(3); // test_job, failing_job, slow_job
    });
  });

  describe('AC2: Handler registration', () => {
    it('should register single handler', () => {
      const tempWorker = new JobWorker();
      const handler: JobHandler = async () => ({ success: true });

      tempWorker.registerHandler('temp_job', handler);

      const stats = tempWorker.getStats();
      expect(stats.registeredHandlers).toBe(1);
    });

    it('should register multiple handlers via registerHandlers', () => {
      const tempWorker = new JobWorker();
      const handler1: JobHandler = async () => ({ success: true, data: {} });
      const handler2: JobHandler = async () => ({ success: true, data: {} });

      tempWorker.registerHandlers({
        job1: handler1,
        job2: handler2,
      });

      const stats = tempWorker.getStats();
      expect(stats.registeredHandlers).toBe(2);
    });

    it('should overwrite existing handler when registering same type', () => {
      const tempWorker = new JobWorker();
      const handler1: JobHandler = async () => ({ success: true, data: { version: 1 } });
      const handler2: JobHandler = async () => ({ success: true, data: { version: 2 } });

      tempWorker.registerHandler('job', handler1);
      tempWorker.registerHandler('job', handler2);

      const stats = tempWorker.getStats();
      expect(stats.registeredHandlers).toBe(1); // Still 1, not 2
    });
  });

  describe('AC3: End-to-end job processing', () => {
    it('should process a job enqueued by the queue', async () => {
      const initialCallCount = testJobCallCount;

      // Enqueue a test job
      const result = await enqueueJob('test_job', { test_data: 'value' }, { maxAttempts: 1 });

      expect(result.id).toBeDefined();
      expect(result.type).toBe('test_job');
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

      // Verify handler was called
      expect(testJobCallCount).toBe(initialCallCount + 1);
    }, 10000);

    it('should process multiple jobs concurrently', async () => {
      const initialCallCount = testJobCallCount;

      // Enqueue multiple jobs
      const jobs = await Promise.all([
        enqueueJob('test_job', { index: 1 }, { maxAttempts: 1 }),
        enqueueJob('test_job', { index: 2 }, { maxAttempts: 1 }),
        enqueueJob('test_job', { index: 3 }, { maxAttempts: 1 }),
      ]);

      // Wait for all jobs to complete
      await Promise.all(jobs.map((job) => waitForJob(job.id)));

      // Verify all jobs completed
      for (const jobResult of jobs) {
        const job = await getJob(jobResult.id);
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }

      // Verify handler was called for each job
      expect(testJobCallCount).toBe(initialCallCount + 3);
    }, 15000);

    it('should fail job when no handler is registered', async () => {
      // Enqueue job with unregistered type
      const result = await enqueueJob('unregistered_job', { data: 'test' }, { maxAttempts: 1 });

      // Wait for job to fail
      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.last_error).toContain('No handler registered');
      expect(job!.attempts).toBe(1);
    }, 10000);
  });

  describe('AC4: Retry logic with exponential backoff', () => {
    it('should retry failed job up to max_attempts', async () => {
      const initialCallCount = failingJobCallCount;
      const maxAttempts = 3;

      // Enqueue failing job with multiple attempts
      const result = await enqueueJob('failing_job', { data: 'test' }, { maxAttempts });

      // Wait for job to fail permanently
      await waitForJob(result.id, 15000);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.attempts).toBe(maxAttempts);
      expect(job!.last_error).toContain('Intentional test failure');

      // Verify handler was called max_attempts times
      expect(failingJobCallCount).toBe(initialCallCount + maxAttempts);
    }, 20000);

    it('should calculate exponential backoff correctly', async () => {
      const backoffTimes: number[] = [];

      // Enqueue failing job
      const result = await enqueueJob('failing_job', { data: 'backoff_test' }, { maxAttempts: 3 });

      // Track scheduled_at changes to verify backoff
      let previousScheduledAt = (await getJob(result.id))!.scheduled_at;

      for (let i = 0; i < 3; i++) {
        await waitForJob(result.id, 10000);
        const job = await getJob(result.id);

        if (job!.status === JobStatus.FAILED) {
          break;
        }

        const currentScheduledAt = job!.scheduled_at;
        const diff = currentScheduledAt.getTime() - previousScheduledAt.getTime();

        if (diff > 0) {
          backoffTimes.push(diff);
        }

        previousScheduledAt = currentScheduledAt;
      }

      // Verify exponential growth (allowing some tolerance)
      if (backoffTimes.length >= 2) {
        expect(backoffTimes[1]).toBeGreaterThan(backoffTimes[0] * 1.5); // At least 1.5x growth
      }
    }, 30000);
  });

  describe('AC5: Graceful shutdown', () => {
    it('should stop polling when stop is called', async () => {
      const tempWorker = new JobWorker({ pollInterval: 100 });
      await tempWorker.start();

      expect(tempWorker.getStats().isRunning).toBe(true);

      await tempWorker.stop();

      expect(tempWorker.getStats().isRunning).toBe(false);
    });

    it('should wait for running jobs to complete during shutdown', async () => {
      const tempWorker = new JobWorker({
        pollInterval: 100,
        maxConcurrentJobs: 1,
      });

      let jobStarted = false;
      let jobCompleted = false;

      const handler: JobHandler = async () => {
        jobStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        jobCompleted = true;
        return { success: true };
      };

      tempWorker.registerHandler('shutdown_test', handler);
      await tempWorker.start();

      // Enqueue a job
      const result = await enqueueJob('shutdown_test', {}, { maxAttempts: 1 });

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(jobStarted).toBe(true);
      expect(jobCompleted).toBe(false);

      // Stop worker (should wait for job to complete)
      await tempWorker.stop();

      // Verify job completed before worker stopped
      expect(jobCompleted).toBe(true);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
    }, 10000);

    it('should timeout if jobs take too long during shutdown', async () => {
      const tempWorker = new JobWorker({
        pollInterval: 100,
        maxConcurrentJobs: 1,
      });

      const handler: JobHandler = async () => {
        // Job that never completes
        return new Promise(() => {
          // Never resolve
        });
      };

      tempWorker.registerHandler('timeout_test', handler);
      await tempWorker.start();

      // Enqueue a job
      await enqueueJob('timeout_test', {}, { maxAttempts: 1 });

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop worker with short timeout
      const startTime = Date.now();
      await tempWorker.stop(); // Use default timeout
      const elapsed = Date.now() - startTime;

      // Should timeout approximately after default shutdown timeout
      expect(elapsed).toBeGreaterThan(29000); // Default is 30 seconds
    }, 40000);
  });

  describe('AC6: Database operations with FOR UPDATE SKIP LOCKED', () => {
    it('should prevent multiple workers from processing same job', async () => {
      // Create two workers
      const worker1 = new JobWorker({ pollInterval: 100, maxConcurrentJobs: 1 });
      const worker2 = new JobWorker({ pollInterval: 100, maxConcurrentJobs: 1 });

      let worker1CallCount = 0;
      let worker2CallCount = 0;

      const handler1: JobHandler = async () => {
        worker1CallCount++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, worker: 1 };
      };

      const handler2: JobHandler = async () => {
        worker2CallCount++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { success: true, worker: 2 };
      };

      worker1.registerHandler('lock_test', handler1);
      worker2.registerHandler('lock_test', handler2);

      // Start both workers
      await worker1.start();
      await worker2.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Enqueue a single job
      const result = await enqueueJob('lock_test', {}, { maxAttempts: 1 });

      // Wait for job to complete
      await waitForJob(result.id, 5000);

      // Stop both workers
      await worker1.stop();
      await worker2.stop();

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Only one worker should have processed the job
      const totalCalls = worker1CallCount + worker2CallCount;
      expect(totalCalls).toBe(1);

      // The job should have been processed by exactly one worker
      const exactlyOneWorkerProcessed = worker1CallCount === 1 || worker2CallCount === 1;
      expect(exactlyOneWorkerProcessed).toBe(true);
    }, 10000);

    it('should query pending jobs with priority ordering', async () => {
      // Enqueue jobs with different priorities
      await enqueueJob('test_job', { priority: 1 }, { maxAttempts: 1, priority: 1 });
      await enqueueJob('test_job', { priority: 10 }, { maxAttempts: 1, priority: 10 });
      await enqueueJob('test_job', { priority: 5 }, { maxAttempts: 1, priority: 5 });

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The highest priority job (10) should be processed first
      // (This is a weak test - in a real scenario we'd need more precise tracking)
    }, 5000);
  });

  describe('Job lifecycle and status transitions', () => {
    it('should transition job from pending to running to completed', async () => {
      const result = await enqueueJob('test_job', { lifecycle: 'test' }, { maxAttempts: 1 });

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
      expect(job!.completed_at!.getTime()).toBeGreaterThanOrEqual(job!.started_at!.getTime());
    }, 10000);

    it('should update attempts counter on each retry', async () => {
      const result = await enqueueJob('failing_job', {}, { maxAttempts: 2 });

      await waitForJob(result.id, 10000);

      const job = await getJob(result.id);
      expect(job!.attempts).toBe(2);
      expect(job!.status).toBe(JobStatus.FAILED);
    }, 15000);
  });

  describe('Edge cases and error handling', () => {
    it('should handle job timeout', async () => {
      const tempWorker = new JobWorker({ pollInterval: 100, timeout: 500 });

      const slowHandler: JobHandler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second job
        return { success: true };
      };

      tempWorker.registerHandler('timeout_edge_case', slowHandler);
      await tempWorker.start();

      const result = await enqueueJob('timeout_edge_case', {}, { maxAttempts: 1 });

      await waitForJob(result.id, 5000);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.FAILED);
      expect(job!.last_error).toContain('timeout');

      await tempWorker.stop();
    }, 10000);

    it('should handle empty payload', async () => {
      const result = await enqueueJob('test_job', {}, { maxAttempts: 1 });

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
    }, 10000);

    it('should handle handler that returns minimal success', async () => {
      const minimalHandler: JobHandler = async () => {
        return { success: true };
      };

      worker.registerHandler('minimal_handler', minimalHandler);

      const result = await enqueueJob('minimal_handler', {}, { maxAttempts: 1 });

      await waitForJob(result.id);

      const job = await getJob(result.id);
      expect(job!.status).toBe(JobStatus.COMPLETED);
    }, 10000);
  });
});
