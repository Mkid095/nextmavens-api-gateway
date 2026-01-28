import { Request, Response, NextFunction } from 'express';
import { durationTracker } from '@/duration/services/duration-tracker.service.js';
import type { DurationMetrics } from '@/duration/types/duration.types.js';

/**
 * Extend Express Request to include duration tracking properties
 * Used to track request start time and calculate duration
 */
declare global {
  namespace Express {
    interface Request {
      _startTime?: number;
    }
  }
}

/**
 * Duration Tracking Middleware
 *
 * Express middleware that tracks request duration with:
 * - High-precision timing using performance.now()
 * - Integration with correlation ID (US-006)
 * - Integration with project_id from JWT (US-005)
 * - Slow request detection (>1s threshold)
 * - Non-blocking async recording
 *
 * The middleware records start time when request begins,
 * calculates duration when response completes, and records
 * the metrics asynchronously to avoid blocking request processing.
 *
 * Usage:
 * ```typescript
 * import { durationTrackingMiddleware } from '@/duration/middleware/duration-tracking.middleware.js';
 * app.use(durationTrackingMiddleware);
 * ```
 *
 * Note: This middleware should be applied AFTER:
 * - correlation.middleware.ts (to ensure correlation_id exists)
 * - jwt.middleware.ts (to ensure project_id exists)
 *
 * Note: Follows the same pattern as US-008 request-logging.middleware.ts
 */

/**
 * Default slow request threshold in milliseconds
 * Requests exceeding this duration are logged to console
 */
const DEFAULT_SLOW_THRESHOLD = 1000; // 1 second

/**
 * Extract project ID from request
 * Checks JWT payload and fallback to request property
 * Matches the pattern from US-008 request logging
 */
function extractProjectId(req: Request): string | undefined {
  // Check if project ID was set by JWT middleware
  if (req.projectId) {
    return req.projectId;
  }

  // Check if JWT payload exists
  if ((req as unknown as Record<string, unknown>).jwtPayload) {
    const payload = (req as unknown as Record<string, unknown>).jwtPayload as Record<string, unknown>;
    if (typeof payload.project_id === 'string') {
      return payload.project_id;
    }
  }

  return undefined;
}

/**
 * Duration tracking middleware function
 * Records start time and tracks request duration
 */
export function durationTrackingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Record request start time using high-precision timer
  // performance.now() provides sub-millisecond precision
  req._startTime = performance.now();

  // Listen for response finish event
  // This fires when the response has been sent to the client
  res.on('finish', async () => {
    // Calculate request duration using high-precision timer
    const duration = req._startTime ? performance.now() - req._startTime : 0;

    // Extract project ID
    const projectId = extractProjectId(req);

    // If no project ID, skip tracking (request wasn't authenticated)
    if (!projectId) {
      return;
    }

    // Check if this is a slow request (>1s threshold)
    const isSlow = duration > DEFAULT_SLOW_THRESHOLD;

    // Log slow requests to console for immediate visibility
    if (isSlow) {
      console.warn(
        `[Duration Tracking] Slow request detected: ${duration.toFixed(2)}ms ` +
          `> ${DEFAULT_SLOW_THRESHOLD}ms threshold | ` +
          `Path: ${req.method} ${req.path} | ` +
          `Project: ${projectId} | ` +
          `Correlation: ${req.correlationId || 'unknown'}`
      );
    }

    // Create duration metrics entry
    const metrics: DurationMetrics = {
      request_id: req.correlationId || 'unknown',
      project_id: projectId,
      path: req.path,
      method: req.method,
      status_code: res.statusCode,
      duration_ms: Math.round(duration),
      timestamp: new Date().toISOString(),
      is_slow: isSlow
    };

    // Record metrics asynchronously (don't await)
    // This ensures tracking doesn't block request processing
    durationTracker.record(metrics).catch((error) => {
      // Silently handle tracking errors to avoid impacting requests
      console.error('[Duration Tracking] Failed to record metrics:', error);
    });
  });

  // Continue processing request
  next();
}

/**
 * Create a duration tracking middleware with custom options
 * Allows configuration of tracking behavior
 *
 * @param options - Middleware options
 * @returns Express middleware function
 */
export function createDurationTrackingMiddleware(options?: {
  /**
   * Slow request threshold in milliseconds
   * Requests slower than this will be logged to console
   * Default: 1000 (1 second)
   */
  slowRequestThreshold?: number;

  /**
   * Whether to track requests without project ID
   * Default: false (only track authenticated requests)
   */
  trackUnauthenticated?: boolean;

  /**
   * Whether to log slow requests to console
   * Default: true
   */
  logSlowRequests?: boolean;
}) {
  // Merge options with defaults
  const slowThreshold = options?.slowRequestThreshold ?? DEFAULT_SLOW_THRESHOLD;
  const trackUnauthenticated = options?.trackUnauthenticated ?? false;
  const logSlowRequests = options?.logSlowRequests ?? true;

  return function durationTrackingMiddlewareWithOptions(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // Record request start time
    req._startTime = performance.now();

    // Listen for response finish event
    res.on('finish', async () => {
      // Calculate request duration
      const duration = req._startTime ? performance.now() - req._startTime : 0;

      // Extract project ID
      const projectId = extractProjectId(req);

      // If no project ID and not tracking unauthenticated, skip
      if (!projectId && !trackUnauthenticated) {
        return;
      }

      // Check if this is a slow request
      const isSlow = duration > slowThreshold;

      // Log slow requests to console if enabled
      if (isSlow && logSlowRequests) {
        console.warn(
          `[Duration Tracking] Slow request detected: ${duration.toFixed(2)}ms ` +
            `> ${slowThreshold}ms threshold | ` +
            `Path: ${req.method} ${req.path} | ` +
            `Project: ${projectId || 'anonymous'} | ` +
            `Correlation: ${req.correlationId || 'unknown'}`
        );
      }

      // Create duration metrics entry
      const metrics: DurationMetrics = {
        request_id: req.correlationId || 'unknown',
        project_id: projectId || 'anonymous',
        path: req.path,
        method: req.method,
        status_code: res.statusCode,
        duration_ms: Math.round(duration),
        timestamp: new Date().toISOString(),
        is_slow: isSlow
      };

      // Record metrics asynchronously
      durationTracker.record(metrics).catch((error) => {
        console.error('[Duration Tracking] Failed to record metrics:', error);
      });
    });

    // Continue processing request
    next();
  };
}
