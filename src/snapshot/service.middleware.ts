import { Request, Response, NextFunction } from 'express';
import { getSnapshotService, SnapshotUnavailableError } from '@/snapshot/snapshot.service.js';
import { GatewayErrorCode, sendErrorResponse } from './validation.helpers.js';
import { validateProjectFromRequest, validateProjectStatus } from './project.middleware.js';

/**
 * Middleware to validate service enablement
 * Checks if the requested service is enabled for the project
 */
export function validateServiceEnabled(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const snapshotService = getSnapshotService();

    if (!snapshotService) {
      sendErrorResponse(
        res,
        GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
        'Snapshot service not available. Gateway cannot validate service access.',
        503
      );
      return;
    }

    if (!req.projectId) {
      sendErrorResponse(
        res,
        GatewayErrorCode.KEY_INVALID,
        'Project ID required for service validation',
        401
      );
      return;
    }

    try {
      const serviceEnabled = snapshotService.isServiceEnabled(req.projectId, serviceName);

      if (!serviceEnabled) {
        sendErrorResponse(
          res,
          GatewayErrorCode.SERVICE_DISABLED,
          `Service '${serviceName}' is not enabled for this project. ` +
          `Please enable it in the developer portal.`,
          403
        );
        return;
      }

      next();
    } catch (error) {
      if (error instanceof SnapshotUnavailableError) {
        // Fail closed - if snapshot is unavailable, reject all requests
        sendErrorResponse(
          res,
          GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
          'Snapshot unavailable. Cannot validate service access.',
          503
        );
        return;
      }

      console.error('[SnapshotMiddleware] Error validating service:', error);
      sendErrorResponse(
        res,
        GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
        'Failed to validate service access',
        503
      );
    }
  };
}

/**
 * Combined middleware to validate both project status and service enablement
 */
export function validateProjectAndService(serviceName: string) {
  return [
    validateProjectFromRequest,
    validateProjectStatus,
    validateServiceEnabled(serviceName)
  ];
}
