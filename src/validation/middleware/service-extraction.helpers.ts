import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import type { ServiceValidatedRequest } from './service-enablement.middleware.js';
import type { Request } from 'express';

/**
 * Service name validation schema
 * Must be alphanumeric with hyphens/underscores, 1-100 chars
 * SECURITY: Strict regex prevents injection attacks
 */
const SERVICE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * Maximum length for service name before trimming (prevent DoS)
 */
const MAX_SERVICE_NAME_INPUT_LENGTH = 200;

/**
 * Validate and sanitise service name
 * Throws error if format is invalid or input is suspiciously long
 *
 * SECURITY:
 * - Enforces maximum length to prevent DoS
 * - Strict format validation prevents injection
 * - Trims whitespace to prevent bypass attempts
 */
export function validateServiceNameFormat(candidate: string): string {
  // SECURITY: Check raw input length before processing to prevent DoS
  if (candidate.length > MAX_SERVICE_NAME_INPUT_LENGTH) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid service name format',
      400,
      false
    );
  }

  const trimmed = candidate.trim();

  // SECURITY: Check trimmed length again
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid service name format',
      400,
      false
    );
  }

  // SECURITY: Strict format validation
  if (!SERVICE_NAME_REGEX.test(trimmed)) {
    throw new ApiError(
      ApiErrorCode.BAD_REQUEST,
      'Invalid service name format',
      400,
      false
    );
  }

  return trimmed;
}

/**
 * Extract service name from request
 * Can be provided via:
 * 1. Query parameter (?service=serviceName)
 * 2. Header (x-service-name)
 * 3. Path parameter (extracted from route)
 *
 * Priority: Path > Header > Query
 */
export function extractServiceName(req: ServiceValidatedRequest): string | null {
  // Try path parameter first (most reliable)
  if (req.params && req.params.serviceName) {
    return validateServiceNameFormat(req.params.serviceName);
  }

  // Try header second
  const headerServiceName = req.headers['x-service-name'] as string | undefined;
  if (headerServiceName) {
    return validateServiceNameFormat(headerServiceName);
  }

  // Try query parameter last (least secure but still valid)
  if (req.query && req.query.service) {
    const serviceParam = req.query.service as string;
    return validateServiceNameFormat(serviceParam);
  }

  return null;
}

/**
 * Extract project ID from request
 * Uses the same logic as project-status middleware
 */
export function extractProjectId(req: Request): string | null {
  const headerProjectId = req.headers['x-project-id'] as string | undefined;
  if (headerProjectId) {
    return headerProjectId.trim();
  }

  return null;
}

/**
 * Attach service data to request
 * Helper function to avoid code duplication
 */
export function attachServiceDataToRequest(
  req: ServiceValidatedRequest,
  serviceName: string
): void {
  req.service = {
    name: serviceName,
    enabled: true
  };
}

/**
 * Attach project data to request if not already attached
 * Helper function to avoid code duplication
 */
export function attachProjectDataToRequest(
  req: ServiceValidatedRequest,
  projectId: string,
  project: unknown
): void {
  if (!req.project) {
    req.project = {
      id: projectId,
      config: project
    };
  }
}
