/**
 * Monitoring Routes
 *
 * Defines routes for monitoring webhook integration.
 * External monitoring systems can use these endpoints to trigger
 * auto-suspend jobs when abuse patterns are detected.
 *
 * SECURITY:
 * - All webhook endpoints require monitoring API key authentication
 * - Rate limiting is applied to prevent abuse
 * - IP whitelisting recommended for production
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 */

import { Router } from 'express';
import {
  autoSuspendWebhook,
  monitoringWebhookHealth,
  monitoringWebhookDocs,
} from './monitoring.controller.js';
import { requireMonitoringApiKey } from '@/api/middleware/monitoring-auth.middleware.js';
import { monitoringWebhookRateLimit, apiRateLimit } from '@/api/middleware/rate-limit.middleware.js';

const router = Router();

/**
 * POST /api/monitoring/webhook/auto-suspend
 *
 * Webhook endpoint for triggering auto-suspend jobs.
 *
 * SECURITY REQUIREMENTS:
 * - Authentication: Required (X-Monitoring-API-Key header)
 * - Rate Limiting: 10 requests per minute
 * - IP Whitelisting: Recommended for production
 *
 * Environment variables needed:
 * - MONITORING_API_KEY: Shared secret for monitoring webhooks
 *
 * In production, add IP whitelisting:
 * ```typescript
 * import { ipWhitelist } from '@/api/middleware/monitoring-auth.middleware.js';
 * const allowedIps = ['10.0.0.1', '192.168.1.0/24'];
 * router.post('/webhook/auto-suspend',
 *   ipWhitelist(allowedIps),
 *   requireMonitoringApiKey,
 *   monitoringWebhookRateLimit,
 *   autoSuspendWebhook
 * );
 * ```
 */
router.post(
  '/webhook/auto-suspend',
  requireMonitoringApiKey,
  monitoringWebhookRateLimit,
  autoSuspendWebhook
);

/**
 * GET /api/monitoring/webhook/health
 *
 * Health check endpoint for monitoring integration.
 * No authentication required for health checks.
 */
router.get('/webhook/health', monitoringWebhookHealth);

/**
 * GET /api/monitoring/docs
 *
 * API documentation endpoint.
 * Rate limited but no authentication required.
 */
router.get('/docs', apiRateLimit, monitoringWebhookDocs);

export default router;
