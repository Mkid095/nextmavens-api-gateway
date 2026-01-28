import type { DurationMetrics, DurationStats, DurationStatsOptions } from '@/duration/types/duration.types.js';

/**
 * Duration Statistics Service
 *
 * Calculates statistics from duration metrics arrays.
 * Provides percentile calculations and aggregations.
 *
 * Architecture:
 * - Pure functions for statistics calculation
 * - Supports filtering by various criteria
 * - Calculates percentiles (p50, p95, p99)
 * - Identifies slow requests
 */

/**
 * Duration Statistics Service class
 * Handles statistics calculation and filtering
 */
class DurationStatsService {
  /**
   * Calculate statistics from metrics array
   *
   * @param metrics - Metrics to analyze
   * @param slowThreshold - Slow request threshold in ms (default: 1000)
   * @returns Duration statistics
   */
  calculateStats(metrics: DurationMetrics[], slowThreshold: number = 1000): DurationStats {
    if (metrics.length === 0) {
      return this.getEmptyStats();
    }

    const durations = metrics.map((m) => m.duration_ms);

    // Sort for percentile calculation
    durations.sort((a, b) => a - b);

    // Calculate basic stats
    const count = durations.length;
    const min = durations[0];
    const max = durations[durations.length - 1];
    const sum = durations.reduce((acc, val) => acc + val, 0);
    const avg = sum / count;

    // Calculate percentiles
    const p50 = this.calculatePercentile(durations, 50);
    const p95 = this.calculatePercentile(durations, 95);
    const p99 = this.calculatePercentile(durations, 99);

    // Calculate standard deviation
    const variance = durations.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / count;
    const std_dev = Math.sqrt(variance);

    // Count slow requests
    const slow_count = durations.filter((d) => d > slowThreshold).length;
    const slow_percentage = (slow_count / count) * 100;

    return {
      count,
      min,
      max,
      avg,
      p50,
      p95,
      p99,
      std_dev,
      slow_count,
      slow_percentage
    };
  }

  /**
   * Calculate percentile from sorted array
   *
   * @param sorted - Sorted array of durations
   * @param percentile - Percentile to calculate (0-100)
   * @returns Percentile value
   */
  calculatePercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Apply filters to metrics array
   *
   * @param metrics - Metrics to filter
   * @param options - Filter options
   * @returns Filtered metrics
   */
  applyFilters(metrics: DurationMetrics[], options: DurationStatsOptions): DurationMetrics[] {
    let filtered = [...metrics];

    // Time range filters
    if (options.startTime) {
      const startTime = new Date(options.startTime).getTime();
      filtered = filtered.filter((m) => new Date(m.timestamp).getTime() >= startTime);
    }

    if (options.endTime) {
      const endTime = new Date(options.endTime).getTime();
      filtered = filtered.filter((m) => new Date(m.timestamp).getTime() <= endTime);
    }

    // Path filter
    if (options.path) {
      filtered = filtered.filter((m) => m.path === options.path);
    }

    // Method filter
    if (options.method) {
      filtered = filtered.filter((m) => m.method === options.method);
    }

    // Status code filter
    if (options.statusCode) {
      filtered = filtered.filter((m) => m.status_code === options.statusCode);
    }

    // Limit filter
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Get slow requests from metrics array
   *
   * @param metrics - Metrics to filter
   * @param threshold - Slow request threshold in ms
   * @returns Array of slow requests
   */
  getSlowRequests(metrics: DurationMetrics[], threshold: number): DurationMetrics[] {
    return metrics.filter((metric) => metric.duration_ms > threshold);
  }

  /**
   * Get empty statistics object
   *
   * @returns Empty stats
   */
  getEmptyStats(): DurationStats {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      std_dev: 0,
      slow_count: 0,
      slow_percentage: 0
    };
  }
}

/**
 * Singleton instance of the statistics service
 */
export const durationStatsService = new DurationStatsService();

/**
 * Export the class for testing purposes
 */
export { DurationStatsService };
