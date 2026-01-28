/**
 * Correlation Middleware Unit Tests
 *
 * Tests for correlation ID middleware including:
 * - Extraction of existing x-request-id header
 * - Generation of new UUID when header is missing
 * - Attachment of correlation ID to request object
 * - Setting of x-request-id response header
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import {
  correlationMiddleware,
  getCorrelationId,
  formatLogWithCorrelation
} from '../correlation.middleware.js';

describe('Correlation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    // Reset mocks before each test
    mockReq = {
      headers: {}
    };

    mockRes = {
      setHeader: jest.fn() as any,
      getHeader: jest.fn() as any
    };

    mockNext = jest.fn() as any;
  });

  /**
   * Helper to properly type headers as non-undefined for testing
   */
  function getHeaders(req: Partial<Request>): Record<string, string | string[] | undefined> {
    return req.headers as Record<string, string | string[] | undefined>;
  }

  describe('correlationMiddleware', () => {
    it('should generate new correlation ID when x-request-id header is not present', () => {
      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify correlation ID was generated and stored on request
      expect(mockReq.correlationId).toBeDefined();
      expect(typeof mockReq.correlationId).toBe('string');
      expect(mockReq.correlationId!.length).toBeGreaterThan(0);

      // Verify UUID format (standard UUID v4 has 36 characters)
      expect(mockReq.correlationId!.length).toBe(36);

      // Verify header was set on request
      expect(getHeaders(mockReq)['x-request-id']).toBe(mockReq.correlationId);

      // Verify response header was set
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', mockReq.correlationId);

      // Verify middleware called next()
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should use existing x-request-id header when present', () => {
      const existingCorrelationId = 'existing-correlation-id-12345';
      mockReq.headers = {
        'x-request-id': existingCorrelationId
      };

      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify existing correlation ID was used
      expect(mockReq.correlationId).toBe(existingCorrelationId);

      // Verify header was preserved on request
      expect(getHeaders(mockReq)['x-request-id']).toBe(existingCorrelationId);

      // Verify response header was set with existing ID
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', existingCorrelationId);

      // Verify middleware called next()
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should handle x-request-id header as array (use first value)', () => {
      const firstId = 'first-correlation-id';
      const secondId = 'second-correlation-id';
      mockReq.headers = {
        'x-request-id': [firstId, secondId]
      };

      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify first value was used
      expect(mockReq.correlationId).toBe(firstId);

      // Verify response header was set with first value
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', firstId);
    });

    it('should generate different IDs for multiple requests without header', () => {
      const mockReq2: Partial<Request> = { headers: {} };
      const mockRes2: Partial<Response> = {
        setHeader: jest.fn() as any,
        getHeader: jest.fn() as any
      };
      const mockNext2: NextFunction = jest.fn() as any;

      // Process first request
      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Process second request
      correlationMiddleware(
        mockReq2 as Request,
        mockRes2 as Response,
        mockNext2
      );

      // Verify different correlation IDs were generated
      expect(mockReq.correlationId).toBeDefined();
      expect(mockReq2.correlationId).toBeDefined();
      expect(mockReq.correlationId).not.toBe(mockReq2.correlationId);
    });

    it('should maintain same correlation ID across multiple calls with header', () => {
      const existingCorrelationId = 'consistent-correlation-id';
      mockReq.headers = {
        'x-request-id': existingCorrelationId
      };

      // First call
      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      const firstCorrelationId = mockReq.correlationId;

      // Reset mockNext
      mockNext = jest.fn() as any;

      // Second call (same request object)
      correlationMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify correlation ID remains consistent
      expect(mockReq.correlationId).toBe(firstCorrelationId);
      expect(mockReq.correlationId).toBe(existingCorrelationId);
    });
  });

  describe('getCorrelationId', () => {
    it('should return correlation ID when set on request', () => {
      mockReq.correlationId = 'test-correlation-id';

      const result = getCorrelationId(mockReq as Request);

      expect(result).toBe('test-correlation-id');
    });

    it('should return "unknown" when correlation ID is not set', () => {
      const result = getCorrelationId(mockReq as Request);

      expect(result).toBe('unknown');
    });

    it('should return "unknown" when correlation ID is empty string', () => {
      mockReq.correlationId = '';

      const result = getCorrelationId(mockReq as Request);

      expect(result).toBe('unknown');
    });
  });

  describe('formatLogWithCorrelation', () => {
    it('should format log message with correlation ID', () => {
      mockReq.correlationId = 'test-id-123';

      const result = formatLogWithCorrelation(mockReq as Request, 'Test log message');

      expect(result).toBe('[test-id-123] Test log message');
    });

    it('should use "unknown" when correlation ID is missing', () => {
      const result = formatLogWithCorrelation(mockReq as Request, 'Test log message');

      expect(result).toBe('[unknown] Test log message');
    });

    it('should handle empty log message', () => {
      mockReq.correlationId = 'test-id-123';

      const result = formatLogWithCorrelation(mockReq as Request, '');

      expect(result).toBe('[test-id-123] ');
    });

    it('should handle special characters in log message', () => {
      mockReq.correlationId = 'test-id-123';

      const result = formatLogWithCorrelation(
        mockReq as Request,
        'Test with special chars: @#$%^&*()'
      );

      expect(result).toBe('[test-id-123] Test with special chars: @#$%^&*()');
    });
  });
});
