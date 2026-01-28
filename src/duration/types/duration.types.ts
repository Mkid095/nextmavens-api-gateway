/**
 * Duration Tracking Types (US-009)
 *
 * Defines the data structures for tracking request duration metrics.
 * These types support performance monitoring and analysis of API request durations.
 *
 * ARCHITECTURE NOTES:
 * - Follows the same patterns as US-008 (request logger)
 * - Uses @/ path aliases for imports
 * - No 'any' types - all properly typed
 * - Supports individual request tracking and aggregate statistics
 */

/**
 * Duration Metrics Entry
 *
 * Captures the duration information for a single request.
 * Used for tracking individual request performance.
 */
export interface DurationMetrics {
  /**
   * Unique request identifier
   * Links to the correlation ID from US-006
   */
  request_id: string;

  /**
   * Project ID
   * Extracted from JWT (US-005) or x-project-id header
   */
  project_id: string;

  /**
   * Request path/route
   * The URL path that was requested (excludes query string for security)
   */
  path: string;

  /**
   * HTTP method
   * The HTTP method used (GET, POST, PUT, DELETE, etc.)
   */
  method: string;

  /**
   * HTTP status code
   * The status code returned for the request
   */
  status_code: number;

  /**
   * Request duration in milliseconds
   * Time from request start to response completion
   */
  duration_ms: number;

  /**
   * ISO 8601 timestamp
   * When the request completed
   */
  timestamp: string;

  /**
   * Whether the request is considered slow
   * Based on threshold (default: >1000ms)
   */
  is_slow?: boolean;

  /**
   * Optional metadata for additional context
   * Can include user agent, IP, etc.
   */
  metadata?: DurationMetadata;
}

/**
 * Duration Metadata
 *
 * Optional additional context for duration tracking.
 * Provides extra information for performance analysis.
 */
export interface DurationMetadata {
  /**
   * Query string parameters
   * Excluded from main path for security
   */
  query?: Record<string, string>;

  /**
   * Client IP address
   */
  ip?: string;

  /**
   * User agent string
   */
  user_agent?: string;

  /**
   * Request size in bytes
   */
  request_size?: number;

  /**
   * Response size in bytes
   */
  response_size?: number;
}

/**
 * Duration Statistics
 *
 * Aggregate statistics for request durations.
 * Used for performance monitoring and analysis.
 */
export interface DurationStats {
  /**
   * Total number of requests measured
   */
  count: number;

  /**
   * Minimum request duration in milliseconds
   */
  min: number;

  /**
   * Maximum request duration in milliseconds
   */
  max: number;

  /**
   * Average (mean) request duration in milliseconds
   */
  avg: number;

  /**
   * Median (50th percentile) request duration in milliseconds
   */
  p50: number;

  /**
   * 95th percentile request duration in milliseconds
   */
  p95: number;

  /**
   * 99th percentile request duration in milliseconds
   */
  p99: number;

  /**
   * Standard deviation of request durations
   */
  std_dev?: number;

  /**
   * Number of slow requests (>1s)
   */
  slow_count?: number;

  /**
   * Percentage of slow requests
   */
  slow_percentage?: number;
}

/**
 * Duration Tracker Configuration
 *
 * Configuration options for the duration tracker.
 */
export interface DurationTrackerConfig {
  /**
   * Slow request threshold in milliseconds
   * Requests exceeding this duration are marked as slow
   * Default: 1000ms (1 second)
   */
  slowRequestThreshold?: number;

  /**
   * Maximum number of duration samples to keep in memory
   * Used for calculating statistics (percentiles, etc.)
   * Default: 10000 samples
   */
  maxSamples?: number;

  /**
   * Whether to enable detailed tracking
   * When false, only aggregate statistics are kept
   * Default: true
   */
  detailedTracking?: boolean;

  /**
   * Whether to track individual requests
   * When false, only statistics are calculated
   * Default: true
   */
  trackIndividualRequests?: boolean;
}

/**
 * Duration Tracker Interface
 *
 * Defines the API for tracking request durations.
 * Implemented by duration tracking services.
 */
export interface DurationTracker {
  /**
   * Record a duration measurement for a request
   *
   * @param metrics - The duration metrics to record
   * @returns Promise that resolves when the metrics are recorded
   */
  record(metrics: DurationMetrics): Promise<void>;

  /**
   * Get statistics for a specific project
   *
   * @param projectId - The project ID to get statistics for
   * @param options - Optional filters (time range, path, etc.)
   * @returns Promise resolving to duration statistics
   */
  getStats(
    projectId: string,
    options?: DurationStatsOptions
  ): Promise<DurationStats>;

  /**
   * Get statistics for all projects
   *
   * @param options - Optional filters (time range, path, etc.)
   * @returns Promise resolving to duration statistics
   */
  getAllStats(options?: DurationStatsOptions): Promise<DurationStats>;

  /**
   * Get slow requests for a specific project
   *
   * @param projectId - The project ID to get slow requests for
   * @param threshold - Optional custom threshold (overrides default)
   * @returns Promise resolving to list of slow requests
   */
  getSlowRequests(
    projectId: string,
    threshold?: number
  ): Promise<DurationMetrics[]>;

  /**
   * Reset/clear all tracked data
   * Useful for testing or memory management
   *
   * @returns Promise that resolves when data is cleared
   */
  reset(): Promise<void>;
}

/**
 * Duration Statistics Options
 *
 * Optional filters and parameters for statistics queries.
 */
export interface DurationStatsOptions {
  /**
   * Start time filter (ISO 8601 timestamp)
   * Only include requests after this time
   */
  startTime?: string;

  /**
   * End time filter (ISO 8601 timestamp)
   * Only include requests before this time
   */
  endTime?: string;

  /**
   * Path filter
   * Only include requests for this path
   */
  path?: string;

  /**
   * HTTP method filter
   * Only include requests for this method
   */
  method?: string;

  /**
   * Status code filter
   * Only include requests with this status code
   */
  statusCode?: number;

  /**
   * Limit the number of samples to analyze
   * Useful for performance with large datasets
   */
  limit?: number;
}

/**
 * Duration Percentile
 *
 * Represents a specific percentile value.
 */
export interface DurationPercentile {
  /**
   * The percentile value (e.g., 50, 95, 99)
   */
  percentile: number;

  /**
   * The duration value at this percentile in milliseconds
   */
  value: number;
}

/**
 * Duration Threshold
 *
 * Defines a threshold for duration monitoring.
 */
export interface DurationThreshold {
  /**
   * Threshold name
   */
  name: string;

  /**
   * Threshold duration in milliseconds
   */
  value: number;

  /**
   * Threshold level (info, warning, critical)
   */
  level: ThresholdLevel;

  /**
   * Whether this threshold is enabled
   */
  enabled: boolean;
}

/**
 * Threshold Level Enumeration
 *
 * Defines severity levels for duration thresholds.
 */
export enum ThresholdLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

/**
 * Duration Alert
 *
 * Represents an alert triggered by a duration threshold.
 */
export interface DurationAlert {
  /**
   * Unique alert identifier
   */
  id: string;

  /**
   * The threshold that triggered this alert
   */
  threshold: DurationThreshold;

  /**
   * The metrics that triggered the alert
   */
  metrics: DurationMetrics;

  /**
   * When the alert was triggered
   */
  timestamp: string;

  /**
   * Alert message
   */
  message: string;
}

/**
 * Duration Tracking Result
 *
 * Result of a duration tracking operation.
 */
export interface DurationTrackingResult {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * Error message if the operation failed
   */
  error?: string;

  /**
   * Timestamp of the operation
   */
  timestamp: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Default configuration values
 */
export const DEFAULT_DURATION_CONFIG: Required<DurationTrackerConfig> = {
  slowRequestThreshold: 1000, // 1 second
  maxSamples: 10000,
  detailedTracking: true,
  trackIndividualRequests: true
} as const;

/**
 * Common threshold presets
 */
export const DURATION_THRESHOLDS: Record<string, DurationThreshold> = {
  SLOW_REQUEST: {
    name: 'Slow Request',
    value: 1000,
    level: ThresholdLevel.WARNING,
    enabled: true
  },
  VERY_SLOW_REQUEST: {
    name: 'Very Slow Request',
    value: 5000,
    level: ThresholdLevel.CRITICAL,
    enabled: true
  },
  CRITICAL_REQUEST: {
    name: 'Critical Request',
    value: 10000,
    level: ThresholdLevel.CRITICAL,
    enabled: true
  }
} as const;
