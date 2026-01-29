/**
 * Monitoring Webhook Controller
 *
 * Provides webhook endpoints for external monitoring systems to trigger
 * auto-suspend jobs when abuse patterns are detected.
 *
 * Supported monitoring systems:
 * - Prometheus Alertmanager
 * - Grafana Alerts
 * - Datadog Monitors
 * - Custom monitoring solutions
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 *
 * @example
 * ```typescript
 * // Webhook endpoint: POST /api/monitoring/webhook/auto-suspend
 * // Payload from monitoring system:
 * {
 *   "project_id": "proj-123",
 *   "pattern_type": "excessive_usage",
 *   "metrics": {
 *     "requests_per_minute": 5000,
 *     "baseline_requests_per_minute": 500
 *   },
 *   "source": "prometheus",
 *   "enforce_action": true
 * }
 * ```
 */

import type { Request, Response, NextFunction } from 'express';
import {
  processMonitoringAlert,
  validateMonitoringAlertPayload,
} from '@/lib/jobs/handlers/monitoring/monitoring-trigger.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Auto-suspend webhook response
 */
interface AutoSuspendWebhookResponse {
  /** Whether the alert was successfully processed */
  success: boolean;
  /** Job ID that was enqueued (if successful) */
  job_id?: string;
  /** Error message (if failed) */
  error?: string;
  /** Timestamp of webhook processing */
  processed_at: string;
}

/**
 * Auto-suspend webhook request body
 */
interface AutoSuspendWebhookRequest {
  /** Project ID to evaluate for auto-suspend */
  project_id: string;
  /** Type of abuse pattern detected */
  pattern_type: 'excessive_usage' | 'error_spike' | 'suspicious_pattern';
  /** Metrics that triggered the detection */
  metrics: {
    requests_per_minute?: number;
    baseline_requests_per_minute?: number;
    error_rate?: number;
    error_count?: number;
    total_requests?: number;
    pattern_details?: Record<string, unknown>;
  };
  /** Source of the monitoring alert */
  source?: string;
  /** Alert timestamp */
  alert_timestamp?: string;
  /** Whether to actually suspend or dry-run */
  enforce_action?: boolean;
  /** Additional context about the alert */
  context?: string;
}

/**
 * Validate project ID format
 */
function isValidProjectId(projectId: string): boolean {
  if (!projectId || typeof projectId !== 'string') {
    return false;
  }
  // Project IDs should start with 'proj-' followed by alphanumeric characters
  const projectIdRegex = /^proj-[a-zA-Z0-9_-]+$/;
  return projectIdRegex.test(projectId);
}

/**
 * POST /api/monitoring/webhook/auto-suspend
 *
 * Webhook endpoint for monitoring systems to trigger auto-suspend jobs.
 *
 * This endpoint allows external monitoring systems (Prometheus, Grafana, Datadog, etc.)
 * to trigger automatic suspension of projects when abuse patterns are detected.
 *
 * SECURITY:
 * - In production, this should be protected with:
 *   - API key authentication (X-API-Key header)
 *   - IP whitelist (only allow known monitoring servers)
 *   - Rate limiting (prevent abuse of the endpoint)
 *   - HTTPS only
 *
 * Request Body:
 * - project_id: Project ID to evaluate (required)
 * - pattern_type: Type of abuse pattern (required)
 * - metrics: Metrics that triggered detection (required)
 * - source: Monitoring system source (optional)
 * - enforce_action: Whether to actually suspend (optional, default: true)
 * - context: Additional context (optional)
 *
 * @param req - Express request with webhook payload
 * @param res - Express response
 * @param next - Express next function
 */
export async function autoSuspendWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as AutoSuspendWebhookRequest;

    // Validate request body exists
    if (!payload || typeof payload !== 'object') {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Request body is required and must be a valid JSON object',
        400,
        false
      );
    }

    // Validate project_id
    if (!payload.project_id || !isValidProjectId(payload.project_id)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid project_id format. Project ID must start with "proj-" followed by alphanumeric characters',
        400,
        false
      );
    }

    // Validate pattern_type
    const validPatternTypes = ['excessive_usage', 'error_spike', 'suspicious_pattern'];
    if (!payload.pattern_type || !validPatternTypes.includes(payload.pattern_type)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        `Invalid pattern_type. Must be one of: ${validPatternTypes.join(', ')}`,
        400,
        false
      );
    }

    // Validate metrics
    if (!payload.metrics || typeof payload.metrics !== 'object') {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Metrics object is required',
        400,
        false
      );
    }

    // Validate payload using monitoring trigger validator
    const validation = validateMonitoringAlertPayload(payload);
    if (!validation.valid) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        validation.reason || 'Invalid payload',
        400,
        false
      );
    }

    // Log the incoming webhook
    console.log(
      `[MonitoringWebhook] Received auto-suspend webhook for project ${payload.project_id} from ${payload.source || 'unknown'}`
    );

    // Process the monitoring alert
    const result = await processMonitoringAlert(payload);

    // Prepare response
    const response: AutoSuspendWebhookResponse = {
      success: result.success,
      job_id: result.job_id,
      error: result.error,
      processed_at: new Date().toISOString(),
    };

    // Return appropriate status code
    if (result.success) {
      console.log(
        `[MonitoringWebhook] Successfully processed webhook, enqueued job ${result.job_id}`
      );
      res.status(200).json(response);
    } else {
      console.error(`[MonitoringWebhook] Failed to process webhook: ${result.error}`);
      res.status(400).json(response);
    }
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}

/**
 * GET /api/monitoring/webhook/health
 *
 * Health check endpoint for monitoring webhook integration.
 * Allows monitoring systems to verify the webhook is operational.
 *
 * @param req - Express request
 * @param res - Express response
 */
export function monitoringWebhookHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      auto_suspend: '/api/monitoring/webhook/auto-suspend',
    },
  });
}

/**
 * GET /api/monitoring/docs
 *
 * Documentation endpoint for monitoring webhook integration.
 * Provides information about how to integrate monitoring systems.
 *
 * @param req - Express request
 * @param res - Express response
 */
export function monitoringWebhookDocs(_req: Request, res: Response): void {
  res.status(200).json({
    title: 'Auto-Suspend Monitoring Webhook API',
    version: '1.0.0',
    description:
      'Webhook endpoints for external monitoring systems to trigger auto-suspend jobs when abuse patterns are detected.',
    endpoints: [
      {
        path: '/api/monitoring/webhook/auto-suspend',
        method: 'POST',
        description: 'Trigger auto-suspend job for a project',
        authentication: 'API Key (X-API-Key header)',
        request_body: {
          project_id: 'string (required) - Project ID to evaluate',
          pattern_type: 'string (required) - Abuse pattern type: excessive_usage, error_spike, suspicious_pattern',
          metrics: 'object (required) - Metrics that triggered detection',
          source: 'string (optional) - Monitoring system identifier',
          enforce_action: 'boolean (optional) - Whether to actually suspend (default: true)',
          context: 'string (optional) - Additional context',
        },
        response: {
          success: 'boolean - Whether the alert was processed',
          job_id: 'string - Enqueued job ID (if successful)',
          error: 'string - Error message (if failed)',
          processed_at: 'string - ISO timestamp of processing',
        },
      },
      {
        path: '/api/monitoring/webhook/health',
        method: 'GET',
        description: 'Health check for webhook integration',
      },
      {
        path: '/api/monitoring/docs',
        method: 'GET',
        description: 'API documentation for monitoring integration',
      },
    ],
    examples: {
      prometheus: {
        description: 'Example Prometheus Alertmanager webhook configuration',
        alertmanager_config: {
          receivers: [
            {
              name: 'auto-suspend-webhook',
              webhook_configs: [
                {
                  url: 'https://your-api-gateway.com/api/monitoring/webhook/auto-suspend',
                  http_config: {
                    headers: {
                      'X-API-Key': 'your-api-key',
                      'Content-Type': 'application/json',
                    },
                  },
                  send_resolved: false,
                },
              ],
            },
          ],
        },
        alert_example: {
          project_id: 'proj-123',
          pattern_type: 'excessive_usage',
          metrics: {
            requests_per_minute: 5000,
            baseline_requests_per_minute: 500,
          },
          source: 'prometheus',
          enforce_action: true,
        },
      },
      datadog: {
        description: 'Example Datadog webhook integration',
        webhook_url: 'https://your-api-gateway.com/api/monitoring/webhook/auto-suspend',
        headers: {
          'X-API-Key': 'your-api-key',
          'Content-Type': 'application/json',
        },
        payload_template: {
          project_id: '{{project_id}}',
          pattern_type: 'excessive_usage',
          metrics: {
            requests_per_minute: '{{metric.value}}',
            baseline_requests_per_minute: '{{metric.baseline}}',
          },
          source: 'datadog',
          enforce_action: true,
        },
      },
      custom: {
        description: 'Example cURL request for manual testing',
        curl_command:
          "curl -X POST https://your-api-gateway.com/api/monitoring/webhook/auto-suspend \\\n  -H 'X-API-Key: your-api-key' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    \"project_id\": \"proj-123\",\n    \"pattern_type\": \"excessive_usage\",\n    \"metrics\": {\n      \"requests_per_minute\": 5000,\n      \"baseline_requests_per_minute\": 500\n    },\n    \"source\": \"manual\",\n    \"enforce_action\": true\n  }'",
      },
    },
  });
}
