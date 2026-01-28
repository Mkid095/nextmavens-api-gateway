/**
 * Global Error Handler Integration Test
 *
 * This test verifies that:
 * 1. The global Express error handler catches all errors
 * 2. Error responses follow the standard format
 * 3. Error responses include: code, message, retryable fields
 */

import request from 'supertest';
import express, { Request, Response } from 'express';
import { ApiError, ApiErrorCode } from '../error.handler.js';

describe('Global Error Handler Integration', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Add a test endpoint that throws ApiError directly
    app.get('/test/api-error', (_req: Request, _res: Response) => {
      throw new ApiError(
        ApiErrorCode.SERVICE_DISABLED,
        'Test service is disabled',
        403,
        false
      );
    });

    // Add a test endpoint that throws generic Error
    app.get('/test/generic-error', (_req: Request, _res: Response) => {
      throw new Error('Generic error message');
    });

    // Add a test endpoint that throws ApiError with details
    app.get('/test/api-error-with-details', (_req: Request, _res: Response) => {
      throw new ApiError(
        ApiErrorCode.RATE_LIMITED,
        'Rate limit exceeded',
        429,
        true,
        {
          retryAfter: 60,
          limit: 100,
          window: 'MINUTE'
        }
      );
    });

    // Add a test endpoint that returns success
    app.get('/test/success', (_req: Request, res: Response) => {
      res.json({ message: 'Success' });
    });

    // Global error handler (same as in src/index.ts)
    app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(`[ErrorHandler] ${req.method} ${req.path}: ${err.message}`);

      // Handle ApiError instances with proper formatting
      if (err instanceof ApiError) {
        const errorResponse = err.toJSON();
        return res.status(err.statusCode).json(errorResponse);
      }

      // Handle generic errors
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message,
          retryable: false
        }
      });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Cannot ${req.method} ${req.path}`,
          retryable: false
        }
      });
    });
  });

  describe('ApiError handling', () => {
    it('should catch ApiError and return standard error format', async () => {
      const response = await request(app)
        .get('/test/api-error')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatchObject({
        code: 'SERVICE_DISABLED',
        message: 'Test service is disabled',
        retryable: false
      });
    });

    it('should include all required error fields', async () => {
      const response = await request(app)
        .get('/test/api-error')
        .expect(403);

      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('retryable');
      expect(typeof response.body.error.code).toBe('string');
      expect(typeof response.body.error.message).toBe('string');
      expect(typeof response.body.error.retryable).toBe('boolean');
    });

    it('should include optional details field when provided', async () => {
      const response = await request(app)
        .get('/test/api-error-with-details')
        .expect(429);

      expect(response.body.error).toHaveProperty('details');
      expect(response.body.error.details).toMatchObject({
        retryAfter: 60,
        limit: 100,
        window: 'MINUTE'
      });
    });

    it('should not include details field when not provided', async () => {
      const response = await request(app)
        .get('/test/api-error')
        .expect(403);

      expect(response.body.error).not.toHaveProperty('details');
    });
  });

  describe('Generic error handling', () => {
    it('should catch generic Error and convert to standard format', async () => {
      const response = await request(app)
        .get('/test/generic-error')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Generic error message',
        retryable: false
      });
    });

    it('should include all required fields for generic errors', async () => {
      const response = await request(app)
        .get('/test/generic-error')
        .expect(500);

      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('retryable');
      expect(typeof response.body.error.code).toBe('string');
      expect(typeof response.body.error.message).toBe('string');
      expect(typeof response.body.error.retryable).toBe('boolean');
    });
  });

  describe('404 handler', () => {
    it('should return NOT_FOUND error for unknown routes', async () => {
      const response = await request(app)
        .get('/unknown-route')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Cannot GET /unknown-route',
        retryable: false
      });
    });

    it('should include HTTP method in 404 error message', async () => {
      const response = await request(app)
        .post('/unknown-route')
        .expect(404);

      expect(response.body.error.message).toBe('Cannot POST /unknown-route');
    });
  });

  describe('Error code consistency', () => {
    it('should use correct error codes across all error types', async () => {
      // Test SERVICE_DISABLED
      const response1 = await request(app)
        .get('/test/api-error')
        .expect(403);
      expect(response1.body.error.code).toBe('SERVICE_DISABLED');

      // Test INTERNAL_ERROR
      const response2 = await request(app)
        .get('/test/generic-error')
        .expect(500);
      expect(response2.body.error.code).toBe('INTERNAL_ERROR');

      // Test RATE_LIMITED
      const response3 = await request(app)
        .get('/test/api-error-with-details')
        .expect(429);
      expect(response3.body.error.code).toBe('RATE_LIMITED');

      // Test NOT_FOUND
      const response4 = await request(app)
        .get('/unknown-route')
        .expect(404);
      expect(response4.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Retryable flag behavior', () => {
    it('should mark non-retryable errors correctly', async () => {
      const response = await request(app)
        .get('/test/api-error')
        .expect(403);

      expect(response.body.error.retryable).toBe(false);
    });

    it('should mark retryable errors correctly', async () => {
      const response = await request(app)
        .get('/test/api-error-with-details')
        .expect(429);

      expect(response.body.error.retryable).toBe(true);
    });

    it('should mark generic errors as non-retryable', async () => {
      const response = await request(app)
        .get('/test/generic-error')
        .expect(500);

      expect(response.body.error.retryable).toBe(false);
    });
  });

  describe('HTTP status codes', () => {
    it('should use correct HTTP status code for each error type', async () => {
      // 403 for SERVICE_DISABLED
      await request(app)
        .get('/test/api-error')
        .expect(403);

      // 500 for INTERNAL_ERROR
      await request(app)
        .get('/test/generic-error')
        .expect(500);

      // 429 for RATE_LIMITED
      await request(app)
        .get('/test/api-error-with-details')
        .expect(429);

      // 404 for NOT_FOUND
      await request(app)
        .get('/unknown-route')
        .expect(404);
    });
  });

  describe('Success responses', () => {
    it('should not interfere with successful responses', async () => {
      const response = await request(app)
        .get('/test/success')
        .expect(200);

      expect(response.body).toMatchObject({
        message: 'Success'
      });
      expect(response.body).not.toHaveProperty('error');
    });
  });

  describe('Error format structure', () => {
    it('should always have error object at top level', async () => {
      const responses = await Promise.all([
        request(app).get('/test/api-error'),
        request(app).get('/test/generic-error'),
        request(app).get('/unknown-route')
      ]);

      responses.forEach(response => {
        expect(response.body).toHaveProperty('error');
        expect(typeof response.body.error).toBe('object');
      });
    });

    it('should never have additional top-level properties besides error', async () => {
      const response = await request(app)
        .get('/test/api-error')
        .expect(403);

      const keys = Object.keys(response.body);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe('error');
    });
  });
});
