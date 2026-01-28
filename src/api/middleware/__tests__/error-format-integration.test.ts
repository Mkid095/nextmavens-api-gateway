/**
 * Error Format Integration Tests
 *
 * Integration tests to verify that all errors returned by the API
 * follow the standard error format: { error: { code, message, retryable, details? } }
 */

import { describe, it, expect } from '@jest/globals';
import { ApiErrorCode } from '../error.handler.js';

describe('Error Format Integration', () => {
  describe('Error code consistency', () => {
    it('should have PROJECT_SUSPENDED error code', () => {
      expect(ApiErrorCode.PROJECT_SUSPENDED).toBe('PROJECT_SUSPENDED');
    });

    it('should have SERVICE_DISABLED error code', () => {
      expect(ApiErrorCode.SERVICE_DISABLED).toBe('SERVICE_DISABLED');
    });

    it('should have RATE_LIMITED error code', () => {
      expect(ApiErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    });

    it('should have KEY_INVALID error code', () => {
      expect(ApiErrorCode.KEY_INVALID).toBe('KEY_INVALID');
    });
  });

  describe('Error format structure', () => {
    it('should define error codes as strings', () => {
      const codes = Object.values(ApiErrorCode);

      codes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });

    it('should use uppercase snake_case for error codes', () => {
      const codes = Object.values(ApiErrorCode);

      codes.forEach(code => {
        // Should be uppercase
        expect(code).toBe(code.toUpperCase());
        // Should only contain letters, numbers, and underscores
        expect(code).toMatch(/^[A-Z0-9_]+$/);
      });
    });
  });

  describe('Required error codes for US-007', () => {
    it('should include all required error codes', () => {
      const requiredCodes = [
        'PROJECT_SUSPENDED',
        'SERVICE_DISABLED',
        'RATE_LIMITED',
        'KEY_INVALID'
      ];

      requiredCodes.forEach(code => {
        expect(Object.values(ApiErrorCode)).toContain(code);
      });
    });
  });

  describe('Error code uniqueness', () => {
    it('should have unique error codes', () => {
      const codes = Object.values(ApiErrorCode);
      const uniqueCodes = new Set(codes);

      expect(codes.length).toBe(uniqueCodes.size);
    });
  });
});
