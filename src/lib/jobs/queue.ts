/**
 * Job Queue System
 *
 * Provides a centralized job queue for enqueueing background jobs.
 * Jobs are stored in the control_plane.jobs table and processed by workers.
 *
 * US-002: Create Job Queue System
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 *
 * // Enqueue a job with default options
 * const jobId = await enqueueJob('provision_project', { project_id: 'proj-123' });
 *
 * // Enqueue a job with scheduling and retry options
 * const scheduledJobId = await enqueueJob('rotate_key', { key_id: 'key-456' }, {
 *   delay: 60000, // 1 minute delay
 *   maxAttempts: 5,
 *   priority: 10
 * });
 * ```
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  JobType,
  JobPayload,
} from '@nextmavens/audit-logs-database';
import { JobStatus } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';

/**
 * Job enqueuement options
 * Provides fine-grained control over job scheduling and retry behavior
 */
export interface EnqueueJobOptions {
  /**
   * Delay before job execution (in milliseconds)
   * If specified, the job will be scheduled for the future
   * @default 0 (execute immediately)
   */
  delay?: number;

  /**
   * Maximum number of execution attempts
   * Includes the initial attempt plus retries
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Job priority level
   * Higher values indicate higher priority
   * Workers should process higher priority jobs first
   * @default 0
   */
  priority?: number;

  /**
   * Custom scheduled timestamp
   * If provided, takes precedence over delay
   * Useful for specific scheduling requirements
   */
  scheduledAt?: Date;
}

/**
 * Validation constants
 */
const VALIDATION = {
  /** Maximum allowed maxAttempts value */
  MAX_MAX_ATTEMPTS: 100,
  /** Minimum allowed maxAttempts value */
  MIN_MAX_ATTEMPTS: 1,
  /** Maximum allowed delay in milliseconds (24 hours) */
  MAX_DELAY: 24 * 60 * 60 * 1000,
  /** Minimum allowed delay (0 = immediate) */
  MIN_DELAY: 0,
  /** Maximum allowed priority value */
  MAX_PRIORITY: 1000,
  /** Minimum allowed priority value */
  MIN_PRIORITY: 0,
} as const;

/**
 * Validate job type string
 */
function validateJobType(type: string): void {
  if (typeof type !== 'string') {
    throw new Error('Job type must be a string');
  }
  if (type.trim().length === 0) {
    throw new Error('Job type cannot be empty');
  }
  if (type.length > 100) {
    throw new Error('Job type cannot exceed 100 characters');
  }
  // Allow only alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(type)) {
    throw new Error('Job type can only contain alphanumeric characters, underscores, and hyphens');
  }
}

/**
 * Validate job payload
 */
function validateJobPayload(payload: JobPayload): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Job payload must be an object');
  }
  // Check payload size when serialized (max 1MB)
  const serialized = JSON.stringify(payload);
  if (serialized.length > 1024 * 1024) {
    throw new Error('Job payload size cannot exceed 1MB');
  }
}

/**
 * Validate maxAttempts value
 */
function validateMaxAttempts(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts)) {
    throw new Error('maxAttempts must be an integer');
  }
  if (maxAttempts < VALIDATION.MIN_MAX_ATTEMPTS) {
    throw new Error(`maxAttempts must be at least ${VALIDATION.MIN_MAX_ATTEMPTS}`);
  }
  if (maxAttempts > VALIDATION.MAX_MAX_ATTEMPTS) {
    throw new Error(`maxAttempts cannot exceed ${VALIDATION.MAX_MAX_ATTEMPTS}`);
  }
}

/**
 * Validate delay value
 */
function validateDelay(delay: number): void {
  if (!Number.isInteger(delay)) {
    throw new Error('delay must be an integer');
  }
  if (delay < VALIDATION.MIN_DELAY) {
    throw new Error(`delay must be at least ${VALIDATION.MIN_DELAY}`);
  }
  if (delay > VALIDATION.MAX_DELAY) {
    throw new Error(`delay cannot exceed ${VALIDATION.MAX_DELAY} milliseconds (24 hours)`);
  }
}

/**
 * Validate priority value
 */
function validatePriority(priority: number): void {
  if (!Number.isInteger(priority)) {
    throw new Error('priority must be an integer');
  }
  if (priority < VALIDATION.MIN_PRIORITY) {
    throw new Error(`priority must be at least ${VALIDATION.MIN_PRIORITY}`);
  }
  if (priority > VALIDATION.MAX_PRIORITY) {
    throw new Error(`priority cannot exceed ${VALIDATION.MAX_PRIORITY}`);
  }
}

/**
 * Validate scheduled date
 */
function validateScheduledDate(date: Date): void {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Scheduled date must be a valid Date object');
  }
  // Don't allow scheduling too far in the future (max 1 year)
  const maxFuture = new Date();
  maxFuture.setFullYear(maxFuture.getFullYear() + 1);
  if (date > maxFuture) {
    throw new Error('Cannot schedule jobs more than 1 year in the future');
  }
}

/**
 * Result of job enqueuement
 */
export interface EnqueueJobResult {
  /**
   * Unique identifier for the enqueued job
   */
  id: string;

  /**
   * Type of the job
   */
  type: string;

  /**
   * Current job status
   */
  status: JobStatus;

  /**
   * Timestamp when job is scheduled to run
   */
  scheduledAt: Date;

  /**
   * Timestamp when job was created
   */
  createdAt: Date;
}

/**
 * Job Queue Class
 *
 * Manages job enqueuement with support for:
 * - Delayed scheduling
 * - Retry configuration
 * - Priority handling
 * - Type-safe payloads
 */
export class JobQueue {
  /**
   * Enqueue a new job for background processing
   *
   * @param type - The type of job to enqueue (e.g., 'provision_project', 'rotate_key')
   * @param payload - Job-specific data (optional)
   * @param options - Job enqueuement options (delay, maxAttempts, priority)
   * @returns Promise resolving to the job ID and metadata
   *
   * @throws Error if database insertion fails
   *
   * @example
   * ```typescript
   * const queue = new JobQueue();
   *
   * // Simple job
   * const result = await queue.enqueue('provision_project', { project_id: '123' });
   * console.log(`Job ${result.id} enqueued for ${result.scheduledAt}`);
   *
   * // Delayed job with custom retry
   * const result2 = await queue.enqueue(
   *   'rotate_key',
   *   { key_id: '456' },
   *   { delay: 60000, maxAttempts: 5, priority: 10 }
   * );
   * ```
   */
  async enqueue(
    type: JobType | string,
    payload: JobPayload = {},
    options: EnqueueJobOptions = {}
  ): Promise<EnqueueJobResult> {
    // Validate inputs
    validateJobType(type);
    validateJobPayload(payload);

    // Calculate scheduled timestamp
    const scheduledAt = options.scheduledAt || new Date(Date.now() + (options.delay || 0));

    // Validate scheduled date
    if (options.scheduledAt) {
      validateScheduledDate(options.scheduledAt);
    }

    // Set defaults and validate
    const maxAttempts = options.maxAttempts ?? 3;
    const priority = options.priority ?? 0;

    validateMaxAttempts(maxAttempts);
    validatePriority(priority);

    if (options.delay !== undefined) {
      validateDelay(options.delay);
    }

    // Generate unique job ID
    const id = uuidv4();

    // Prepare payload with priority
    const enrichedPayload: JobPayload = {
      ...payload,
      priority,
    };

    // Insert job into database
    const queryText = `
      INSERT INTO control_plane.jobs (
        id,
        type,
        payload,
        status,
        attempts,
        max_attempts,
        scheduled_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, type, status, scheduled_at, created_at
    `;

    const values = [
      id,
      type,
      JSON.stringify(enrichedPayload),
      JobStatus.PENDING,
      0,
      maxAttempts,
      scheduledAt,
    ];

    try {
      const result = await query(queryText, values);

      if (result.rows.length === 0) {
        throw new Error('Failed to create job');
      }

      const row = result.rows[0] as {
        id: string;
        type: string;
        status: string;
        scheduled_at: Date;
        created_at: Date;
      };

      return {
        id: row.id,
        type: row.type,
        status: row.status as JobStatus,
        scheduledAt: row.scheduled_at,
        createdAt: row.created_at,
      };
    } catch (error) {
      // Don't expose internal error messages
      if (error instanceof Error && error.message.startsWith('Failed to create job')) {
        throw error;
      }
      throw new Error('Failed to enqueue job');
    }
  }

  /**
   * Batch enqueue multiple jobs
   *
   * @param jobs - Array of jobs to enqueue
   * @returns Promise resolving to array of job IDs
   *
   * @example
   * ```typescript
   * const queue = new JobQueue();
   * const results = await queue.enqueueBatch([
   *   { type: 'provision_project', payload: { project_id: '1' } },
   *   { type: 'provision_project', payload: { project_id: '2' } },
   *   { type: 'rotate_key', payload: { key_id: '3' }, options: { delay: 5000 } }
   * ]);
   * ```
   */
  async enqueueBatch(
    jobs: Array<{
      type: JobType | string;
      payload?: JobPayload;
      options?: EnqueueJobOptions;
    }>
  ): Promise<EnqueueJobResult[]> {
    const results: EnqueueJobResult[] = [];

    for (const job of jobs) {
      const result = await this.enqueue(
        job.type,
        job.payload || {},
        job.options || {}
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Schedule a job for a specific future time
   *
   * @param type - The type of job to schedule
   * @param payload - Job-specific data
   * @param scheduledAt - When to execute the job
   * @param options - Additional job options (maxAttempts, priority)
   * @returns Promise resolving to the job ID and metadata
   *
   * @example
   * ```typescript
   * const queue = new JobQueue();
   *
   * // Schedule job for specific date
   * const result = await queue.schedule(
   *   'export_backup',
   *   { project_id: '123' },
   *   new Date('2026-01-30T02:00:00Z'),
   *   { priority: 5 }
   * );
   * ```
   */
  async schedule(
    type: JobType | string,
    payload: JobPayload,
    scheduledAt: Date,
    options: Omit<EnqueueJobOptions, 'delay' | 'scheduledAt'> = {}
  ): Promise<EnqueueJobResult> {
    return this.enqueue(type, payload, {
      ...options,
      scheduledAt,
    });
  }
}

/**
 * Global job queue instance
 * Provides a singleton for convenient job enqueuement
 */
const jobQueue = new JobQueue();

/**
 * Enqueue a job for background processing
 *
 * This is the primary function for adding jobs to the queue.
 * It uses a singleton JobQueue instance for efficiency.
 *
 * @param type - The type of job to enqueue
 * @param payload - Job-specific data (optional)
 * @param options - Job enqueuement options (optional)
 * @returns Promise resolving to the job ID and metadata
 *
 * @example
 * ```typescript
 * // Simple job
 * const result = await enqueueJob('provision_project', { project_id: '123' });
 * console.log(`Enqueued job: ${result.id}`);
 *
 * // Delayed job with retries
 * const result2 = await enqueueJob(
 *   'rotate_key',
 *   { key_id: '456' },
 *   { delay: 60000, maxAttempts: 5 }
 * );
 * ```
 */
export async function enqueueJob(
  type: JobType | string,
  payload: JobPayload = {},
  options: EnqueueJobOptions = {}
): Promise<EnqueueJobResult> {
  return jobQueue.enqueue(type, payload, options);
}

/**
 * Enqueue multiple jobs in a batch
 *
 * @param jobs - Array of jobs to enqueue
 * @returns Promise resolving to array of job results
 */
export async function enqueueJobBatch(
  jobs: Array<{
    type: JobType | string;
    payload?: JobPayload;
    options?: EnqueueJobOptions;
  }>
): Promise<EnqueueJobResult[]> {
  return jobQueue.enqueueBatch(jobs);
}

/**
 * Schedule a job for a specific time
 *
 * @param type - The type of job to schedule
 * @param payload - Job-specific data
 * @param scheduledAt - When to execute the job
 * @param options - Additional job options
 * @returns Promise resolving to the job result
 */
export async function scheduleJob(
  type: JobType | string,
  payload: JobPayload,
  scheduledAt: Date,
  options: Omit<EnqueueJobOptions, 'delay' | 'scheduledAt'> = {}
): Promise<EnqueueJobResult> {
  return jobQueue.schedule(type, payload, scheduledAt, options);
}
