import { Request, Response, NextFunction } from 'express';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Extend Express Request to include auth data
 */
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
      userId?: string;
    }
  }
}

/**
 * Authentication result
 */
interface AuthResult {
  valid: boolean;
  projectId?: string;
  userId?: string;
  error?: ApiError;
}

/**
 * API key information extracted from request
 */
interface ApiKeyInfo {
  key: string;
  source: 'header' | 'query';
}

/**
 * Extract API key from request
 * Checks both header and query parameter
 */
function extractApiKey(req: Request): ApiKeyInfo | null {
  // Check header first (preferred method)
  const headerKey = req.headers['x-api-key'] as string;
  if (headerKey && headerKey.length > 0) {
    return { key: headerKey, source: 'header' };
  }

  // Check query parameter (less secure but allowed)
  const queryKey = req.query.api_key as string;
  if (queryKey && queryKey.length > 0) {
    return { key: queryKey, source: 'query' };
  }

  return null;
}

/**
 * Validate API key format
 * API keys should be in format: nm_proj_<projectId>_<signature>
 */
function validateApiKeyFormat(key: string): { valid: boolean; projectId?: string } {
  // Basic format validation
  const prefix = 'nm_proj_';
  if (!key.startsWith(prefix)) {
    return { valid: false };
  }

  // Extract project ID from key
  const parts = key.substring(prefix.length).split('_');
  if (parts.length < 2) {
    return { valid: false };
  }

  const projectId = parts[0];
  if (!projectId || projectId.length === 0) {
    return { valid: false };
  }

  return { valid: true, projectId };
}

/**
 * Authenticate request using API key
 * This is a simplified version - in production, this would validate
 * against a database or API key service
 */
export async function authenticateWithApiKey(req: Request): Promise<AuthResult> {
  const apiKeyInfo = extractApiKey(req);

  if (!apiKeyInfo) {
    return {
      valid: false,
      error: new ApiError(
        ApiErrorCode.UNAUTHORIZED,
        'API key not found. Provide API key via X-API-Key header or api_key query parameter.',
        401,
        false
      )
    };
  }

  // Validate API key format
  const formatValidation = validateApiKeyFormat(apiKeyInfo.key);
  if (!formatValidation.valid) {
    return {
      valid: false,
      error: new ApiError(
        ApiErrorCode.INVALID_API_KEY,
        'Invalid API key format. Expected format: nm_proj_<projectId>_<signature>',
        401,
        false
      )
    };
  }

  // Extract project ID from API key
  const projectId = formatValidation.projectId!;

  // In production, you would:
  // 1. Verify the signature against the control plane
  // 2. Check if the API key is active and not expired
  // 3. Check if the project is active
  // For now, we extract the project ID and let the snapshot middleware validate the project

  return {
    valid: true,
    projectId
  };
}

/**
 * Express middleware to authenticate requests using API key
 * Attaches projectId and userId to the request object
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  authenticateWithApiKey(req)
    .then((result) => {
      if (!result.valid || result.error) {
        const error = result.error || new ApiError(
          ApiErrorCode.UNAUTHORIZED,
          'Authentication failed',
          401
        );
        res.status(error.statusCode).json(error.toJSON());
        return;
      }

      // Attach auth info to request
      req.projectId = result.projectId;
      req.userId = result.userId;

      next();
    })
    .catch((error) => {
      console.error('[Auth Middleware] Authentication error:', error);
      const apiError = new ApiError(
        ApiErrorCode.INTERNAL_ERROR,
        'Authentication error',
        500,
        false
      );
      res.status(apiError.statusCode).json(apiError.toJSON());
    });
}

/**
 * Express middleware to extract project ID from authenticated request
 * This middleware should run after authentication
 */
export function extractProjectId(req: Request, _res: Response, next: NextFunction): void {
  if (!req.projectId) {
    const error = new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Project ID not found. Ensure request is authenticated.',
      401
    );
    throw error;
  }

  next();
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't fail if no API key is provided
 */
export function optionalApiKey(req: Request, _res: Response, next: NextFunction): void {
  authenticateWithApiKey(req)
    .then((result) => {
      if (result.valid) {
        req.projectId = result.projectId;
        req.userId = result.userId;
      }
      // Always continue, even if auth fails
      next();
    })
    .catch((error) => {
      console.error('[Auth Middleware] Optional authentication failed:', error);
      // Continue anyway - this is optional auth
      next();
    });
}
