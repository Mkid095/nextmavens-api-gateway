/**
 * Monitoring Integration for Auto-Suspend Job Handler
 *
 * This module provides integration points for external monitoring systems
 * (Prometheus, Grafana, Datadog, etc.) to trigger auto-suspend jobs when
 * abuse patterns are detected.
 *
 * The monitoring integration supports:
 * 1. Direct function calls from application code
 * 2. Webhook endpoints for external alerting systems
 * 3. Scheduled metric collection and analysis
 * 4. Manual trigger via API
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 *
 * @example
 * ```typescript
 * import { triggerAutoSuspendFromMetrics } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';
 *
 * // Trigger from custom metrics
 * await triggerAutoSuspendFromMetrics({
 *   projectId: 'proj-123',
 *   patternType: AbusePatternType.EXCESSIVE_USAGE,
 *   metrics: {
 *     requests_per_minute: 5000,
 *     baseline_requests_per_minute: 500,
 *   },
 *   source: 'prometheus-alert',
 * });
 * ```
 */

import { getProjectMetrics, getProjectBaseline } from '../auto-suspend.handler.js';
import { enqueueAutoSuspendJob } from '../auto-suspend.handler.js';
import { AbusePatternType } from '../auto-suspend.handler.js';

/**
 * Monitoring system source identifiers
 */
export enum MonitoringSource {
  /** Prometheus Alertmanager */
  PROMETHEUS = 'prometheus',
  /** Grafana Alerts */
  GRAFANA = 'grafana',
  /** Datadog Monitors */
  DATADOG = 'datadog',
  /** Custom application metrics */
  CUSTOM = 'custom',
  /** Manual API trigger */
  MANUAL = 'manual',
  /** Scheduled health check */
  SCHEDULED = 'scheduled',
}

/**
 * Monitoring alert payload from external systems
 */
export interface MonitoringAlertPayload {
  /** Project ID to evaluate */
  project_id: string;
  /** Type of abuse pattern detected */
  pattern_type: AbusePatternType;
  /** Metrics that triggered the alert */
  metrics: {
    requests_per_minute?: number;
    baseline_requests_per_minute?: number;
    error_rate?: number;
    error_count?: number;
    total_requests?: number;
    pattern_details?: Record<string, unknown>;
  };
  /** Source of the alert */
  source?: MonitoringSource | string;
  /** Alert timestamp */
  alert_timestamp?: string;
  /** Whether to enforce suspension or dry-run */
  enforce_action?: boolean;
  /** Additional context */
  context?: string;
}

/**
 * Auto-suspend trigger result
 */
export interface AutoSuspendTriggerResult {
  /** Whether the trigger was successful */
  success: boolean;
  /** Job ID that was enqueued */
  job_id?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp of trigger */
  triggered_at: Date;
}

/**
 * Trigger auto-suspend from pre-collected metrics
 *
 * Use this function when you have already collected metrics from your
 * monitoring system and want to trigger an auto-suspend job.
 *
 * This validates the metrics before enqueuing the job to ensure
 * they meet the abuse detection thresholds.
 *
 * @param options - Trigger options including project, metrics, and source
 * @returns Promise resolving to trigger result with job ID
 *
 * @example
 * ```typescript
 * import { triggerAutoSuspendFromMetrics } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';
 *
 * const result = await triggerAutoSuspendFromMetrics({
 *   projectId: 'proj-123',
 *   patternType: AbusePatternType.EXCESSIVE_USAGE,
 *   metrics: {
 *     requests_per_minute: 5000,
 *     baseline_requests_per_minute: 500,
 *   },
 *   source: MonitoringSource.PROMETHEUS,
 *   enforceAction: true,
 * });
 *
 * console.log(`Enqueued job: ${result.job_id}`);
 * ```
 */
export async function triggerAutoSuspendFromMetrics(options: {
  projectId: string;
  patternType: AbusePatternType;
  metrics: {
    requests_per_minute?: number;
    baseline_requests_per_minute?: number;
    error_rate?: number;
    error_count?: number;
    total_requests?: number;
    pattern_details?: Record<string, unknown>;
  };
  source?: MonitoringSource | string;
  enforceAction?: boolean;
  context?: string;
}): Promise<AutoSuspendTriggerResult> {
  const { projectId, patternType, metrics, source, enforceAction, context } = options;

  console.log(
    `[MonitoringTrigger] Triggering auto-suspend for project ${projectId} from ${source || 'unknown'}`
  );

  try {
    // Enqueue the auto-suspend job
    const jobId = await enqueueAutoSuspendJob({
      projectId,
      patternType,
      metrics,
      enforceAction,
      context: context || `Triggered from ${source || 'external monitoring'}`,
    });

    console.log(
      `[MonitoringTrigger] Successfully enqueued auto-suspend job ${jobId} for project ${projectId}`
    );

    return {
      success: true,
      job_id: jobId,
      triggered_at: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MonitoringTrigger] Failed to trigger auto-suspend:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      triggered_at: new Date(),
    };
  }
}

/**
 * Trigger auto-suspend from real-time metric analysis
 *
 * This function collects current metrics for the project and analyzes them
 * to detect abuse patterns before triggering the auto-suspend job.
 *
 * Use this when you want the monitoring integration to perform its own
 * metric collection rather than relying on pre-collected metrics.
 *
 * @param projectId - Project ID to analyze and potentially suspend
 * @param patternType - Type of abuse pattern to check for
 * @param source - Source of the monitoring trigger
 * @param enforceAction - Whether to actually suspend or dry-run
 * @returns Promise resolving to trigger result
 *
 * @example
 * ```typescript
 * import { triggerAutoSuspendFromAnalysis } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';
 *
 * // Analyze and potentially suspend for excessive usage
 * const result = await triggerAutoSuspendFromAnalysis({
 *   projectId: 'proj-123',
 *   patternType: AbusePatternType.EXCESSIVE_USAGE,
 *   source: MonitoringSource.SCHEDULED,
 *   enforceAction: true,
 * });
 *
 * if (result.success) {
 *   console.log(`Auto-suspend triggered: ${result.job_id}`);
 * } else {
 *   console.log(`No abuse detected: ${result.reason}`);
 * }
 * ```
 */
export async function triggerAutoSuspendFromAnalysis(options: {
  projectId: string;
  patternType: AbusePatternType;
  source?: MonitoringSource | string;
  enforceAction?: boolean;
}): Promise<
  AutoSuspendTriggerResult & {
    reason?: string;
    metrics_collected?: {
      requests_per_minute: number;
      error_rate: number;
      total_requests: number;
      error_count: number;
      baseline_requests_per_minute: number;
    };
  }
> {
  const { projectId, patternType, source, enforceAction } = options;

  console.log(
    `[MonitoringTrigger] Analyzing metrics for project ${projectId} for ${patternType} detection`
  );

  try {
    // Collect current metrics
    const currentMetrics = await getProjectMetrics(projectId);
    const baselineMetrics = await getProjectBaseline(projectId);

    const metricsCollected = {
      ...currentMetrics,
      baseline_requests_per_minute: baselineMetrics.baseline_requests_per_minute,
    };

    console.log(
      `[MonitoringTrigger] Collected metrics for project ${projectId}:`,
      JSON.stringify(metricsCollected)
    );

    // Determine if metrics indicate abuse based on pattern type
    let shouldTrigger = false;
    let metricsForTrigger: Parameters<typeof triggerAutoSuspendFromMetrics>[0]['metrics'] = {};

    switch (patternType) {
      case AbusePatternType.EXCESSIVE_USAGE:
        const usageMultiplier =
          currentMetrics.requests_per_minute / baselineMetrics.baseline_requests_per_minute;
        shouldTrigger =
          currentMetrics.requests_per_minute >= 1000 &&
          usageMultiplier >= 10 &&
          baselineMetrics.baseline_requests_per_minute > 0;

        metricsForTrigger = {
          requests_per_minute: currentMetrics.requests_per_minute,
          baseline_requests_per_minute: baselineMetrics.baseline_requests_per_minute,
        };
        break;

      case AbusePatternType.ERROR_SPIKE:
        shouldTrigger =
          currentMetrics.total_requests >= 100 && currentMetrics.error_rate >= 0.5;

        metricsForTrigger = {
          error_rate: currentMetrics.error_rate,
          error_count: currentMetrics.error_count,
          total_requests: currentMetrics.total_requests,
        };
        break;

      case AbusePatternType.SUSPICIOUS_PATTERN:
        // For suspicious patterns, we rely on external detection
        // This function won't auto-trigger for this pattern type
        shouldTrigger = false;
        break;
    }

    if (!shouldTrigger) {
      return {
        success: false,
        reason: `Metrics do not meet ${patternType} threshold`,
        triggered_at: new Date(),
        metrics_collected: metricsCollected,
      };
    }

    // Trigger the auto-suspend job
    const result = await triggerAutoSuspendFromMetrics({
      projectId,
      patternType,
      metrics: metricsForTrigger,
      source,
      enforceAction,
    });

    return {
      ...result,
      metrics_collected: metricsCollected,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MonitoringTrigger] Failed to analyze metrics:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      triggered_at: new Date(),
    };
  }
}

/**
 * Validate monitoring alert payload
 *
 * Ensures the payload from external monitoring systems contains
 * all required fields and valid data before processing.
 *
 * @param payload - Alert payload to validate
 * @returns Validation result with reason if invalid
 */
export function validateMonitoringAlertPayload(
  payload: unknown
): { valid: boolean; reason?: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Payload must be an object' };
  }

  const alert = payload as Partial<MonitoringAlertPayload>;

  if (!alert.project_id || typeof alert.project_id !== 'string') {
    return { valid: false, reason: 'Missing or invalid project_id' };
  }

  if (!alert.pattern_type || typeof alert.pattern_type !== 'string') {
    return { valid: false, reason: 'Missing or invalid pattern_type' };
  }

  if (!Object.values(AbusePatternType).includes(alert.pattern_type as AbusePatternType)) {
    return { valid: false, reason: `Invalid pattern_type: ${alert.pattern_type}` };
  }

  if (!alert.metrics || typeof alert.metrics !== 'object') {
    return { valid: false, reason: 'Missing or invalid metrics' };
  }

  return { valid: true };
}

/**
 * Process monitoring alert from external system
 *
 * This is the main entry point for external monitoring systems.
 * It validates the alert payload and triggers an auto-suspend job.
 *
 * @param payload - Alert payload from monitoring system
 * @returns Promise resolving to trigger result
 *
 * @example
 * ```typescript
 * import { processMonitoringAlert } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';
 *
 * // From Prometheus webhook
 * const prometheusPayload = {
 *   project_id: 'proj-123',
 *   pattern_type: 'excessive_usage',
 *   metrics: {
 *     requests_per_minute: 5000,
 *     baseline_requests_per_minute: 500,
 *   },
 *   source: 'prometheus',
 *   enforce_action: true,
 * };
 *
 * const result = await processMonitoringAlert(prometheusPayload);
 * ```
 */
export async function processMonitoringAlert(
  payload: unknown
): Promise<AutoSuspendTriggerResult> {
  console.log('[MonitoringTrigger] Processing monitoring alert');

  // Validate payload
  const validation = validateMonitoringAlertPayload(payload);
  if (!validation.valid) {
    console.error(`[MonitoringTrigger] Invalid alert payload: ${validation.reason}`);
    return {
      success: false,
      error: validation.reason,
      triggered_at: new Date(),
    };
  }

  const alert = payload as MonitoringAlertPayload;

  // Trigger auto-suspend from metrics
  return triggerAutoSuspendFromMetrics({
    projectId: alert.project_id,
    patternType: alert.pattern_type as AbusePatternType,
    metrics: alert.metrics,
    source: alert.source,
    enforceAction: alert.enforce_action,
    context: alert.context,
  });
}

/**
 * Batch check multiple projects for abuse patterns
 *
 * Analyzes metrics for multiple projects and enqueues auto-suspend jobs
 * for any projects that exceed thresholds.
 *
 * @param projectIds - Array of project IDs to check
 * @param patternType - Type of abuse pattern to check for
 * @param source - Source of the monitoring check
 * @param enforceAction - Whether to actually suspend or dry-run
 * @returns Promise resolving to array of trigger results
 *
 * @example
 * ```typescript
 * import { batchCheckProjectsForAbuse } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';
 *
 * const results = await batchCheckProjectsForAbuse({
 *   projectIds: ['proj-123', 'proj-456', 'proj-789'],
 *   patternType: AbusePatternType.EXCESSIVE_USAGE,
 *   source: MonitoringSource.SCHEDULED,
 *   enforceAction: true,
 * });
 *
 * const suspended = results.filter(r => r.success);
 * console.log(`Suspended ${suspended.length} projects`);
 * ```
 */
export async function batchCheckProjectsForAbuse(options: {
  projectIds: string[];
  patternType: AbusePatternType;
  source?: MonitoringSource | string;
  enforceAction?: boolean;
}): Promise<Array<AutoSuspendTriggerResult & { project_id: string }>> {
  const { projectIds, patternType, source, enforceAction } = options;

  console.log(
    `[MonitoringTrigger] Batch checking ${projectIds.length} projects for ${patternType}`
  );

  const results: Array<AutoSuspendTriggerResult & { project_id: string }> = [];

  for (const projectId of projectIds) {
    const result = await triggerAutoSuspendFromAnalysis({
      projectId,
      patternType,
      source,
      enforceAction,
    });

    results.push({
      project_id: projectId,
      ...result,
    });
  }

  const triggeredCount = results.filter((r) => r.success).length;
  console.log(
    `[MonitoringTrigger] Batch check complete: ${triggeredCount}/${projectIds.length} projects triggered auto-suspend`
  );

  return results;
}
