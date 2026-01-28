import { Response, NextFunction } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { createServiceEnablementValidator } from '@/validation/service-enablement.validator.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { withErrorHandling } from '@/api/middleware/error.handler.js';
import {
  extractServiceName,
  extractProjectId,
  attachServiceDataToRequest,
  attachProjectDataToRequest
} from './service-extraction.helpers.js';
import type { Request } from 'express';

/**
 * Extended Request interface with project and service data
 */
export interface ServiceValidatedRequest extends Request {
  project?: {
    id: string;
    config: unknown;
  };
  service?: {
    name: string;
    enabled: boolean;
  };
}

/**
 * Middleware to validate service enablement
 * Checks if the requested service is enabled for the project
 *
 * SECURITY:
 * - Fails closed if snapshot unavailable
 * - Validates service name format before processing
 * - Requires project ID to be present
 * - Generic error messages prevent enumeration
 * - Constant-time validation prevents timing attacks
 */
export function validateServiceEnablement(
  req: ServiceValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  withErrorHandling(async () => {
    // Extract and validate service name from request
    const serviceName = extractServiceName(req);

    if (!serviceName) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Service name required. Provide via x-service-name header, ?service query parameter, or route parameter.',
        400,
        false
      );
    }

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

    // SECURITY: Validate service enablement with constant-time checks
    const validator = createServiceEnablementValidator();
    validator.validateServiceEnablementOrThrow(project, serviceName);

    // Attach service and project data to request for downstream use
    attachServiceDataToRequest(req, serviceName);
    attachProjectDataToRequest(req, projectId, project);

    next();
  }, 'validateServiceEnablement').catch(next);
}

/**
 * Middleware to check if service is enabled (non-throwing version)
 * Returns 403 if service is not enabled, otherwise continues
 *
 * SECURITY: Fails closed if snapshot unavailable
 */
export function requireServiceEnabled(
  req: ServiceValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  withErrorHandling(async () => {
    const serviceName = extractServiceName(req);
    const projectId = extractProjectId(req);

    if (!serviceName) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Service name required',
        400,
        false
      );
    }

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
    const validator = createServiceEnablementValidator();

    // SECURITY: Validate even if not enabled to prevent timing attacks
    if (!validator.isServiceEnabled(project, serviceName)) {
      validator.validateServiceEnablementOrThrow(project, serviceName);
    }

    // Attach service and project data
    attachServiceDataToRequest(req, serviceName);
    attachProjectDataToRequest(req, projectId, project);

    next();
  }, 'requireServiceEnabled').catch(next);
}

/**
 * Factory function to create middleware for a specific service
 * Useful when you know the service name at route definition time
 *
 * Example:
 * router.get('/api/data', validateServiceEnabledFor('data-service'), handler);
 */
export function validateServiceEnabledFor(serviceName: string) {
  return (
    req: ServiceValidatedRequest,
    _res: Response,
    next: NextFunction
  ): void => {
    withErrorHandling(async () => {
      // Validate the provided service name format
      const validatedServiceName = serviceName.trim();

      if (validatedServiceName.length === 0) {
        throw new ApiError(
          ApiErrorCode.BAD_REQUEST,
          'Service name cannot be empty',
          400,
          false
        );
      }

      // Extract project ID
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
        throw new ApiError(
          ApiErrorCode.SNAPSHOT_UNAVAILABLE,
          'Service temporarily unavailable',
          503,
          true
        );
      }

      // Get project from snapshot
      const project = snapshotService.getProject(projectId);

      // Validate service enablement
      const validator = createServiceEnablementValidator();
      validator.validateServiceEnablementOrThrow(project, validatedServiceName);

      // Attach service and project data to request
      attachServiceDataToRequest(req, validatedServiceName);
      attachProjectDataToRequest(req, projectId, project);

      next();
    }, `validateServiceEnabledFor(${serviceName})`).catch(next);
  };
}

/**
 * Optional service validation middleware
 * Attaches service data to request if available, but doesn't block if missing
 *
 * SECURITY: This is for non-critical paths where service context is optional
 * Always logs errors for security monitoring
 */
export function attachServiceData(
  req: ServiceValidatedRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const serviceName = extractServiceName(req);
    const projectId = extractProjectId(req);

    if (serviceName && projectId) {
      const snapshotService = getSnapshotService();
      if (snapshotService) {
        const project = snapshotService.getProject(projectId);
        const validator = createServiceEnablementValidator();

        // SECURITY: Only attach if service is enabled
        if (validator.isServiceEnabled(project, serviceName)) {
          attachServiceDataToRequest(req, serviceName);
        }
      }
    }

    next();
  } catch (error) {
    // SECURITY: Log but don't block - this is optional attachment
    console.error('[attachServiceData] Error attaching service data');
    next();
  }
}
