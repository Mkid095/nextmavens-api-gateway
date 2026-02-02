import type { SnapshotFetcher } from './snapshot.fetcher.js';
import type { SnapshotCacheManager } from './snapshot.cache.js';
import type {
  SnapshotMonitoringService,
  SnapshotFetchEvent
} from './snapshot.monitoring.js';

/**
 * Snapshot refresh manager
 * Handles background refresh of snapshot data with monitoring integration
 */
export class SnapshotRefreshManager {
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  constructor(
    private readonly fetcher: SnapshotFetcher,
    private readonly cache: SnapshotCacheManager,
    private readonly cacheTTLSeconds: number,
    private readonly monitoring?: SnapshotMonitoringService
  ) {}

  /**
   * Start background refresh interval
   */
  start(refreshIntervalSeconds: number): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    console.log(
      `[SnapshotRefresh] Starting background refresh - ` +
      `Interval: ${refreshIntervalSeconds}s`
    );

    this.refreshTimer = setInterval(
      async () => {
        await this.performRefresh();
      },
      refreshIntervalSeconds * 1000
    );
  }

  /**
   * Stop background refresh interval
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log('[SnapshotRefresh] Background refresh stopped');
    }
  }

  /**
   * Perform background refresh with monitoring
   */
  private async performRefresh(): Promise<void> {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      console.log('[SnapshotRefresh] Refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;
    const startTime = Date.now();
    let success = false;
    let snapshotVersion: number | null = null;
    let error: string | undefined;

    try {
      console.log('[SnapshotRefresh] Fetching snapshot from control plane...');

      const snapshotData = await this.fetcher.fetchSnapshot();

      // Update cache
      const wasCacheHit = this.cache.updateCache(snapshotData, this.cacheTTLSeconds);

      snapshotVersion = snapshotData.version;

      console.log(
        `[SnapshotRefresh] Snapshot refreshed successfully - Version: ${snapshotData.version}, ` +
        `Projects: ${Object.keys(snapshotData.projects).length}, ` +
        `Services: ${Object.keys(snapshotData.services).length}`
      );

      success = true;

      // Record successful fetch in monitoring
      if (this.monitoring) {
        this.monitoring.recordFetch({
          timestamp: Date.now(),
          success: true,
          responseTimeMs: Date.now() - startTime,
          cacheHit: wasCacheHit,
          version: snapshotVersion
        });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error('[SnapshotRefresh] Background refresh failed:', error);

      // Record failed fetch in monitoring
      if (this.monitoring) {
        this.monitoring.recordFetch({
          timestamp: Date.now(),
          success: false,
          responseTimeMs: Date.now() - startTime,
          cacheHit: false,
          version: null,
          error
        });
      }

      // Don't throw - keep using cached data if available
      // Background refresh failures are logged but don't crash the service
    } finally {
      this.isRefreshing = false;

      // Log health status if monitoring is enabled
      if (this.monitoring) {
        const health = this.monitoring.generateHealthReport();
        if (health.status !== 'healthy') {
          console.warn(
            `[SnapshotRefresh] Health status: ${health.status.toUpperCase()} - ` +
            `Issues: ${health.issues.join(', ')}`
          );
        }
      }
    }
  }

  /**
   * Check if refresh is currently in progress
   */
  isRefreshingInProgress(): boolean {
    return this.isRefreshing;
  }

  /**
   * Get current health report (if monitoring is enabled)
   */
  getHealthReport() {
    if (!this.monitoring) {
      return {
        status: 'unknown',
        message: 'Monitoring not enabled'
      };
    }

    return this.monitoring.generateHealthReport();
  }

  /**
   * Get current metrics (if monitoring is enabled)
   */
  getMetrics() {
    if (!this.monitoring) {
      return {};
    }

    return this.monitoring.getMetrics();
  }
}
