import { Request, Response, NextFunction } from 'express';
import { getSnapshotService, SnapshotUnavailableError } from '@/snapshot/snapshot.service.js';
import { GatewayErrorCode, sendErrorResponse, validateProjectStatusAndRespond } from './validation.helpers.js';
import type { ProjectConfig } from '@/types/snapshot.types.js';

/**
 * Extend Express Request to include snapshot data
 */
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
      snapshotValidated?: boolean;
      projectData?: ProjectConfig;
    }
  }
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

    // Store project data for downstream use
    req.projectData = project;

    // Check project status
    const isActive = validateProjectStatusAndRespond(res, project.projectName, project.status);

    if (isActive) {
      req.snapshotValidated = true;
      next();
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
