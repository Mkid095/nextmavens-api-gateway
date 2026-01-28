/**
 * Duration Tracking Module - Barrel Exports
 *
 * Centralized exports for the duration tracking module.
 * Provides request duration tracking and performance monitoring.
 *
 * Usage:
 * ```typescript
 * import { durationTracker, durationTrackingMiddleware } from '@/duration/index.js';
 * ```
 */

// Export duration tracker service
export {
  durationTracker,
  DurationTrackerService
} from './services/duration-tracker.service.js';

// Export duration tracking middleware
export {
  durationTrackingMiddleware,
  createDurationTrackingMiddleware
} from './middleware/duration-tracking.middleware.js';

// Export types
export type {
  DurationMetrics,
  DurationMetadata,
  DurationStats,
  DurationTrackerConfig,
  DurationTracker,
  DurationStatsOptions,
  DurationPercentile,
  DurationThreshold,
  DurationAlert,
  DurationTrackingResult
} from './types/duration.types.js';

// Export enums
export {
  ThresholdLevel,
  DEFAULT_DURATION_CONFIG,
  DURATION_THRESHOLDS
} from './types/duration.types.js';
