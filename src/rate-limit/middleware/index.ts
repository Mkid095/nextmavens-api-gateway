/**
 * Rate limit middleware exports
 *
 * This module provides Express middleware for enforcing rate limits
 * based on snapshot configuration from the control plane API.
 *
 * Main middleware:
 * - enforceRateLimit: Enforce rate limits and return 429 when exceeded
 * - checkRateLimit: Check rate limit without blocking (for monitoring)
 * - skipRateLimit: Skip rate limiting for specific routes
 *
 * Helper modules:
 * - project-id-extractor: Extract and validate project ID from requests
 * - rate-limit-headers: Set standard rate limit headers on responses
 * - rate-limit.types: TypeScript types for rate limit middleware
 */

export {
  enforceRateLimit,
  checkRateLimit,
  skipRateLimit
} from './rate-limit.middleware.js';

export {
  RateLimitRequest,
  RateLimitHeaders
} from './rate-limit.types.js';

export {
  extractProjectId,
  extractCorrelationId,
  validateProjectIdFormat
} from './project-id-extractor.js';

export {
  formatRetryAfter,
  setRateLimitHeaders,
  createRateLimitHeaders
} from './rate-limit-headers.js';
