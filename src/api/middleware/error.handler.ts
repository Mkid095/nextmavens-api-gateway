/**
 * API error types for centralized error handling
 */
export enum ApiErrorCode {
  // Snapshot errors
  SNAPSHOT_UNAVAILABLE = 'SNAPSHOT_UNAVAILABLE',
  SNAPSHOT_EXPIRED = 'SNAPSHOT_EXPIRED',
  SNAPSHOT_FETCH_FAILED = 'SNAPSHOT_FETCH_FAILED',

  // Project errors
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  PROJECT_SUSPENDED = 'PROJECT_SUSPENDED',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PROJECT_DELETED = 'PROJECT_DELETED',

  // Service errors
  SERVICE_DISABLED = 'SERVICE_DISABLED',
  SERVICE_NOT_FOUND = 'SERVICE_NOT_FOUND',

  // Authentication/Authorization errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_API_KEY = 'INVALID_API_KEY',
  KEY_INVALID = 'KEY_INVALID',

  // Rate limiting errors
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED', // Alias for RATE_LIMIT_EXCEEDED

  // Generic errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

/**
 * Standard API error class
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly retryable: boolean = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Convert error to JSON response format
   */
  toJSON(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details && { details: this.details })
      }
    };
  }

  /**
   * Create a snapshot unavailable error
   */
  static snapshotUnavailable(message: string = 'Snapshot unavailable'): ApiError {
    return new ApiError(
      ApiErrorCode.SNAPSHOT_UNAVAILABLE,
      message,
      503,
      true
    );
  }

  /**
   * Create a project not found error
   * SECURITY: Generic message to prevent project enumeration
   */
  static projectNotFound(_projectId: string): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_NOT_FOUND,
      'Project not found or access denied',
      404,
      false
    );
  }

  /**
   * Create a project suspended error
   * SECURITY: Generic message to prevent information leakage
   */
  static projectSuspended(_projectName: string): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_SUSPENDED,
      'Project is suspended. Please contact support to resolve any outstanding issues.',
      403,
      false
    );
  }

  /**
   * Create a project archived error
   * SECURITY: Generic message to prevent information leakage
   */
  static projectArchived(_projectName: string): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_ARCHIVED,
      'Project is archived and cannot accept requests. Please contact support if you need to reactivate this project.',
      403,
      false
    );
  }

  /**
   * Create a project deleted error
   * SECURITY: Generic message to prevent information leakage
   */
  static projectDeleted(_projectId: string): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_DELETED,
      'Project has been deleted and is no longer available.',
      403,
      false
    );
  }

  /**
   * Create a service disabled error
   */
  static serviceDisabled(serviceName: string): ApiError {
    return new ApiError(
      ApiErrorCode.SERVICE_DISABLED,
      `Service '${serviceName}' is not enabled for this project. Please enable it in the developer portal.`,
      403,
      false
    );
  }

  /**
   * Create a key invalid error for JWT authentication failures
   * SECURITY: Generic message to prevent information leakage about token structure
   */
  static keyInvalid(): ApiError {
    return new ApiError(
      ApiErrorCode.KEY_INVALID,
      'Invalid or malformed authentication token',
      401,
      false
    );
  }
}

/**
 * Error handler middleware function
 * Catches and formats all errors in a consistent way
 */
export function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  return operation().catch((error) => {
    console.error(`[Error Handler] ${context}:`, error);

    if (error instanceof ApiError) {
      throw error;
    }

    // Convert unknown errors to ApiError
    throw new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Unknown error occurred',
      500,
      false,
      { originalError: error instanceof Error ? error.name : typeof error }
    );
  });
}

/**
 * Synchronous error handler wrapper
 */
export function withErrorHandlingSync<T>(
  operation: () => T,
  context: string
): T {
  try {
    return operation();
  } catch (error) {
    console.error(`[Error Handler] ${context}:`, error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Unknown error occurred',
      500,
      false
    );
  }
}

/**
 * Log error with structured format
 */
export function logError(error: Error, context: string, metadata?: Record<string, unknown>): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    context,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    ...(metadata && { metadata })
  };

  console.error('[Error]', JSON.stringify(logEntry, null, 2));
}
