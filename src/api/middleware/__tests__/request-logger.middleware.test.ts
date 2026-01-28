import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { requestLoggerMiddleware, createLogEntry, formatLogEntryAsString } from '../request-logger.middleware.js';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Mock console.log to capture output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('Request Logger Middleware (US-008)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock request
    mockReq = {
      method: 'GET',
      path: '/api/test',
      url: '/api/test?param=value',
      headers: {},
      correlationId: randomUUID()
    };

    // Setup mock response with finish event
    mockRes = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          // Simulate immediate finish for testing
          setTimeout(callback, 0);
        }
        return mockRes as Response;
      })
    };

    // Setup mock next function
    mockNext = jest.fn();
  });

  describe('requestLoggerMiddleware', () => {
    it('should record start time on request', () => {
      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._startTime).toBeDefined();
      expect(typeof mockReq._startTime).toBe('number');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract project_id from JWT', () => {
      mockReq.projectId = 'project-123';

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._projectId).toBe('project-123');
    });

    it('should extract project_id from x-project-id header', () => {
      mockReq.headers = {
        'x-project-id': 'project-456'
      };

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._projectId).toBe('project-456');
    });

    it('should prioritize JWT project_id over header', () => {
      mockReq.projectId = 'project-from-jwt';
      mockReq.headers = {
        'x-project-id': 'project-from-header'
      };

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._projectId).toBe('project-from-jwt');
    });

    it('should not have project_id when not provided', () => {
      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._projectId).toBeUndefined();
    });

    it('should log request on finish event', async () => {
      mockReq.projectId = 'project-123';
      mockReq.correlationId = 'test-correlation-123';

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockConsoleLog).toHaveBeenCalled();
      const logCalls = mockConsoleLog.mock.calls;
      const requestLogCall = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[test-correlation-123]')
      );
      expect(requestLogCall).toBeDefined();
    });

    it('should log all required fields', async () => {
      const testCorrelationId = 'test-correlation-456';
      const testProjectId = 'project-789';

      mockReq = {
        method: 'POST',
        path: '/api/data',
        url: '/api/data',
        headers: {},
        correlationId: testCorrelationId,
        projectId: testProjectId
      };

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockConsoleLog).toHaveBeenCalled();
      const logCalls = mockConsoleLog.mock.calls;
      const logEntry = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      expect(logEntry).toBeDefined();

      // Parse the JSON log entry
      const logString = logEntry![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.correlationId).toBe(testCorrelationId);
      expect(logData.projectId).toBe(testProjectId);
      expect(logData.method).toBe('POST');
      expect(logData.path).toBe('/api/data');
      expect(logData.statusCode).toBe(200);
      expect(logData.duration).toBeGreaterThanOrEqual(0);
      expect(logData.timestamp).toBeDefined();
    });

    it('should use "unknown" for correlation_id when not set', async () => {
      delete mockReq.correlationId;

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockConsoleLog).toHaveBeenCalled();
      const logCalls = mockConsoleLog.mock.calls;
      const logEntry = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      expect(logEntry).toBeDefined();

      const logString = logEntry![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.correlationId).toBe('unknown');
    });

    it('should not include query parameters in path', async () => {
      mockReq = {
        method: 'GET',
        path: '/api/test',
        url: '/api/test?sensitive=data',
        headers: {},
        correlationId: 'test-correlation'
      };

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      const logCalls = mockConsoleLog.mock.calls;
      const logEntry = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = logEntry![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.path).toBe('/api/test');
      expect(logData.path).not.toContain('?');
      expect(logData.path).not.toContain('sensitive');
    });

    it('should handle logging errors gracefully', async () => {
      // Mock JSON.stringify to throw an error
      const originalStringify = JSON.stringify;
      JSON.stringify = jest.fn(() => {
        throw new Error('JSON error');
      });

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should log error but not crash
      expect(mockConsoleError).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();

      // Restore original JSON.stringify
      JSON.stringify = originalStringify;
    });
  });

  describe('createLogEntry', () => {
    it('should create log entry with all required fields', () => {
      mockReq = {
        method: 'DELETE',
        path: '/api/resource/123',
        url: '/api/resource/123',
        headers: {},
        correlationId: 'test-correlation',
        projectId: 'project-123'
      };
      (mockRes as Response).statusCode = 204;

      const duration = 123;
      const logEntry = createLogEntry(
        mockReq as Request,
        mockRes as Response,
        duration
      );

      expect(logEntry).toEqual({
        correlationId: 'test-correlation',
        projectId: 'project-123',
        method: 'DELETE',
        path: '/api/resource/123',
        statusCode: 204,
        duration: 123,
        timestamp: expect.any(String)
      });
    });

    it('should create log entry without project_id', () => {
      mockReq = {
        method: 'GET',
        path: '/api/public',
        url: '/api/public',
        headers: {},
        correlationId: 'test-correlation'
      };
      (mockRes as Response).statusCode = 200;

      const logEntry = createLogEntry(
        mockReq as Request,
        mockRes as Response,
        50
      );

      expect(logEntry.projectId).toBeUndefined();
      expect(logEntry.correlationId).toBe('test-correlation');
    });
  });

  describe('formatLogEntryAsString', () => {
    it('should format log entry as JSON string', () => {
      const logEntry = {
        correlationId: 'test-123',
        projectId: 'project-456',
        method: 'GET',
        path: '/api/test',
        statusCode: 200,
        duration: 100,
        timestamp: '2024-01-28T12:00:00.000Z'
      };

      const formatted = formatLogEntryAsString(logEntry);
      const parsed = JSON.parse(formatted);

      expect(parsed).toEqual(logEntry);
    });
  });

  describe('Integration with correlation middleware', () => {
    it('should use correlation_id from request', async () => {
      const testCorrelationId = 'integration-test-123';
      mockReq.correlationId = testCorrelationId;
      mockReq.projectId = 'project-integration';

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 10));

      const logCalls = mockConsoleLog.mock.calls;
      const logEntry = logCalls.find(call =>
        call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
      );

      const logString = logEntry![0] as string;
      const jsonPart = logString.replace('[RequestLog] ', '');
      const logData = JSON.parse(jsonPart);

      expect(logData.correlationId).toBe(testCorrelationId);
    });
  });

  describe('Integration with JWT middleware', () => {
    it('should use project_id from JWT', () => {
      mockReq.projectId = 'jwt-project-123';

      requestLoggerMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq._projectId).toBe('jwt-project-123');
    });
  });
});
