import { Request, Response, NextFunction } from 'express';
import { requestLogger } from '@/logging/request-logger.service.js';
import type { RequestLogEntry } from '@/types/request-log.types.js';

/**
 * Extend Express Request to include request start time
 * Used to calculate request duration
 */
declare global {
  namespace Express {
    interface Request {
      _startTime?: number;
    }
  }
}

/**
 * Request Logging Middleware
 *
 * Express middleware that logs all requests with:
 * - project_id (from JWT)
 * - path
 * - method
 * - status_code
 * - duration (ms)
 * - correlation_id
 *
 * The middleware logs asynchronously to avoid blocking request processing.
 * Logs are written after the response is sent to the client.
 *
 * Usage:
 * ```typescript
 * import { requestLoggingMiddleware } from '@/logging/middleware/request-logging.middleware.js';
 * app.use(requestLoggingMiddleware);
 * ```
 *
 * Note: This middleware should be applied AFTER:
 * - correlation.middleware.ts (to ensure correlation_id exists)
 * - jwt.middleware.ts (to ensure project_id exists)
 *
 * Note: This is a placeholder implementation for Step 1.
 * Full implementation will be completed in later steps.
 */

/**
 * Extract project ID from request
 * Checks JWT payload and fallback to request property
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
 * Request logging middleware function
 * Records start time and logs request completion
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Record request start time
  req._startTime = Date.now();

  // Listen for response finish event
  res.on('finish', async () => {
    // Calculate request duration
    const duration = req._startTime ? Date.now() - req._startTime : 0;

    // Extract project ID
    const projectId = extractProjectId(req);

    // If no project ID, skip logging (request wasn't authenticated)
    if (!projectId) {
      return;
    }

    // Create log entry
    const logEntry: RequestLogEntry = {
      project_id: projectId,
      path: req.path,
      method: req.method,
      status_code: res.statusCode,
      duration,
      correlation_id: req.correlationId || 'unknown',
      timestamp: new Date().toISOString()
    };

    // Log asynchronously (don't await)
    // This ensures logging doesn't block request processing
    requestLogger.logRequest(logEntry).catch((error) => {
      // Silently handle logging errors to avoid impacting requests
      console.error('[Request Logging] Failed to log request:', error);
    });
  });

  // Continue processing request
  next();
}

/**
 * Create a request logging middleware with custom options
 * Allows configuration of logging behavior
 *
 * @param options - Middleware options (placeholder for future extensions)
 * @returns Express middleware function
 */
export function createRequestLoggingMiddleware(options?: {
  /**
   * Whether to log requests without project ID
   * Default: false (only log authenticated requests)
   */
  logUnauthenticated?: boolean;

  /**
   * Whether to include request metadata
   * Default: false
   */
  includeMetadata?: boolean;

  /**
   * Slow request threshold in milliseconds
   * Requests slower than this will be logged as warnings
   * Default: 1000 (1 second)
   */
  slowRequestThreshold?: number;
}) {
  return function requestLoggingMiddlewareWithOptions(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // Record request start time
    req._startTime = Date.now();

    // Listen for response finish event
    res.on('finish', async () => {
      // Calculate request duration
      const duration = req._startTime ? Date.now() - req._startTime : 0;

      // Extract project ID
      const projectId = extractProjectId(req);

      // If no project ID and not logging unauthenticated, skip
      if (!projectId && !options?.logUnauthenticated) {
        return;
      }

      // Create log entry
      const logEntry: RequestLogEntry = {
        project_id: projectId || 'anonymous',
        path: req.path,
        method: req.method,
        status_code: res.statusCode,
        duration,
        correlation_id: req.correlationId || 'unknown',
        timestamp: new Date().toISOString()
      };

      // Log asynchronously
      try {
        // Check if this is a slow request
        if (options?.slowRequestThreshold && duration > options.slowRequestThreshold) {
          await requestLogger.logSlowRequest(logEntry, options.slowRequestThreshold);
        } else {
          await requestLogger.logRequest(logEntry);
        }
      } catch (error) {
        console.error('[Request Logging] Failed to log request:', error);
      }
    });

    next();
  };
}
