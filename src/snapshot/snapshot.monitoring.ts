/**
 * Snapshot Refresh Monitoring Module
 *
 * Provides monitoring, metrics, and alerting for snapshot refresh operations.
 * Tracks fetch success rates, cache health, and system performance.
 *
 * Metrics tracked:
 * - Fetch success/failure counts
 * - Response time percentiles (p50, p95, p99)
 * - Cache hit/miss ratio
 * - Refresh failure alerts
 * - Snapshot age/staleness detection
 */

import { EventEmitter } from 'events';

/**
 * Snapshot fetch event data
 */
interface SnapshotFetchEvent {
  timestamp: number;
  success: boolean;
  responseTimeMs: number;
  cacheHit: boolean;
  version: number | null;
  error?: string;
}

/**
 * Snapshot health status
 */
export type SnapshotHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Snapshot health report
 */
export interface SnapshotHealthReport {
  status: SnapshotHealthStatus;
  timestamp: string;
  metrics: {
    fetchSuccessRate: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    cacheHitRate: number;
    consecutiveFailures: number;
    lastFetchAge: number;
  };
  issues: string[];
  recommendations: string[];
}

/**
 * Monitoring configuration
 */
interface MonitoringConfig {
  // Response time thresholds (milliseconds)
  p50Threshold: number;
  p95Threshold: number;
  p99Threshold: number;

  // Failure thresholds
  maxConsecutiveFailures: number;
  minSuccessRate: number; // 0-1

  // Cache thresholds
  minCacheHitRate: number; // 0-1

  // Staleness threshold (seconds)
  maxSnapshotAge: number;

  // Alert callbacks
  onHealthChange?: (status: SnapshotHealthStatus, report: SnapshotHealthReport) => void;
  onFetchFailure?: (error: string) => void;
  onStaleSnapshot?: (age: number) => void;
}

/**
 * Default monitoring configuration
 */
const DEFAULT_CONFIG: MonitoringConfig = {
  p50Threshold: 100,   // 100ms
  p95Threshold: 500,   // 500ms
  p99Threshold: 1000,  // 1000ms
  maxConsecutiveFailures: 3,
  minSuccessRate: 0.95, // 95%
  minCacheHitRate: 0.5,  // 50%
  maxSnapshotAge: 120   // 2 minutes
};

/**
 * Snapshot Monitoring Service
 *
 * Tracks and reports on snapshot refresh operations.
 * Emits events for health changes and issues.
 */
export class SnapshotMonitoringService extends EventEmitter {
  private fetchHistory: SnapshotFetchEvent[] = [];
  private maxHistorySize = 1000;
  private currentStatus: SnapshotHealthStatus = 'healthy';
  private consecutiveFailures = 0;
  private lastSuccessfulFetch: number | null = null;
  private lastSnapshotVersion: number | null = null;

  constructor(private readonly config: MonitoringConfig = DEFAULT_CONFIG) {
    super();
  }

  /**
   * Record a snapshot fetch attempt
   */
  recordFetch(event: SnapshotFetchEvent): void {
    // Add to history
    this.fetchHistory.push(event);

    // Trim history if needed
    if (this.fetchHistory.length > this.maxHistorySize) {
      this.fetchHistory = this.fetchHistory.slice(-this.maxHistorySize);
    }

    // Update consecutive failures counter
    if (event.success) {
      this.consecutiveFailures = 0;
      this.lastSuccessfulFetch = event.timestamp;
      this.lastSnapshotVersion = event.version;
    } else {
      this.consecutiveFailures++;

      // Trigger failure alert
      if (this.config.onFetchFailure && event.error) {
        this.config.onFetchFailure(event.error);
      }
    }

    // Check for health changes
    this.evaluateHealth();
  }

  /**
   * Get current health status
   */
  getHealthStatus(): SnapshotHealthStatus {
    return this.currentStatus;
  }

  /**
   * Generate comprehensive health report
   */
  generateHealthReport(): SnapshotHealthReport {
    const now = Date.now();
    const recentFetches = this.getRecentFetches(100); // Last 100 fetches
    const successfulFetches = recentFetches.filter(f => f.success);

    // Calculate metrics
    const fetchSuccessRate = recentFetches.length > 0
      ? successfulFetches.length / recentFetches.length
      : 0;

    const responseTimes = successfulFetches.map(f => f.responseTimeMs);
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const sortedResponseTimes = responseTimes.sort((a, b) => a - b);
    const p95ResponseTime = this.getPercentile(sortedResponseTimes, 95);
    const p99ResponseTime = this.getPercentile(sortedResponseTimes, 99);

    const cacheHits = recentFetches.filter(f => f.cacheHit).length;
    const cacheHitRate = recentFetches.length > 0
      ? cacheHits / recentFetches.length
      : 0;

    const lastFetchAge = this.lastSuccessfulFetch
      ? (now - this.lastSuccessfulFetch) / 1000
      : Infinity;

    // Determine issues
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check response times
    if (avgResponseTime > this.config.p50Threshold) {
      issues.push(`Average response time (${avgResponseTime.toFixed(0)}ms) exceeds threshold (${this.config.p50Threshold}ms)`);
      recommendations.push('Investigate network latency or control plane performance');
    }

    if (p95ResponseTime > this.config.p95Threshold) {
      issues.push(`P95 response time (${p95ResponseTime.toFixed(0)}ms) exceeds threshold (${this.config.p95Threshold}ms)`);
      recommendations.push('Consider increasing cache TTL or optimizing snapshot generation');
    }

    if (p99ResponseTime > this.config.p99Threshold) {
      issues.push(`P99 response time (${p99ResponseTime.toFixed(0)}ms) exceeds threshold (${this.config.p99Threshold}ms)`);
      recommendations.push('Check for outliers in snapshot generation time');
    }

    // Check success rate
    if (fetchSuccessRate < this.config.minSuccessRate) {
      issues.push(`Fetch success rate (${(fetchSuccessRate * 100).toFixed(1)}%) below threshold (${(this.config.minSuccessRate * 100)}%)`);
      recommendations.push('Check control plane availability and network connectivity');
    }

    // Check consecutive failures
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      issues.push(`${this.consecutiveFailures} consecutive fetch failures`);
      recommendations.push('Immediate investigation required - control plane may be down');
    }

    // Check cache hit rate
    if (cacheHitRate < this.config.minCacheHitRate) {
      issues.push(`Cache hit rate (${(cacheHitRate * 100).toFixed(1)}%) below threshold (${(this.config.minCacheHitRate * 100)}%)`);
      recommendations.push('Consider increasing cache TTL or refresh interval');
    }

    // Check staleness
    if (lastFetchAge > this.config.maxSnapshotAge) {
      issues.push(`Last successful fetch was ${lastFetchAge.toFixed(0)}s ago (threshold: ${this.config.maxSnapshotAge}s)`);
      recommendations.push('Snapshot may be stale - verify refresh mechanism');
      if (this.config.onStaleSnapshot) {
        this.config.onStaleSnapshot(lastFetchAge);
      }
    }

    // Determine overall status
    let status: SnapshotHealthStatus;
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures ||
        fetchSuccessRate < this.config.minSuccessRate * 0.5) {
      status = 'unhealthy';
    } else if (issues.length > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      metrics: {
        fetchSuccessRate,
        avgResponseTime,
        p95ResponseTime,
        p99ResponseTime,
        cacheHitRate,
        consecutiveFailures: this.consecutiveFailures,
        lastFetchAge
      },
      issues,
      recommendations
    };
  }

  /**
   * Get metrics for external monitoring systems
   */
  getMetrics(): Record<string, number | string> {
    const recentFetches = this.getRecentFetches(100);
    const successfulFetches = recentFetches.filter(f => f.success);

    return {
      snapshot_fetch_success_rate: recentFetches.length > 0
        ? successfulFetches.length / recentFetches.length
        : 0,
      snapshot_avg_response_time_ms: successfulFetches.length > 0
        ? successfulFetches.reduce((a, b) => a + b.responseTimeMs, 0) / successfulFetches.length
        : 0,
      snapshot_p95_response_time_ms: this.getPercentile(
        successfulFetches.map(f => f.responseTimeMs).sort((a, b) => a - b),
        95
      ),
      snapshot_p99_response_time_ms: this.getPercentile(
        successfulFetches.map(f => f.responseTimeMs).sort((a, b) => a - b),
        99
      ),
      snapshot_cache_hit_rate: recentFetches.length > 0
        ? recentFetches.filter(f => f.cacheHit).length / recentFetches.length
        : 0,
      snapshot_consecutive_failures: this.consecutiveFailures,
      snapshot_last_fetch_age_seconds: this.lastSuccessfulFetch
        ? (Date.now() - this.lastSuccessfulFetch) / 1000
        : -1,
      snapshot_current_version: this.lastSnapshotVersion || -1,
      snapshot_health_status: this.currentStatus
    };
  }

  /**
   * Evaluate health and emit change events
   */
  private evaluateHealth(): void {
    const report = this.generateHealthReport();
    const previousStatus = this.currentStatus;
    this.currentStatus = report.status;

    // Emit status change event
    if (previousStatus !== this.currentStatus) {
      this.emit('statusChange', this.currentStatus, previousStatus, report);

      if (this.config.onHealthChange) {
        this.config.onHealthChange(this.currentStatus, report);
      }
    }

    // Emit alerts for unhealthy status
    if (this.currentStatus === 'unhealthy') {
      this.emit('alert', {
        type: 'unhealthy',
        message: 'Snapshot service is unhealthy',
        report
      });
    }
  }

  /**
   * Get recent fetch events
   */
  private getRecentFetches(count: number): SnapshotFetchEvent[] {
    return this.fetchHistory.slice(-count);
  }

  /**
   * Calculate percentile from sorted array
   */
  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Reset monitoring state
   */
  reset(): void {
    this.fetchHistory = [];
    this.consecutiveFailures = 0;
    this.lastSuccessfulFetch = null;
    this.lastSnapshotVersion = null;
    this.currentStatus = 'healthy';
  }
}

/**
 * Create a singleton monitoring service instance
 */
let monitoringInstance: SnapshotMonitoringService | null = null;

export function createSnapshotMonitoring(
  config?: Partial<MonitoringConfig>
): SnapshotMonitoringService {
  if (monitoringInstance) {
    return monitoringInstance;
  }

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  monitoringInstance = new SnapshotMonitoringService(finalConfig);

  return monitoringInstance;
}

export function getSnapshotMonitoring(): SnapshotMonitoringService | null {
  return monitoringInstance;
}
