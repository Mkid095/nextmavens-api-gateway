import { Request, Response, NextFunction } from 'express';
import { formatLogWithCorrelation } from '@/api/middleware/correlation.middleware.js';

/**
 * Request log entry structure
 * Contains all required fields for audit trail
 */
interface RequestLogEntry {
  correlationId: string;
  projectId?: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: string;
}

/**
 * Extended Express Request to include timing data
 */
declare global {
  namespace Express {
    interface Request {
      _startTime?: number;
      _projectId?: string;
    }
  }
}

/**
 * Extract project ID from request
 * Checks multiple sources in priority order:
 * 1. JWT-based (req.projectId from US-005)
 * 2. Project validation middleware (req.project from US-002)
 * 3. Header-based (x-project-id header)
 */
function extractProjectId(req: Request): string | undefined {
  // Check JWT-based project ID first (from US-005)
  if (req.projectId) {
    return req.projectId;
  }

  // Check project validation middleware result (from US-002)
  if ((req as unknown as Record<string, unknown>).project) {
    const project = (req as unknown as Record<string, unknown>).project as Record<string, unknown>;
    if (typeof project.id === 'string') {
      return project.id;
    }
  }

  // Check header-based project ID (x-project-id header)
  const projectHeader = req.headers['x-project-id'];
  if (typeof projectHeader === 'string' && projectHeader.length > 0) {
    return projectHeader;
  }

  return undefined;
}

/**
 * Format log entry as JSON string for structured logging
 * This format is compatible with log aggregation tools
 */
function formatLogEntry(entry: RequestLogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Async log writer that doesn't block the request/response cycle
 * Uses setImmediate to ensure logging happens in the next event loop tick
 *
 * PERFORMANCE: This ensures logging doesn't slow down request handling
 */
function asyncLog(entry: RequestLogEntry): void {
  setImmediate(() => {
    try {
      const logMessage = formatLogEntry(entry);
      console.log(`[RequestLog] ${logMessage}`);
    } catch (error) {
      // Silently fail to avoid breaking requests due to logging errors
      console.error('[RequestLogger] Failed to log request:', error);
    }
  });
}

/**
 * Request logging middleware (US-008)
 *
 * This middleware:
 * 1. Records start time when request begins
 * 2. Extracts project_id from JWT or header
 * 3. Logs request details on response finish
 * 4. Uses async logging to avoid blocking requests
 * 5. Includes correlation_id for distributed tracing
 *
 * LOGGED FIELDS:
 * - correlationId: Unique request identifier (from US-006)
 * - projectId: Project identifier (from US-005 JWT or x-project-id header)
 * - method: HTTP method (GET, POST, etc.)
 * - path: Request path (excludes query string for security)
 * - statusCode: HTTP response status code
 * - duration: Request processing time in milliseconds
 * - timestamp: ISO 8601 timestamp of request completion
 *
 * SECURITY:
 * - Does not log query parameters (may contain sensitive data)
 * - Does not log request body (may contain sensitive data)
 * - Does not log response body (may contain sensitive data)
 * - Async logging prevents timing attacks via logging delays
 *
 * PERFORMANCE:
 * - Non-blocking async logging
 * - Minimal overhead in request path
 * - Fail-safe logging (errors don't break requests)
 *
 * Usage:
 * ```typescript
 * import { requestLoggerMiddleware } from '@/api/middleware/request-logger.middleware.js';
 * app.use(requestLoggerMiddleware);
 * ```
 *
 * INTEGRATION NOTES:
 * - Must be applied AFTER correlationMiddleware (US-006)
 * - Can be applied before or after JWT middleware (US-005)
 * - Works with both JWT and header-based authentication
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Record start time for duration calculation
  req._startTime = Date.now();

  // Extract project ID early (may be from JWT or header)
  req._projectId = extractProjectId(req);

  // Log the incoming request
  console.log(formatLogWithCorrelation(req, `${req.method} ${req.path}`));

  // Listen for response finish event
  // This fires when the response has been sent to the client
  res.on('finish', () => {
    // Calculate request duration
    const duration = req._startTime ? Date.now() - req._startTime : 0;

    // Create log entry with all required fields
    const logEntry: RequestLogEntry = {
      correlationId: req.correlationId || 'unknown',
      projectId: req._projectId,
      method: req.method,
      path: req.path, // Using path instead of url for security (excludes query string)
      statusCode: res.statusCode,
      duration,
      timestamp: new Date().toISOString()
    };

    // Log asynchronously to avoid blocking
    asyncLog(logEntry);
  });

  // Continue processing the request
  next();
}

/**
 * Helper function to create a log entry manually
 * Useful for custom logging scenarios outside the middleware
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param duration - Request duration in milliseconds
 * @returns Formatted log entry
 */
export function createLogEntry(
  req: Request,
  res: Response,
  duration: number
): RequestLogEntry {
  return {
    correlationId: req.correlationId || 'unknown',
    projectId: extractProjectId(req),
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    duration,
    timestamp: new Date().toISOString()
  };
}

/**
 * Helper function to format a log entry as JSON string
 * Can be used for custom logging implementations
 *
 * @param entry - Request log entry
 * @returns JSON string representation
 */
export function formatLogEntryAsString(entry: RequestLogEntry): string {
  return formatLogEntry(entry);
}
