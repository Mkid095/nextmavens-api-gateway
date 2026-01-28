import { Response, NextFunction } from 'express';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { createRateLimitValidator } from '@/rate-limit/rate-limit.validator.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { withErrorHandling } from '@/api/middleware/error.handler.js';
import { RateLimitContext, RateLimitWindow } from '@/types/rate-limit.types.js';
import { RateLimitRequest } from './rate-limit.types.js';
import { extractProjectId, extractCorrelationId } from './project-id-extractor.js';
import {
  formatRetryAfter,
  setRateLimitHeaders,
  createRateLimitHeaders
} from './rate-limit-headers.js';

/**
 * Middleware to enforce rate limits
 * Checks rate limits from snapshot and enforces sliding window rate limiting
 *
 * SECURITY:
 * - Fails closed if snapshot unavailable
 * - Validates project ID format before processing
 * - Uses sliding window algorithm for accurate rate limiting
 * - Prevents request flooding and DoS attacks
 * - Generic error messages prevent quota enumeration
 *
 * Rate limit headers:
 * - X-RateLimit-Limit: Maximum requests allowed in window
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Unix timestamp when window resets
 * - X-RateLimit-Window: Window type (MINUTE or HOUR)
 * - Retry-After: Seconds until retry is allowed (only on 429)
 */
export function enforceRateLimit(
  req: RateLimitRequest,
  res: Response,
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

    // SECURITY: Get snapshot data (fails closed if unavailable)
    let snapshotData;
    try {
      snapshotData = snapshotService.getSnapshot();
    } catch (error) {
      // SECURITY: Fail closed - don't allow requests without snapshot
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Service temporarily unavailable',
        503,
        true
      );
    }

    // Create rate limit context
    const context: RateLimitContext = {
      projectId,
      timestamp: Date.now(),
      requestId: extractCorrelationId(req)
    };

    // Validate rate limit
    const validator = createRateLimitValidator();
    const validation = validator.validateRateLimit(snapshotData, context);

    // Check if request is allowed
    if (!validation.allowed) {
      // Rate limit exceeded - return 429 with retry-after header
      if (validation.error) {
        const retryAfter = validation.error.details?.retryAfter as number | undefined;
        const resetTime = validation.error.details?.resetTime as number | undefined;
        const limit = validation.error.details?.limit as number | undefined;
        const window = validation.error.details?.window as RateLimitWindow | undefined;

        // Set retry-after header if available
        if (retryAfter) {
          res.setHeader('Retry-After', formatRetryAfter(retryAfter));
        }

        // Set rate limit headers even on failure
        if (limit !== undefined && resetTime !== undefined && window) {
          setRateLimitHeaders(
            res,
            createRateLimitHeaders(limit, 0, resetTime, window)
          );
        }

        // Attach rate limit info to request for logging
        req.rateLimit = {
          allowed: false,
          limit: limit || 0,
          remaining: 0,
          reset: resetTime || 0,
          window: window || RateLimitWindow.MINUTE
        };

        throw validation.error;
      }

      // Generic rate limit error if no specific error available
      throw new ApiError(
        ApiErrorCode.RATE_LIMITED,
        'Rate limit exceeded. Please retry later.',
        429,
        true
      );
    }

    // Request is allowed - attach rate limit info to request
    if (validation.result) {
      const result = validation.result;

      // Set rate limit headers for successful request
      setRateLimitHeaders(
        res,
        createRateLimitHeaders(
          result.limit,
          result.remainingRequests,
          result.resetTime,
          result.window
        )
      );

      // Attach rate limit info to request for downstream use
      req.rateLimit = {
        allowed: true,
        limit: result.limit,
        remaining: result.remainingRequests,
        reset: result.resetTime,
        window: result.window
      };
    }

    // Attach project ID to request if not already present
    if (!req.project) {
      req.project = {
        id: projectId,
        config: snapshotData.projects[projectId] || null
      };
    }

    next();
  }, 'enforceRateLimit').catch(next);
}

/**
 * Middleware to check rate limit without blocking
 * Attaches rate limit info to request but doesn't throw error
 * Useful for monitoring and logging purposes
 *
 * SECURITY: Still fails closed if snapshot unavailable
 */
export function checkRateLimit(
  req: RateLimitRequest,
  _res: Response,
  next: NextFunction
): void {
  try {
    const projectId = extractProjectId(req);

    if (!projectId) {
      // No project ID - skip rate limit check
      next();
      return;
    }

    const snapshotService = getSnapshotService();
    if (!snapshotService) {
      // SECURITY: Fail closed - attach error info but don't block
      req.rateLimit = {
        allowed: false,
        limit: 0,
        remaining: 0,
        reset: 0,
        window: RateLimitWindow.MINUTE
      };
      next();
      return;
    }

    let snapshotData;
    try {
      snapshotData = snapshotService.getSnapshot();
    } catch (error) {
      // SECURITY: Fail closed - attach error info but don't block
      req.rateLimit = {
        allowed: false,
        limit: 0,
        remaining: 0,
        reset: 0,
        window: RateLimitWindow.MINUTE
      };
      next();
      return;
    }

    const context: RateLimitContext = {
      projectId,
      timestamp: Date.now(),
      requestId: extractCorrelationId(req)
    };

    const validator = createRateLimitValidator();
    const validation = validator.validateRateLimit(snapshotData, context);

    if (validation.result) {
      req.rateLimit = {
        allowed: validation.allowed,
        limit: validation.result.limit,
        remaining: validation.result.remainingRequests,
        reset: validation.result.resetTime,
        window: validation.result.window
      };
    } else {
      req.rateLimit = {
        allowed: false,
        limit: 0,
        remaining: 0,
        reset: 0,
        window: RateLimitWindow.MINUTE
      };
    }

    next();
  } catch (error) {
    // Log but don't block - this is non-blocking check
    console.error('[checkRateLimit] Error checking rate limit:', error);
    next();
  }
}

/**
 * Middleware to skip rate limiting for specific routes
 * Wrap this around routes that should not be rate limited
 * Example: health checks, webhooks, etc.
 */
export function skipRateLimit(
  req: RateLimitRequest,
  _res: Response,
  next: NextFunction
): void {
  // Mark request as skipped from rate limiting
  req.rateLimit = {
    allowed: true,
    limit: -1, // -1 indicates unlimited
    remaining: -1,
    reset: 0,
    window: RateLimitWindow.MINUTE
  };

  next();
}
