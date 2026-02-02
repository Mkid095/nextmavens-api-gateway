import { Request, Response } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Health check middleware for snapshot service
 * Returns detailed health status including cache statistics and monitoring metrics
 *
 * Endpoints:
 * - GET /health/snapshot - Basic health check with cache stats
 * - GET /health/snapshot/detailed - Detailed health report with metrics
 * - GET /health/snapshot/metrics - Prometheus-style metrics
 */

/**
 * Basic health check endpoint
 * Returns simple healthy/unhealthy status
 */
export function checkSnapshotHealth(_req: Request, res: Response): void {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    res.status(503).json({
      status: 'unhealthy',
      snapshot: {
        available: false,
        message: 'Snapshot service not initialized'
      }
    });
    return;
  }

  try {
    const stats = snapshotService.getCacheStats();

    if (stats.isExpired) {
      res.status(503).json({
        status: 'unhealthy',
        snapshot: {
          available: false,
          message: 'Snapshot expired',
          stats
        }
      });
      return;
    }

    res.json({
      status: 'healthy',
      snapshot: {
        available: true,
        stats
      }
    });
  } catch (error) {
    const apiError = ApiError.snapshotUnavailable(error instanceof Error ? error.message : 'Unknown error');
    res.status(apiError.statusCode).json({
      status: 'unhealthy',
      snapshot: {
        available: false,
        message: apiError.message
      }
    });
  }
}

/**
 * Detailed health check endpoint
 * Returns comprehensive health report with issues and recommendations
 */
export function checkSnapshotHealthDetailed(_req: Request, res: Response): void {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      snapshot: {
        available: false,
        message: 'Snapshot service not initialized'
      }
    });
    return;
  }

  try {
    const healthReport = snapshotService.getHealthReport();
    const stats = snapshotService.getCacheStats();

    // Determine HTTP status based on health
    let httpStatus = 200;
    if (healthReport.status === 'unhealthy') {
      httpStatus = 503;
    } else if (healthReport.status === 'degraded') {
      httpStatus = 200; // Degraded still returns 200 but with warnings
    }

    res.status(httpStatus).json({
      ...healthReport,
      snapshot: {
        available: !stats.isExpired,
        stats
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      snapshot: {
        available: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}

/**
 * Metrics endpoint
 * Returns Prometheus-style metrics for external monitoring systems
 */
export function getSnapshotMetrics(_req: Request, res: Response): void {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    res.status(503).send('# Snapshot service not initialized\n');
    return;
  }

  try {
    const metrics = snapshotService.getMonitoringMetrics();
    const stats = snapshotService.getCacheStats();

    // Format as Prometheus text format
    const prometheusMetrics = [
      '# Snapshot service metrics',
      `snapshot_fetch_success_rate ${metrics.snapshot_fetch_success_rate || 0}`,
      `snapshot_avg_response_time_ms ${metrics.snapshot_avg_response_time_ms || 0}`,
      `snapshot_p95_response_time_ms ${metrics.snapshot_p95_response_time_ms || 0}`,
      `snapshot_p99_response_time_ms ${metrics.snapshot_p99_response_time_ms || 0}`,
      `snapshot_cache_hit_rate ${metrics.snapshot_cache_hit_rate || 0}`,
      `snapshot_consecutive_failures ${metrics.snapshot_consecutive_failures || 0}`,
      `snapshot_last_fetch_age_seconds ${metrics.snapshot_last_fetch_age_seconds || -1}`,
      `snapshot_current_version ${metrics.snapshot_current_version || -1}`,
      `snapshot_health_status ${metrics.snapshot_health_status === 'healthy' ? 1 : 0}`,
      `snapshot_has_cached_data ${stats.hasCachedData ? 1 : 0}`,
      `snapshot_is_expired ${stats.isExpired ? 1 : 0}`,
      ''
    ].join('\n');

    res.set('Content-Type', 'text/plain');
    res.send(prometheusMetrics);
  } catch (error) {
    res.status(503).send('# Error fetching metrics\n');
  }
}

/**
 * Middleware to add health check headers to all responses
 * Adds X-Snapshot-Health header with current status
 */
export function addSnapshotHealthHeader(_req: Request, res: Response, next: () => void): void {
  const snapshotService = getSnapshotService();

  if (snapshotService) {
    try {
      const healthReport = snapshotService.getHealthReport();
      res.setHeader('X-Snapshot-Health', healthReport.status);
    } catch {
      // Ignore errors - don't block requests
      res.setHeader('X-Snapshot-Health', 'unknown');
    }
  }

  next();
}
