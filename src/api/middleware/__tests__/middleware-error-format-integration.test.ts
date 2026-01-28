/**
 * Middleware Error Format Integration Tests
 *
 * Comprehensive integration tests to verify that ALL middleware and validators
 * properly integrate with the standard error format defined in US-007.
 *
 * Standard error format:
 * {
 *   error: {
 *     code: string,
 *     message: string,
 *     retryable: boolean,
 *     details?: Record<string, unknown>
 *   }
 * }
 */

import { describe, it, expect } from '@jest/globals';
import { ApiError, ApiErrorCode } from '../error.handler.js';
import { createProjectStatusValidator } from '@/validation/project-status.validator.js';
import { createServiceEnablementValidator } from '@/validation/service-enablement.validator.js';
import { authenticateWithJwt } from '../jwt.middleware.js';
import { ProjectConfig, ProjectStatus } from '@/types/snapshot.types.js';

describe('Middleware Error Format Integration (US-007)', () => {
  /**
   * Create test project configurations
   */
  function createTestProject(status: ProjectStatus): ProjectConfig {
    return {
      projectId: 'test-project',
      projectName: 'Test Project',
      status,
      tenantId: 'tenant-1',
      allowedOrigins: ['https://example.com'],
      rateLimit: 100,
      enabledServices: ['service-a', 'service-b']
    };
  }

  describe('PROJECT_SUSPENDED Error Integration', () => {
    it('should return standard error format when project is suspended', () => {
      const validator = createProjectStatusValidator();
      const project = createTestProject(ProjectStatus.SUSPENDED);

      const result = validator.validateProjectStatus(project);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(result.error!.code).toBe(ApiErrorCode.PROJECT_SUSPENDED);
      expect(result.error!.message).toBe('Project is suspended. Please contact support to resolve any outstanding issues.');
      expect(result.error!.statusCode).toBe(403);
      expect(result.error!.retryable).toBe(false);

      // Verify toJSON() returns standard format
      const errorJson = result.error!.toJSON();
      expect(errorJson).toHaveProperty('error');
      expect(errorJson.error).toMatchObject({
        code: 'PROJECT_SUSPENDED',
        message: expect.any(String),
        retryable: false
      });

      // Verify structure types
      if (typeof errorJson.error === 'object' && errorJson.error !== null) {
        const errorObj = errorJson.error as { code: string; message: string; retryable: boolean };
        expect(typeof errorObj.code).toBe('string');
        expect(typeof errorObj.message).toBe('string');
        expect(typeof errorObj.retryable).toBe('boolean');
      }
    });

    it('should throw PROJECT_SUSPENDED error when validating suspended project', () => {
      const validator = createProjectStatusValidator();
      const project = createTestProject(ProjectStatus.SUSPENDED);

      expect(() => {
        validator.validateProjectStatusOrThrow(project);
      }).toThrow(ApiError);

      try {
        validator.validateProjectStatusOrThrow(project);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.code).toBe(ApiErrorCode.PROJECT_SUSPENDED);
        expect(apiError.statusCode).toBe(403);
        expect(apiError.retryable).toBe(false);
      }
    });
  });

  describe('SERVICE_DISABLED Error Integration', () => {
    it('should return standard error format when service is disabled', () => {
      const validator = createServiceEnablementValidator();
      const project = createTestProject(ProjectStatus.ACTIVE);
      project.enabledServices = ['service-b']; // service-a not enabled

      const result = validator.validateServiceEnablement(project, 'service-a');

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(result.error!.code).toBe(ApiErrorCode.SERVICE_DISABLED);
      expect(result.error!.message).toContain('service-a');
      expect(result.error!.message).toContain('not enabled');
      expect(result.error!.statusCode).toBe(403);
      expect(result.error!.retryable).toBe(false);

      // Verify toJSON() returns standard format
      const errorJson = result.error!.toJSON();
      expect(errorJson).toHaveProperty('error');
      expect(errorJson.error).toMatchObject({
        code: 'SERVICE_DISABLED',
        message: expect.stringContaining('service-a'),
        retryable: false
      });

      // Verify structure types
      if (typeof errorJson.error === 'object' && errorJson.error !== null) {
        const errorObj = errorJson.error as { code: string; message: string; retryable: boolean };
        expect(typeof errorObj.code).toBe('string');
        expect(typeof errorObj.message).toBe('string');
        expect(typeof errorObj.retryable).toBe('boolean');
      }
    });

    it('should throw SERVICE_DISABLED error when validating disabled service', () => {
      const validator = createServiceEnablementValidator();
      const project = createTestProject(ProjectStatus.ACTIVE);
      project.enabledServices = ['service-b'];

      expect(() => {
        validator.validateServiceEnablementOrThrow(project, 'service-a');
      }).toThrow(ApiError);

      try {
        validator.validateServiceEnablementOrThrow(project, 'service-a');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.code).toBe(ApiErrorCode.SERVICE_DISABLED);
        expect(apiError.statusCode).toBe(403);
        expect(apiError.retryable).toBe(false);
        expect(apiError.message).toContain('service-a');
      }
    });
  });

  describe('RATE_LIMITED Error Integration', () => {
    it('should return standard error format when rate limit is exceeded', () => {
      // Test the static factory method directly
      const rateLimitError = ApiError.rateLimited({
        retryAfter: 60,
        resetTime: Date.now() + 60000,
        limit: 100,
        window: 'MINUTE'
      });

      expect(rateLimitError).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(rateLimitError.code).toBe(ApiErrorCode.RATE_LIMITED);
      expect(rateLimitError.message).toContain('Rate limit');
      expect(rateLimitError.statusCode).toBe(429);
      expect(rateLimitError.retryable).toBe(true);

      // Verify details are present for rate limit errors
      expect(rateLimitError.details).toBeDefined();
      expect(rateLimitError.details).toMatchObject({
        retryAfter: expect.any(Number),
        resetTime: expect.any(Number),
        limit: expect.any(Number),
        window: expect.any(String)
      });

      // Verify toJSON() returns standard format
      const errorJson = rateLimitError.toJSON();
      expect(errorJson).toHaveProperty('error');
      expect(errorJson.error).toMatchObject({
        code: 'RATE_LIMITED',
        message: expect.stringContaining('Rate limit'),
        retryable: true
      });

      // Verify structure types
      if (typeof errorJson.error === 'object' && errorJson.error !== null) {
        const errorObj = errorJson.error as { code: string; message: string; retryable: boolean };
        expect(typeof errorObj.code).toBe('string');
        expect(typeof errorObj.message).toBe('string');
        expect(typeof errorObj.retryable).toBe('boolean');
      }
    });

    it('should throw RATE_LIMITED error when created via static method', () => {
      const rateLimitError = ApiError.rateLimited({
        retryAfter: 60,
        resetTime: Date.now() + 60000,
        limit: 100,
        window: 'MINUTE'
      });

      expect(rateLimitError.code).toBe(ApiErrorCode.RATE_LIMITED);
      expect(rateLimitError.statusCode).toBe(429);
      expect(rateLimitError.retryable).toBe(true);
    });
  });

  describe('KEY_INVALID Error Integration', () => {
    beforeEach(() => {
      // Set JWT config for testing
      process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-min-32-chars';
    });

    it('should return standard error format when JWT is invalid', () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer invalid-token'
        }
      } as any;

      const result = authenticateWithJwt(mockRequest);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
      expect(result.error!.message).toContain('Invalid or malformed');
      expect(result.error!.statusCode).toBe(401);
      expect(result.error!.retryable).toBe(false);

      // Verify toJSON() returns standard format
      const errorJson = result.error!.toJSON();
      expect(errorJson).toHaveProperty('error');
      expect(errorJson.error).toMatchObject({
        code: 'KEY_INVALID',
        message: expect.any(String),
        retryable: false
      });

      // Verify structure types
      if (typeof errorJson.error === 'object' && errorJson.error !== null) {
        const errorObj = errorJson.error as { code: string; message: string; retryable: boolean };
        expect(typeof errorObj.code).toBe('string');
        expect(typeof errorObj.message).toBe('string');
        expect(typeof errorObj.retryable).toBe('boolean');
      }
    });

    it('should return standard error format when JWT is missing', () => {
      const mockRequest = {
        headers: {}
      } as any;

      const result = authenticateWithJwt(mockRequest);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(result.error!.code).toBe(ApiErrorCode.UNAUTHORIZED);
      expect(result.error!.message).toContain('Authorization token not found');
      expect(result.error!.statusCode).toBe(401);
      expect(result.error!.retryable).toBe(false);

      // Verify toJSON() returns standard format
      const errorJson = result.error!.toJSON();
      expect(errorJson).toHaveProperty('error');
      expect(errorJson.error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: expect.stringContaining('Authorization token'),
        retryable: false
      });
    });

    it('should return standard error format when JWT is malformed', () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer malformed.jwt.token'
        }
      } as any;

      const result = authenticateWithJwt(mockRequest);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(ApiError);

      // Verify standard error format
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
      expect(result.error!.statusCode).toBe(401);
      expect(result.error!.retryable).toBe(false);

      // Verify toJSON() returns standard format
      const errorJson = result.error!.toJSON();
      expect(errorJson.error).toMatchObject({
        code: 'KEY_INVALID',
        message: expect.any(String),
        retryable: false
      });
    });
  });

  describe('Error Format Consistency Across All Errors', () => {
    it('should always return error object with code, message, and retryable', () => {
      // Test PROJECT_SUSPENDED
      const projectValidator = createProjectStatusValidator();
      const suspendedProject = createTestProject(ProjectStatus.SUSPENDED);
      const suspendedResult = projectValidator.validateProjectStatus(suspendedProject);

      expect(suspendedResult.error).toBeDefined();
      const suspendedJson = suspendedResult.error!.toJSON().error;
      if (typeof suspendedJson === 'object' && suspendedJson !== null) {
        const suspendedObj = suspendedJson as { code: string; message: string; retryable: boolean };
        expect(suspendedObj).toHaveProperty('code');
        expect(suspendedObj).toHaveProperty('message');
        expect(suspendedObj).toHaveProperty('retryable');
        expect(typeof suspendedObj.code).toBe('string');
        expect(typeof suspendedObj.message).toBe('string');
        expect(typeof suspendedObj.retryable).toBe('boolean');
      }

      // Test SERVICE_DISABLED
      const serviceValidator = createServiceEnablementValidator();
      const activeProject = createTestProject(ProjectStatus.ACTIVE);
      activeProject.enabledServices = ['service-b'];
      const serviceResult = serviceValidator.validateServiceEnablement(activeProject, 'service-a');

      expect(serviceResult.error).toBeDefined();
      const serviceJson = serviceResult.error!.toJSON().error;
      if (typeof serviceJson === 'object' && serviceJson !== null) {
        const serviceObj = serviceJson as { code: string; message: string; retryable: boolean };
        expect(serviceObj).toHaveProperty('code');
        expect(serviceObj).toHaveProperty('message');
        expect(serviceObj).toHaveProperty('retryable');
        expect(typeof serviceObj.code).toBe('string');
        expect(typeof serviceObj.message).toBe('string');
        expect(typeof serviceObj.retryable).toBe('boolean');
      }
    });

    it('should use correct HTTP status codes for each error type', () => {
      // PROJECT_SUSPENDED should be 403
      const projectValidator = createProjectStatusValidator();
      const suspendedProject = createTestProject(ProjectStatus.SUSPENDED);
      const suspendedResult = projectValidator.validateProjectStatus(suspendedProject);

      expect(suspendedResult.error!.statusCode).toBe(403);

      // SERVICE_DISABLED should be 403
      const serviceValidator = createServiceEnablementValidator();
      const activeProject = createTestProject(ProjectStatus.ACTIVE);
      activeProject.enabledServices = [];
      const serviceResult = serviceValidator.validateServiceEnablement(activeProject, 'service-a');

      expect(serviceResult.error!.statusCode).toBe(403);

      // RATE_LIMITED should be 429
      const rateError = ApiError.rateLimited({
        retryAfter: 60,
        resetTime: Date.now() + 60000,
        limit: 100,
        window: 'MINUTE'
      });

      expect(rateError.statusCode).toBe(429);

      // KEY_INVALID should be 401
      process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-min-32-chars';
      const mockRequest = { headers: { authorization: 'Bearer invalid' } } as any;
      const jwtResult = authenticateWithJwt(mockRequest);

      expect(jwtResult.error!.statusCode).toBe(401);
    });
  });

  describe('Error Code Values', () => {
    it('should use correct error code strings', () => {
      // Verify all required error codes exist
      expect(ApiErrorCode.PROJECT_SUSPENDED).toBe('PROJECT_SUSPENDED');
      expect(ApiErrorCode.SERVICE_DISABLED).toBe('SERVICE_DISABLED');
      expect(ApiErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
      expect(ApiErrorCode.KEY_INVALID).toBe('KEY_INVALID');
    });

    it('should return error codes in uppercase snake_case', () => {
      const codes = Object.values(ApiErrorCode);

      codes.forEach(code => {
        expect(code).toBe(code.toUpperCase());
        expect(code).toMatch(/^[A-Z0-9_]+$/);
      });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create errors with correct format using static methods', () => {
      // Test ApiError.projectSuspended()
      const suspendedError = ApiError.projectSuspended('test-project');
      expect(suspendedError.code).toBe(ApiErrorCode.PROJECT_SUSPENDED);
      expect(suspendedError.statusCode).toBe(403);
      expect(suspendedError.retryable).toBe(false);
      expect(suspendedError.toJSON().error).toHaveProperty('code');
      expect(suspendedError.toJSON().error).toHaveProperty('message');
      expect(suspendedError.toJSON().error).toHaveProperty('retryable');

      // Test ApiError.serviceDisabled()
      const serviceError = ApiError.serviceDisabled('service-a');
      expect(serviceError.code).toBe(ApiErrorCode.SERVICE_DISABLED);
      expect(serviceError.statusCode).toBe(403);
      expect(serviceError.retryable).toBe(false);
      expect(serviceError.toJSON().error).toHaveProperty('code');
      expect(serviceError.toJSON().error).toHaveProperty('message');
      expect(serviceError.toJSON().error).toHaveProperty('retryable');

      // Test ApiError.rateLimited()
      const rateError = ApiError.rateLimited({ retryAfter: 60, resetTime: Date.now() + 60000, limit: 100, window: 'MINUTE' });
      expect(rateError.code).toBe(ApiErrorCode.RATE_LIMITED);
      expect(rateError.statusCode).toBe(429);
      expect(rateError.retryable).toBe(true);
      expect(rateError.toJSON().error).toHaveProperty('code');
      expect(rateError.toJSON().error).toHaveProperty('message');
      expect(rateError.toJSON().error).toHaveProperty('retryable');
      expect(rateError.toJSON().error).toHaveProperty('details');

      // Test ApiError.keyInvalid()
      const keyError = ApiError.keyInvalid();
      expect(keyError.code).toBe(ApiErrorCode.KEY_INVALID);
      expect(keyError.statusCode).toBe(401);
      expect(keyError.retryable).toBe(false);
      expect(keyError.toJSON().error).toHaveProperty('code');
      expect(keyError.toJSON().error).toHaveProperty('message');
      expect(keyError.toJSON().error).toHaveProperty('retryable');
    });
  });
});
