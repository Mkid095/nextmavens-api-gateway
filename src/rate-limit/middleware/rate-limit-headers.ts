import { Response } from 'express';
import { RateLimitWindow } from '@/types/rate-limit.types.js';
import { RateLimitHeaders } from './rate-limit.types.js';

/**
 * Format retry-after header value
 * Converts seconds to appropriate format for HTTP header
 *
 * @param retryAfterSeconds - Retry-after time in seconds
 * @returns Formatted retry-after value
 */
export function formatRetryAfter(retryAfterSeconds: number): number {
  // HTTP retry-after header expects seconds
  return Math.ceil(retryAfterSeconds);
}

/**
 * Calculate and set rate limit headers on response
 * Includes standard rate limit headers for client-side tracking
 *
 * @param res - Express response object
 * @param headers - Rate limit headers data
 */
export function setRateLimitHeaders(res: Response, headers: RateLimitHeaders): void {
  // Standard rate limit headers
  res.setHeader('X-RateLimit-Limit', headers.limit.toString());
  res.setHeader('X-RateLimit-Remaining', Math.max(0, headers.remaining).toString());
  res.setHeader('X-RateLimit-Reset', headers.reset.toString());
  res.setHeader('X-RateLimit-Window', headers.window);
}

/**
 * Create rate limit headers object
 *
 * @param limit - Rate limit threshold
 * @param remaining - Remaining requests in current window
 * @param reset - Unix timestamp when window resets
 * @param window - Rate limit window type
 * @returns Rate limit headers object
 */
export function createRateLimitHeaders(
  limit: number,
  remaining: number,
  reset: number,
  window: RateLimitWindow
): RateLimitHeaders {
  return {
    limit,
    remaining: Math.max(0, remaining),
    reset,
    window
  };
}
