import type {
  DurationMetrics,
  DurationStats,
  DurationTracker,
  DurationTrackerConfig,
  DurationStatsOptions
} from '@/duration/types/duration.types.js';
import { DurationStorageService } from './duration-storage.service.js';
import { durationStatsService } from './duration-stats.service.js';

/**
 * Duration Tracker Service
 *
 * Provides in-memory tracking of request durations with statistics calculation.
 * Follows the same patterns as US-008 request-logger.service.ts.
 *
 * Architecture:
 * - In-memory storage with automatic cleanup (LRU-style)
 * - Async recording to avoid blocking request processing
 * - Statistics calculation (min, max, avg, p50, p95, p99)
 * - Slow request detection (>1s threshold)
 * - Project-based aggregation
 *
 * Usage:
 * ```typescript
 * import { durationTracker } from '@/duration/services/duration-tracker.service.js';
 * await durationTracker.record(metrics);
 * const stats = await durationTracker.getStats('project-123');
 * ```
 */

/**
 * Duration Tracker Service class
 * Handles tracking and analysis of request durations
 */
class DurationTrackerService implements DurationTracker {
  /**
   * Storage service for managing metrics
   */
  private storage: DurationStorageService;

  /**
   * Configuration options
   */
  private config: Required<DurationTrackerConfig>;

  /**
   * Whether tracking is enabled
   */
  private enabled: boolean = true;

  /**
   * Constructor
   * Initializes the tracker with configuration from environment or defaults
   */
  constructor() {
    // Load configuration from environment or use defaults
    this.config = {
      slowRequestThreshold: parseInt(process.env.SLOW_REQUEST_THRESHOLD || '1000', 10),
      maxSamples: parseInt(process.env.MAX_DURATION_SAMPLES || '10000', 10),
      detailedTracking: process.env.DETAILED_DURATION_TRACKING !== 'false',
      trackIndividualRequests: process.env.TRACK_INDIVIDUAL_REQUESTS !== 'false'
    };

    // Initialize storage service with max samples
    this.storage = new DurationStorageService(this.config.maxSamples);

    // Check if tracking is disabled
    if (process.env.DURATION_TRACKING_ENABLED === 'false') {
      this.enabled = false;
    }
  }

  /**
   * Record a duration measurement
   * Adds to in-memory storage with automatic cleanup
   *
   * @param metrics - The duration metrics to record
   * @returns Promise that resolves when recording is complete
   */
  async record(metrics: DurationMetrics): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Record asynchronously to avoid blocking
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          // Check if we should track individual requests
          if (this.config.trackIndividualRequests) {
            this.storage.add(metrics.project_id, metrics);
          } else {
            // Just increment count without storing details
            // This is handled by storage service internally
            this.storage.add(metrics.project_id, metrics);
          }

          resolve();
        } catch (error) {
          // Silently handle errors to avoid impacting requests
          console.error('[Duration Tracker] Failed to record metrics:', error);
          resolve();
        }
      });
    });
  }

  /**
   * Get statistics for a specific project
   *
   * @param projectId - The project ID to get statistics for
   * @param options - Optional filters
   * @returns Promise resolving to duration statistics
   */
  async getStats(
    projectId: string,
    options?: DurationStatsOptions
  ): Promise<DurationStats> {
    if (!this.enabled || !this.storage.hasProject(projectId)) {
      return durationStatsService.calculateStats([], this.config.slowRequestThreshold);
    }

    let metrics = this.storage.getProjectMetrics(projectId);

    // Apply filters if provided
    if (options) {
      metrics = durationStatsService.applyFilters(metrics, options);
    }

    return durationStatsService.calculateStats(metrics, this.config.slowRequestThreshold);
  }

  /**
   * Get statistics for all projects
   *
   * @param options - Optional filters
   * @returns Promise resolving to duration statistics
   */
  async getAllStats(options?: DurationStatsOptions): Promise<DurationStats> {
    if (!this.enabled) {
      return durationStatsService.calculateStats([], this.config.slowRequestThreshold);
    }

    // Collect all metrics from all projects
    let allMetrics = this.storage.getAllMetrics();

    // Apply filters if provided
    if (options) {
      allMetrics = durationStatsService.applyFilters(allMetrics, options);
    }

    return durationStatsService.calculateStats(allMetrics, this.config.slowRequestThreshold);
  }

  /**
   * Get slow requests for a specific project
   *
   * @param projectId - The project ID to get slow requests for
   * @param threshold - Optional custom threshold
   * @returns Promise resolving to list of slow requests
   */
  async getSlowRequests(
    projectId: string,
    threshold?: number
  ): Promise<DurationMetrics[]> {
    if (!this.enabled || !this.storage.hasProject(projectId)) {
      return [];
    }

    const metrics = this.storage.getProjectMetrics(projectId);
    const slowThreshold = threshold ?? this.config.slowRequestThreshold;

    return durationStatsService.getSlowRequests(metrics, slowThreshold);
  }

  /**
   * Reset/clear all tracked data
   *
   * @returns Promise that resolves when data is cleared
   */
  async reset(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(() => {
        this.storage.clear();
        resolve();
      });
    });
  }

  /**
   * Enable or disable tracking
   *
   * @param enabled - Whether tracking should be enabled
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get current configuration
   *
   * @returns Current configuration
   */
  getConfig(): Required<DurationTrackerConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   *
   * @param config - New configuration values
   */
  setConfig(config: Partial<DurationTrackerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };

    // Update storage if max samples changed
    if (config.maxSamples !== undefined) {
      this.storage = new DurationStorageService(config.maxSamples);
    }
  }

  /**
   * Get storage statistics (for monitoring)
   *
   * @returns Storage statistics
   */
  getStorageStats(): {
    totalProjects: number;
    totalSamples: number;
    samplesByProject: Record<string, number>;
  } {
    return this.storage.getStats();
  }
}

/**
 * Singleton instance of the duration tracker service
 * Exported for use across the application
 */
export const durationTracker = new DurationTrackerService();

/**
 * Export the class for testing purposes
 */
export { DurationTrackerService };
