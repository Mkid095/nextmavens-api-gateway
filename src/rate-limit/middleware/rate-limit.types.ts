import { Request } from 'express';
import { RateLimitWindow } from '@/types/rate-limit.types.js';

/**
 * Extended Request interface with rate limit data
 */
export interface RateLimitRequest extends Request {
  rateLimit?: {
    allowed: boolean;
    limit: number;
    remaining: number;
    reset: number;
    window: RateLimitWindow;
  };
  project?: {
    id: string;
    config: unknown;
  };
}

/**
 * Rate limit headers response data
 */
export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  reset: number;
  window: RateLimitWindow;
}
