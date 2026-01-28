import { Request, Response } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Health check middleware for snapshot service
 * Returns detailed health status including cache statistics
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
