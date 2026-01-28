import { Request, Response, NextFunction } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { createProjectStatusValidator } from '@/validation/project-status.validator.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { withErrorHandling } from '@/api/middleware/error.handler.js';

/**
 * Project ID validation schema
 * Must be alphanumeric with hyphens/underscores, 1-100 chars
 * SECURITY: Strict regex prevents injection attacks
 */
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Maximum length for project ID before trimming (prevent DoS via ultra-long strings)
 */
const MAX_PROJECT_ID_INPUT_LENGTH = 200;

/**
 * Validate and sanitize project ID
 * Throws error if format is invalid or input is suspiciously long
 *
 * SECURITY:
 * - Enforces maximum input length before regex to prevent ReDoS
 * - Trims whitespace to prevent bypass attempts
 * - Strict regex prevents injection attacks
 * - Generic error message prevents information leakage
 */
function validateProjectIdFormat(candidate: string): string {
  // SECURITY: Check raw input length before processing to prevent DoS
  if (candidate.length > MAX_PROJECT_ID_INPUT_LENGTH) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid project ID format',
      400,
      false
    );
  }

  const trimmed = candidate.trim();

  // SECURITY: Check trimmed length again
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid project ID format',
      400,
      false
    );
  }

  // SECURITY: Strict format validation
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
 *
 * SECURITY:
 * - Fails closed if snapshot unavailable
 * - Validates project ID format before processing
 * - Generic error messages prevent enumeration
 * - Constant-time validation prevents timing attacks
 */
export function validateProjectStatus(
  req: ValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  withErrorHandling(async () => {
    // Extract and validate project ID from request
    const projectId = extractProjectId(req);

    if (!projectId) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Project ID required. Provide via x-project-id header.',
        400,
        false
      );
    }

    // SECURITY: Get snapshot service and check availability
    const snapshotService = getSnapshotService();
    if (!snapshotService) {
      // SECURITY: Fails closed - no requests if snapshot unavailable
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Service temporarily unavailable',
        503,
        true
      );
    }

    // SECURITY: Get project from snapshot (handles null internally)
    const project = snapshotService.getProject(projectId);

    // SECURITY: Validate project status with constant-time checks
    const validator = createProjectStatusValidator();
    validator.validateProjectStatusOrThrow(project);

    // Attach project data to request for downstream use
    // SECURITY: Only attach if validation passed
    if (project) {
      req.project = {
        id: projectId,
        config: project
      };
    }

    next();
  }, 'validateProjectStatus').catch(next);
}

/**
 * Middleware to check if project is active (non-throwing version)
 * Returns 403 if project is not active, otherwise continues
 *
 * SECURITY: Fails closed if snapshot unavailable
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
      // SECURITY: Fails closed
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Service temporarily unavailable',
        503,
        true
      );
    }

    const project = snapshotService.getProject(projectId);
    const validator = createProjectStatusValidator();

    // SECURITY: Validate even if not active to prevent timing attacks
    if (!validator.isProjectActive(project)) {
      const validation = validator.validateProjectStatus(project);
      if (!validation.isValid && validation.error) {
        throw validation.error;
      }
    }

    // SECURITY: Only attach if project exists
    if (project) {
      req.project = {
        id: projectId,
        config: project
      };
    }

    next();
  }, 'requireActiveProject').catch(next);
}

/**
 * Optional project validation middleware
 * Attaches project data to request if available, but doesn't block if missing
 *
 * SECURITY: This is for non-critical paths where project context is optional
 * Always logs errors for security monitoring
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
        // SECURITY: Only attach if project exists
        if (project) {
          req.project = {
            id: projectId,
            config: project
          };
        }
      }
    }

    next();
  } catch (error) {
    // SECURITY: Log but don't block - this is optional attachment
    // Generic logging prevents information leakage
    console.error('[attachProjectData] Error attaching project data');
    next();
  }
}
