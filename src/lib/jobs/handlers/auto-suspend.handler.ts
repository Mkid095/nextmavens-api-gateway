/**
 * Auto Suspend Job Handler
 *
 * Detects abusive behavior patterns and automatically suspends projects to protect
 * the platform from malicious or excessive usage. This is a security-focused job
 * that monitors for:
 * 1. Excessive usage spikes (> 10x normal rate)
 * 2. Error rate spikes (> 50% error rate)
 * 3. Suspicious patterns (rapid requests, anomalous behavior)
 *
 * This is a one-shot job (no retry) since suspension is idempotent and should
 * not be automatically retried on failure. Manual review is required.
 *
 * US-009: Implement Auto Suspend Job
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { autoSuspendHandler } from '@/lib/jobs/handlers/auto-suspend.handler';
 *
 * // Register the handler
 * worker.registerHandler('auto_suspend', autoSuspendHandler);
 *
 * // Enqueue an auto suspend job (typically triggered by monitoring/alerting)
 * await enqueueJob('auto_suspend', {
 *   project_id: 'proj-123',
 *   pattern_type: 'excessive_usage',
 *   metrics: { requests_per_minute: 5000 }
 * }, { maxAttempts: 1 });
 * ```
 */

import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import { enqueueJob } from '../queue.js';

/**
 * Abuse pattern types that trigger automatic suspension
 */
export enum AbusePatternType {
  /** Usage rate exceeds 10x normal baseline */
  EXCESSIVE_USAGE = 'excessive_usage',
  /** Error rate exceeds 50% of total requests */
  ERROR_SPIKE = 'error_spike',
  /** Suspicious behavior patterns detected */
  SUSPICIOUS_PATTERN = 'suspicious_pattern',
}

/**
 * Auto suspend handler payload
 */
export interface AutoSuspendPayload extends JobPayload {
  /**
   * The ID of the project to suspend
   */
  project_id: string;

  /**
   * Type of abuse pattern detected
   */
  pattern_type: AbusePatternType;

  /**
   * Metrics/evidence that triggered the detection
   */
  metrics: AbuseMetrics;

  /**
   * Whether to actually suspend or just report (dry-run mode)
   */
  enforce_action?: boolean;

  /**
   * Additional context about the detection
   */
  context?: string;
}

/**
 * Metrics that triggered abuse detection
 */
export interface AbuseMetrics {
  /** Current requests per minute */
  requests_per_minute?: number;
  /** Baseline/normal requests per minute */
  baseline_requests_per_minute?: number;
  /** Current error rate (0-1) */
  error_rate?: number;
  /** Total errors in detection window */
  error_count?: number;
  /** Total requests in detection window */
  total_requests?: number;
  /** Pattern-specific metrics */
  pattern_details?: Record<string, unknown>;
}

/**
 * Project abuse detection result
 */
export interface ProjectAbuseDetection {
  /** Project ID */
  project_id: string;
  /** Whether abuse was confirmed */
  abuse_confirmed: boolean;
  /** Type of abuse pattern detected */
  pattern_type: AbusePatternType;
  /** Detection timestamp */
  detected_at: Date;
  /** Metrics that triggered detection */
  metrics: AbuseMetrics;
  /** Action taken */
  action_taken: 'project_suspended' | 'warning_sent' | 'logged_only';
}

/**
 * Auto suspend job result
 */
export interface AutoSuspendResult extends Record<string, unknown> {
  /** The ID of the project that was evaluated */
  project_id: string;
  /** Whether abuse was confirmed */
  abuse_confirmed: boolean;
  /** Type of abuse pattern detected */
  pattern_type: AbusePatternType;
  /** Action taken */
  action_taken: 'project_suspended' | 'warning_sent' | 'logged_only';
  /** Timestamp of suspension action */
  suspended_at?: Date;
  /** Details of the abuse detection */
  detection: ProjectAbuseDetection;
}

/**
 * Thresholds for abuse detection
 */
const ABUSE_THRESHOLDS = {
  /** Usage rate multiplier that triggers excessive usage detection */
  EXCESSIVE_USAGE_MULTIPLIER: 10,
  /** Error rate threshold (0-1) that triggers error spike detection */
  ERROR_RATE_THRESHOLD: 0.5,
  /** Minimum requests required for meaningful error rate calculation */
  MIN_REQUESTS_FOR_ERROR_CHECK: 100,
  /** Minimum requests per minute to trigger excessive usage check */
  MIN_REQUESTS_PER_MINUTE: 1000,
};

/**
 * Project status for suspension
 */
enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

/**
 * Verify abuse detection metrics meet threshold requirements
 */
function verifyAbuseMetrics(
  patternType: AbusePatternType,
  metrics: AbuseMetrics
): { valid: boolean; reason?: string } {
  switch (patternType) {
    case AbusePatternType.EXCESSIVE_USAGE:
      if (!metrics.requests_per_minute || !metrics.baseline_requests_per_minute) {
        return {
          valid: false,
          reason: 'Missing required metrics: requests_per_minute and baseline_requests_per_minute',
        };
      }
      if (metrics.requests_per_minute < ABUSE_THRESHOLDS.MIN_REQUESTS_PER_MINUTE) {
        return {
          valid: false,
          reason: `Requests per minute below threshold: ${metrics.requests_per_minute} < ${ABUSE_THRESHOLDS.MIN_REQUESTS_PER_MINUTE}`,
        };
      }
      const usageMultiplier =
        metrics.requests_per_minute / metrics.baseline_requests_per_minute;
      if (usageMultiplier < ABUSE_THRESHOLDS.EXCESSIVE_USAGE_MULTIPLIER) {
        return {
          valid: false,
          reason: `Usage multiplier below threshold: ${usageMultiplier.toFixed(2)}x < ${ABUSE_THRESHOLDS.EXCESSIVE_USAGE_MULTIPLIER}x`,
        };
      }
      return { valid: true };

    case AbusePatternType.ERROR_SPIKE:
      if (metrics.error_rate === undefined || metrics.total_requests === undefined) {
        return {
          valid: false,
          reason: 'Missing required metrics: error_rate and total_requests',
        };
      }
      if (metrics.total_requests < ABUSE_THRESHOLDS.MIN_REQUESTS_FOR_ERROR_CHECK) {
        return {
          valid: false,
          reason: `Insufficient requests for error rate calculation: ${metrics.total_requests} < ${ABUSE_THRESHOLDS.MIN_REQUESTS_FOR_ERROR_CHECK}`,
        };
      }
      if (metrics.error_rate < ABUSE_THRESHOLDS.ERROR_RATE_THRESHOLD) {
        return {
          valid: false,
          reason: `Error rate below threshold: ${(metrics.error_rate * 100).toFixed(1)}% < ${(ABUSE_THRESHOLDS.ERROR_RATE_THRESHOLD * 100).toFixed(1)}%`,
        };
      }
      return { valid: true };

    case AbusePatternType.SUSPICIOUS_PATTERN:
      // Suspicious patterns require manual review but should have some context
      if (!metrics.pattern_details || Object.keys(metrics.pattern_details).length === 0) {
        return {
          valid: false,
          reason: 'Missing pattern_details for suspicious pattern detection',
        };
      }
      return { valid: true };

    default:
      return { valid: false, reason: 'Unknown pattern type' };
  }
}

/**
 * Suspend a project for abuse
 */
async function suspendProject(
  projectId: string,
  patternType: AbusePatternType,
  metrics: AbuseMetrics
): Promise<void> {
  const queryText = `
    UPDATE control_plane.projects
    SET status = $1,
        updated_at = NOW(),
        suspension_reason = $2
    WHERE id = $3
  `;

  const reason = `Abuse detected: ${patternType}`;
  await query(queryText, [ProjectStatus.SUSPENDED, reason, projectId]);

  console.log(
    `[AutoSuspend] Suspended project ${projectId} for ${patternType}: ${JSON.stringify(metrics)}`
  );
}

/**
 * Send notification to project owner about abuse detection
 */
async function sendAbuseNotification(
  projectId: string,
  patternType: AbusePatternType,
  metrics: AbuseMetrics
): Promise<void> {
  // Get project owner email using the data layer function
  const owner = await getProjectOwner(projectId);

  if (!owner) {
    console.warn(`[AutoSuspend] No owner found for project ${projectId}`);
    return;
  }

  // TODO: Implement actual notification sending
  // This would enqueue a send_notification job or call notification service
  console.log(
    `[AutoSuspend] TODO: Send abuse notification to ${owner.email} for project ${projectId}: ${patternType}`
  );

  // For now, just log the notification with metrics
  console.log(
    `[AutoSuspend] Abuse notification would be sent to ${owner.email} (user_id: ${owner.user_id}): ${JSON.stringify(metrics)}`
  );
}

/**
 * Get project details for abuse verification
 */
async function getProjectDetails(
  projectId: string
): Promise<{ id: string; name: string; status: string; owner_id: string } | null> {
  const queryText = `
    SELECT id, name, status, owner_id
    FROM control_plane.projects
    WHERE id = $1
  `;

  const result = await query(queryText, [projectId]);
  return result.rows.length > 0 ? (result.rows[0] as unknown as { id: string; name: string; status: string; owner_id: string }) : null;
}

/**
 * Get current metrics for a project
 *
 * Queries the audit_logs table to calculate current usage metrics:
 * - Request rate (requests per minute in the last hour)
 * - Error rate (percentage of failed actions in the last hour)
 * - Total requests in the measurement window
 *
 * This provides real-time metrics for abuse detection.
 *
 * @param projectId - Project ID to get metrics for
 * @returns Current metrics for the project
 */
export async function getProjectMetrics(
  projectId: string
): Promise<{ requests_per_minute: number; error_rate: number; total_requests: number; error_count: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Get total requests and error count from audit_logs in the last hour
  const metricsQuery = `
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN action LIKE '%error%' OR action LIKE '%failed%' THEN 1 ELSE 0 END) as error_count
    FROM control_plane.audit_logs
    WHERE target_id = $1
      AND created_at >= $2
  `;

  const result = await query(metricsQuery, [projectId, oneHourAgo]);
  const row = result.rows[0] as { total_requests: string; error_count: string };

  const totalRequests = parseInt(row.total_requests, 10) || 0;
  const errorCount = parseInt(row.error_count, 10) || 0;
  const requestsPerMinute = totalRequests / 60; // Requests per minute over the last hour
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

  return {
    requests_per_minute: Math.round(requestsPerMinute * 100) / 100,
    error_rate: Math.round(errorRate * 1000) / 1000,
    total_requests: totalRequests,
    error_count: errorCount,
  };
}

/**
 * Get baseline metrics for a project
 *
 * Calculates the baseline (normal) usage metrics by analyzing
 * audit_logs from the past 7 days (excluding the last hour which
 * contains the current metrics).
 *
 * This baseline is used to detect anomalies - current usage
 * significantly higher than baseline indicates potential abuse.
 *
 * @param projectId - Project ID to get baseline for
 * @returns Baseline metrics for the project
 */
export async function getProjectBaseline(
  projectId: string
): Promise<{ baseline_requests_per_minute: number; baseline_error_rate: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get baseline metrics from the past 7 days (excluding last hour)
  const baselineQuery = `
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN action LIKE '%error%' OR action LIKE '%failed%' THEN 1 ELSE 0 END) as error_count
    FROM control_plane.audit_logs
    WHERE target_id = $1
      AND created_at >= $2
      AND created_at < $3
  `;

  const result = await query(baselineQuery, [projectId, sevenDaysAgo, oneHourAgo]);
  const row = result.rows[0] as { total_requests: string; error_count: string };

  const totalRequests = parseInt(row.total_requests, 10) || 0;
  const errorCount = parseInt(row.error_count, 10) || 0;

  // Calculate baseline per minute (7 days = 7 * 24 * 60 minutes)
  const minutesInWeek = 7 * 24 * 60;
  const baselineRequestsPerMinute = totalRequests / minutesInWeek;
  const baselineErrorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

  return {
    baseline_requests_per_minute: Math.round(baselineRequestsPerMinute * 100) / 100,
    baseline_error_rate: Math.round(baselineErrorRate * 1000) / 1000,
  };
}

/**
 * Get project owner information for notifications
 *
 * Retrieves the project owner's email and user ID for sending
 * abuse detection notifications.
 *
 * @param projectId - Project ID to get owner for
 * @returns Owner information or null if not found
 */
export async function getProjectOwner(
  projectId: string
): Promise<{ email: string; user_id: string } | null> {
  const ownerQuery = `
    SELECT u.email, u.id as user_id
    FROM control_plane.projects p
    JOIN control_plane.users u ON p.owner_id = u.id
    WHERE p.id = $1
  `;

  const result = await query(ownerQuery, [projectId]);

  if (result.rows.length === 0) {
    return null;
  }

  const owner = result.rows[0] as { email: string; user_id: string };
  return owner;
}

/**
 * Record abuse detection event for audit trail
 *
 * Creates an audit log entry documenting the abuse detection
 * and any actions taken. This provides a complete history of
 * security events for compliance and forensics.
 *
 * @param projectId - Project ID where abuse was detected
 * @param patternType - Type of abuse pattern detected
 * @param metrics - Metrics that triggered the detection
 * @param actionTaken - Action that was taken
 * @returns Promise that resolves when audit log is created
 */
export async function recordAbuseDetection(
  projectId: string,
  patternType: AbusePatternType,
  metrics: AbuseMetrics,
  actionTaken: 'project_suspended' | 'warning_sent' | 'logged_only'
): Promise<void> {
  const auditLogQuery = `
    INSERT INTO control_plane.audit_logs (
      actor_id,
      actor_type,
      action,
      target_type,
      target_id,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `;

  const metadata = {
    pattern_type: patternType,
    metrics,
    action_taken: actionTaken,
    detected_at: new Date().toISOString(),
  };

  await query(auditLogQuery, [
    'system',
    'system',
    'abuse.detected',
    'project',
    projectId,
    JSON.stringify(metadata),
  ]);

  console.log(
    `[AutoSuspend] Recorded abuse detection for project ${projectId}: ${patternType} -> ${actionTaken}`
  );
}

/**
 * Auto Suspend Job Handler
 *
 * Detects abusive behavior patterns and automatically suspends projects:
 * - Excessive usage spikes (> 10x normal rate)
 * - Error rate spikes (> 50% error rate)
 * - Suspicious patterns (rapid requests, anomalous behavior)
 *
 * This is a one-shot job that should not be retried automatically.
 *
 * @param payload - Job payload containing project_id, pattern_type, and metrics
 * @returns Promise resolving to job execution result
 */
export async function autoSuspendHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  // Validate payload
  const config = payload as AutoSuspendPayload;

  if (!config.project_id) {
    return {
      success: false,
      error: 'Missing required field: project_id',
    };
  }

  if (!config.pattern_type) {
    return {
      success: false,
      error: 'Missing required field: pattern_type',
    };
  }

  if (!config.metrics) {
    return {
      success: false,
      error: 'Missing required field: metrics',
    };
  }

  console.log(
    `[AutoSuspend] Starting abuse detection for project ${config.project_id}: ${config.pattern_type}`
  );

  const enforceAction = config.enforce_action !== false; // Default to true
  const startTime = Date.now();

  try {
    // Step 1: Verify project exists
    const project = await getProjectDetails(config.project_id);

    if (!project) {
      return {
        success: false,
        error: `Project not found: ${config.project_id}`,
      };
    }

    // Step 2: Check if project is already suspended
    if (project.status === ProjectStatus.SUSPENDED) {
      console.log(`[AutoSuspend] Project ${config.project_id} is already suspended`);
      return {
        success: true,
        data: {
          project_id: config.project_id,
          abuse_confirmed: false,
          pattern_type: config.pattern_type,
          action_taken: 'logged_only',
          detection: {
            project_id: config.project_id,
            abuse_confirmed: false,
            pattern_type: config.pattern_type,
            detected_at: new Date(),
            metrics: config.metrics,
            action_taken: 'logged_only',
          },
        } as AutoSuspendResult,
      };
    }

    // Step 3: Verify abuse detection metrics
    const verification = verifyAbuseMetrics(config.pattern_type, config.metrics);

    if (!verification.valid) {
      console.log(`[AutoSuspend] Abuse detection not verified: ${verification.reason}`);
      return {
        success: true,
        data: {
          project_id: config.project_id,
          abuse_confirmed: false,
          pattern_type: config.pattern_type,
          action_taken: 'logged_only',
          detection: {
            project_id: config.project_id,
            abuse_confirmed: false,
            pattern_type: config.pattern_type,
            detected_at: new Date(),
            metrics: config.metrics,
            action_taken: 'logged_only',
          },
        } as AutoSuspendResult,
      };
    }

    // Step 4: Abuse confirmed - take action
    const detection: ProjectAbuseDetection = {
      project_id: config.project_id,
      abuse_confirmed: true,
      pattern_type: config.pattern_type,
      detected_at: new Date(),
      metrics: config.metrics,
      action_taken: enforceAction ? 'project_suspended' : 'logged_only',
    };

    let actionTaken: 'project_suspended' | 'warning_sent' | 'logged_only' = 'logged_only';
    let suspendedAt: Date | undefined = undefined;

    if (enforceAction) {
      // Suspend the project
      await suspendProject(config.project_id, config.pattern_type, config.metrics);
      actionTaken = 'project_suspended';
      suspendedAt = new Date();

      // Send notification to project owner
      await sendAbuseNotification(config.project_id, config.pattern_type, config.metrics);
    } else {
      // Dry-run mode - just log
      console.log(
        `[AutoSuspend] Dry-run: Would suspend project ${config.project_id} for ${config.pattern_type}`
      );
    }

    // Record abuse detection for audit trail
    await recordAbuseDetection(
      config.project_id,
      config.pattern_type,
      config.metrics,
      actionTaken
    );

    const duration = Date.now() - startTime;

    // Step 5: Prepare result
    const result: AutoSuspendResult = {
      project_id: config.project_id,
      abuse_confirmed: true,
      pattern_type: config.pattern_type,
      action_taken: actionTaken,
      suspended_at: suspendedAt,
      detection,
    };

    console.log(
      `[AutoSuspend] Completed abuse detection for project ${config.project_id}: ${actionTaken} (${duration}ms)`
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[AutoSuspend] Failed for project ${config.project_id}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Convenience function to enqueue an auto_suspend job
 *
 * @param options - Auto suspend options including project_id, pattern_type, and metrics
 * @returns Promise resolving to the job ID
 *
 * @example
 * ```typescript
 * import { enqueueAutoSuspendJob } from '@/lib/jobs/handlers/auto-suspend.handler';
 *
 * // Suspend for excessive usage
 * await enqueueAutoSuspendJob({
 *   projectId: 'proj-123',
 *   patternType: AbusePatternType.EXCESSIVE_USAGE,
 *   metrics: {
 *     requests_per_minute: 5000,
 *     baseline_requests_per_minute: 500,
 *   },
 * });
 *
 * // Suspend for error spike
 * await enqueueAutoSuspendJob({
 *   projectId: 'proj-456',
 *   patternType: AbusePatternType.ERROR_SPIKE,
 *   metrics: {
 *     error_rate: 0.65,
 *     total_requests: 1000,
 *     error_count: 650,
 *   },
 * });
 *
 * // Report suspicious pattern (dry-run)
 * await enqueueAutoSuspendJob({
 *   projectId: 'proj-789',
 *   patternType: AbusePatternType.SUSPICIOUS_PATTERN,
 *   metrics: {
 *     pattern_details: {
 *       rapid_sequential_requests: true,
 *       same_ip_multiple_accounts: true,
 *     },
 *   },
 *   enforceAction: false,
 * });
 * ```
 */
export async function enqueueAutoSuspendJob(options: {
  projectId: string;
  patternType: AbusePatternType;
  metrics: AbuseMetrics;
  enforceAction?: boolean;
  context?: string;
}): Promise<string> {
  const payload: AutoSuspendPayload = {
    project_id: options.projectId,
    pattern_type: options.patternType,
    metrics: options.metrics,
    enforce_action: options.enforceAction,
    context: options.context,
  };

  const result = await enqueueJob(
    'auto_suspend',
    payload,
    {
      maxAttempts: 1, // One-shot job, no retry
    }
  );

  return result.id;
}
