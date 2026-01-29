/**
 * Job Worker System
 *
 * Processes background jobs from the queue with support for:
 * - Polling for pending jobs
 * - Executing job handlers
 * - Retry with exponential backoff
 * - Graceful shutdown
 *
 * US-003: Create Job Worker
 *
 * @example
 * ```typescript
 * import { JobWorker } from '@/lib/jobs/worker';
 * import { JobType } from '@nextmavens/audit-logs-database';
 *
 * // Create worker with custom options
 * const worker = new JobWorker({
 *   pollInterval: 5000,
 *   maxConcurrentJobs: 5,
 *   timeout: 30000
 * });
 *
 * // Register handlers
 * worker.registerHandler(JobType.PROVISION_PROJECT, async (payload) => {
 *   // Handle provisioning logic
 *   return { success: true, data: { projectId: payload.project_id } };
 * });
 *
 * // Start processing jobs
 * await worker.start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await worker.stop();
 * });
 * ```
 */

import type {
  Job,
  JobHandler,
  JobHandlerRegistry,
  JobPayload,
  WorkerOptions,
} from '@nextmavens/audit-logs-database';
import { JobStatus } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';

/**
 * Default worker configuration
 */
const DEFAULT_WORKER_OPTIONS: Required<WorkerOptions> = {
  pollInterval: 5000, // 5 seconds
  maxConcurrentJobs: 3,
  timeout: 60000, // 1 minute
};

/**
 * Retry configuration constants
 */
const RETRY_CONFIG = {
  baseDelay: 1000, // 1 second
  maxDelay: 60000, // 60 seconds
  multiplier: 2,
} as const;

/**
 * Calculate exponential backoff delay
 *
 * @param attempts - Number of attempts made so far
 * @returns Delay in milliseconds
 *
 * @example
 * ```typescript
 * calculateBackoff(1); // 1000ms
 * calculateBackoff(2); // 2000ms
 * calculateBackoff(3); // 4000ms
 * calculateBackoff(10); // 60000ms (capped)
 * ```
 */
function calculateBackoff(attempts: number): number {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.multiplier, attempts - 1);
  return Math.min(delay, RETRY_CONFIG.maxDelay);
}

/**
 * Job Worker Class
 *
 * Manages background job processing with:
 * - Polling for pending jobs
 * - Executing registered handlers
 * - Retry logic with exponential backoff
 * - Graceful shutdown
 */
export class JobWorker {
  private handlers: JobHandlerRegistry = {};
  private options: Required<WorkerOptions>;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private runningJobs = new Map<string, Promise<void>>();
  private shutdownTimeout = 30000; // 30 seconds to complete running jobs

  /**
   * Create a new JobWorker instance
   *
   * @param options - Worker configuration options
   */
  constructor(options: WorkerOptions = {}) {
    this.options = { ...DEFAULT_WORKER_OPTIONS, ...options };
  }

  /**
   * Register a job handler for a specific job type
   *
   * @param jobType - The type of job this handler processes
   * @param handler - The handler function to execute
   *
   * @example
   * ```typescript
   * worker.registerHandler('provision_project', async (payload) => {
   *   const result = await provisionProject(payload.project_id);
   *   return { success: true, data: result };
   * });
   * ```
   */
  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers[jobType] = handler;
  }

  /**
   * Register multiple job handlers at once
   *
   * @param handlers - Object mapping job types to handlers
   *
   * @example
   * ```typescript
   * worker.registerHandlers({
   *   'provision_project': provisionHandler,
   *   'rotate_key': rotateKeyHandler,
   *   'deliver_webhook': webhookHandler
   * });
   * ```
   */
  registerHandlers(handlers: JobHandlerRegistry): void {
    Object.assign(this.handlers, handlers);
  }

  /**
   * Start polling for jobs
   *
   * Begins the polling loop and sets up signal handlers for graceful shutdown
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[JobWorker] Worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('[JobWorker] Starting job worker');

    // Set up signal handlers for graceful shutdown
    this.setupSignalHandlers();

    // Start polling loop
    await this.poll();
  }

  /**
   * Stop polling for jobs and wait for running jobs to complete
   *
   * @param timeout - Maximum time to wait for jobs to complete (ms)
   */
  async stop(timeout?: number): Promise<void> {
    if (!this.isRunning) {
      console.warn('[JobWorker] Worker is not running');
      return;
    }

    console.log('[JobWorker] Stopping job worker');
    this.isRunning = false;

    // Clear poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for running jobs to complete
    const shutdownTimeoutMs = timeout ?? this.shutdownTimeout;
    const startTime = Date.now();

    while (this.runningJobs.size > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= shutdownTimeoutMs) {
        console.warn(
          `[JobWorker] Shutdown timeout exceeded, ${this.runningJobs.size} jobs still running`
        );
        break;
      }

      console.log(`[JobWorker] Waiting for ${this.runningJobs.size} jobs to complete`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log('[JobWorker] Worker stopped');
  }

  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      console.log(`[JobWorker] Received ${signal}, initiating graceful shutdown`);
      try {
        await this.stop();
        // Close database connections
        const { closeDatabase } = await import('@nextmavens/audit-logs-database');
        await closeDatabase();
        process.exit(0);
      } catch (error) {
        console.error('[JobWorker] Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.once('SIGINT', () => shutdownHandler('SIGINT'));
  }

  /**
   * Poll for pending jobs
   *
   * Queries the database for jobs that are:
   * - In PENDING status
   * - Scheduled for now or in the past
   * - Ordered by priority (DESC) and scheduled_at (ASC)
   *
   * Uses FOR UPDATE SKIP LOCKED to prevent multiple workers from processing the same job
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Check if we can process more jobs
      if (this.runningJobs.size < this.options.maxConcurrentJobs) {
        const jobs = await this.fetchPendingJobs();

        for (const job of jobs) {
          if (this.runningJobs.size >= this.options.maxConcurrentJobs) {
            break;
          }

          // Process job asynchronously
          const jobPromise = this.processJob(job);
          this.runningJobs.set(job.id, jobPromise);

          // Clean up completed jobs
          jobPromise.finally(() => {
            this.runningJobs.delete(job.id);
          });
        }
      }
    } catch (error) {
      console.error('[JobWorker] Error during poll:', error);
    }

    // Schedule next poll
    if (this.isRunning) {
      this.pollTimer = setTimeout(() => {
        this.poll();
      }, this.options.pollInterval);
    }
  }

  /**
   * Fetch pending jobs from the database
   *
   * @returns Array of pending jobs
   */
  private async fetchPendingJobs(): Promise<Job[]> {
    const queryText = `
      SELECT *
      FROM control_plane.jobs
      WHERE status = $1
        AND scheduled_at <= NOW()
      ORDER BY
        (payload->>'priority')::int DESC,
        scheduled_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    `;

    const values = [
      JobStatus.PENDING,
      this.options.maxConcurrentJobs - this.runningJobs.size,
    ];

    try {
      const result = await query(queryText, values);

      // Define database row type
      type DbJobRow = {
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
      };

      return result.rows.map((row: DbJobRow) => ({
        id: row.id,
        type: row.type,
        payload: row.payload as JobPayload,
        status: row.status as JobStatus,
        attempts: row.attempts,
        max_attempts: row.max_attempts,
        last_error: row.last_error,
        scheduled_at: row.scheduled_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        created_at: row.created_at,
      }));
    } catch (error) {
      console.error('[JobWorker] Error fetching pending jobs:', error);
      return [];
    }
  }

  /**
   * Process a single job
   *
   * @param job - The job to process
   */
  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    console.log(`[JobWorker] Processing job ${job.id} (type: ${job.type})`);

    try {
      // Update job status to RUNNING
      await this.updateJobStatus(job.id, JobStatus.RUNNING, null, new Date());

      // Get handler for job type
      const handler = this.handlers[job.type];
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      // Execute handler with timeout
      const result = await this.executeWithTimeout(handler, job.payload);

      // Update job status to COMPLETED
      await this.updateJobStatus(
        job.id,
        JobStatus.COMPLETED,
        null,
        null,
        new Date(),
        result.data
      );

      const duration = Date.now() - startTime;
      console.log(`[JobWorker] Job ${job.id} completed in ${duration}ms`);
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`[JobWorker] Job ${job.id} failed after ${duration}ms:`, errorMessage);

      // Determine if job should be retried
      const shouldRetry = job.attempts < job.max_attempts;

      if (shouldRetry) {
        // Calculate retry delay with exponential backoff
        const delay = calculateBackoff(job.attempts + 1);
        const scheduledAt = new Date(Date.now() + delay);

        console.log(
          `[JobWorker] Retrying job ${job.id} in ${delay}ms (attempt ${job.attempts + 1}/${job.max_attempts})`
        );

        // Update job status to PENDING with new scheduled time
        await this.updateJobStatus(
          job.id,
          JobStatus.PENDING,
          errorMessage,
          null,
          null,
          null,
          scheduledAt
        );
      } else {
        // Mark job as FAILED
        console.log(`[JobWorker] Job ${job.id} failed permanently after ${job.max_attempts} attempts`);

        await this.updateJobStatus(
          job.id,
          JobStatus.FAILED,
          errorMessage,
          null,
          new Date()
        );
      }
    }
  }

  /**
   * Execute a handler with a timeout
   *
   * @param handler - The handler function to execute
   * @param payload - The job payload
   * @returns Promise resolving to the handler result
   * @throws Error if timeout is exceeded
   */
  private async executeWithTimeout<T>(
    handler: (payload: JobPayload) => Promise<T>,
    payload: JobPayload
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Job execution timeout after ${this.options.timeout}ms`));
      }, this.options.timeout);

      handler(payload)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTimeout(timer);
        });
    });
  }

  /**
   * Update job status in the database
   *
   * @param jobId - The job ID
   * @param status - The new status
   * @param error - Error message (if any)
   * @param startedAt - Job start timestamp (optional)
   * @param completedAt - Job completion timestamp (optional)
   * @param data - Additional result data (optional)
   * @param scheduledAt - Rescheduled timestamp (optional)
   */
  private async updateJobStatus(
    jobId: string,
    status: JobStatus,
    error: string | null = null,
    startedAt: Date | null = null,
    completedAt: Date | null = null,
    data: Record<string, unknown> | null = null,
    scheduledAt: Date | null = null
  ): Promise<void> {
    const queryText = `
      UPDATE control_plane.jobs
      SET
        status = $1,
        attempts = CASE
          WHEN $2 IS NOT NULL THEN attempts + 1
          ELSE attempts
        END,
        last_error = $2,
        started_at = COALESCE($3, started_at),
        completed_at = COALESCE($4, completed_at),
        payload = CASE
          WHEN $5 IS NOT NULL THEN payload || $5
          ELSE payload
        END,
        scheduled_at = COALESCE($6, scheduled_at)
      WHERE id = $7
    `;

    const values = [
      status,
      error,
      startedAt,
      completedAt,
      data ? JSON.stringify(data) : null,
      scheduledAt,
      jobId,
    ];

    try {
      await query(queryText, values);
    } catch (error) {
      console.error(`[JobWorker] Error updating job ${jobId} status:`, error);
      throw error;
    }
  }

  /**
   * Get current worker statistics
   *
   * @returns Object with worker stats
   */
  getStats(): { isRunning: boolean; runningJobs: number; registeredHandlers: number } {
    return {
      isRunning: this.isRunning,
      runningJobs: this.runningJobs.size,
      registeredHandlers: Object.keys(this.handlers).length,
    };
  }
}

/**
 * Global worker instance
 * Provides a singleton for convenient worker management
 */
let globalWorker: JobWorker | null = null;

/**
 * Get or create the global job worker instance
 *
 * @param options - Worker configuration options (only used on first call)
 * @returns The global JobWorker instance
 *
 * @example
 * ```typescript
 * import { getJobWorker } from '@/lib/jobs/worker';
 *
 * // Get or create worker
 * const worker = getJobWorker({ pollInterval: 10000 });
 *
 * // Register handlers
 * worker.registerHandler('provision_project', provisionHandler);
 *
 * // Start worker
 * await worker.start();
 * ```
 */
export function getJobWorker(options?: WorkerOptions): JobWorker {
  if (!globalWorker) {
    globalWorker = new JobWorker(options);
  }
  return globalWorker;
}

/**
 * Start the global job worker
 *
 * @param options - Worker configuration options
 * @returns Promise resolving when worker is started
 *
 * @example
 * ```typescript
 * import { startWorker } from '@/lib/jobs/worker';
 *
 * // Start worker with default options
 * await startWorker();
 *
 * // Start worker with custom options
 * await startWorker({ pollInterval: 3000, maxConcurrentJobs: 5 });
 * ```
 */
export async function startWorker(options?: WorkerOptions): Promise<void> {
  const worker = getJobWorker(options);
  await worker.start();
}

/**
 * Stop the global job worker
 *
 * @param timeout - Maximum time to wait for jobs to complete
 * @returns Promise resolving when worker is stopped
 *
 * @example
 * ```typescript
 * import { stopWorker } from '@/lib/jobs/worker';
 *
 * await stopWorker();
 * ```
 */
export async function stopWorker(timeout?: number): Promise<void> {
  if (globalWorker) {
    await globalWorker.stop(timeout);
  }
}
