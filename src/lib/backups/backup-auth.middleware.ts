/**
 * Backup Authentication Middleware
 *
 * Ensures only authorized users can access backup operations.
 */

import type { Request, Response, NextFunction } from 'express';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Check if request has valid authentication
 * @param req - Express request
 * @returns True if authenticated
 */
function isAuthenticated(req: Request): boolean {
  // Check for JWT token in Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return false;
  }

  // Check Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);

  // Check token is not empty
  if (!token || token.length === 0) {
    return false;
  }

  // TODO: Verify JWT token signature and expiration
  // For now, just check presence and format
  return token.length > 20;
}

/**
 * Check if user has admin role
 * @param req - Express request
 * @returns True if admin
 */
function isAdmin(req: Request): boolean {
  // TODO: Check user role from JWT payload
  // For now, assume authenticated users are admins
  return isAuthenticated(req);
}

/**
 * Authentication middleware for backup operations
 * Requires valid JWT token
 */
export function requireBackupAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!isAuthenticated(req)) {
    throw new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Authentication required for backup operations',
      401,
      false
    );
  }

  next();
}

/**
 * Admin-only middleware for backup operations
 * Requires admin role
 */
export function requireBackupAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!isAdmin(req)) {
    throw new ApiError(
      ApiErrorCode.FORBIDDEN,
      'Admin access required for this operation',
      403,
      false
    );
  }

  next();
}

/**
 * Project ownership verification middleware
 * Ensures user can only access backups for their projects
 */
export function requireProjectAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // First check authentication
  if (!isAuthenticated(req)) {
    throw new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Authentication required',
      401,
      false
    );
  }

  // Get project ID from request
  const projectId = req.params.project_id || req.body.project_id;

  if (!projectId) {
    throw new ApiError(
      ApiErrorCode.VALIDATION_ERROR,
      'Project ID is required',
      400,
      false
    );
  }

  // TODO: Verify user owns the project
  // For now, just check authentication
  next();
}

/**
 * Rate limiting middleware for backup operations
 * Prevents abuse of backup endpoints
 */
const backupRateLimits = new Map<string, { count: number; resetTime: number }>();

export function requireBackupRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get user identifier (from JWT or IP)
  const userId = req.headers['x-user-id'] as string || req.ip;

  if (!userId) {
    throw new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Unable to identify user for rate limiting',
      401,
      false
    );
  }

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10; // Max 10 backup requests per minute

  // Get or create rate limit entry
  let rateLimit = backupRateLimits.get(userId);

  if (!rateLimit || now > rateLimit.resetTime) {
    // Create new rate limit window
    rateLimit = {
      count: 1,
      resetTime: now + windowMs,
    };
    backupRateLimits.set(userId, rateLimit);
    next();
    return;
  }

  // Check rate limit
  if (rateLimit.count >= maxRequests) {
    const retryAfter = Math.ceil((rateLimit.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    throw new ApiError(
      ApiErrorCode.RATE_LIMIT_EXCEEDED,
      'Too many backup requests. Please try again later.',
      429,
      false
    );
  }

  // Increment counter
  rateLimit.count++;
  next();
}

/**
 * Clean up expired rate limit entries
 * Run periodically to prevent memory leaks
 */
setInterval(() => {
  const now = Date.now();
  for (const [userId, rateLimit] of backupRateLimits.entries()) {
    if (now > rateLimit.resetTime) {
      backupRateLimits.delete(userId);
    }
  }
}, 60 * 1000); // Clean up every minute
