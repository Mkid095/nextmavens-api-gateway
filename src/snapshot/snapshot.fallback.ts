/**
 * Snapshot Fallback Strategy Module
 *
 * Provides fallback mechanisms when snapshot is unavailable or stale.
 * Implements graceful degradation with configurable strategies.
 *
 * Strategies:
 * 1. FAIL_CLOSED - Deny all requests when snapshot unavailable (safest)
 * 2. USE_CACHED - Use cached snapshot even if expired (graceful degradation)
 * 3. FALLBACK_DB - Query database directly as last resort
 * 4. EMERGENCY_MODE - Allow limited operations with reduced functionality
 */

import type { SnapshotData } from '@/types/snapshot.types.js';

/**
 * Fallback strategy types
 */
export enum FallbackStrategy {
  /** Deny all requests - safest but disruptive */
  FAIL_CLOSED = 'fail_closed',

  /** Use cached snapshot even if expired - graceful degradation */
  USE_CACHED = 'use_cached',

  /** Query database directly - performance impact */
  FALLBACK_DB = 'fallback_db',

  /** Allow limited operations with reduced functionality */
  EMERGENCY_MODE = 'emergency_mode'
}

/**
 * Fallback configuration
 */
interface FallbackConfig {
  /** Primary fallback strategy */
  strategy: FallbackStrategy;

  /** Maximum age of cached data before considered stale (seconds) */
  maxStaleAge: number;

  /** Emergency mode: allow only read operations */
  emergencyReadOnly: boolean;

  /** Emergency mode: rate limit during fallback */
  emergencyRateLimit: number;

  /** Fallback to database: max concurrent queries */
  fallbackDbMaxConcurrency: number;
}

/**
 * Default fallback configuration
 */
const DEFAULT_CONFIG: FallbackConfig = {
  strategy: FallbackStrategy.USE_CACHED,
  maxStaleAge: 300, // 5 minutes
  emergencyReadOnly: true,
  emergencyRateLimit: 10, // 10 requests per minute
  fallbackDbMaxConcurrency: 5
};

/**
 * Fallback decision result
 */
export interface FallbackDecision {
  shouldAllowRequest: boolean;
  strategyUsed: FallbackStrategy;
  snapshot: {
    available: boolean;
    isStale: boolean;
    age: number;
  };
  warning?: string;
  error?: string;
}

/**
 * Snapshot Fallback Manager
 *
 * Manages fallback decisions when snapshot is unavailable or stale.
 */
export class SnapshotFallbackManager {
  private currentStrategy: FallbackStrategy;
  private emergencyModeActive = false;
  private fallbackDbConcurrency = 0;

  constructor(private readonly config: FallbackConfig = DEFAULT_CONFIG) {
    this.currentStrategy = config.strategy;
  }

  /**
   * Determine if request should be allowed based on snapshot state
   */
  evaluateRequest(snapshotAvailable: boolean, snapshotAge?: number): FallbackDecision {
    const decision: FallbackDecision = {
      shouldAllowRequest: false,
      strategyUsed: this.currentStrategy,
      snapshot: {
        available: snapshotAvailable,
        isStale: false,
        age: snapshotAge || 0
      }
    };

    // Snapshot is available and fresh
    if (snapshotAvailable && snapshotAge !== undefined && snapshotAge < this.config.maxStaleAge) {
      decision.shouldAllowRequest = true;
      decision.snapshot.isStale = false;
      return decision;
    }

    // Snapshot is stale or unavailable - use fallback strategy
    decision.snapshot.isStale = snapshotAge !== undefined && snapshotAge >= this.config.maxStaleAge;

    switch (this.currentStrategy) {
      case FallbackStrategy.FAIL_CLOSED:
        decision.shouldAllowRequest = false;
        decision.error = 'Snapshot unavailable - request denied';
        break;

      case FallbackStrategy.USE_CACHED:
        decision.shouldAllowRequest = true;
        decision.warning = snapshotAvailable
          ? 'Using stale cached snapshot'
          : 'No snapshot available';
        break;

      case FallbackStrategy.FALLBACK_DB:
        decision.shouldAllowRequest = this.canUseFallbackDb();
        if (!decision.shouldAllowRequest) {
          decision.error = 'Fallback database unavailable';
        } else {
          decision.warning = 'Using direct database query - performance degraded';
        }
        break;

      case FallbackStrategy.EMERGENCY_MODE:
        decision.shouldAllowRequest = true;
        decision.warning = 'Emergency mode: reduced functionality';
        break;
    }

    return decision;
  }

  /**
   * Check if fallback to database is available
   */
  private canUseFallbackDb(): boolean {
    return this.fallbackDbConcurrency < this.config.fallbackDbMaxConcurrency;
  }

  /**
   * Execute a function with fallback database connection
   */
  async withFallbackDb<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canUseFallbackDb()) {
      throw new Error('Fallback database at max concurrency');
    }

    this.fallbackDbConcurrency++;

    try {
      return await fn();
    } finally {
      this.fallbackDbConcurrency--;
    }
  }

  /**
   * Activate emergency mode
   */
  activateEmergencyMode(): void {
    this.emergencyModeActive = true;
    this.currentStrategy = FallbackStrategy.EMERGENCY_MODE;
    console.warn('[SnapshotFallback] Emergency mode activated');
  }

  /**
   * Deactivate emergency mode
   */
  deactivateEmergencyMode(): void {
    this.emergencyModeActive = false;
    this.currentStrategy = this.config.strategy;
    console.log('[SnapshotFallback] Emergency mode deactivated');
  }

  /**
   * Set fallback strategy
   */
  setStrategy(strategy: FallbackStrategy): void {
    this.currentStrategy = strategy;
    console.log(`[SnapshotFallback] Strategy changed to: ${strategy}`);
  }

  /**
   * Get current strategy
   */
  getStrategy(): FallbackStrategy {
    return this.currentStrategy;
  }

  /**
   * Get emergency mode status
   */
  isEmergencyMode(): boolean {
    return this.emergencyModeActive;
  }

  /**
   * Get fallback configuration
   */
  getConfig(): Readonly<FallbackConfig> {
    return this.config;
  }
}

/**
 * Cache entry with staleness tracking
 */
export interface StaleCacheEntry {
  snapshot: SnapshotData;
  fetchedAt: number;
  expiresAt: number;
  lastValidAt: number; // Last time this was known to be valid
}

/**
 * Stale-tolerant cache manager
 *
 * Extends normal caching to allow using stale data when fresh data unavailable
 */
export class StaleTolerantCache {
  private cache: Map<string, StaleCacheEntry> = new Map();

  /**
   * Get snapshot with staleness tolerance
   * Returns stale snapshot if fresh unavailable
   */
  get(key: string, maxStaleAge?: number): {
    snapshot: SnapshotData | null;
    isStale: boolean;
    age: number;
  } {
    const entry = this.cache.get(key);

    if (!entry) {
      return { snapshot: null, isStale: false, age: 0 };
    }

    const now = Date.now();
    const age = (now - entry.fetchedAt) / 1000;
    const isExpired = now > entry.expiresAt;

    if (!isExpired) {
      return { snapshot: entry.snapshot, isStale: false, age };
    }

    // Check if stale data is acceptable
    if (maxStaleAge !== undefined && age <= maxStaleAge) {
      return { snapshot: entry.snapshot, isStale: true, age };
    }

    return { snapshot: null, isStale: true, age };
  }

  /**
   * Set snapshot in cache
   */
  set(key: string, snapshot: SnapshotData, ttlSeconds: number): void {
    const now = Date.now();

    this.cache.set(key, {
      snapshot,
      fetchedAt: now,
      expiresAt: now + (ttlSeconds * 1000),
      lastValidAt: now
    });
  }

  /**
   * Clear cache entry
   */
  clear(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Get all cache entries
   */
  entries(): IterableIterator<[string, StaleCacheEntry]> {
    return this.cache.entries();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Fallback middleware factory
 * Creates Express middleware that applies fallback strategy
 */
export function createFallbackMiddleware(fallbackManager: SnapshotFallbackManager) {
  return (req: any, res: any, next: any) => {
    // Get snapshot availability from request locals (set by previous middleware)
    const snapshotAvailable = req.locals?.snapshotAvailable ?? true;
    const snapshotAge = req.locals?.snapshotAge;

    const decision = fallbackManager.evaluateRequest(snapshotAvailable, snapshotAge);

    // Attach decision to request for downstream handlers
    req.locals = req.locals || {};
    req.locals.fallbackDecision = decision;

    if (!decision.shouldAllowRequest) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        fallback: {
          strategy: decision.strategyUsed,
          reason: decision.error
        }
      });
    }

    // Add warning header if using fallback
    if (decision.warning) {
      res.setHeader('X-Snapshot-Fallback', decision.warning);
    }

    next();
  };
}

/**
 * Singleton instance
 */
let fallbackManagerInstance: SnapshotFallbackManager | null = null;

export function createSnapshotFallback(
  config?: Partial<FallbackConfig>
): SnapshotFallbackManager {
  if (fallbackManagerInstance) {
    return fallbackManagerInstance;
  }

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  fallbackManagerInstance = new SnapshotFallbackManager(finalConfig);

  return fallbackManagerInstance;
}

export function getSnapshotFallback(): SnapshotFallbackManager | null {
  return fallbackManagerInstance;
}
