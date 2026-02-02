import type {
  SnapshotData,
  ProjectConfig,
  ServiceConfig,
  RateLimitConfig
} from '@/types/snapshot.types.js';
import { ProjectStatus } from '@/types/snapshot.types.js';
import { SnapshotCacheManager } from './snapshot.cache.js';
import { SnapshotFetcher } from './snapshot.fetcher.js';
import { SnapshotRefreshManager } from './snapshot.refresh.js';
import {
  createSnapshotMonitoring,
  getSnapshotMonitoring,
  type SnapshotHealthReport
} from './snapshot.monitoring.js';
import {
  createSnapshotFallback,
  getSnapshotFallback,
  FallbackStrategy,
  type FallbackDecision,
  type StaleCacheEntry
} from './snapshot.fallback.js';

/**
 * Snapshot service unavailable error
 */
export class SnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotUnavailableError';
  }
}

/**
 * Snapshot service configuration
 */
interface SnapshotServiceConfig {
  snapshotApiUrl: string;
  projectId: string;
  cacheTTLSeconds: number;
  refreshIntervalSeconds: number;
  requestTimeoutMs: number;
}

/**
 * Snapshot service manages fetching, caching, and refreshing of configuration snapshots
 *
 * This service has been refactored into smaller, focused modules:
 * - SnapshotCacheManager: Handles caching and expiration
 * - SnapshotFetcher: Handles fetching from control plane API
 * - SnapshotRefreshManager: Handles background refresh logic
 */
export class SnapshotService {
  private cache: SnapshotCacheManager;
  private fetcher: SnapshotFetcher;
  private refreshManager: SnapshotRefreshManager;
  private fallbackManager: ReturnType<typeof createSnapshotFallback>;

  constructor(private readonly config: SnapshotServiceConfig) {
    this.cache = new SnapshotCacheManager();
    this.fetcher = new SnapshotFetcher({
      snapshotApiUrl: config.snapshotApiUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      projectId: config.projectId
    });

    // Create monitoring service
    const monitoring = createSnapshotMonitoring({
      onHealthChange: (status, report) => {
        console.log(`[SnapshotService] Health status changed to: ${status}`);
        if (status !== 'healthy') {
          console.warn(`[SnapshotService] Health issues:`, report.issues.join(', '));
        }
      },
      onFetchFailure: (error) => {
        console.error(`[SnapshotService] Fetch failure detected:`, error);
      },
      onStaleSnapshot: (age) => {
        console.warn(`[SnapshotService] Stale snapshot detected: ${age.toFixed(0)}s old`);
        // Activate fallback if stale
        const fallback = getSnapshotFallback();
        if (fallback && age > 120) { // 2 minutes
          fallback.activateEmergencyMode();
        }
      }
    });

    // Create fallback manager
    this.fallbackManager = createSnapshotFallback({
      strategy: FallbackStrategy.USE_CACHED,
      maxStaleAge: 300 // 5 minutes
    });

    this.refreshManager = new SnapshotRefreshManager(
      this.fetcher,
      this.cache,
      config.cacheTTLSeconds,
      monitoring
    );
  }

  /**
   * Initialize the snapshot service
   * Fetches initial snapshot and starts background refresh
   */
  async initialize(): Promise<void> {
    console.log('[SnapshotService] Initializing snapshot service...');

    try {
      await this.fetchSnapshot();
      console.log('[SnapshotService] Initial snapshot loaded successfully');
      this.startBackgroundRefresh();
    } catch (error) {
      console.error('[SnapshotService] Failed to load initial snapshot:', error);
      // Fail closed - don't start the service if initial fetch fails
      throw new SnapshotUnavailableError(
        'Failed to load initial snapshot. Gateway cannot start without snapshot.'
      );
    }
  }

  /**
   * Get the current snapshot data with fallback support
   * Returns cached data if available, with fallback for stale data
   * Throws SnapshotUnavailableError only if all fallbacks exhausted
   */
  getSnapshot(): SnapshotData {
    const snapshot = this.cache.getSnapshot();

    if (!snapshot) {
      // Try fallback strategy
      const fallbackDecision = this.fallbackManager.evaluateRequest(false);

      if (!fallbackDecision.shouldAllowRequest) {
        throw new SnapshotUnavailableError(
          'No snapshot available and fallback denied'
        );
      }

      // If we get here, fallback allowed but no data
      // This shouldn't happen with USE_CACHED strategy
      throw new SnapshotUnavailableError('No snapshot available');
    }

    // Check if snapshot is stale and apply fallback
    const cacheStats = this.cache.getCacheStats();
    if (cacheStats.isExpired) {
      const snapshotAge = cacheStats.fetchedAt
        ? (Date.now() - cacheStats.fetchedAt) / 1000
        : 0;

      const fallbackDecision = this.fallbackManager.evaluateRequest(true, snapshotAge);

      if (!fallbackDecision.shouldAllowRequest) {
        throw new SnapshotUnavailableError(
          'Snapshot expired and fallback denied'
        );
      }

      // Log warning about using stale data
      console.warn(
        `[SnapshotService] Using ${snapshotAge.toFixed(0)}s old snapshot ` +
        `(strategy: ${fallbackDecision.strategyUsed})`
      );
    }

    return snapshot;
  }

  /**
   * Get project configuration by project ID
   * Returns null if project not found
   */
  getProject(projectId: string): ProjectConfig | null {
    try {
      const snapshot = this.getSnapshot();
      return snapshot.projects[projectId] || null;
    } catch (error) {
      console.error('[SnapshotService] Error getting project:', error);
      return null;
    }
  }

  /**
   * Get service configuration by service name
   * Returns null if service not found
   */
  getService(serviceName: string): ServiceConfig | null {
    try {
      const snapshot = this.getSnapshot();
      return snapshot.services[serviceName] || null;
    } catch (error) {
      console.error('[SnapshotService] Error getting service:', error);
      return null;
    }
  }

  /**
   * Get rate limit configuration for a project
   * Returns null if project not found
   */
  getRateLimit(projectId: string): RateLimitConfig | null {
    try {
      const snapshot = this.getSnapshot();
      return snapshot.rateLimits[projectId] || null;
    } catch (error) {
      console.error('[SnapshotService] Error getting rate limit:', error);
      return null;
    }
  }

  /**
   * Check if a project is active
   * Returns false if project is suspended, archived, deleted, or not found
   */
  isProjectActive(projectId: string): boolean {
    const project = this.getProject(projectId);
    if (!project) {
      return false;
    }
    return project.status === ProjectStatus.ACTIVE;
  }

  /**
   * Check if a service is enabled for a project
   */
  isServiceEnabled(projectId: string, serviceName: string): boolean {
    const project = this.getProject(projectId);
    if (!project) {
      return false;
    }
    return project.enabledServices.includes(serviceName);
  }

  /**
   * Fetch a new snapshot from the control plane API
   */
  private async fetchSnapshot(): Promise<void> {
    const snapshotData = await this.fetcher.fetchSnapshot();
    this.cache.updateCache(snapshotData, this.config.cacheTTLSeconds);
  }

  /**
   * Start background refresh interval
   */
  private startBackgroundRefresh(): void {
    this.refreshManager.start(this.config.refreshIntervalSeconds);
  }

  /**
   * Stop background refresh interval
   */
  stop(): void {
    this.refreshManager.stop();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    hasCachedData: boolean;
    version: number | null;
    fetchedAt: number | null;
    expiresAt: number | null;
    isExpired: boolean;
    fetchFailures: number;
    lastFetchAttempt: number;
  } {
    const cacheStats = this.cache.getCacheStats();
    const fetchStats = this.fetcher.getFetchStats();

    return {
      ...cacheStats,
      fetchFailures: fetchStats.fetchFailures,
      lastFetchAttempt: fetchStats.lastFetchAttempt
    };
  }

  /**
   * Get health report for monitoring
   */
  getHealthReport(): SnapshotHealthReport | { status: string; message: string } {
    return this.refreshManager.getHealthReport();
  }

  /**
   * Get monitoring metrics
   */
  getMonitoringMetrics(): Record<string, number | string> {
    return this.refreshManager.getMetrics();
  }

  /**
   * Get current fallback decision for monitoring
   */
  getFallbackDecision(): FallbackDecision {
    const cacheStats = this.cache.getCacheStats();
    const snapshotAvailable = cacheStats.hasCachedData;
    const snapshotAge = cacheStats.fetchedAt
      ? (Date.now() - cacheStats.fetchedAt) / 1000
      : undefined;

    return this.fallbackManager.evaluateRequest(snapshotAvailable, snapshotAge);
  }

  /**
   * Manually activate emergency mode
   */
  activateEmergencyMode(): void {
    this.fallbackManager.activateEmergencyMode();
  }

  /**
   * Manually deactivate emergency mode
   */
  deactivateEmergencyMode(): void {
    this.fallbackManager.deactivateEmergencyMode();
  }
}

/**
 * Create a singleton instance of the snapshot service
 */
let snapshotServiceInstance: SnapshotService | null = null;

export function createSnapshotService(
  config?: Partial<SnapshotServiceConfig>
): SnapshotService {
  if (snapshotServiceInstance) {
    return snapshotServiceInstance;
  }

  const defaultConfig: SnapshotServiceConfig = {
    snapshotApiUrl: process.env.SNAPSHOT_API_URL || 'http://localhost:3000/api/internal/snapshot',
    projectId: process.env.PROJECT_ID || '',
    cacheTTLSeconds: parseInt(process.env.SNAPSHOT_CACHE_TTL || '30', 10),
    refreshIntervalSeconds: parseInt(process.env.SNAPSHOT_REFRESH_INTERVAL || '25', 10),
    requestTimeoutMs: parseInt(process.env.SNAPSHOT_REQUEST_TIMEOUT || '5000', 10)
  };

  if (!defaultConfig.projectId) {
    throw new Error('PROJECT_ID environment variable is required for snapshot service');
  }

  const finalConfig = { ...defaultConfig, ...config };
  snapshotServiceInstance = new SnapshotService(finalConfig);

  return snapshotServiceInstance;
}

export function getSnapshotService(): SnapshotService | null {
  return snapshotServiceInstance;
}
