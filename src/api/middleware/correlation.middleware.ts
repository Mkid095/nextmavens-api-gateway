import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Extend Express Request to include correlation ID
 */
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Correlation ID header name
 */
const CORRELATION_HEADER = 'x-request-id';

/**
 * Extract correlation ID from request headers
 * Returns the existing correlation ID if present, null otherwise
 */
function extractCorrelationId(req: Request): string | null {
  const headerValue = req.headers[CORRELATION_HEADER];

  if (typeof headerValue === 'string') {
    return headerValue;
  }

  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return headerValue[0];
  }

  return null;
}

/**
 * Generate a new correlation ID using UUID v4
 * Uses Node.js crypto.randomUUID() for secure, unique ID generation
 */
function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Middleware to manage correlation IDs for request tracking
 *
 * This middleware:
 * 1. Checks for existing x-request-id header
 * 2. Generates UUID v4 if not present
 * 3. Stores correlation ID on the request object for downstream use
 * 4. Sets x-request-id response header for client-side tracking
 *
 * Correlation IDs enable:
 * - Distributed tracing across services
 * - Log aggregation and analysis
 * - Performance monitoring
 * - Debugging and troubleshooting
 *
 * Usage:
 * ```typescript
 * import { correlationMiddleware } from '@/api/middleware/correlation.middleware.js';
 * app.use(correlationMiddleware);
 * ```
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract existing correlation ID or generate new one
  const correlationId = extractCorrelationId(req) || generateCorrelationId();

  // Store correlation ID on request for downstream middleware/routes
  req.correlationId = correlationId;

  // Ensure the header is set on the request for downstream services
  req.headers[CORRELATION_HEADER] = correlationId;

  // Set correlation ID on response for client-side tracking
  res.setHeader(CORRELATION_HEADER, correlationId);

  // Continue processing
  next();
}

/**
 * Helper function to get correlation ID from request
 * Returns the correlation ID or 'unknown' if not set
 */
export function getCorrelationId(req: Request): string {
  return req.correlationId || 'unknown';
}

/**
 * Helper function to add correlation ID to log messages
 * Formats log entries with correlation ID prefix
 */
export function formatLogWithCorrelation(req: Request, message: string): string {
  const correlationId = getCorrelationId(req);
  return `[${correlationId}] ${message}`;
}
