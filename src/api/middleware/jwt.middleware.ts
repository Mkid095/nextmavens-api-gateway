import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { withErrorHandling } from '@/api/middleware/error.handler.js';

/**
 * JWT payload structure
 * Contains the project_id claim used for request scoping
 * Can also contain break glass session claims
 */
export interface JwtPayload {
  project_id?: string;
  userId?: string;
  scope?: 'break_glass';
  session_id?: string;
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
}

/**
 * Extended Express Request to include JWT data
 */
declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
      projectId?: string;
    }
  }
}

/**
 * JWT configuration loaded from environment
 */
interface JwtConfig {
  secret: string;
  algorithm: jwt.Algorithm;
  issuer?: string;
  audience?: string;
}

/**
 * JWT authentication result
 */
interface JwtAuthResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: ApiError;
}

/**
 * Load JWT configuration from environment variables
 * SECURITY: Fails closed if secret is not configured
 */
function getJwtConfig(): JwtConfig {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length === 0) {
    throw new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      'JWT authentication not configured',
      500,
      false
    );
  }

  // SECURITY: Enforce minimum secret length for security
  if (secret.length < 32) {
    throw new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      'JWT secret too short',
      500,
      false
    );
  }

  return {
    secret,
    algorithm: (process.env.JWT_ALGORITHM as jwt.Algorithm) || 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE
  };
}

/**
 * Extract JWT token from request
 * Checks Authorization header (Bearer scheme)
 * SECURITY: Only accepts Bearer token from Authorization header
 */
function extractJwtToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader.length === 0) {
    return null;
  }

  // SECURITY: Strict Bearer token format validation
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  const token = parts[1];

  // SECURITY: Validate token length to prevent DoS
  if (token.length === 0 || token.length > 4096) {
    return null;
  }

  return token;
}

/**
 * Validate JWT token structure and signature
 * Returns decoded payload if valid, error otherwise
 *
 * SECURITY:
 * - Validates signature using configured secret
 * - Checks expiration automatically
 * - Verifies issuer and audience if configured
 * - Uses constant-time comparison for security
 */
function validateJwtToken(token: string, config: JwtConfig): JwtAuthResult {
  try {
    const verifyOptions: jwt.VerifyOptions = {
      algorithms: [config.algorithm],
      issuer: config.issuer,
      audience: config.audience
    };

    // SECURITY: jsonwebtoken automatically handles:
    // - Signature verification
    // - Expiration checking (exp claim)
    // - Not before checking (nbf claim)
    // - Issuer validation
    // - Audience validation
    const decoded = jwt.verify(token, config.secret, verifyOptions) as JwtPayload;

    // SECURITY: Validate that project_id claim exists and is a string (unless it's a break glass token)
    if (!decoded.project_id || typeof decoded.project_id !== 'string') {
      // Allow break glass tokens without project_id
      if (decoded.scope !== 'break_glass') {
        return {
          valid: false,
          error: ApiError.keyInvalid()
        };
      }
    }

    // SECURITY: Validate project_id format (if present)
    if (decoded.project_id) {
      const projectIdRegex = /^[a-zA-Z0-9_-]{1,100}$/;
      if (!projectIdRegex.test(decoded.project_id)) {
        return {
          valid: false,
          error: ApiError.keyInvalid()
        };
      }
    }

    return {
      valid: true,
      payload: decoded
    };
  } catch (error) {
    // SECURITY: Return generic error for all JWT failures to prevent information leakage
    // This includes: TokenExpiredError, JsonWebTokenError, NotBeforeError
    return {
      valid: false,
      error: ApiError.keyInvalid()
    };
  }
}

/**
 * Authenticate request using JWT token
 * Extracts and validates JWT from Authorization header
 *
 * @param req - Express request object
 * @returns Authentication result with payload or error
 */
export function authenticateWithJwt(req: Request): JwtAuthResult {
  const token = extractJwtToken(req);

  if (!token) {
    return {
      valid: false,
      error: new ApiError(
        ApiErrorCode.UNAUTHORIZED,
        'Authorization token not found. Provide Bearer token in Authorization header.',
        401,
        false
      )
    };
  }

  const config = getJwtConfig();
  return validateJwtToken(token, config);
}

/**
 * Express middleware to authenticate requests using JWT
 * Attaches projectId and jwtPayload to the request object
 *
 * SECURITY:
 * - Fails closed if authentication fails
 * - Generic error messages prevent information leakage
 * - Validates token signature and claims
 * - Enforces project_id claim presence
 */
export function requireJwtAuth(req: Request, res: Response, next: NextFunction): void {
  withErrorHandling(async () => {
    const result = authenticateWithJwt(req);

    if (!result.valid || result.error) {
      const error = result.error || ApiError.keyInvalid();
      throw error;
    }

    // Attach JWT data to request for downstream middleware
    req.jwtPayload = result.payload;
    req.projectId = result.payload!.project_id;

    next();
  }, 'requireJwtAuth').catch((error) => {
    // Handle errors and send response
    const apiError = error instanceof ApiError ? error : new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      'Authentication error',
      500,
      false
    );
    res.status(apiError.statusCode).json(apiError.toJSON());
  });
}

/**
 * Express middleware to extract project ID from JWT
 * This middleware should run after requireJwtAuth
 *
 * @param req - Express request object
 * @param _res - Express response object (unused)
 * @param next - Express next function
 */
export function extractProjectIdFromJwt(req: Request, _res: Response, next: NextFunction): void {
  if (!req.projectId) {
    throw new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Project ID not found in token',
      401,
      false
    );
  }

  next();
}

/**
 * Optional JWT authentication middleware
 * Attempts to authenticate but doesn't fail if no token is provided
 * Useful for endpoints that work both authenticated and unauthenticated
 *
 * @param req - Express request object
 * @param _res - Express response object (unused)
 * @param next - Express next function
 */
export function optionalJwtAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const result = authenticateWithJwt(req);

    if (result.valid && result.payload) {
      // Attach JWT data if authentication succeeded
      req.jwtPayload = result.payload;
      req.projectId = result.payload.project_id;
    }
    // Always continue, even if auth failed
    next();
  } catch (error) {
    // Log but continue - this is optional auth
    console.error('[JWT Middleware] Optional authentication failed:', error);
    next();
  }
}

/**
 * Generate a JWT token for testing purposes
 * NOTE: This should only be used in development/testing environments
 *
 * @param payload - JWT payload containing project_id
 * @param secret - JWT secret (defaults to environment variable)
 * @returns Signed JWT token
 */
export function generateTestToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret?: string): string {
  const config = getJwtConfig();
  const tokenSecret = secret || config.secret;

  return jwt.sign(payload, tokenSecret, {
    algorithm: config.algorithm,
    issuer: config.issuer,
    audience: config.audience,
    expiresIn: '1h'
  });
}