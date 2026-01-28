/**
 * Logging Module - Barrel Exports
 *
 * Centralized exports for the logging module.
 * Provides request logging functionality for audit trails.
 *
 * Usage:
 * ```typescript
 * import { requestLogger, requestLoggingMiddleware } from '@/logging/index.js';
 * ```
 */

// Export request logger service
export {
  requestLogger,
  RequestLoggerService
} from './request-logger.service.js';

// Export request logging middleware
export {
  requestLoggingMiddleware,
  createRequestLoggingMiddleware
} from './middleware/request-logging.middleware.js';

// Export types
export type {
  RequestLogEntry,
  RequestLogMetadata,
  LogEntry,
  LogResult
} from '@/types/request-log.types.js';

// Export enums
export {
  LogLevel
} from '@/types/request-log.types.js';
