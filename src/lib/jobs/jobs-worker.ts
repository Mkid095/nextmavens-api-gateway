/**
 * Job Worker Initialization
 *
 * Centralizes job worker setup with all handlers registered.
 * Provides functions to start/stop the worker and manage scheduled jobs.
 *
 * US-008: Implement Check Usage Limits Job - Step 7: Integration
 *
 * @example
 * ```typescript
 * import { initializeJobsWorker, shutdownJobsWorker } from '@/lib/jobs/jobs-worker';
 *
 * // Start worker with all handlers registered
 * await initializeJobsWorker();
 *
 * // Later, shutdown gracefully
 * await shutdownJobsWorker();
 * ```
 */

import { getJobWorker, type JobWorker } from './worker.js';
import { provisionProjectHandler } from './handlers/provision-project.handler.js';
import { checkUsageLimitsHandler } from './handlers/check-usage-limits.handler.js';
import { rotateKeyHandler } from './handlers/rotate-key.handler.js';
import { exportBackupHandler } from './handlers/export-backup.handler.js';
import { exportLogsHandler } from './handlers/export-logs.handler.js';
import { autoSuspendHandler } from './handlers/auto-suspend.handler.js';
import { cleanupExpiredBackupsHandler, notifyBackupExpirationHandler } from './handlers/cleanup-backups.handler.js';
import { enqueueJob } from './queue.js';
import { JobType } from '@nextmavens/audit-logs-database';
import { getConfig as getRetentionConfig } from '../backups/retention.config.js';

/**
 * Scheduled job interface
 */
interface ScheduledJob {
  jobType: string;
  intervalMs: number;
  payload: Record<string, unknown>;
  timerId: NodeJS.Timeout | null;
}

/**
 * Active scheduled jobs
 */
const scheduledJobs: Map<string, ScheduledJob> = new Map();

/**
 * Get job worker with all handlers registered
 *
 * @returns Configured job worker instance
 */
export function getJobsWorker(): JobWorker {
  const worker = getJobWorker({
    pollInterval: 5000, // 5 seconds
    maxConcurrentJobs: 5,
    timeout: 300000, // 5 minutes
  });

  // Register all job handlers
  worker.registerHandler(JobType.PROVISION_PROJECT, provisionProjectHandler);
  worker.registerHandler(JobType.CHECK_USAGE_LIMITS, checkUsageLimitsHandler);
  worker.registerHandler(JobType.ROTATE_KEY, rotateKeyHandler);
  worker.registerHandler(JobType.EXPORT_BACKUP, exportBackupHandler);
  worker.registerHandler('export_logs', exportLogsHandler);
  worker.registerHandler(JobType.AUTO_SUSPEND, autoSuspendHandler);

  // US-010: Register backup retention cleanup handlers
  worker.registerHandler('cleanup_expired_backups', cleanupExpiredBackupsHandler);
  worker.registerHandler('notify_backup_expiration', notifyBackupExpirationHandler);

  return worker;
}

/**
 * Initialize and start the job worker
 *
 * This function:
 * 1. Gets the job worker with all handlers registered
 * 2. Starts the worker polling loop
 * 3. Sets up scheduled jobs (e.g., hourly usage limits check)
 *
 * @returns Promise that resolves when worker is started
 */
export async function initializeJobsWorker(): Promise<void> {
  console.log('[JobsWorker] Initializing job worker...');

  try {
    // Get worker with handlers registered
    const worker = getJobsWorker();

    // Verify handlers are registered
    const stats = worker.getStats();
    console.log(`[JobsWorker] Registered ${stats.registeredHandlers} job handlers`);

    // Start the worker
    await worker.start();
    console.log('[JobsWorker] Job worker started successfully');

    // Set up scheduled jobs
    setupScheduledJobs();
    console.log('[JobsWorker] Scheduled jobs configured');
  } catch (error) {
    console.error('[JobsWorker] Failed to initialize job worker:', error);
    throw error;
  }
}

/**
 * Setup scheduled jobs
 *
 * Configures recurring jobs like:
 * - Hourly usage limits check
 * - Daily backup cleanup (US-010)
 * - Daily backup expiration notifications (US-010)
 */
function setupScheduledJobs(): void {
  // Schedule hourly usage limits check
  scheduleJob({
    name: 'hourly-usage-check',
    jobType: JobType.CHECK_USAGE_LIMITS,
    intervalMs: 60 * 60 * 1000, // 1 hour
    payload: {
      check_all: true,
      enforce_limits: true,
    },
  });

  // US-010: Schedule daily backup cleanup
  const retentionConfig = getRetentionConfig();
  const cleanupInterval = retentionConfig.cleanupIntervalHours * 60 * 60 * 1000;

  scheduleJob({
    name: 'backup-cleanup',
    jobType: 'cleanup_expired_backups',
    intervalMs: cleanupInterval,
    payload: {
      batch_size: retentionConfig.cleanupBatchSize,
      notify_first: false, // Notifications are sent separately
      dry_run: false,
    },
  });

  // US-010: Schedule daily backup expiration notifications
  scheduleJob({
    name: 'backup-expiration-notify',
    jobType: 'notify_backup_expiration',
    intervalMs: 24 * 60 * 60 * 1000, // Daily
    payload: {
      batch_size: retentionConfig.cleanupBatchSize,
    },
  });

  console.log('[JobsWorker] Scheduled jobs configured:');
  console.log('  - check_usage_limits: Every hour');
  console.log(`  - cleanup_expired_backups: Every ${retentionConfig.cleanupIntervalHours} hour(s)`);
  console.log('  - notify_backup_expiration: Daily');
}

/**
 * Schedule a recurring job
 *
 * @param options - Job scheduling options
 */
interface ScheduleJobOptions {
  name: string;
  jobType: string;
  intervalMs: number;
  payload: Record<string, unknown>;
}

function scheduleJob(options: ScheduleJobOptions): void {
  const { name, jobType, intervalMs, payload } = options;

  // Clear existing timer if job is already scheduled
  const existing = scheduledJobs.get(name);
  if (existing?.timerId) {
    clearInterval(existing.timerId);
  }

  // Schedule the job
  const timerId = setInterval(async () => {
    try {
      console.log(`[JobsWorker] Executing scheduled job: ${name}`);
      await enqueueJob(jobType, payload);
    } catch (error) {
      console.error(`[JobsWorker] Failed to execute scheduled job ${name}:`, error);
    }
  }, intervalMs);

  // Store scheduled job
  scheduledJobs.set(name, {
    jobType,
    intervalMs,
    payload,
    timerId,
  });

  console.log(`[JobsWorker] Scheduled job '${name}' to run every ${intervalMs}ms`);
}

/**
 * Shutdown the job worker gracefully
 *
 * Stops the worker and clears all scheduled job timers
 *
 * @param timeout - Maximum time to wait for jobs to complete (ms)
 * @returns Promise that resolves when worker is stopped
 */
export async function shutdownJobsWorker(timeout?: number): Promise<void> {
  console.log('[JobsWorker] Shutting down job worker...');

  try {
    // Clear all scheduled job timers
    scheduledJobs.forEach((job, name) => {
      if (job.timerId) {
        clearInterval(job.timerId);
        console.log(`[JobsWorker] Cleared scheduled job: ${name}`);
      }
    });
    scheduledJobs.clear();

    // Stop the worker
    const worker = getJobWorker();
    await worker.stop(timeout);

    console.log('[JobsWorker] Job worker shut down successfully');
  } catch (error) {
    console.error('[JobsWorker] Error during shutdown:', error);
    throw error;
  }
}

/**
 * Get information about scheduled jobs
 *
 * @returns Array of scheduled job information
 */
export function getScheduledJobs(): Array<{
  name: string;
  jobType: string;
  intervalMs: number;
  intervalDescription: string;
}> {
  const jobs: Array<{
    name: string;
    jobType: string;
    intervalMs: number;
    intervalDescription: string;
  }> = [];

  scheduledJobs.forEach((job, name) => {
    jobs.push({
      name,
      jobType: job.jobType,
      intervalMs: job.intervalMs,
      intervalDescription: formatInterval(job.intervalMs),
    });
  });

  return jobs;
}

/**
 * Format interval milliseconds into human-readable description
 */
function formatInterval(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `Every ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `Every ${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  return `Every ${seconds} second${seconds > 1 ? 's' : ''}`;
}
