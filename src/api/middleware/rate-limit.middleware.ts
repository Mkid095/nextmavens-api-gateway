/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting for API endpoints to prevent abuse and DoS attacks.
 * Uses in-memory storage for rate limit tracking (Redis recommended for production).
 *
 * US-009: Implement Auto Suspend Job - Rate Limiting for Monitoring Webhooks
 *
 * @example
 * ```typescript
 * import { rateLimit } from '@/api/middleware/rate-limit.middleware.js';
 *
 * // Apply rate limit to webhook endpoint
 * router.post('/webhook/auto-suspend',
 *   rateLimit({ windowMs: 60000, max: 10 }),
 *   autoSuspendWebhook
 * );
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Rate limit record for tracking requests
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
  windowStart: number;
}

/**
 * In-memory storage for rate limit records
 * In production, use Redis or similar for distributed systems
 */
const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Clean up expired rate limit records
 *
 * Runs periodically to remove old records and prevent memory leaks.
 */
function cleanupExpiredRecords(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    rateLimitStore.delete(key);
  }

  // Schedule next cleanup
  setTimeout(cleanupExpiredRecords, 60000); // Run every minute
}

// Start cleanup process
cleanupExpiredRecords();

/**
 * Rate limiting options
 */
export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Maximum number of requests allowed in the window (default: 100) */
  max?: number;
  /** Key generator function for identifying clients (default: IP address) */
  keyGenerator?: (req: Request) => string;
  /** Whether to skip successful requests (default: false) */
  skipSuccessfulRequests?: boolean;
  /** Whether to skip failed requests (default: false) */
  skipFailedRequests?: boolean;
  /** Custom handler for rate limit exceeded */
  handler?: (req: Request, res: Response) => void;
}

/**
 * Default rate limit options
 */
const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  windowMs: 60000, // 1 minute
  max: 100,
  keyGenerator: (req: Request) => {
    // Use IP address as default key
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (_req: Request, res: Response) => {
    const error = new ApiError(
      ApiErrorCode.RATE_LIMIT_EXCEEDED,
      'Too many requests. Please try again later.',
      429,
      false
    );
    res.status(error.statusCode).json(error.toJSON());
  },
};

/**
 * Rate limiting middleware factory
 *
 * Creates middleware that limits the number of requests a client can make
 * within a specific time window. Exceeding the limit results in a 429 response.
 *
 * @param options - Rate limiting configuration options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Limit to 10 requests per minute
 * router.post('/webhook/auto-suspend',
 *   rateLimit({ windowMs: 60000, max: 10 }),
 *   autoSuspendWebhook
 * );
 *
 * // Stricter limit for sensitive endpoints
 * router.post('/api/sensitive',
 *   rateLimit({ windowMs: 300000, max: 5 }),
 *   handler
 * );
 *
 * // Custom key generator (e.g., by API key)
 * router.post('/api/webhook',
 *   rateLimit({
 *     keyGenerator: (req) => {
 *       const apiKey = req.headers['x-api-key'];
 *       return typeof apiKey === 'string' ? apiKey : req.ip || 'unknown';
 *     }
 *   }),
 *   handler
 * );
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const opts: Required<RateLimitOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Generate key for this client
    const key = opts.keyGenerator(req);

    const now = Date.now();
    const windowStart = now - (now % opts.windowMs);

    // Get or create rate limit record
    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      // Create new record for this window
      record = {
        count: 0,
        resetTime: windowStart + opts.windowMs,
        windowStart,
      };
      rateLimitStore.set(key, record);
    }

    // Check if we should skip this request
    const statusCode = res.statusCode;
    if (opts.skipSuccessfulRequests && statusCode >= 200 && statusCode < 300) {
      return next();
    }
    if (opts.skipFailedRequests && (statusCode < 200 || statusCode >= 300)) {
      return next();
    }

    // Check if limit exceeded
    if (record.count >= opts.max) {
      // Calculate retry-after time
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      console.warn(
        `[RateLimit] Rate limit exceeded for ${key}: ${record.count}/${opts.max} in ${opts.windowMs}ms window`
      );

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', opts.max.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
      res.setHeader('Retry-After', retryAfter.toString());

      // Call custom handler or default handler
      return opts.handler(req, res);
    }

    // Increment counter
    record.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', opts.max.toString());
    res.setHeader('X-RateLimit-Remaining', (opts.max - record.count).toString());
    res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

    // Log rate limit status periodically
    if (record.count % 10 === 0) {
      console.log(
        `[RateLimit] ${key}: ${record.count}/${opts.max} requests in current window`
      );
    }

    next();
  };
}

/**
 * Extend Express Request to include monitoring source
 * (Must match declaration in monitoring-auth.middleware.ts)
 */
declare global {
  namespace Express {
    interface Request {
      monitoringSource?: string;
    }
  }
}

/**
 * Rate limit preset for monitoring webhooks
 *
 * Stricter limits for webhook endpoints to prevent abuse:
 * - 10 requests per minute
 * - Identifies clients by IP address
 *
 * @example
 * ```typescript
 * import { monitoringWebhookRateLimit } from '@/api/middleware/rate-limit.middleware.js';
 *
 * router.post('/webhook/auto-suspend',
 *   monitoringWebhookRateLimit,
 *   autoSuspendWebhook
 * );
 * ```
 */
export const monitoringWebhookRateLimit = rateLimit({
  windowMs: 60000, // 1 minute
  max: 10, // 10 requests per minute
  keyGenerator: (req: Request) => {
    // Use monitoring source if available, otherwise IP
    const source = req.monitoringSource || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `monitoring:${source}:${ip}`;
  },
});

/**
 * Rate limit preset for API endpoints
 *
 * Standard limits for general API usage:
 * - 100 requests per minute
 * - Identifies clients by IP address
 *
 * @example
 * ```typescript
 * import { apiRateLimit } from '@/api/middleware/rate-limit.middleware.js';
 *
 * router.get('/api/jobs', apiRateLimit, jobsController);
 * ```
 */
export const apiRateLimit = rateLimit({
  windowMs: 60000, // 1 minute
  max: 100, // 100 requests per minute
});

/**
 * Rate limit preset for sensitive operations
 *
 * Very strict limits for operations like project suspension:
 * - 5 requests per 5 minutes
 * - Identifies clients by IP address
 *
 * @example
 * ```typescript
 * import { strictRateLimit } from '@/api/middleware/rate-limit.middleware.js';
 *
 * router.post('/api/projects/:id/suspend', strictRateLimit, suspendController);
 * ```
 */
export const strictRateLimit = rateLimit({
  windowMs: 300000, // 5 minutes
  max: 5, // 5 requests per 5 minutes
});
