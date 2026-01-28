import axios, { AxiosError } from 'axios';
import {
  SnapshotData,
  SnapshotResponse,
  SnapshotCacheEntry,
  ProjectConfig,
  ServiceConfig,
  RateLimitConfig,
  ProjectStatus
} from '../types/snapshot.types.js';

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
 * Snapshot service error types
 */
export class SnapshotFetchError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'SnapshotFetchError';
  }
}

export class SnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotUnavailableError';
  }
}

/**
 * Snapshot service manages fetching, caching, and refreshing of configuration snapshots
 */
export class SnapshotService {
  private cache: SnapshotCacheEntry | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isFetching = false;
  private lastFetchAttempt = 0;
  private fetchFailures = 0;

  constructor(private readonly config: SnapshotServiceConfig) {}

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
    if (!this.cache) {
      throw new SnapshotUnavailableError('No snapshot available');
    }

    const now = Date.now();
    if (now > this.cache.expiresAt) {
      throw new SnapshotUnavailableError('Snapshot expired');
    }

    return this.cache.data;
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
    // Prevent concurrent fetches
    if (this.isFetching) {
      console.log('[SnapshotService] Fetch already in progress, skipping');
      return;
    }

    this.isFetching = true;
    this.lastFetchAttempt = Date.now();

    try {
      console.log('[SnapshotService] Fetching snapshot from control plane...');

      const response = await axios.get<SnapshotResponse>(
        this.config.snapshotApiUrl,
        {
          timeout: this.config.requestTimeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'nextmavens-gateway/1.0.0'
          }
        }
      );

      if (!response.data.success) {
        throw new SnapshotFetchError(
          `Snapshot API returned error: ${response.data.error}`
        );
      }

      if (!response.data.data) {
        throw new SnapshotFetchError('Snapshot API returned no data');
      }

      // Validate snapshot data structure
      this.validateSnapshotData(response.data.data);

      // Update cache
      const now = Date.now();
      this.cache = {
        data: response.data.data,
        fetchedAt: now,
        expiresAt: now + (this.config.cacheTTLSeconds * 1000),
        version: response.data.data.version
      };

      // Reset failure counter on success
      this.fetchFailures = 0;

      console.log(
        `[SnapshotService] Snapshot fetched successfully - Version: ${this.cache.version}, ` +
        `Projects: ${Object.keys(this.cache.data.projects).length}, ` +
        `Services: ${Object.keys(this.cache.data.services).length}`
      );
    } catch (error) {
      this.fetchFailures++;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        throw new SnapshotFetchError(
          `Failed to fetch snapshot: ${axiosError.message}`,
          axiosError
        );
      }

      throw error;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Validate snapshot data structure
   * Throws error if data is invalid
   */
  private validateSnapshotData(data: SnapshotData): void {
    if (!data) {
      throw new SnapshotFetchError('Snapshot data is null or undefined');
    }

    if (typeof data.version !== 'number' || data.version < 0) {
      throw new SnapshotFetchError('Invalid snapshot version');
    }

    if (!data.projects || typeof data.projects !== 'object') {
      throw new SnapshotFetchError('Invalid projects data in snapshot');
    }

    if (!data.services || typeof data.services !== 'object') {
      throw new SnapshotFetchError('Invalid services data in snapshot');
    }

    if (!data.rateLimits || typeof data.rateLimits !== 'object') {
      throw new SnapshotFetchError('Invalid rate limits data in snapshot');
    }
  }

  /**
   * Start background refresh interval
   */
  private startBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    console.log(
      `[SnapshotService] Starting background refresh - ` +
      `Interval: ${this.config.refreshIntervalSeconds}s`
    );

    this.refreshTimer = setInterval(
      async () => {
        try {
          await this.fetchSnapshot();
        } catch (error) {
          console.error('[SnapshotService] Background refresh failed:', error);
          // Don't throw - keep using cached data if available
          // Background refresh failures are logged but don't crash the service
        }
      },
      this.config.refreshIntervalSeconds * 1000
    );
  }

  /**
   * Stop background refresh interval
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log('[SnapshotService] Background refresh stopped');
    }
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
    const now = Date.now();
    return {
      hasCachedData: this.cache !== null,
      version: this.cache?.version || null,
      fetchedAt: this.cache?.fetchedAt || null,
      expiresAt: this.cache?.expiresAt || null,
      isExpired: this.cache ? now > this.cache.expiresAt : true,
      fetchFailures: this.fetchFailures,
      lastFetchAttempt: this.lastFetchAttempt
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
