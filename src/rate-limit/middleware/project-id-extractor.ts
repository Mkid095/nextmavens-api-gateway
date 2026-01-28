import { Request } from 'express';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Maximum length for project ID before trimming (prevent DoS via ultra-long strings)
 */
const MAX_PROJECT_ID_INPUT_LENGTH = 200;

/**
 * Project ID validation schema
 * Must be alphanumeric with hyphens/underscores, 1-100 chars
 * SECURITY: Strict regex prevents injection attacks
 */
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

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
export function validateProjectIdFormat(candidate: string): string {
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
 * Extract project ID from request
 * Priority order (most secure to least secure):
 * 1. From authenticated JWT token (future US-005)
 * 2. From x-project-id header (only if authenticated)
 *
 * SECURITY: Query parameters are NEVER accepted for project ID
 * as they are easily manipulated and can be logged/broadcasted
 */
export function extractProjectId(req: Request): string | null {
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
 * Extract correlation ID from request headers
 * Returns null if not present
 */
export function extractCorrelationId(req: Request): string | undefined {
  return req.headers['x-request-id'] as string | undefined;
}
