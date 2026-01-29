/**
 * Monitoring Trigger Integration Tests
 *
 * Tests for the monitoring integration module that allows external
 * monitoring systems to trigger auto-suspend jobs.
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  triggerAutoSuspendFromMetrics,
  triggerAutoSuspendFromAnalysis,
  validateMonitoringAlertPayload,
  processMonitoringAlert,
  batchCheckProjectsForAbuse,
  MonitoringSource,
} from '../monitoring-trigger.js';
import { AbusePatternType } from '../../auto-suspend.handler.js';

// Mock the auto-suspend handler
const mockEnqueueAutoSuspendJob = jest.fn() as any;
const mockGetProjectMetrics = jest.fn() as any;
const mockGetProjectBaseline = jest.fn() as any;

jest.mock('../../auto-suspend.handler', () => ({
  AbusePatternType: {
    EXCESSIVE_USAGE: 'excessive_usage',
    ERROR_SPIKE: 'error_spike',
    SUSPICIOUS_PATTERN: 'suspicious_pattern',
  },
  enqueueAutoSuspendJob: mockEnqueueAutoSuspendJob,
  getProjectMetrics: mockGetProjectMetrics,
  getProjectBaseline: mockGetProjectBaseline,
}));

describe('Monitoring Trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateMonitoringAlertPayload', () => {
    it('should validate a correct payload', () => {
      const payload = {
        project_id: 'proj-123',
        pattern_type: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
      };

      const result = validateMonitoringAlertPayload(payload);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject payload with missing project_id', () => {
      const payload = {
        pattern_type: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {},
      };

      const result = validateMonitoringAlertPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Missing or invalid project_id');
    });

    it('should reject payload with invalid pattern_type', () => {
      const payload = {
        project_id: 'proj-123',
        pattern_type: 'invalid_pattern',
        metrics: {},
      };

      const result = validateMonitoringAlertPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid pattern_type: invalid_pattern');
    });

    it('should reject payload with missing metrics', () => {
      const payload = {
        project_id: 'proj-123',
        pattern_type: AbusePatternType.EXCESSIVE_USAGE,
      };

      const result = validateMonitoringAlertPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Missing or invalid metrics');
    });
  });

  describe('triggerAutoSuspendFromMetrics', () => {
    it('should successfully trigger auto-suspend with valid metrics', async () => {
      mockEnqueueAutoSuspendJob.mockResolvedValue('job-123');

      const result = await triggerAutoSuspendFromMetrics({
        projectId: 'proj-123',
        patternType: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
        source: MonitoringSource.PROMETHEUS,
        enforceAction: true,
      });

      expect(result.success).toBe(true);
      expect(result.job_id).toBe('job-123');
      expect(mockEnqueueAutoSuspendJob).toHaveBeenCalledWith({
        projectId: 'proj-123',
        patternType: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
        enforceAction: true,
        context: 'Triggered from prometheus',
      });
    });

    it('should handle errors when enqueueing job fails', async () => {
      mockEnqueueAutoSuspendJob.mockRejectedValue(new Error('Database error'));

      const result = await triggerAutoSuspendFromMetrics({
        projectId: 'proj-123',
        patternType: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('triggerAutoSuspendFromAnalysis', () => {
    it('should trigger auto-suspend when metrics exceed thresholds', async () => {
      mockGetProjectMetrics.mockResolvedValue({
        requests_per_minute: 5000,
        error_rate: 0.1,
        total_requests: 5000,
        error_count: 500,
      });

      mockGetProjectBaseline.mockResolvedValue({
        baseline_requests_per_minute: 500,
        baseline_error_rate: 0.1,
      });

      mockEnqueueAutoSuspendJob.mockResolvedValue('job-456');

      const result = await triggerAutoSuspendFromAnalysis({
        projectId: 'proj-123',
        patternType: AbusePatternType.EXCESSIVE_USAGE,
        source: MonitoringSource.SCHEDULED,
        enforceAction: true,
      });

      expect(result.success).toBe(true);
      expect(result.job_id).toBe('job-456');
      expect(result.metrics_collected).toEqual({
        requests_per_minute: 5000,
        error_rate: 0.1,
        total_requests: 5000,
        error_count: 500,
        baseline_requests_per_minute: 500,
      });
    });

    it('should not trigger when metrics do not exceed thresholds', async () => {
      mockGetProjectMetrics.mockResolvedValue({
        requests_per_minute: 600,
        error_rate: 0.1,
        total_requests: 600,
        error_count: 60,
      });

      mockGetProjectBaseline.mockResolvedValue({
        baseline_requests_per_minute: 500,
        baseline_error_rate: 0.1,
      });

      const result = await triggerAutoSuspendFromAnalysis({
        projectId: 'proj-123',
        patternType: AbusePatternType.EXCESSIVE_USAGE,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('Metrics do not meet excessive_usage threshold');
      expect(result.job_id).toBeUndefined();
    });

    it('should trigger for error spike when error rate exceeds threshold', async () => {
      mockGetProjectMetrics.mockResolvedValue({
        requests_per_minute: 1000,
        error_rate: 0.6,
        total_requests: 500,
        error_count: 300,
      });

      mockGetProjectBaseline.mockResolvedValue({
        baseline_requests_per_minute: 500,
        baseline_error_rate: 0.1,
      });

      mockEnqueueAutoSuspendJob.mockResolvedValue('job-789');

      const result = await triggerAutoSuspendFromAnalysis({
        projectId: 'proj-123',
        patternType: AbusePatternType.ERROR_SPIKE,
      });

      expect(result.success).toBe(true);
      expect(result.job_id).toBe('job-789');
    });
  });

  describe('processMonitoringAlert', () => {
    it('should process valid monitoring alert', async () => {
      mockEnqueueAutoSuspendJob.mockResolvedValue('job-999');

      const payload = {
        project_id: 'proj-123',
        pattern_type: AbusePatternType.EXCESSIVE_USAGE,
        metrics: {
          requests_per_minute: 5000,
          baseline_requests_per_minute: 500,
        },
        source: 'prometheus',
        enforce_action: true,
      };

      const result = await processMonitoringAlert(payload);

      expect(result.success).toBe(true);
      expect(result.job_id).toBe('job-999');
    });

    it('should reject invalid payload', async () => {
      const payload = {
        project_id: 'invalid-id',
        pattern_type: 'invalid-type',
      };

      const result = await processMonitoringAlert(payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid pattern_type');
    });
  });

  describe('batchCheckProjectsForAbuse', () => {
    it('should check multiple projects and trigger where needed', async () => {
      mockGetProjectMetrics.mockResolvedValueOnce({
          requests_per_minute: 5000,
          error_rate: 0.1,
          total_requests: 5000,
          error_count: 500,
        })
        .mockResolvedValueOnce({
          requests_per_minute: 600,
          error_rate: 0.1,
          total_requests: 600,
          error_count: 60,
        });

      mockGetProjectBaseline.mockResolvedValueOnce({
          baseline_requests_per_minute: 500,
          baseline_error_rate: 0.1,
        })
        .mockResolvedValueOnce({
          baseline_requests_per_minute: 500,
          baseline_error_rate: 0.1,
        });

      mockEnqueueAutoSuspendJob.mockResolvedValue('job-batch');

      const results = await batchCheckProjectsForAbuse({
        projectIds: ['proj-123', 'proj-456'],
        patternType: AbusePatternType.EXCESSIVE_USAGE,
        source: MonitoringSource.SCHEDULED,
      });

      expect(results).toHaveLength(2);
      expect(results[0].project_id).toBe('proj-123');
      expect(results[0].success).toBe(true);
      expect(results[1].project_id).toBe('proj-456');
      expect(results[1].success).toBe(false);
    });
  });
});
