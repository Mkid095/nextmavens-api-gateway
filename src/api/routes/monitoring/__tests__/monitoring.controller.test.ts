/**
 * Monitoring Webhook Controller Integration Tests
 *
 * Tests for the monitoring webhook endpoints that allow external
 * monitoring systems to trigger auto-suspend jobs.
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { autoSuspendWebhook, monitoringWebhookHealth, monitoringWebhookDocs } from '../monitoring.controller.js';

// Mock the monitoring trigger module
jest.mock('@/lib/jobs/handlers/monitoring/monitoring-trigger.js', () => ({
  processMonitoringAlert: jest.fn(),
  validateMonitoringAlertPayload: jest.fn(),
}));

import { processMonitoringAlert, validateMonitoringAlertPayload } from '@/lib/jobs/handlers/monitoring/monitoring-trigger.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/monitoring/webhook/auto-suspend', autoSuspendWebhook);
  app.get('/api/monitoring/webhook/health', monitoringWebhookHealth);
  app.get('/api/monitoring/docs', monitoringWebhookDocs);
  return app;
}

describe('Monitoring Webhook Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/monitoring/webhook/auto-suspend', () => {
    it('should successfully process valid webhook payload', async () => {
      (validateMonitoringAlertPayload as jest.Mock).mockReturnValue({ valid: true });
      (processMonitoringAlert as jest.Mock).mockResolvedValue({
        success: true,
        job_id: 'job-123',
        triggered_at: new Date(),
      });

      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send({
          project_id: 'proj-123',
          pattern_type: 'excessive_usage',
          metrics: {
            requests_per_minute: 5000,
            baseline_requests_per_minute: 500,
          },
          source: 'prometheus',
          enforce_action: true,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        job_id: 'job-123',
        processed_at: expect.any(String),
      });

      expect(validateMonitoringAlertPayload).toHaveBeenCalled();
      expect(processMonitoringAlert).toHaveBeenCalled();
    });

    it('should reject payload with invalid project_id format', async () => {
      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send({
          project_id: 'invalid-id-format',
          pattern_type: 'excessive_usage',
          metrics: {},
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid project_id format');
    });

    it('should reject payload with invalid pattern_type', async () => {
      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send({
          project_id: 'proj-123',
          pattern_type: 'invalid_pattern',
          metrics: {},
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid pattern_type');
    });

    it('should reject payload with missing metrics', async () => {
      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send({
          project_id: 'proj-123',
          pattern_type: 'excessive_usage',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Metrics object is required');
    });

    it('should handle processing failure gracefully', async () => {
      (validateMonitoringAlertPayload as jest.Mock).mockReturnValue({ valid: true });
      (processMonitoringAlert as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Metrics do not meet threshold',
        triggered_at: new Date(),
      });

      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send({
          project_id: 'proj-123',
          pattern_type: 'excessive_usage',
          metrics: {
            requests_per_minute: 100,
            baseline_requests_per_minute: 90,
          },
          source: 'prometheus',
        })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Metrics do not meet threshold',
        processed_at: expect.any(String),
      });
    });

    it('should reject malformed JSON payload', async () => {
      const app = createTestApp();

      const response = await request(app)
        .post('/api/monitoring/webhook/auto-suspend')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should accept valid project IDs with different formats', async () => {
      (validateMonitoringAlertPayload as jest.Mock).mockReturnValue({ valid: true });
      (processMonitoringAlert as jest.Mock).mockResolvedValue({
        success: true,
        job_id: 'job-456',
        triggered_at: new Date(),
      });

      const app = createTestApp();

      const validProjectIds = ['proj-123', 'proj-test-456', 'proj_abc_123'];

      for (const projectId of validProjectIds) {
        await request(app)
          .post('/api/monitoring/webhook/auto-suspend')
          .send({
            project_id: projectId,
            pattern_type: 'excessive_usage',
            metrics: {
              requests_per_minute: 5000,
              baseline_requests_per_minute: 500,
            },
          })
          .expect(200);
      }
    });

    it('should support all valid pattern types', async () => {
      (validateMonitoringAlertPayload as jest.Mock).mockReturnValue({ valid: true });
      (processMonitoringAlert as jest.Mock).mockResolvedValue({
        success: true,
        job_id: 'job-789',
        triggered_at: new Date(),
      });

      const app = createTestApp();

      const patternTypes = ['excessive_usage', 'error_spike', 'suspicious_pattern'];

      for (const patternType of patternTypes) {
        await request(app)
          .post('/api/monitoring/webhook/auto-suspend')
          .send({
            project_id: 'proj-123',
            pattern_type: patternType,
            metrics: {},
          })
          .expect(200);
      }
    });
  });

  describe('GET /api/monitoring/webhook/health', () => {
    it('should return healthy status', async () => {
      const app = createTestApp();

      const response = await request(app)
        .get('/api/monitoring/webhook/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        endpoints: {
          auto_suspend: '/api/monitoring/webhook/auto-suspend',
        },
      });
    });
  });

  describe('GET /api/monitoring/docs', () => {
    it('should return API documentation', async () => {
      const app = createTestApp();

      const response = await request(app)
        .get('/api/monitoring/docs')
        .expect(200);

      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('examples');
      expect(response.body.title).toBe('Auto-Suspend Monitoring Webhook API');
      expect(response.body.endpoints).toBeInstanceOf(Array);
      expect(response.body.examples).toHaveProperty('prometheus');
      expect(response.body.examples).toHaveProperty('datadog');
      expect(response.body.examples).toHaveProperty('custom');
    });

    it('should include Prometheus example configuration', async () => {
      const app = createTestApp();

      const response = await request(app)
        .get('/api/monitoring/docs')
        .expect(200);

      expect(response.body.examples.prometheus).toHaveProperty('alertmanager_config');
      expect(response.body.examples.prometheus).toHaveProperty('alert_example');
      expect(response.body.examples.prometheus.alert_example).toEqual({
        project_id: 'proj-123',
        pattern_type: 'excessive_usage',
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
        source: 'prometheus',
        enforce_action: true,
      });
    });

    it('should include Datadog example configuration', async () => {
      const app = createTestApp();

      const response = await request(app)
        .get('/api/monitoring/docs')
        .expect(200);

      expect(response.body.examples.datadog).toHaveProperty('webhook_url');
      expect(response.body.examples.datadog).toHaveProperty('headers');
      expect(response.body.examples.datadog).toHaveProperty('payload_template');
    });

    it('should include cURL command example', async () => {
      const app = createTestApp();

      const response = await request(app)
        .get('/api/monitoring/docs')
        .expect(200);

      expect(response.body.examples.custom).toHaveProperty('description');
      expect(response.body.examples.custom).toHaveProperty('curl_command');
      expect(response.body.examples.custom.curl_command).toContain('curl');
      expect(response.body.examples.custom.curl_command).toContain('/api/monitoring/webhook/auto-suspend');
    });
  });
});
