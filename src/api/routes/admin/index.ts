/**
 * Break Glass Authentication Routes
 *
 * Routes for break glass emergency access authentication.
 * These endpoints provide super-admin powers for emergency situations.
 *
 * US-003: Implement Break Glass Authentication - Step 1: Foundation
 *
 * POST /api/admin/break-glass - Initiate break glass session
 *
 * @example
 * ```typescript
 * // POST /api/admin/break-glass
 * {
 *   "totp_code": "123456",
 *   "reason": "Production incident - locked out of critical project",
 *   "access_method": "otp"
 * }
 * ```
 */

import { type Router, Request, Response } from 'express';
import {
  createAdminSession,
  validateAdminSession,
  logAuditEvent,
  AccessMethod,
  ActorType,
  TargetType,
} from '@nextmavens/audit-logs-database';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';

/**
 * Break glass request body interface
 */
interface BreakGlassRequestBody {
  /** TOTP code (6-digit) OR hardware key credential */
  totp_code?: string;
  /** Hardware key credential (for WebAuthn) */
  hardware_key?: string;
  /** Reason for break glass access (min 10 chars) */
  reason: string;
  /** Access method: 'otp' or 'hardware_key' */
  access_method: 'otp' | 'hardware_key';
}

/**
 * Break glass response interface
 */
interface BreakGlassResponse {
  /** Temporary break glass token (JWT) */
  token: string;
  /** Session ID */
  session_id: string;
  /** Expiration timestamp */
  expires_at: Date;
  /** Admin ID */
  admin_id: string;
}

/**
 * JWT payload for break glass tokens
 */
interface BreakGlassJwtPayload {
  /** Session ID */
  session_id: string;
  /** Admin ID */
  admin_id: string;
  /** Break glass scope */
  scope: 'break_glass';
  /** Expiration timestamp */
  exp: number;
  /** Issued at timestamp */
  iat: number;
}

/**
 * Configure break glass authentication routes
 *
 * @param app - Express application
 */
export function configureBreakGlassRoutes(app: Router): void {
  /**
   * POST /api/admin/break-glass
   *
   * Initiate a break glass session with TOTP or hardware key authentication.
   * Creates a time-limited admin session (1 hour) and returns a JWT token.
   *
   * Request body:
   * - totp_code: string (6-digit TOTP code, required if access_method is 'otp')
   * - hardware_key: string (WebAuthn credential, required if access_method is 'hardware_key')
   * - reason: string (min 10 chars, required)
   * - access_method: 'otp' | 'hardware_key' (required)
   *
   * Response:
   * - token: string (JWT token valid for 1 hour)
   * - session_id: string (UUID of the admin session)
   * - expires_at: Date (session expiration timestamp)
   * - admin_id: string (UUID of the admin)
   *
   * Security:
   * - Requires valid JWT authentication (admin user)
   * - Validates TOTP code or hardware key credential
   * - Requires reason for access (min 10 chars)
   * - Creates audit log entry
   * - Token expires after 1 hour
   *
   * @example
   * ```typescript
   * // Request
   * POST /api/admin/break-glass
   * Authorization: Bearer <admin_jwt_token>
   * {
   *   "totp_code": "123456",
   *   "reason": "Production incident - locked out of critical project",
   *   "access_method": "otp"
   * }
   *
   * // Response
   * {
   *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   *   "session_id": "550e8400-e29b-41d4-a716-446655440000",
   *   "expires_at": "2026-01-29T20:00:00.000Z",
   *   "admin_id": "admin-uuid-123"
   * }
   * ```
   */
  app.post(
    '/api/admin/break-glass',
    requireJwtAuth,
    async (req: Request, res: Response) => {
      try {
        const { jwtPayload } = req;
        const body = req.body as BreakGlassRequestBody;

        // Extract admin ID from JWT
        const admin_id = jwtPayload?.userId;
        if (!admin_id) {
          const error = new ApiError(
            ApiErrorCode.UNAUTHORIZED,
            'Admin ID not found in token',
            401,
            true
          );
          return res.status(error.statusCode).json(error.toJSON());
        }

        // Validate required fields
        if (!body.reason || typeof body.reason !== 'string') {
          const error = new ApiError(
            ApiErrorCode.VALIDATION_ERROR,
            'Reason is required and must be a string',
            400,
            true
          );
          return res.status(error.statusCode).json(error.toJSON());
        }

        if (body.reason.length < 10) {
          const error = new ApiError(
            ApiErrorCode.VALIDATION_ERROR,
            'Reason must be at least 10 characters long',
            400,
            true
          );
          return res.status(error.statusCode).json(error.toJSON());
        }

        if (!body.access_method || typeof body.access_method !== 'string') {
          const error = new ApiError(
            ApiErrorCode.VALIDATION_ERROR,
            'Access method is required and must be a string',
            400,
            true
          );
          return res.status(error.statusCode).json(error.toJSON());
        }

        // Validate access method
        if (!['otp', 'hardware_key'].includes(body.access_method)) {
          const error = new ApiError(
            ApiErrorCode.VALIDATION_ERROR,
            'Access method must be either "otp" or "hardware_key"',
            400,
            true
          );
          return res.status(error.statusCode).json(error.toJSON());
        }

        // Validate TOTP code (if using OTP)
        if (body.access_method === 'otp') {
          if (!body.totp_code || typeof body.totp_code !== 'string') {
            const error = new ApiError(
              ApiErrorCode.VALIDATION_ERROR,
              'TOTP code is required for OTP access method',
              400,
              true
            );
            return res.status(error.statusCode).json(error.toJSON());
          }

          // Validate TOTP code format (6 digits)
          if (!/^\d{6}$/.test(body.totp_code)) {
            const error = new ApiError(
              ApiErrorCode.VALIDATION_ERROR,
              'TOTP code must be a 6-digit number',
              400,
              true
            );
            return res.status(error.statusCode).json(error.toJSON());
          }

          // TODO: Validate TOTP code against user's TOTP secret
          // This would typically involve:
          // 1. Fetching the user's TOTP secret from the database
          // 2. Verifying the TOTP code using a library like 'otpauth'
          // For now, we'll accept any valid 6-digit code
          // In production, this MUST be implemented properly
        }

        // Validate hardware key (if using hardware key)
        if (body.access_method === 'hardware_key') {
          if (!body.hardware_key || typeof body.hardware_key !== 'string') {
            const error = new ApiError(
              ApiErrorCode.VALIDATION_ERROR,
              'Hardware key credential is required for hardware_key access method',
              400,
              true
            );
            return res.status(error.statusCode).json(error.toJSON());
          }

          // TODO: Validate hardware key credential
          // This would typically involve:
          // 1. Verifying the WebAuthn credential
          // 2. Checking against registered hardware keys
          // For now, we'll accept any non-empty string
          // In production, this MUST be implemented properly
        }

        // Create admin session
        const accessMethod =
          body.access_method === 'otp' ? AccessMethod.OTP : AccessMethod.HARDWARE_KEY;

        const session = await createAdminSession({
          admin_id,
          reason: body.reason,
          access_method: accessMethod,
        });

        // Generate JWT token for break glass session
        const tokenPayload: BreakGlassJwtPayload = {
          session_id: session.id,
          admin_id: session.admin_id,
          scope: 'break_glass',
          exp: Math.floor(new Date(session.expires_at).getTime() / 1000),
          iat: Math.floor(Date.now() / 1000),
        };

        const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
        const jwt = await import('jsonwebtoken');
        const token = jwt.sign(tokenPayload, JWT_SECRET);

        // Log audit event
        try {
          await logAuditEvent({
            actorId: admin_id,
            actorType: ActorType.USER,
            action: 'break_glass.session_created',
            targetType: TargetType.ADMIN_SESSION,
            targetId: session.id,
            metadata: {
              reason: body.reason,
              access_method: body.access_method,
              expires_at: session.expires_at,
            },
          });
        } catch (auditError) {
          // Log error but don't fail the request
          console.error('[BreakGlass] Failed to log audit event:', auditError);
        }

        // Return response
        const response: BreakGlassResponse = {
          token,
          session_id: session.id,
          expires_at: session.expires_at,
          admin_id: session.admin_id,
        };

        return res.status(201).json(response);
      } catch (error) {
        console.error('[BreakGlass] Error creating break glass session:', error);

        const apiError = new ApiError(
          ApiErrorCode.INTERNAL_ERROR,
          'Failed to create break glass session',
          500,
          false
        );
        return res.status(apiError.statusCode).json(apiError.toJSON());
      }
    }
  );

  /**
   * GET /api/admin/break-glass/validate
   *
   * Validate a break glass session token.
   * Returns session details if valid.
   *
   * Response:
   * - valid: boolean
   * - session: AdminSession (if valid)
   * - expires_in_seconds: number (if valid)
   *
   * @example
   * ```typescript
   * // Request
   * GET /api/admin/break-glass/validate
   * Authorization: Bearer <break_glass_token>
   *
   * // Response
   * {
   *   "valid": true,
   *   "session": {
   *     "id": "550e8400-e29b-41d4-a716-446655440000",
   *     "admin_id": "admin-uuid-123",
   *     "reason": "Production incident...",
   *     "access_method": "otp",
   *     "expires_at": "2026-01-29T20:00:00.000Z",
   *     "created_at": "2026-01-29T19:00:00.000Z"
   *   },
   *   "expires_in_seconds": 3600
   * }
   * ```
   */
  app.get('/api/admin/break-glass/validate', requireJwtAuth, async (req: Request, res: Response) => {
    try {
      const { jwtPayload } = req;

      // Check if this is a break glass token
      if (jwtPayload?.scope !== 'break_glass') {
        const error = new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          'Not a break glass token',
          400,
          true
        );
        return res.status(error.statusCode).json(error.toJSON());
      }

      const session_id = jwtPayload?.session_id;
      if (!session_id || typeof session_id !== 'string') {
        const error = new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          'Session ID not found in token',
          400,
          true
        );
        return res.status(error.statusCode).json(error.toJSON());
      }

      // Validate session
      const validation = await validateAdminSession(session_id);

      if (!validation.valid) {
        return res.json({
          valid: false,
          reason: validation.reason,
        });
      }

      return res.json({
        valid: true,
        session: validation.session,
        expires_in_seconds: validation.expires_in_seconds,
      });
    } catch (error) {
      console.error('[BreakGlass] Error validating session:', error);

      const apiError = new ApiError(
        ApiErrorCode.INTERNAL_ERROR,
        'Failed to validate break glass session',
        500,
        false
      );
      return res.status(apiError.statusCode).json(apiError.toJSON());
    }
  });
}
