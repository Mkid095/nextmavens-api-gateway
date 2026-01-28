import type { DurationMetrics } from '@/duration/types/duration.types.js';

/**
 * Duration Storage Service
 *
 * Handles in-memory storage of duration metrics with automatic cleanup.
 * Manages LRU-style eviction to prevent unbounded memory growth.
 *
 * Architecture:
 * - In-memory storage organized by project ID
 * - Automatic cleanup of old samples
 * - LRU eviction when limits are exceeded
 * - Async operations to avoid blocking
 */

/**
 * In-memory storage structure
 * Key: project ID, Value: metrics array and total count
 */
interface DurationStorage {
  [projectId: string]: {
    metrics: DurationMetrics[];
    totalCount: number;
  };
}

/**
 * Duration Storage Service class
 * Manages in-memory storage with cleanup and eviction
 */
class DurationStorageService {
  /**
   * In-memory storage for duration metrics
   */
  private storage: DurationStorage = {};

  /**
   * Maximum samples per project (LRU eviction)
   */
  private readonly maxSamplesPerProject: number = 1000;

  /**
   * Global maximum samples across all projects
   */
  private readonly maxSamplesGlobal: number;

  /**
   * Constructor
   *
   * @param maxSamplesGlobal - Global maximum samples (default: 10000)
   */
  constructor(maxSamplesGlobal: number = 10000) {
    this.maxSamplesGlobal = maxSamplesGlobal;
    this.startCleanupInterval();
  }

  /**
   * Start automatic cleanup interval
   * Runs every 5 minutes to remove old samples
   */
  private startCleanupInterval(): void {
    const cleanupInterval = 5 * 60 * 1000; // 5 minutes

    setInterval(() => {
      this.performCleanup();
    }, cleanupInterval).unref(); // Don't keep process alive
  }

  /**
   * Perform cleanup of old samples
   * Removes samples older than 1 hour
   */
  private performCleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const projectId in this.storage) {
      const projectData = this.storage[projectId];

      // Filter out old samples
      const oldLength = projectData.metrics.length;
      projectData.metrics = projectData.metrics.filter((metric) => {
        const metricTime = new Date(metric.timestamp).getTime();
        return now - metricTime < maxAge;
      });

      // Update total count
      if (projectData.metrics.length < oldLength) {
        projectData.totalCount = projectData.metrics.length;
      }

      // Remove project if empty
      if (projectData.metrics.length === 0) {
        delete this.storage[projectId];
      }

      // Enforce max samples per project
      if (projectData.metrics.length > this.maxSamplesPerProject) {
        projectData.metrics = projectData.metrics.slice(-this.maxSamplesPerProject);
        projectData.totalCount = projectData.metrics.length;
      }
    }

    // Enforce global max samples
    this.enforceGlobalMaxSamples();
  }

  /**
   * Enforce global maximum samples across all projects
   * Uses LRU eviction based on timestamp
   */
  private enforceGlobalMaxSamples(): void {
    let totalSamples = 0;

    // Count total samples
    for (const projectId in this.storage) {
      totalSamples += this.storage[projectId].metrics.length;
    }

    // If we're over the limit, remove oldest samples
    if (totalSamples > this.maxSamplesGlobal) {
      const allMetrics: Array<{ projectId: string; metric: DurationMetrics }> = [];

      // Collect all metrics with their project IDs
      for (const projectId in this.storage) {
        for (const metric of this.storage[projectId].metrics) {
          allMetrics.push({ projectId, metric });
        }
      }

      // Sort by timestamp (oldest first)
      allMetrics.sort((a, b) => {
        const timeA = new Date(a.metric.timestamp).getTime();
        const timeB = new Date(b.metric.timestamp).getTime();
        return timeA - timeB;
      });

      // Remove oldest samples
      const toRemove = totalSamples - this.maxSamplesGlobal;
      for (let i = 0; i < toRemove; i++) {
        const { projectId, metric } = allMetrics[i];
        const projectData = this.storage[projectId];

        // Remove this metric from project storage
        const index = projectData.metrics.findIndex((m) => m.request_id === metric.request_id);
        if (index !== -1) {
          projectData.metrics.splice(index, 1);
          projectData.totalCount--;
        }

        // Remove project if empty
        if (projectData.metrics.length === 0) {
          delete this.storage[projectId];
        }
      }
    }
  }

  /**
   * Add metrics to storage
   *
   * @param projectId - Project ID
   * @param metrics - Metrics to add
   */
  add(projectId: string, metrics: DurationMetrics): void {
    // Initialize project storage if needed
    if (!this.storage[projectId]) {
      this.storage[projectId] = {
        metrics: [],
        totalCount: 0
      };
    }

    // Add metrics to project storage
    this.storage[projectId].metrics.push(metrics);

    // Enforce max samples per project
    if (this.storage[projectId].metrics.length > this.maxSamplesPerProject) {
      this.storage[projectId].metrics.shift(); // Remove oldest
    }

    // Update total count
    this.storage[projectId].totalCount++;
  }

  /**
   * Get all metrics for a project
   *
   * @param projectId - Project ID
   * @returns Array of metrics
   */
  getProjectMetrics(projectId: string): DurationMetrics[] {
    return this.storage[projectId]?.metrics || [];
  }

  /**
   * Get all metrics from all projects
   *
   * @returns Array of all metrics
   */
  getAllMetrics(): DurationMetrics[] {
    const allMetrics: DurationMetrics[] = [];

    for (const projectId in this.storage) {
      allMetrics.push(...this.storage[projectId].metrics);
    }

    return allMetrics;
  }

  /**
   * Check if project has metrics
   *
   * @param projectId - Project ID
   * @returns True if project has metrics
   */
  hasProject(projectId: string): boolean {
    return !!this.storage[projectId] && this.storage[projectId].metrics.length > 0;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.storage = {};
  }

  /**
   * Get storage statistics
   *
   * @returns Storage statistics
   */
  getStats(): {
    totalProjects: number;
    totalSamples: number;
    samplesByProject: Record<string, number>;
  } {
    const samplesByProject: Record<string, number> = {};
    let totalSamples = 0;

    for (const projectId in this.storage) {
      const count = this.storage[projectId].metrics.length;
      samplesByProject[projectId] = count;
      totalSamples += count;
    }

    return {
      totalProjects: Object.keys(this.storage).length,
      totalSamples,
      samplesByProject
    };
  }
}

/**
 * Export the class for use by DurationTrackerService
 */
export { DurationStorageService };
