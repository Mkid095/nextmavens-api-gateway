/**
 * Check Usage Limits Job Handler
 *
 * Periodically checks all projects against their configured quotas and:
 * 1. Suspends projects exceeding hard caps
 * 2. Sends warnings at 80% and 90% threshold
 * 3. Tracks usage metrics for monitoring
 *
 * This job runs on a schedule (typically hourly) and checks all active projects.
 *
 * US-008: Implement Check Usage Limits Job
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { checkUsageLimitsHandler } from '@/lib/jobs/handlers/check-usage-limits.handler';
 *
 * // Register the handler
 * worker.registerHandler('check_usage_limits', checkUsageLimitsHandler);
 *
 * // Enqueue a check job (usually scheduled via cron)
 * await enqueueJob('check_usage_limits', { check_all: true });
 *
 * // Or check specific project
 * await enqueueJob('check_usage_limits', { project_ids: ['proj-123'] });
 * ```
 */

import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import { enqueueJob } from '../queue.js';

/**
 * Hard cap types for quota enforcement
 */
export enum HardCapType {
  /** Database queries per day */
  DB_QUERIES_PER_DAY = 'db_queries_per_day',
  /** Realtime connections */
  REALTIME_CONNECTIONS = 'realtime_connections',
  /** Storage uploads per day */
  STORAGE_UPLOADS_PER_DAY = 'storage_uploads_per_day',
  /** Function invocations per day */
  FUNCTION_INVOCATIONS_PER_DAY = 'function_invocations_per_day',
}

/**
 * Project status for suspension checks
 */
export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

/**
 * Check usage limits handler payload
 */
export interface CheckUsageLimitsPayload extends JobPayload {
  /**
   * Check all active projects (default for scheduled job)
   */
  check_all?: boolean;

  /**
   * Check specific projects only
   */
  project_ids?: string[];

  /**
   * Cap types to check (default: all)
   */
  cap_types?: HardCapType[];

  /**
   * Whether to actually suspend projects or just report
   * Set to false for dry-run mode
   */
  enforce_limits?: boolean;
}

/**
 * Project quota configuration
 */
export interface ProjectQuota {
  /** Project ID */
  project_id: string;
  /** Type of cap */
  cap_type: HardCapType;
  /** Quota limit value */
  cap_value: number;
}

/**
 * Current usage metrics for a project
 */
export interface ProjectUsage {
  /** Project ID */
  project_id: string;
  /** Database queries today */
  db_queries_today: number;
  /** Active realtime connections */
  realtime_connections: number;
  /** Storage uploads today */
  storage_uploads_today: number;
  /** Function invocations today */
  function_invocations_today: number;
}

/**
 * Quota check result for a single project
 */
export interface QuotaCheckResult {
  /** Project ID */
  project_id: string;
  /** Whether quota was exceeded */
  exceeded: boolean;
  /** Actions taken */
  actions: QuotaAction[];
}

/**
 * Actions taken during quota check
 */
export interface QuotaAction {
  /** Type of action */
  action_type: 'warning_sent' | 'project_suspended' | 'no_action';
  /** Cap type that triggered action */
  cap_type: HardCapType;
  /** Current usage value */
  current_usage: number;
  /** Quota limit */
  quota_limit: number;
  /** Usage percentage */
  usage_percentage: number;
  /** Timestamp of action */
  timestamp: Date;
}

/**
 * Check usage limits job result
 */
export interface CheckUsageLimitsResult extends Record<string, unknown> {
  /** Number of projects checked */
  projects_checked: number;
  /** Number of projects suspended */
  projects_suspended: number;
  /** Number of warnings sent */
  warnings_sent: number;
  /** Detailed results by project */
  details: QuotaCheckResult[];
  /** Duration of check in milliseconds */
  duration_ms: number;
}

/**
 * Warning thresholds for quota alerts
 */
const WARNING_THRESHOLDS = {
  WARNING_80: 0.8,
  WARNING_90: 0.9,
  HARD_CAP: 1.0,
};

/**
 * Get all active projects from the database
 */
async function getActiveProjects(): Promise<Array<{ id: string; name: string }>> {
  const queryText = `
    SELECT id, name
    FROM control_plane.projects
    WHERE status = $1
    ORDER BY name
  `;

  const result = await query(queryText, [ProjectStatus.ACTIVE]);
  return result.rows;
}

/**
 * Get quotas for a project
 */
async function getProjectQuotas(projectId: string): Promise<ProjectQuota[]> {
  const queryText = `
    SELECT
      project_id,
      cap_type,
      cap_value
    FROM control_plane.project_quotas
    WHERE project_id = $1
  `;

  const result = await query(queryText, [projectId]);
  return result.rows;
}

/**
 * Get current usage for a project
 *
 * TODO: Implement actual usage tracking
 * This should query from metrics/usage tables that track:
 * - DB queries (from audit logs or dedicated metrics table)
 * - Realtime connections (from realtime service)
 * - Storage uploads (from storage service)
 * - Function invocations (from function execution logs)
 */
async function getProjectUsage(projectId: string): Promise<ProjectUsage> {
  // Mock implementation - in production, query actual usage metrics
  const queryText = `
    SELECT
      $1 as project_id,
      0 as db_queries_today,
      0 as realtime_connections,
      0 as storage_uploads_today,
      0 as function_invocations_today
  `;

  const result = await query(queryText, [projectId]);
  return result.rows[0] as ProjectUsage;
}

/**
 * Map cap type to usage field
 */
function getUsageForCapType(usage: ProjectUsage, capType: HardCapType): number {
  switch (capType) {
    case HardCapType.DB_QUERIES_PER_DAY:
      return usage.db_queries_today;
    case HardCapType.REALTIME_CONNECTIONS:
      return usage.realtime_connections;
    case HardCapType.STORAGE_UPLOADS_PER_DAY:
      return usage.storage_uploads_today;
    case HardCapType.FUNCTION_INVOCATIONS_PER_DAY:
      return usage.function_invocations_today;
    default:
      return 0;
  }
}

/**
 * Suspend a project for exceeding quota
 */
async function suspendProject(
  projectId: string,
  capType: HardCapType,
  currentUsage: number,
  quotaLimit: number
): Promise<void> {
  const queryText = `
    UPDATE control_plane.projects
    SET status = $1,
        updated_at = NOW()
    WHERE id = $2
  `;

  await query(queryText, [ProjectStatus.SUSPENDED, projectId]);

  // TODO: Send notification to project owner
  console.log(
    `[CheckUsageLimits] Suspended project ${projectId} for exceeding ${capType}: ${currentUsage}/${quotaLimit}`
  );
}

/**
 * Send warning notification for approaching quota
 */
async function sendWarning(
  projectId: string,
  capType: HardCapType,
  currentUsage: number,
  quotaLimit: number,
  _threshold: number
): Promise<void> {
  // TODO: Implement notification sending
  const percentage = Math.round((currentUsage / quotaLimit) * 100);
  console.log(
    `[CheckUsageLimits] Warning for project ${projectId}: ${capType} at ${percentage}% (${currentUsage}/${quotaLimit})`
  );
}

/**
 * Check a single project against its quotas
 */
async function checkProjectQuotas(
  projectId: string,
  enforceLimits: boolean
): Promise<QuotaCheckResult> {
  const actions: QuotaAction[] = [];
  let exceeded = false;

  // Get project quotas
  const quotas = await getProjectQuotas(projectId);

  // Get current usage
  const usage = await getProjectUsage(projectId);

  // Check each quota
  for (const quota of quotas) {
    const currentUsage = getUsageForCapType(usage, quota.cap_type);
    const usagePercentage = currentUsage / quota.cap_value;

    // Check if hard cap exceeded
    if (usagePercentage >= WARNING_THRESHOLDS.HARD_CAP) {
      exceeded = true;
      actions.push({
        action_type: enforceLimits ? 'project_suspended' : 'no_action',
        cap_type: quota.cap_type,
        current_usage: currentUsage,
        quota_limit: quota.cap_value,
        usage_percentage: usagePercentage,
        timestamp: new Date(),
      });

      if (enforceLimits) {
        await suspendProject(
          projectId,
          quota.cap_type,
          currentUsage,
          quota.cap_value
        );
      }
    }
    // Check 90% warning threshold
    else if (usagePercentage >= WARNING_THRESHOLDS.WARNING_90) {
      actions.push({
        action_type: 'warning_sent',
        cap_type: quota.cap_type,
        current_usage: currentUsage,
        quota_limit: quota.cap_value,
        usage_percentage: usagePercentage,
        timestamp: new Date(),
      });

      await sendWarning(
        projectId,
        quota.cap_type,
        currentUsage,
        quota.cap_value,
        WARNING_THRESHOLDS.WARNING_90
      );
    }
    // Check 80% warning threshold
    else if (usagePercentage >= WARNING_THRESHOLDS.WARNING_80) {
      actions.push({
        action_type: 'warning_sent',
        cap_type: quota.cap_type,
        current_usage: currentUsage,
        quota_limit: quota.cap_value,
        usage_percentage: usagePercentage,
        timestamp: new Date(),
      });

      await sendWarning(
        projectId,
        quota.cap_type,
        currentUsage,
        quota.cap_value,
        WARNING_THRESHOLDS.WARNING_80
      );
    }
  }

  return {
    project_id: projectId,
    exceeded,
    actions,
  };
}

/**
 * Check Usage Limits Job Handler
 *
 * Checks projects against their configured quotas and takes action:
 * - Suspends projects exceeding hard caps (100%)
 * - Sends warnings at 90% threshold
 * - Sends warnings at 80% threshold
 *
 * @param payload - Job payload with optional filters
 * @returns Promise resolving to job execution result
 */
export async function checkUsageLimitsHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  const config = payload as CheckUsageLimitsPayload;

  console.log('[CheckUsageLimits] Starting quota check run');

  const startTime = Date.now();
  const enforceLimits = config.enforce_limits !== false; // Default to true

  try {
    // Determine which projects to check
    let projectIds: string[] = [];

    if (config.project_ids && config.project_ids.length > 0) {
      // Check specific projects
      projectIds = config.project_ids;
    } else if (config.check_all !== false) {
      // Check all active projects (default)
      const projects = await getActiveProjects();
      projectIds = projects.map((p) => p.id);
    }

    console.log(`[CheckUsageLimits] Checking ${projectIds.length} projects`);

    // Check each project
    const details: QuotaCheckResult[] = [];
    let projectsSuspended = 0;
    let warningsSent = 0;

    for (const projectId of projectIds) {
      const result = await checkProjectQuotas(projectId, enforceLimits);
      details.push(result);

      // Count actions
      for (const action of result.actions) {
        if (action.action_type === 'project_suspended') {
          projectsSuspended++;
        } else if (action.action_type === 'warning_sent') {
          warningsSent++;
        }
      }
    }

    const duration = Date.now() - startTime;

    // Prepare result
    const result: CheckUsageLimitsResult = {
      projects_checked: projectIds.length,
      projects_suspended: projectsSuspended,
      warnings_sent: warningsSent,
      details,
      duration_ms: duration,
    };

    console.log(
      `[CheckUsageLimits] Completed: ${projectIds.length} projects checked, ${projectsSuspended} suspended, ${warningsSent} warnings sent (${duration}ms)`
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CheckUsageLimits] Failed:', errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Convenience function to enqueue a check_usage_limits job
 *
 * @param options - Check options (check all projects or specific ones)
 * @returns Promise resolving to the job ID
 *
 * @example
 * ```typescript
 * import { enqueueCheckUsageLimitsJob } from '@/lib/jobs/handlers/check-usage-limits.handler';
 *
 * // Check all projects
 * await enqueueCheckUsageLimitsJob({ checkAll: true });
 *
 * // Check specific project
 * await enqueueCheckUsageLimitsJob({ projectIds: ['proj-123'] });
 *
 * // Dry run (don't actually suspend)
 * await enqueueCheckUsageLimitsJob({ checkAll: true, enforceLimits: false });
 * ```
 */
export async function enqueueCheckUsageLimitsJob(
  options: {
    checkAll?: boolean;
    projectIds?: string[];
    enforceLimits?: boolean;
  } = {}
): Promise<string> {
  const payload: CheckUsageLimitsPayload = {
    check_all: options.checkAll !== false,
    project_ids: options.projectIds,
    enforce_limits: options.enforceLimits,
  };

  const result = await enqueueJob('check_usage_limits', payload);

  return result.id;
}
