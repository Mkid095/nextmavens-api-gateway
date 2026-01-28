import type { RequestLogEntry, LogResult, LogEntry } from '@/types/request-log.types.js';
import { LogLevel } from '@/types/request-log.types.js';

/**
 * Request Logger Service
 *
 * Provides async logging functionality that doesn't block request processing.
 * Logs are written asynchronously to avoid impacting request performance.
 *
 * Architecture:
 * - Async logging using setImmediate to avoid blocking
 * - Structured log format for easy parsing
 * - Includes all required fields: project_id, path, method, status_code, duration, correlation_id
 * - Console-based logging (can be extended to file/database)
 *
 * Usage:
 * ```typescript
 * import { requestLogger } from '@/logging/request-logger.service.js';
 * await requestLogger.logRequest(logEntry);
 * ```
 */

/**
 * Request Logger Service class
 * Handles async logging of request data
 */
class RequestLoggerService {
  /**
   * Minimum log level
   * Only logs at or above this level will be recorded
   */
  private minLevel: LogLevel = 'info' as LogLevel;

  /**
   * Whether logging is enabled
   * Can be disabled for testing or performance
   */
  private enabled: boolean = true;

  /**
   * Log level priority order
   * Used for filtering logs by level
   */
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  /**
   * Constructor
   * Initializes the logger with configuration from environment
   */
  constructor() {
    // Load configuration from environment
    const logLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (logLevel && this.isValidLogLevel(logLevel)) {
      this.minLevel = logLevel as LogLevel;
    }

    // Check if logging is disabled
    if (process.env.LOGGING_ENABLED === 'false') {
      this.enabled = false;
    }
  }

  /**
   * Validate if a string is a valid log level
   */
  private isValidLogLevel(level: string): boolean {
    return ['debug', 'info', 'warn', 'error'].includes(level);
  }

  /**
   * Check if a log level should be logged based on minimum level
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  /**
   * Format log entry as JSON string
   * Creates structured log format for parsing
   */
  private formatLogEntry(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp,
      level: entry.level,
      correlation_id: entry.correlation_id,
      project_id: entry.project_id,
      method: entry.method,
      path: entry.path,
      status_code: entry.status_code,
      duration_ms: entry.duration,
      ...(entry.message && { message: entry.message }),
      ...(entry.metadata && { metadata: entry.metadata })
    });
  }

  /**
   * Write log entry to console
   * Uses appropriate console method based on log level
   */
  private writeLog(entry: LogEntry): void {
    const logString = this.formatLogEntry(entry);

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(logString);
        break;
      case LogLevel.WARN:
        console.warn(logString);
        break;
      case LogLevel.DEBUG:
        console.debug(logString);
        break;
      case LogLevel.INFO:
      default:
        console.log(logString);
        break;
    }
  }

  /**
   * Log a request entry asynchronously
   * Doesn't block the request processing
   *
   * @param entry - Request log entry to log
   * @returns Promise that resolves when log is written
   */
  async logRequest(entry: RequestLogEntry): Promise<LogResult> {
    if (!this.enabled) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    // Default to info level for request logs
    const level: LogLevel = LogLevel.INFO;

    if (!this.shouldLog(level)) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    // Create log entry with level
    const logEntry: LogEntry = {
      ...entry,
      level,
      message: `Request: ${entry.method} ${entry.path} - ${entry.status_code}`
    };

    // Log asynchronously to avoid blocking
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          this.writeLog(logEntry);
          resolve({
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      });
    });
  }

  /**
   * Log an error entry asynchronously
   * Used for logging errors and failures
   *
   * @param entry - Request log entry
   * @param errorMessage - Error message
   * @returns Promise that resolves when log is written
   */
  async logError(entry: RequestLogEntry, errorMessage: string): Promise<LogResult> {
    if (!this.enabled) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    if (!this.shouldLog(LogLevel.ERROR)) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    const logEntry: LogEntry = {
      ...entry,
      level: LogLevel.ERROR,
      message: `Error: ${errorMessage}`
    };

    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          this.writeLog(logEntry);
          resolve({
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      });
    });
  }

  /**
   * Log a slow request (performance monitoring)
   * Used for tracking requests that take longer than expected
   *
   * @param entry - Request log entry
   * @param threshold - Threshold duration in milliseconds
   * @returns Promise that resolves when log is written
   */
  async logSlowRequest(entry: RequestLogEntry, threshold: number): Promise<LogResult> {
    if (!this.enabled) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    if (!this.shouldLog(LogLevel.WARN)) {
      return {
        success: true,
        timestamp: new Date().toISOString()
      };
    }

    const logEntry: LogEntry = {
      ...entry,
      level: LogLevel.WARN,
      message: `Slow request: ${entry.duration}ms (threshold: ${threshold}ms)`
    };

    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          this.writeLog(logEntry);
          resolve({
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      });
    });
  }

  /**
   * Enable or disable logging
   * Useful for testing or performance tuning
   *
   * @param enabled - Whether logging should be enabled
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set minimum log level
   * Only logs at or above this level will be recorded
   *
   * @param level - Minimum log level
   */
  setMinLevel(level: LogLevel): void {
    if (this.isValidLogLevel(level)) {
      this.minLevel = level;
    }
  }

  /**
   * Get current configuration
   * Returns the current logger configuration
   */
  getConfig(): { enabled: boolean; minLevel: LogLevel } {
    return {
      enabled: this.enabled,
      minLevel: this.minLevel
    };
  }
}

/**
 * Singleton instance of the request logger service
 * Exported for use across the application
 */
export const requestLogger = new RequestLoggerService();

/**
 * Export the class for testing purposes
 */
export { RequestLoggerService };
