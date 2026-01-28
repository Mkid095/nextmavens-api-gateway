import type { SnapshotFetcher } from './snapshot.fetcher.js';
import type { SnapshotCacheManager } from './snapshot.cache.js';

/**
 * Snapshot refresh manager
 * Handles background refresh of snapshot data
 */
export class SnapshotRefreshManager {
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  constructor(
    private readonly fetcher: SnapshotFetcher,
    private readonly cache: SnapshotCacheManager,
    private readonly cacheTTLSeconds: number
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
   * Perform background refresh
   */
  private async performRefresh(): Promise<void> {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      console.log('[SnapshotRefresh] Refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      console.log('[SnapshotRefresh] Fetching snapshot from control plane...');

      const snapshotData = await this.fetcher.fetchSnapshot();

      // Update cache
      this.cache.updateCache(snapshotData, this.cacheTTLSeconds);

      console.log(
        `[SnapshotRefresh] Snapshot refreshed successfully - Version: ${snapshotData.version}, ` +
        `Projects: ${Object.keys(snapshotData.projects).length}, ` +
        `Services: ${Object.keys(snapshotData.services).length}`
      );
    } catch (error) {
      console.error('[SnapshotRefresh] Background refresh failed:', error);
      // Don't throw - keep using cached data if available
      // Background refresh failures are logged but don't crash the service
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Check if refresh is currently in progress
   */
  isRefreshingInProgress(): boolean {
    return this.isRefreshing;
  }
}
