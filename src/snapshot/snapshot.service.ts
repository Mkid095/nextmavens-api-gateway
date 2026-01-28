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

  constructor(private readonly config: SnapshotServiceConfig) {
    this.cache = new SnapshotCacheManager();
    this.fetcher = new SnapshotFetcher({
      snapshotApiUrl: config.snapshotApiUrl,
      requestTimeoutMs: config.requestTimeoutMs
    });
    this.refreshManager = new SnapshotRefreshManager(
      this.fetcher,
      this.cache,
      config.cacheTTLSeconds
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
   * Get the current snapshot data
   * Returns cached data if available and not expired
   * Throws SnapshotUnavailableError if no snapshot is available
   */
  getSnapshot(): SnapshotData {
    const snapshot = this.cache.getSnapshot();

    if (!snapshot) {
      throw new SnapshotUnavailableError('No snapshot available');
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
    snapshotApiUrl: process.env.SNAPSHOT_API_URL || 'http://localhost:4000/api/snapshot',
    cacheTTLSeconds: parseInt(process.env.SNAPSHOT_CACHE_TTL || '30', 10),
    refreshIntervalSeconds: parseInt(process.env.SNAPSHOT_REFRESH_INTERVAL || '25', 10),
    requestTimeoutMs: parseInt(process.env.SNAPSHOT_REQUEST_TIMEOUT || '5000', 10)
  };

  const finalConfig = { ...defaultConfig, ...config };
  snapshotServiceInstance = new SnapshotService(finalConfig);

  return snapshotServiceInstance;
}

export function getSnapshotService(): SnapshotService | null {
  return snapshotServiceInstance;
}
