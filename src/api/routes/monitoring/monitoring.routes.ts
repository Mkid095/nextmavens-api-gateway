/**
 * Monitoring Routes
 *
 * Defines routes for monitoring webhook integration.
 * External monitoring systems can use these endpoints to trigger
 * auto-suspend jobs when abuse patterns are detected.
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 */

import { Router } from 'express';
import {
  autoSuspendWebhook,
  monitoringWebhookHealth,
  monitoringWebhookDocs,
} from './monitoring.controller.js';

const router = Router();

/**
 * POST /api/monitoring/webhook/auto-suspend
 * Webhook endpoint for triggering auto-suspend jobs
 */
router.post('/webhook/auto-suspend', autoSuspendWebhook);

/**
 * GET /api/monitoring/webhook/health
 * Health check endpoint
 */
router.get('/webhook/health', monitoringWebhookHealth);

/**
 * GET /api/monitoring/docs
 * API documentation endpoint
 */
router.get('/docs', monitoringWebhookDocs);

export default router;
