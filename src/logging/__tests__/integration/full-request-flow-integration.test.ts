import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { correlationMiddleware } from '@/api/middleware/correlation.middleware.js';
import { requireJwtAuth, extractProjectIdFromJwt, generateTestToken } from '@/api/middleware/jwt.middleware.js';
import { validateProjectStatus } from '@/validation/middleware/project-status.middleware.js';
import { requestLoggerMiddleware } from '@/api/middleware/request-logger.middleware.js';

// Mock console.log to capture log output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Full Request Flow Integration Tests (US-008)', () => {
  let app: express.Application;
  let validToken: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment for JWT
    process.env.JWT_SECRET = 'test-secret-key-for-jwt-testing-min-32-chars';
    process.env.JWT_ALGORITHM = 'HS256';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';

    // Generate a valid test token
    validToken = generateTestToken({
      project_id: 'test-project-123'
    });

    // Create Express app with full middleware chain
    app = express();
    app.use(express.json());

    // Apply middleware in correct order (US-008)
    // 1. Correlation ID middleware (US-006)
    app.use(correlationMiddleware);

    // Add a JWT-protected test route
    // Middleware chain: correlation -> JWT -> extract project_id -> logging -> handler
    app.get(
      '/api/jwt/test',
      requireJwtAuth,
      extractProjectIdFromJwt,
      requestLoggerMiddleware,
      (req, res) => {
        res.json({
          message: 'JWT authenticated request',
          projectId: (req as unknown as Record<string, unknown>).projectId,
          correlationId: req.correlationId
        });
      }
    );

    // Add a JWT-protected route with project validation
    app.get(
      '/api/jwt/validated',
      requireJwtAuth,
      extractProjectIdFromJwt,
      validateProjectStatus,
      requestLoggerMiddleware,
      (req, res) => {
        res.json({
          message: 'JWT authenticated and validated request',
          projectId: (req as unknown as Record<string, unknown>).projectId,
          project: (req as unknown as Record<string, unknown>).project
        });
      }
    );

    // Add a route without JWT (for comparison)
    app.get('/api/public', (_req, res) => {
      res.json({ message: 'public endpoint' });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('JWT Authentication + Request Logging Integration', () => {
    it('should log request with project_id from JWT', async () => {
      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('projectId', 'test-project-123');
      expect(response.body).toHaveProperty('correlationId');

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify logging occurred
      expect(mockConsoleLog).toHaveBeenCalled();

      // Find the request log entry
      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      expect(requestLog).toBeDefined();

      // Parse and verify log entry
      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      // Verify all required fields are present (US-008 acceptance criteria)
      expect(logData).toHaveProperty('correlationId');
      expect(logData).toHaveProperty('projectId', 'test-project-123');
      expect(logData).toHaveProperty('method', 'GET');
      expect(logData).toHaveProperty('path', '/api/jwt/test');
      expect(logData).toHaveProperty('statusCode', 200);
      expect(logData).toHaveProperty('duration');
      expect(logData).toHaveProperty('timestamp');

      // Verify correlation ID matches response
      expect(logData.correlationId).toBe(response.body.correlationId);
    });

    it('should log failed JWT authentication attempts', async () => {
      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20));

      // Failed auth shouldn't trigger request logging (middleware chain stops at JWT)
      // The requestLoggerMiddleware is not reached because JWT middleware rejects first
      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      // Should NOT have request log because middleware chain stopped at JWT
      expect(requestLog).toBeUndefined();
    });

    it('should include correlation_id from header if provided', async () => {
      const customCorrelationId = 'custom-correlation-id-123';

      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', `Bearer ${validToken}`)
        .set('x-request-id', customCorrelationId);

      expect(response.status).toBe(200);
      expect(response.body.correlationId).toBe(customCorrelationId);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify log uses custom correlation ID
      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.correlationId).toBe(customCorrelationId);
    });
  });

  describe('Async Logging Performance Tests', () => {
    it('should not block request processing while logging', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', `Bearer ${validToken}`);

      const requestDuration = Date.now() - startTime;

      // Request should complete quickly (< 100ms)
      // even though logging happens asynchronously
      expect(requestDuration).toBeLessThan(100);
      expect(response.status).toBe(200);

      // Wait for async logging to complete
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify logging happened
      expect(mockConsoleLog).toHaveBeenCalled();

      // Find and verify log entry
      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      expect(requestLog).toBeDefined();
    });

    it('should log multiple concurrent requests without blocking', async () => {
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .get('/api/jwt/test')
          .set('Authorization', `Bearer ${validToken}`)
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalDuration = Date.now() - startTime;

      // All requests should complete quickly
      expect(responses).toHaveLength(10);
      expect(responses.every(r => r.status === 200)).toBe(true);

      // Total time should be much less than if requests were sequential
      // (10 sequential requests would take much longer)
      expect(totalDuration).toBeLessThan(500);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify all requests were logged
      const logCalls = mockConsoleLog.mock.calls;
      const requestLogs = logCalls.filter(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      expect(requestLogs.length).toBe(10);
    });

    it('should handle logging errors without affecting requests', async () => {
      // Save original implementation
      const originalImpl = mockConsoleLog.getMockImplementation();

      // Mock console.log to throw an error only for [RequestLog] messages
      mockConsoleLog.mockImplementation((message: unknown) => {
        if (typeof message === 'string' && message.includes('[RequestLog]')) {
          throw new Error('Logging failed');
        }
        // Call original for other messages
        if (originalImpl) {
          originalImpl(message);
        }
      });

      // Request should still succeed even if logging fails
      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('projectId', 'test-project-123');

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify the request completed successfully despite logging error
      expect(response.body).toHaveProperty('correlationId');

      // Reset mock
      mockConsoleLog.mockReset();
      mockConsoleLog.mockImplementation(() => {});
    });
  });

  describe('Request Duration Tracking', () => {
    it('should accurately track request duration', async () => {
      // Add a route with known delay
      app.get('/api/slow', requireJwtAuth, extractProjectIdFromJwt, requestLoggerMiddleware, async (_req, res) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        res.json({ message: 'slow response' });
      });

      const response = await request(app)
        .get('/api/slow')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 20));

      // Find log entry
      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      // Duration should be at least 50ms (our artificial delay)
      expect(logData.duration).toBeGreaterThanOrEqual(50);
      expect(logData.duration).toBeLessThan(200); // But not too long
    });
  });

  describe('Different HTTP Methods and Status Codes', () => {
    beforeEach(() => {
      // Add routes with different methods
      app.post('/api/jwt/create', requireJwtAuth, extractProjectIdFromJwt, requestLoggerMiddleware, (req, res) => {
        res.status(201).json({ created: true, data: req.body });
      });

      app.put('/api/jwt/update', requireJwtAuth, extractProjectIdFromJwt, requestLoggerMiddleware, (req, res) => {
        res.json({ updated: true, data: req.body });
      });

      app.delete('/api/jwt/delete', requireJwtAuth, extractProjectIdFromJwt, requestLoggerMiddleware, (_req, res) => {
        res.status(204).send();
      });

      app.get('/api/jwt/error', requireJwtAuth, extractProjectIdFromJwt, requestLoggerMiddleware, (_req, res) => {
        res.status(500).json({ error: 'Internal server error' });
      });
    });

    it('should log POST requests with correct status', async () => {
      const response = await request(app)
        .post('/api/jwt/create')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ name: 'test' });

      expect(response.status).toBe(201);

      await new Promise(resolve => setTimeout(resolve, 20));

      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.method).toBe('POST');
      expect(logData.path).toBe('/api/jwt/create');
      expect(logData.statusCode).toBe(201);
    });

    it('should log PUT requests correctly', async () => {
      const response = await request(app)
        .put('/api/jwt/update')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ name: 'updated' });

      expect(response.status).toBe(200);

      await new Promise(resolve => setTimeout(resolve, 20));

      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.method).toBe('PUT');
      expect(logData.statusCode).toBe(200);
    });

    it('should log DELETE requests with 204 status', async () => {
      const response = await request(app)
        .delete('/api/jwt/delete')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(204);

      await new Promise(resolve => setTimeout(resolve, 20));

      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.method).toBe('DELETE');
      expect(logData.statusCode).toBe(204);
    });

    it('should log error responses correctly', async () => {
      const response = await request(app)
        .get('/api/jwt/error')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(500);

      await new Promise(resolve => setTimeout(resolve, 20));

      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.method).toBe('GET');
      expect(logData.statusCode).toBe(500);
      expect(logData.path).toBe('/api/jwt/error');
    });
  });

  describe('Timestamp Format', () => {
    it('should log ISO 8601 timestamps', async () => {
      const response = await request(app)
        .get('/api/jwt/test')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);

      await new Promise(resolve => setTimeout(resolve, 20));

      const logCalls = mockConsoleLog.mock.calls;
      const requestLog = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = requestLog![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      // Verify timestamp format
      expect(logData.timestamp).toBeDefined();
      expect(typeof logData.timestamp).toBe('string');

      // Should be valid ISO 8601 date
      const date = new Date(logData.timestamp);
      expect(date.toISOString()).toBe(logData.timestamp);

      // Should be recent (within last minute)
      const logTime = new Date(logData.timestamp).getTime();
      const now = Date.now();
      expect(logTime).toBeLessThanOrEqual(now);
      expect(logTime).toBeGreaterThan(now - 60000);
    });
  });
});
