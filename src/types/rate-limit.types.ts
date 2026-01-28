/**
 * Rate limit configuration from snapshot
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  burstAllowance: number;
}

/**
 * Rate limit bucket for tracking requests
 * Used for sliding window rate limiting algorithm
 */
export interface RateLimitBucket {
  projectId: string;
  windowStart: number;
  windowEnd: number;
  requestCount: number;
  burstTokens: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
  retryAfter?: number;
  limit: number;
  window: RateLimitWindow;
}

/**
 * Rate limit window types
 */
export enum RateLimitWindow {
  MINUTE = 'MINUTE',
  HOUR = 'HOUR',
  BURST = 'BURST'
}

/**
 * Rate limit violation details
 */
export interface RateLimitViolation {
  projectId: string;
  limit: number;
  window: RateLimitWindow;
  exceededAt: number;
  resetTime: number;
  retryAfter: number;
}

/**
 * Rate limit metrics
 */
export interface RateLimitMetrics {
  totalChecks: number;
  allowedRequests: number;
  blockedRequests: number;
  currentUsage: Record<string, number>;
  averageRequestCount: number;
  peakRequestCount: number;
}

/**
 * Rate limit storage interface
 * For in-memory or distributed storage of rate limit buckets
 */
export interface RateLimitStorage {
  getBucket(projectId: string, window: RateLimitWindow): Promise<RateLimitBucket | null>;
  setBucket(projectId: string, window: RateLimitWindow, bucket: RateLimitBucket): Promise<void>;
  deleteBucket(projectId: string, window: RateLimitWindow): Promise<void>;
  clearExpiredBuckets(): Promise<void>;
}

/**
 * Rate limit options
 */
export interface RateLimitOptions {
  enabled: boolean;
  defaultLimits: RateLimitConfig;
  storage?: RateLimitStorage;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
}

/**
 * Rate limit context
 */
export interface RateLimitContext {
  projectId: string;
  timestamp: number;
  requestId?: string;
}

/**
 * Rate limit error details
 */
export interface RateLimitErrorDetails {
  projectId: string;
  limit: number;
  window: RateLimitWindow;
  resetTime: number;
  retryAfter: number;
  timestamp: number;
}
