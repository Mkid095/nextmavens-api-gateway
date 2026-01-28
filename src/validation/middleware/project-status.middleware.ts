import { Request, Response, NextFunction } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { createProjectStatusValidator } from '@/validation/project-status.validator.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { withErrorHandling } from '@/api/middleware/error.handler.js';

/**
 * Project ID validation schema
 * Must be alphanumeric with hyphens/underscores, 1-100 chars
 */
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Validate and sanitize project ID
 * Throws error if format is invalid
 */
function validateProjectIdFormat(candidate: string): string {
  const trimmed = candidate.trim();

  if (!PROJECT_ID_REGEX.test(trimmed)) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid project ID format',
      400,
      false
    );
  }

  return trimmed;
}

/**
 * Extended Request interface with project data
 */
export interface ValidatedRequest extends Request {
  project?: {
    id: string;
    config: unknown;
  };
}

/**
 * Extract project ID from request with strict security rules
 * Priority order (most secure to least secure):
 * 1. From authenticated JWT token (future US-005)
 * 2. From x-project-id header (only if authenticated)
 *
 * SECURITY: Query parameters are NEVER accepted for project ID
 * as they are easily manipulated and can be logged/broadcasted
 */
function extractProjectId(req: Request): string | null {
  // Prefer JWT claim when US-005 is implemented
  // const jwtProjectId = (req as any).auth?.projectId;
  // if (jwtProjectId) return validateProjectIdFormat(jwtProjectId);

  // Accept header only (more secure than query param)
  const headerProjectId = req.headers['x-project-id'] as string | undefined;
  if (headerProjectId) {
    return validateProjectIdFormat(headerProjectId);
  }

  // SECURITY: Query parameter extraction removed - too easily manipulated
  // and allows project enumeration attacks

  return null;
}

/**
 * Middleware to validate project status
 * Checks if project is active before allowing request to proceed
 */
export function validateProjectStatus(
  req: ValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  withErrorHandling(async () => {
    // Extract project ID from request
    const projectId = extractProjectId(req);

    if (!projectId) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Project ID required. Provide via x-project-id header or project_id query parameter.',
        400,
        false
      );
    }

    // Get snapshot service
    const snapshotService = getSnapshotService();
    if (!snapshotService) {
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Snapshot service not initialized',
        503,
        true
      );
    }

    // Get project from snapshot
    const project = snapshotService.getProject(projectId);

    // Validate project status
    const validator = createProjectStatusValidator();
    validator.validateProjectStatusOrThrow(project);

    // Attach project data to request for downstream use
    req.project = {
      id: projectId,
      config: project
    };

    next();
  }, 'validateProjectStatus').catch(next);
}

/**
 * Middleware to check if project is active (non-throwing version)
 * Returns 403 if project is not active, otherwise continues
 */
export function requireActiveProject(
  req: ValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  withErrorHandling(async () => {
    const projectId = extractProjectId(req);

    if (!projectId) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Project ID required',
        400,
        false
      );
    }

    const snapshotService = getSnapshotService();
    if (!snapshotService) {
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Snapshot service not initialized',
        503,
        true
      );
    }

    const project = snapshotService.getProject(projectId);
    const validator = createProjectStatusValidator();

    if (!validator.isProjectActive(project)) {
      const validation = validator.validateProjectStatus(project);
      if (!validation.isValid && validation.error) {
        throw validation.error;
      }
    }

    req.project = {
      id: projectId,
      config: project
    };

    next();
  }, 'requireActiveProject').catch(next);
}

/**
 * Optional project validation middleware
 * Attaches project data to request if available, but doesn't block if missing
 */
export function attachProjectData(
  req: ValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const projectId = extractProjectId(req);

    if (projectId) {
      const snapshotService = getSnapshotService();
      if (snapshotService) {
        const project = snapshotService.getProject(projectId);
        req.project = {
          id: projectId,
          config: project
        };
      }
    }

    next();
  } catch (error) {
    // Log but don't block - this is optional attachment
    console.error('[attachProjectData] Error attaching project data:', error);
    next();
  }
}
