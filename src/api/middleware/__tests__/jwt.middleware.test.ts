/**
 * JWT Middleware Unit Tests
 *
 * Tests for JWT authentication middleware including:
 * - Token extraction from Authorization header
 * - Token validation and signature verification
 * - Project ID extraction from JWT claims
 * - Error handling for invalid tokens
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Request } from 'express';
import {
  authenticateWithJwt,
  JwtPayload,
  generateTestToken
} from '../jwt.middleware.js';
import { ApiErrorCode } from '../error.handler.js';

// Mock environment variables
const TEST_JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long-for-security';

describe('JWT Middleware', () => {
  beforeEach(() => {
    // Set environment variables for testing
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_ALGORITHM = 'HS256';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';
  });

  describe('authenticateWithJwt', () => {
    it('should successfully authenticate valid JWT with project_id', () => {
      const validPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
        project_id: 'test-project-123'
      };

      const validToken = generateTestToken(validPayload, TEST_JWT_SECRET);

      const req = {
        headers: {
          authorization: `Bearer ${validToken}`
        }
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.project_id).toBe('test-project-123');
    });

    it('should reject token without project_id claim', () => {
      const invalidPayload = {
        sub: 'user-123'
        // Missing project_id
      };

      const token = generateTestToken(invalidPayload as Omit<JwtPayload, 'iat' | 'exp'>, TEST_JWT_SECRET);

      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
    });

    it('should reject token with invalid project_id format', () => {
      const invalidPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
        project_id: 'invalid project id with spaces!' // Invalid format
      };

      const token = generateTestToken(invalidPayload, TEST_JWT_SECRET);

      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
    });

    it('should reject malformed token', () => {
      const req = {
        headers: {
          authorization: 'Bearer not-a-valid-jwt-token'
        }
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
    });

    it('should reject token signed with wrong secret', () => {
      const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
        project_id: 'test-project-123'
      };

      // Sign with different secret
      const token = generateTestToken(payload, 'wrong-secret-key');

      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ApiErrorCode.KEY_INVALID);
    });

    it('should reject request without Authorization header', () => {
      const req = {
        headers: {}
      } as unknown as Request;

      const result = authenticateWithJwt(req);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ApiErrorCode.UNAUTHORIZED);
    });
  });

  describe('generateTestToken', () => {
    it('should generate valid JWT token with project_id', () => {
      const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
        project_id: 'test-project-456',
        iss: 'test-issuer',
        aud: 'test-audience'
      };

      const token = generateTestToken(payload, TEST_JWT_SECRET);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // Verify token structure (3 parts separated by dots)
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });
  });
});
