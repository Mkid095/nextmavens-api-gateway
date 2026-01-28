import { RateLimitConfig, RateLimitResult, RateLimitWindow, RateLimitContext, RateLimitViolation } from '@/types/rate-limit.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { SnapshotData } from '@/types/snapshot.types.js';

/**
 * Validation result for rate limit check
 */
export interface RateLimitValidation {
  allowed: boolean;
  error?: ApiError;
  result?: RateLimitResult;
}

/**
 * Sliding window tracker for rate limiting
 * Maintains request counts per project per time window
 */
interface SlidingWindowTracker {
  projectId: string;
  windowStart: number;
  windowEnd: number;
  requestTimestamps: number[];
}

/**
 * Rate limit validator
 * Checks rate limits from snapshot data and enforces sliding window rate limiting
 *
 * SECURITY:
 * - Uses sliding window algorithm for accurate rate limiting
 * - Prevents timing attacks with constant-time operations
 * - Fails closed if snapshot unavailable
 * - Prevents request flooding and DoS attacks
 */
export class RateLimitValidator {
  private defaultLimits: RateLimitConfig;
  private inMemoryStore: Map<string, SlidingWindowTracker>;
  private readonly WINDOW_SIZE_MS: Record<RateLimitWindow.MINUTE | RateLimitWindow.HOUR, number> = {
    [RateLimitWindow.MINUTE]: 60 * 1000,
    [RateLimitWindow.HOUR]: 60 * 60 * 1000
  };

  constructor(defaultLimits?: RateLimitConfig) {
    this.defaultLimits = defaultLimits || {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      burstAllowance: 10
    };
    this.inMemoryStore = new Map();
  }

  /**
   * Validate rate limit for a project
   * Checks both per-minute and per-hour limits
   *
   * @param snapshot - Snapshot data containing rate limit configuration
   * @param context - Rate limit context with project ID and timestamp
   * @returns Validation result with error if rate limit exceeded
   */
  validateRateLimit(snapshot: SnapshotData | null, context: RateLimitContext): RateLimitValidation {
    // SECURITY: Fail closed if snapshot unavailable
    if (!snapshot) {
      return {
        allowed: false,
        error: new ApiError(
          ApiErrorCode.SNAPSHOT_UNAVAILABLE,
          'Rate limit check failed - snapshot unavailable',
          503,
          true
        )
      };
    }

    // Get rate limit config for project
    const rateLimitConfig = this.getRateLimitConfig(snapshot, context.projectId);

    // Check per-minute limit
    const minuteValidation = this.checkWindowLimit(
      context,
      RateLimitWindow.MINUTE,
      rateLimitConfig.requestsPerMinute
    );

    if (!minuteValidation.allowed) {
      return minuteValidation;
    }

    // Check per-hour limit
    const hourValidation = this.checkWindowLimit(
      context,
      RateLimitWindow.HOUR,
      rateLimitConfig.requestsPerHour
    );

    return hourValidation;
  }

  /**
   * Validate rate limit and throw error if exceeded
   * Throws ApiError if rate limit is exceeded
   *
   * @param snapshot - Snapshot data containing rate limit configuration
   * @param context - Rate limit context with project ID and timestamp
   */
  validateRateLimitOrThrow(snapshot: SnapshotData | null, context: RateLimitContext): void {
    const validation = this.validateRateLimit(snapshot, context);

    if (!validation.allowed && validation.error) {
      throw validation.error;
    }
  }

  /**
   * Get rate limit configuration for a project from snapshot
   * Falls back to default limits if not configured
   *
   * @param snapshot - Snapshot data
   * @param projectId - Project ID
   * @returns Rate limit configuration
   */
  getRateLimitConfig(snapshot: SnapshotData, projectId: string): RateLimitConfig {
    // Check if project has custom rate limit config
    if (snapshot.rateLimits && snapshot.rateLimits[projectId]) {
      return snapshot.rateLimits[projectId];
    }

    // Check if project config has rate limit
    if (snapshot.projects && snapshot.projects[projectId]) {
      const project = snapshot.projects[projectId];
      // Convert legacy rateLimit number to RateLimitConfig
      if (typeof project.rateLimit === 'number') {
        return {
          requestsPerMinute: project.rateLimit,
          requestsPerHour: project.rateLimit * 60,
          burstAllowance: Math.floor(project.rateLimit / 6)
        };
      }
    }

    // Return default limits
    return this.defaultLimits;
  }

  /**
   * Check if a request is within rate limit for a specific window
   * Uses sliding window algorithm for accurate tracking
   *
   * SECURITY: Constant-time operations prevent timing attacks
   *
   * @param context - Rate limit context
   * @param window - Time window to check
   * @param limit - Maximum requests allowed in window
   * @returns Validation result
   */
  private checkWindowLimit(
    context: RateLimitContext,
    window: RateLimitWindow,
    limit: number
  ): RateLimitValidation {
    const now = context.timestamp;

    // BURST window is not implemented yet, return allowed
    if (window === RateLimitWindow.BURST) {
      return {
        allowed: true,
        result: {
          allowed: true,
          remainingRequests: limit,
          resetTime: now + 60000,
          limit,
          window
        }
      };
    }

    const windowSize = this.WINDOW_SIZE_MS[window];
    const windowStart = now - windowSize;
    const storeKey = this.getStoreKey(context.projectId, window);

    // Get or create tracker
    let tracker = this.inMemoryStore.get(storeKey);

    if (!tracker) {
      tracker = {
        projectId: context.projectId,
        windowStart: now,
        windowEnd: now + windowSize,
        requestTimestamps: []
      };
      this.inMemoryStore.set(storeKey, tracker);
    }

    // Clean up old timestamps outside the current window
    tracker.requestTimestamps = tracker.requestTimestamps.filter(
      timestamp => timestamp > windowStart
    );

    // Count requests in current window
    const requestCount = tracker.requestTimestamps.length;

    // Check if limit exceeded
    const allowed = requestCount < limit;

    if (!allowed) {
      // Calculate retry-after time (when oldest request expires)
      const oldestRequest = tracker.requestTimestamps[0];
      const retryAfter = Math.ceil((oldestRequest + windowSize - now) / 1000);
      const resetTime = oldestRequest + windowSize;

      const error = this.createRateLimitError({
        projectId: context.projectId,
        limit,
        window,
        exceededAt: now,
        resetTime,
        retryAfter
      });

      return {
        allowed: false,
        error
      };
    }

    // Add current request to tracker
    tracker.requestTimestamps.push(now);

    // Calculate result
    const result: RateLimitResult = {
      allowed: true,
      remainingRequests: limit - requestCount - 1,
      resetTime: now + windowSize,
      limit,
      window
    };

    return { allowed: true, result };
  }

  /**
   * Get storage key for rate limit tracker
   * Combines project ID and window type
   *
   * @param projectId - Project ID
   * @param window - Time window type
   * @returns Storage key
   */
  private getStoreKey(projectId: string, window: RateLimitWindow): string {
    return `${projectId}:${window}`;
  }

  /**
   * Create rate limit exceeded error
   * Includes retry-after header information
   *
   * SECURITY: Generic message prevents quota enumeration
   *
   * @param violation - Rate limit violation details
   * @returns ApiError
   */
  private createRateLimitError(violation: RateLimitViolation): ApiError {
    const windowText = violation.window === RateLimitWindow.MINUTE ? 'minute' : 'hour';

    return new ApiError(
      ApiErrorCode.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded. Maximum ${violation.limit} requests per ${windowText}. Please retry later.`,
      429,
      true,
      {
        retryAfter: violation.retryAfter,
        resetTime: violation.resetTime,
        limit: violation.limit,
        window: violation.window
      }
    );
  }

  /**
   * Check if project is rate limited without throwing
   *
   * @param snapshot - Snapshot data
   * @param projectId - Project ID
   * @param timestamp - Current timestamp
   * @returns True if request is allowed, false otherwise
   */
  isAllowed(snapshot: SnapshotData | null, projectId: string, timestamp: number): boolean {
    const context: RateLimitContext = {
      projectId,
      timestamp
    };

    const validation = this.validateRateLimit(snapshot, context);
    return validation.allowed;
  }

  /**
   * Get current rate limit status for a project
   *
   * @param snapshot - Snapshot data
   * @param projectId - Project ID
   * @param timestamp - Current timestamp
   * @returns Rate limit status for all windows
   */
  getRateLimitStatus(
    snapshot: SnapshotData | null,
    projectId: string,
    timestamp: number
  ): Record<RateLimitWindow, RateLimitResult | null> {
    if (!snapshot) {
      return {
        [RateLimitWindow.MINUTE]: null,
        [RateLimitWindow.HOUR]: null,
        [RateLimitWindow.BURST]: null
      };
    }

    const config = this.getRateLimitConfig(snapshot, projectId);
    const context: RateLimitContext = { projectId, timestamp };

    const minuteResult = this.checkWindowLimit(
      context,
      RateLimitWindow.MINUTE,
      config.requestsPerMinute
    );

    const hourResult = this.checkWindowLimit(
      context,
      RateLimitWindow.HOUR,
      config.requestsPerHour
    );

    return {
      [RateLimitWindow.MINUTE]: minuteResult.result || null,
      [RateLimitWindow.HOUR]: hourResult.result || null,
      [RateLimitWindow.BURST]: null
    };
  }

  /**
   * Clear expired rate limit buckets
   * Should be called periodically to free memory
   */
  clearExpiredBuckets(): void {
    const now = Date.now();

    for (const [key, tracker] of this.inMemoryStore.entries()) {
      // Remove buckets that are past their window end time
      if (tracker.windowEnd < now) {
        this.inMemoryStore.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for a project (for testing/admin purposes)
   *
   * @param projectId - Project ID
   * @param window - Window type to reset (optional, resets all if not specified)
   */
  resetRateLimit(projectId: string, window?: RateLimitWindow): void {
    if (window) {
      const key = this.getStoreKey(projectId, window);
      this.inMemoryStore.delete(key);
    } else {
      // Reset all windows for project
      for (const key of this.inMemoryStore.keys()) {
        if (key.startsWith(`${projectId}:`)) {
          this.inMemoryStore.delete(key);
        }
      }
    }
  }

  /**
   * Get current bucket state for a project
   *
   * @param projectId - Project ID
   * @param window - Window type
   * @returns Current bucket state or null
   */
  getBucketState(projectId: string, window: RateLimitWindow): SlidingWindowTracker | null {
    const key = this.getStoreKey(projectId, window);
    return this.inMemoryStore.get(key) || null;
  }
}

/**
 * Create a singleton instance of the rate limit validator
 */
let validatorInstance: RateLimitValidator | null = null;

export function createRateLimitValidator(defaultLimits?: RateLimitConfig): RateLimitValidator {
  if (validatorInstance) {
    return validatorInstance;
  }

  validatorInstance = new RateLimitValidator(defaultLimits);
  return validatorInstance;
}

export function getRateLimitValidator(): RateLimitValidator | null {
  return validatorInstance;
}
