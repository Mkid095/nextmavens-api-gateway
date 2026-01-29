/**
 * Jobs System Index
 *
 * Central export point for the job queue and worker system.
 * Provides a unified interface for enqueuing and processing background jobs.
 *
 * US-002: Create Job Queue System
 * US-003: Create Job Worker
 *
 * @example
 * ```typescript
 * import { enqueueJob, JobWorker, startWorker } from '@/lib/jobs';
 *
 * // Enqueue a job
 * const jobId = await enqueueJob('provision_project', { project_id: '123' });
 *
 * // Create and configure worker
 * const worker = new JobWorker({ pollInterval: 5000 });
 * worker.registerHandler('provision_project', async (payload) => {
 *   // Handle provisioning
 *   return { success: true, data: { projectId: payload.project_id } };
 * });
 *
 * // Start worker
 * await worker.start();
 * ```
 */

// ============================================================================
// JOB QUEUE EXPORTS
// ============================================================================
// US-002: Create Job Queue System
//
// Functions for enqueuing background jobs with support for scheduling,
// priority, and retry configuration.

export {
  JobQueue,
  enqueueJob,
  enqueueJobBatch,
  scheduleJob,
} from './queue.js';

export type {
  EnqueueJobOptions,
  EnqueueJobResult,
} from './queue.js';

// ============================================================================
// JOB WORKER EXPORTS
// ============================================================================
// US-003: Create Job Worker
//
// Worker class and functions for processing background jobs with support for
// polling, handler registration, retry logic, and graceful shutdown.

export {
  JobWorker,
  getJobWorker,
  startWorker,
  stopWorker,
} from './worker.js';

// ============================================================================
// JOB HANDLERS EXPORT
// ============================================================================
// Export individual job handlers for registration with workers

export { rotateKeyHandler } from './handlers/rotate-key.handler.js';
