import { Request, Response, NextFunction } from 'express';
import { getSnapshotService, SnapshotUnavailableError } from '@/snapshot/snapshot.service.js';
import { ProjectStatus } from '@/types/snapshot.types.js';

/**
 * Extend Express Request to include snapshot data
 */
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
      snapshotValidated?: boolean;
    }
  }
}

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

/**
 * Error codes for gateway enforcement
 */
enum GatewayErrorCode {
  PROJECT_SUSPENDED = 'PROJECT_SUSPENDED',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PROJECT_DELETED = 'PROJECT_DELETED',
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  SERVICE_DISABLED = 'SERVICE_DISABLED',
  SNAPSHOT_UNAVAILABLE = 'SNAPSHOT_UNAVAILABLE',
  KEY_INVALID = 'KEY_INVALID'
}

/**
 * Send standardized error response
 */
function sendErrorResponse(res: Response, code: GatewayErrorCode, message: string, status: number = 403): void {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      retryable: code === GatewayErrorCode.SNAPSHOT_UNAVAILABLE
    }
  };

  res.status(status).json(response);
}

/**
 * Middleware to extract and validate project ID from request
 * This middleware should run after JWT/API key validation
 */
export function validateProjectFromRequest(req: Request, res: Response, next: NextFunction): void {
  const projectId = req.headers['x-project-id'] as string || req.query.project_id as string;

  if (!projectId) {
    sendErrorResponse(
      res,
      GatewayErrorCode.KEY_INVALID,
      'Project ID not found in request. Ensure JWT or API key includes project_id.',
      401
    );
    return;
  }

  req.projectId = projectId;
  next();
}

/**
 * Middleware to validate project status from snapshot
 * Rejects requests from suspended, archived, or deleted projects
 */
export function validateProjectStatus(req: Request, res: Response, next: NextFunction): void {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    sendErrorResponse(
      res,
      GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
      'Snapshot service not available. Gateway cannot validate requests.',
      503
    );
    return;
  }

  if (!req.projectId) {
    sendErrorResponse(
      res,
      GatewayErrorCode.KEY_INVALID,
      'Project ID required for validation',
      401
    );
    return;
  }

  try {
    const project = snapshotService.getProject(req.projectId);

    if (!project) {
      sendErrorResponse(
        res,
        GatewayErrorCode.PROJECT_NOT_FOUND,
        `Project '${req.projectId}' not found or does not exist`,
        403
      );
      return;
    }

    // Check project status
    switch (project.status) {
      case ProjectStatus.ACTIVE:
        req.snapshotValidated = true;
        next();
        return;

      case ProjectStatus.SUSPENDED:
        sendErrorResponse(
          res,
          GatewayErrorCode.PROJECT_SUSPENDED,
          `Project '${project.projectName}' is suspended. Please contact support.`,
          403
        );
        return;

      case ProjectStatus.ARCHIVED:
        sendErrorResponse(
          res,
          GatewayErrorCode.PROJECT_ARCHIVED,
          `Project '${project.projectName}' is archived and cannot accept requests.`,
          403
        );
        return;

      case ProjectStatus.DELETED:
        sendErrorResponse(
          res,
          GatewayErrorCode.PROJECT_DELETED,
          `Project '${project.projectName}' has been deleted.`,
          403
        );
        return;

      default:
        sendErrorResponse(
          res,
          GatewayErrorCode.PROJECT_SUSPENDED,
          `Project '${project.projectName}' has unknown status: ${project.status}`,
          403
        );
        return;
    }
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) {
      // Fail closed - if snapshot is unavailable, reject all requests
      sendErrorResponse(
        res,
        GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
        'Snapshot unavailable. Cannot validate project status.',
        503
      );
      return;
    }

    console.error('[SnapshotMiddleware] Error validating project status:', error);
    sendErrorResponse(
      res,
      GatewayErrorCode.SNAPSHOT_UNAVAILABLE,
      'Failed to validate project status',
      503
    );
  }
}

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

/**
 * Health check middleware for snapshot service
 */
export function checkSnapshotHealth(_req: Request, res: Response, _next: NextFunction): void {
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
    res.status(503).json({
      status: 'unhealthy',
      snapshot: {
        available: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}
