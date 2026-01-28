/**
 * Error Handler Unit Tests
 *
 * Tests for centralized error handling including:
 * - ApiError class construction and methods
 * - Error format standardization
 * - Error code validation
 * - Retryable flag behavior
 * - Static error factory methods
 */

import { describe, it, expect } from '@jest/globals';
import { ApiError, ApiErrorCode, withErrorHandling, withErrorHandlingSync, logError } from '../error.handler.js';

describe('ApiErrorCode', () => {
  it('should have all required error codes', () => {
    // Verify all required error codes exist
    expect(ApiErrorCode.PROJECT_SUSPENDED).toBe('PROJECT_SUSPENDED');
    expect(ApiErrorCode.SERVICE_DISABLED).toBe('SERVICE_DISABLED');
    expect(ApiErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
    expect(ApiErrorCode.KEY_INVALID).toBe('KEY_INVALID');
  });

  it('should have RATE_LIMITED error code', () => {
    expect(ApiErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
  });
});

describe('ApiError', () => {
  describe('constructor', () => {
    it('should create error with all properties', () => {
      const error = new ApiError(
        ApiErrorCode.PROJECT_SUSPENDED,
        'Project is suspended',
        403,
        false,
        { projectId: 'test-123' }
      );

      expect(error.code).toBe(ApiErrorCode.PROJECT_SUSPENDED);
      expect(error.message).toBe('Project is suspended');
      expect(error.statusCode).toBe(403);
      expect(error.retryable).toBe(false);
      expect(error.details).toEqual({ projectId: 'test-123' });
      expect(error.name).toBe('ApiError');
    });

    it('should create error with default values', () => {
      const error = new ApiError(
        ApiErrorCode.INTERNAL_ERROR,
        'Internal error'
      );

      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(false);
      expect(error.details).toBeUndefined();
    });

    it('should be instanceof Error and ApiError', () => {
      const error = new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Bad request'
      );

      expect(error instanceof Error).toBe(true);
      expect(error instanceof ApiError).toBe(true);
    });
  });

  describe('toJSON()', () => {
    it('should serialize error to standard format without details', () => {
      const error = new ApiError(
        ApiErrorCode.PROJECT_SUSPENDED,
        'Project is suspended',
        403,
        false
      );

      const json = error.toJSON();

      expect(json).toEqual({
        error: {
          code: 'PROJECT_SUSPENDED',
          message: 'Project is suspended',
          retryable: false
        }
      });
    });

    it('should serialize error to standard format with details', () => {
      const error = new ApiError(
        ApiErrorCode.RATE_LIMITED,
        'Rate limit exceeded',
        429,
        true,
        { retryAfter: 60, limit: 100 }
      );

      const json = error.toJSON();

      expect(json).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          retryable: true,
          details: {
            retryAfter: 60,
            limit: 100
          }
        }
      });
    });

    it('should match standard error format specification', () => {
      const error = new ApiError(
        ApiErrorCode.SERVICE_DISABLED,
        'Service disabled',
        403,
        false
      );

      const json = error.toJSON() as Record<string, unknown>;
      const errorObj = json.error as Record<string, unknown>;

      // Verify structure matches { error: { code, message, retryable, details? } }
      expect(errorObj).toBeDefined();
      expect(errorObj.code).toBeDefined();
      expect(typeof errorObj.code).toBe('string');
      expect(errorObj.message).toBeDefined();
      expect(typeof errorObj.message).toBe('string');
      expect(errorObj.retryable).toBeDefined();
      expect(typeof errorObj.retryable).toBe('boolean');
      // details is optional
      if (errorObj.details) {
        expect(typeof errorObj.details).toBe('object');
      }
    });
  });

  describe('Static factory methods', () => {
    describe('snapshotUnavailable', () => {
      it('should create SNAPSHOT_UNAVAILABLE error', () => {
        const error = ApiError.snapshotUnavailable();

        expect(error.code).toBe(ApiErrorCode.SNAPSHOT_UNAVAILABLE);
        expect(error.statusCode).toBe(503);
        expect(error.retryable).toBe(true);
        expect(error.message).toBe('Snapshot unavailable');
      });

      it('should accept custom message', () => {
        const error = ApiError.snapshotUnavailable('Custom snapshot error');

        expect(error.message).toBe('Custom snapshot error');
      });
    });

    describe('projectNotFound', () => {
      it('should create PROJECT_NOT_FOUND error with generic message', () => {
        const error = ApiError.projectNotFound('project-123');

        expect(error.code).toBe(ApiErrorCode.PROJECT_NOT_FOUND);
        expect(error.statusCode).toBe(404);
        expect(error.retryable).toBe(false);
        expect(error.message).toBe('Project not found or access denied');
      });

      it('should not include project ID in message (security)', () => {
        const error = ApiError.projectNotFound('sensitive-project-id');

        expect(error.message).not.toContain('sensitive-project-id');
      });
    });

    describe('projectSuspended', () => {
      it('should create PROJECT_SUSPENDED error', () => {
        const error = ApiError.projectSuspended('my-project');

        expect(error.code).toBe(ApiErrorCode.PROJECT_SUSPENDED);
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
        expect(error.message).toBe('Project is suspended. Please contact support to resolve any outstanding issues.');
      });

      it('should not include project name in message (security)', () => {
        const error = ApiError.projectSuspended('sensitive-project-name');

        expect(error.message).not.toContain('sensitive-project-name');
      });
    });

    describe('projectArchived', () => {
      it('should create PROJECT_ARCHIVED error', () => {
        const error = ApiError.projectArchived('my-project');

        expect(error.code).toBe(ApiErrorCode.PROJECT_ARCHIVED);
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
      });

      it('should not include project name in message (security)', () => {
        const error = ApiError.projectArchived('sensitive-project-name');

        expect(error.message).not.toContain('sensitive-project-name');
      });
    });

    describe('projectDeleted', () => {
      it('should create PROJECT_DELETED error', () => {
        const error = ApiError.projectDeleted('project-123');

        expect(error.code).toBe(ApiErrorCode.PROJECT_DELETED);
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
      });

      it('should not include project ID in message (security)', () => {
        const error = ApiError.projectDeleted('sensitive-project-id');

        expect(error.message).not.toContain('sensitive-project-id');
      });
    });

    describe('serviceDisabled', () => {
      it('should create SERVICE_DISABLED error with service name', () => {
        const error = ApiError.serviceDisabled('api-service');

        expect(error.code).toBe(ApiErrorCode.SERVICE_DISABLED);
        expect(error.statusCode).toBe(403);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('api-service');
      });

      it('should include service name in message', () => {
        const error = ApiError.serviceDisabled('custom-service');

        expect(error.message).toBe("Service 'custom-service' is not enabled for this project. Please enable it in the developer portal.");
      });
    });

    describe('keyInvalid', () => {
      it('should create KEY_INVALID error', () => {
        const error = ApiError.keyInvalid();

        expect(error.code).toBe(ApiErrorCode.KEY_INVALID);
        expect(error.statusCode).toBe(401);
        expect(error.retryable).toBe(false);
        expect(error.message).toBe('Invalid or malformed authentication token');
      });

      it('should have generic message (security)', () => {
        const error = ApiError.keyInvalid();

        // Message should be generic and not reveal implementation details
        expect(error.message).not.toContain('JWT');
        expect(error.message).not.toContain('signature');
        expect(error.message).not.toContain('HS256');
        expect(error.message).not.toContain('secret');
      });
    });
  });

  describe('Error codes standardization', () => {
    it('should use correct error code for PROJECT_SUSPENDED', () => {
      const error = ApiError.projectSuspended('test');
      expect(error.code).toBe('PROJECT_SUSPENDED');
    });

    it('should use correct error code for SERVICE_DISABLED', () => {
      const error = ApiError.serviceDisabled('test-service');
      expect(error.code).toBe('SERVICE_DISABLED');
    });

    it('should use correct error code for RATE_LIMIT_EXCEEDED', () => {
      const error = new ApiError(
        ApiErrorCode.RATE_LIMITED,
        'Rate limit exceeded',
        429,
        true
      );
      expect(error.code).toBe('RATE_LIMITED');
    });

    it('should use correct error code for KEY_INVALID', () => {
      const error = ApiError.keyInvalid();
      expect(error.code).toBe('KEY_INVALID');
    });
  });

  describe('Retryable flag behavior', () => {
    it('should mark snapshot errors as retryable', () => {
      const error = ApiError.snapshotUnavailable();
      expect(error.retryable).toBe(true);
    });

    it('should mark rate limit errors as retryable', () => {
      const error = new ApiError(
        ApiErrorCode.RATE_LIMITED,
        'Rate limit exceeded',
        429,
        true
      );
      expect(error.retryable).toBe(true);
    });

    it('should mark auth errors as non-retryable', () => {
      const error = ApiError.keyInvalid();
      expect(error.retryable).toBe(false);
    });

    it('should mark project status errors as non-retryable', () => {
      const suspended = ApiError.projectSuspended('test');
      expect(suspended.retryable).toBe(false);

      const archived = ApiError.projectArchived('test');
      expect(archived.retryable).toBe(false);

      const deleted = ApiError.projectDeleted('test');
      expect(deleted.retryable).toBe(false);
    });
  });
});

describe('withErrorHandling', () => {
  it('should handle ApiError and re-throw', async () => {
    const apiError = new ApiError(
      ApiErrorCode.PROJECT_SUSPENDED,
      'Project suspended',
      403,
      false
    );

    await expect(
      withErrorHandling(async () => {
        throw apiError;
      }, 'test context')
    ).rejects.toThrow(apiError);
  });

  it('should convert generic Error to ApiError', async () => {
    const genericError = new Error('Something went wrong');

    await expect(
      withErrorHandling(async () => {
        throw genericError;
      }, 'test context')
    ).rejects.toThrow(ApiError);
  });

  it('should convert non-Error to ApiError', async () => {
    await expect(
      withErrorHandling(async () => {
        throw 'string error';
      }, 'test context')
    ).rejects.toThrow(ApiError);
  });

  it('should pass through successful operations', async () => {
    const result = await withErrorHandling(async () => {
      return 'success';
    }, 'test context');

    expect(result).toBe('success');
  });

  it('should include original error type in details for non-Error', async () => {
    try {
      await withErrorHandling(async () => {
        throw 'string error';
      }, 'test context');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.details?.originalError).toBe('string');
    }
  });
});

describe('withErrorHandlingSync', () => {
  it('should handle ApiError and re-throw', () => {
    const apiError = new ApiError(
      ApiErrorCode.PROJECT_SUSPENDED,
      'Project suspended',
      403,
      false
    );

    expect(() => {
      withErrorHandlingSync(() => {
        throw apiError;
      }, 'test context');
    }).toThrow(apiError);
  });

  it('should convert generic Error to ApiError', () => {
    const genericError = new Error('Something went wrong');

    expect(() => {
      withErrorHandlingSync(() => {
        throw genericError;
      }, 'test context');
    }).toThrow(ApiError);
  });

  it('should pass through successful operations', () => {
    const result = withErrorHandlingSync(() => {
      return 'success';
    }, 'test context');

    expect(result).toBe('success');
  });
});

describe('logError', () => {
  // Note: We can't easily test console.error without jest.mock
  // These tests verify the logError function doesn't throw and formats correctly
  it('should log error without throwing', () => {
    const error = new Error('Test error');

    expect(() => {
      logError(error, 'test context');
    }).not.toThrow();
  });

  it('should log error with metadata without throwing', () => {
    const error = new Error('Test error');

    expect(() => {
      logError(error, 'test context', { userId: '123', action: 'test' });
    }).not.toThrow();
  });

  it('should handle errors without stack traces', () => {
    const error = new Error('Test error');
    delete error.stack;

    expect(() => {
      logError(error, 'test context');
    }).not.toThrow();
  });
});

describe('Error format validation', () => {
  it('should produce consistent format across all error types', () => {
    const errors = [
      ApiError.projectSuspended('test'),
      ApiError.serviceDisabled('test-service'),
      ApiError.keyInvalid(),
      new ApiError(ApiErrorCode.RATE_LIMITED, 'Rate limit', 429, true),
      ApiError.snapshotUnavailable()
    ];

    errors.forEach(error => {
      const json = error.toJSON() as Record<string, unknown>;
      const errorObj = json.error as Record<string, unknown>;

      // All errors must have these fields
      expect(errorObj.code).toBeDefined();
      expect(errorObj.message).toBeDefined();
      expect(errorObj.retryable).toBeDefined();

      // Types must be correct
      expect(typeof errorObj.code).toBe('string');
      expect(typeof errorObj.message).toBe('string');
      expect(typeof errorObj.retryable).toBe('boolean');
    });
  });

  it('should serialize to JSON correctly', () => {
    const error = new ApiError(
      ApiErrorCode.RATE_LIMITED,
      'Rate limit exceeded',
      429,
      true,
      { retryAfter: 60, limit: 100 }
    );

    const jsonString = JSON.stringify(error.toJSON());
    const parsed = JSON.parse(jsonString);

    expect(parsed).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        retryable: true,
        details: {
          retryAfter: 60,
          limit: 100
        }
      }
    });
  });
});
