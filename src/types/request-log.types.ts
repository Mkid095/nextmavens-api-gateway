/**
 * Request log entry data structure
 * Captures all required information for request auditing and tracing
 */
export interface RequestLogEntry {
  /**
   * Project ID extracted from JWT token
   * Used to scope requests to specific projects
   */
  project_id: string;

  /**
   * Request path/route
   * The URL path that was requested
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
  duration: number;

  /**
   * Correlation ID for distributed tracing
   * Links this request to other requests in the system
   */
  correlation_id: string;

  /**
   * ISO 8601 timestamp
   * When the request was logged
   */
  timestamp: string;

  /**
   * Optional additional metadata
   * Can include query parameters, user agent, etc.
   */
  metadata?: RequestLogMetadata;
}

/**
 * Optional metadata for request logging
 * Provides additional context for debugging and analytics
 */
export interface RequestLogMetadata {
  /**
   * Query string parameters
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
   * Request headers (sanitized)
   */
  headers?: Record<string, string>;

  /**
   * Response size in bytes
   */
  response_size?: number;
}

/**
 * Log level enumeration
 * Defines severity levels for log entries
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Log entry with level
 * Extends RequestLogEntry with log level
 */
export interface LogEntry extends RequestLogEntry {
  /**
   * Log level
   * Indicates severity of the log entry
   */
  level: LogLevel;

  /**
   * Log message
   * Human-readable description of the log entry
   */
  message?: string;
}

/**
 * Async log operation result
 * Result of an async log write operation
 */
export interface LogResult {
  /**
   * Whether the log operation succeeded
   */
  success: boolean;

  /**
   * Error message if the operation failed
   */
  error?: string;

  /**
   * Timestamp of the log operation
   */
  timestamp: string;
}
