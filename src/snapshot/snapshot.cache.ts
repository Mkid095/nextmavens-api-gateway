import type {
  SnapshotData,
  SnapshotCacheEntry
} from '@/types/snapshot.types.js';

/**
 * Snapshot cache manager
 * Handles caching and expiration logic for snapshot data
 */
export class SnapshotCacheManager {
  private cache: SnapshotCacheEntry | null = null;

  /**
   * Get cached snapshot if available and not expired
   */
  getSnapshot(): SnapshotData | null {
    if (!this.cache) {
      return null;
    }

    const now = Date.now();
    if (now > this.cache.expiresAt) {
      return null;
    }

    return this.cache.data;
  }

  /**
   * Update cache with new snapshot data
   */
  updateCache(
    data: SnapshotData,
    cacheTTLSeconds: number
  ): void {
    const now = Date.now();
    this.cache = {
      data,
      fetchedAt: now,
      expiresAt: now + (cacheTTLSeconds * 1000),
      version: data.version
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache = null;
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
  } {
    const now = Date.now();
    return {
      hasCachedData: this.cache !== null,
      version: this.cache?.version || null,
      fetchedAt: this.cache?.fetchedAt || null,
      expiresAt: this.cache?.expiresAt || null,
      isExpired: this.cache ? now > this.cache.expiresAt : true
    };
  }

  /**
   * Check if cache has valid data
   */
  hasValidCache(): boolean {
    return this.getSnapshot() !== null;
  }
}
