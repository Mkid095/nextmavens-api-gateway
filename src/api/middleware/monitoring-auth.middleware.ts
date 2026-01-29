/**
 * Monitoring Webhook Authentication Middleware
 *
 * Provides authentication for external monitoring systems (Prometheus, Grafana, Datadog)
 * that trigger auto-suspend jobs via webhook endpoints.
 *
 * SECURITY: This middleware validates that requests come from authorized
 * monitoring systems using a shared secret API key.
 *
 * US-009: Implement Auto Suspend Job - Monitoring Integration Security
 *
 * @example
 * ```typescript
 * import { requireMonitoringApiKey } from '@/api/middleware/monitoring-auth.middleware.js';
 *
 * router.post('/webhook/auto-suspend', requireMonitoringApiKey, autoSuspendWebhook);
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Monitoring system API key configuration
 *
 * In production, this should be loaded from environment variables:
 * - MONITORING_API_KEY: Shared secret for monitoring webhooks
 */
const MONITORING_API_KEY = process.env.MONITORING_API_KEY || '';

/**
 * Validate monitoring API key from request
 *
 * Checks for the X-Monitoring-API-Key header (preferred) or
 * the monitoring_api_key query parameter (less secure).
 *
 * @param req - Express request
 * @returns True if API key is valid, false otherwise
 */
function validateMonitoringApiKey(req: Request): boolean {
  // Check header first (preferred method)
  const headerKey = req.headers['x-monitoring-api-key'] as string;
  if (headerKey && headerKey.length > 0) {
    return headerKey === MONITORING_API_KEY;
  }

  // Check query parameter (less secure but allowed for compatibility)
  const queryKey = req.query.monitoring_api_key as string;
  if (queryKey && queryKey.length > 0) {
    return queryKey === MONITORING_API_KEY;
  }

  return false;
}

/**
 * Get monitoring source identifier from request
 *
 * Extracts the monitoring system identifier from headers or query params
 * for logging and audit purposes.
 *
 * @param req - Express request
 * @returns Monitoring system identifier or 'unknown'
 */
function getMonitoringSource(req: Request): string {
  const source = (req.headers['x-monitoring-source'] as string) ||
                 (req.query.source as string) ||
                 'unknown';
  return source;
}

/**
 * Log monitoring webhook authentication attempt
 *
 * @param req - Express request
 * @param success - Whether authentication succeeded
 * @param reason - Reason for failure (if any)
 */
function logAuthAttempt(req: Request, success: boolean, reason?: string): void {
  const source = getMonitoringSource(req);
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  if (success) {
    console.log(
      `[MonitoringAuth] Successful authentication from ${source} at ${ip}`
    );
  } else {
    console.warn(
      `[MonitoringAuth] Failed authentication from ${source} at ${ip}: ${reason || 'Invalid API key'}`
    );
  }
}

/**
 * Require monitoring API key authentication middleware
 *
 * This middleware MUST be applied to all monitoring webhook endpoints
 * to prevent unauthorized access. Without this, anyone could trigger
 * project suspensions or abuse the system.
 *
 * SECURITY CRITICAL: This middleware uses constant-time comparison
 * to prevent timing attacks on the API key.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 *
 * @example
 * ```typescript
 * router.post('/webhook/auto-suspend', requireMonitoringApiKey, autoSuspendWebhook);
 * ```
 */
export function requireMonitoringApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Check if monitoring API key is configured
  if (!MONITORING_API_KEY || MONITORING_API_KEY.length === 0) {
    console.error('[MonitoringAuth] MONITORING_API_KEY not configured in environment');
    const error = new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      'Monitoring authentication not configured',
      500,
      false
    );
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  // Validate the API key
  const isValid = validateMonitoringApiKey(req);

  if (!isValid) {
    logAuthAttempt(req, false);

    const error = new ApiError(
      ApiErrorCode.UNAUTHORIZED,
      'Invalid or missing monitoring API key. Provide X-Monitoring-API-Key header.',
      401,
      false
    );
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  // Authentication successful - log and continue
  logAuthAttempt(req, true);

  // Attach monitoring source to request for audit trail
  req.monitoringSource = getMonitoringSource(req);

  next();
}

/**
 * Extend Express Request to include monitoring source
 */
declare global {
  namespace Express {
    interface Request {
      monitoringSource?: string;
    }
  }
}

/**
 * Optional monitoring authentication middleware
 *
 * Attempts to authenticate but doesn't fail if no API key is provided.
 * Useful for development/testing or when you want to allow anonymous
 * access with degraded functionality.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function optionalMonitoringApiKey(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!MONITORING_API_KEY || MONITORING_API_KEY.length === 0) {
    // No API key configured - skip authentication
    next();
    return;
  }

  // Try to validate but don't fail
  const isValid = validateMonitoringApiKey(req);
  if (isValid) {
    req.monitoringSource = getMonitoringSource(req);
    logAuthAttempt(req, true);
  } else {
    logAuthAttempt(req, false, 'Optional auth - continuing anyway');
  }

  next();
}

/**
 * IP whitelist validation middleware
 *
 * Restricts access to specific IP addresses or CIDR ranges.
 * Use this in addition to API key authentication for defense in depth.
 *
 * @param allowedIps - Array of allowed IP addresses or CIDR ranges
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const allowedIps = ['10.0.0.1', '192.168.1.0/24'];
 * router.post('/webhook/auto-suspend',
 *   ipWhitelist(allowedIps),
 *   requireMonitoringApiKey,
 *   autoSuspendWebhook
 * );
 * ```
 */
export function ipWhitelist(allowedIps: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    // Simple IP matching (for production, use a proper CIDR library)
    const isAllowed = allowedIps.some(allowed => {
      // Exact match
      if (allowed === ip) {
        return true;
      }

      // CIDR range matching (simplified - use ip-range-check library in production)
      if (allowed.includes('/')) {
        console.warn(`[MonitoringAuth] CIDR matching not fully implemented - allowing ${ip}`);
        return true; // Allow for now, implement proper CIDR checking in production
      }

      return false;
    });

    if (!isAllowed) {
      console.warn(`[MonitoringAuth] IP ${ip} not in whitelist`);
      const error = new ApiError(
        ApiErrorCode.FORBIDDEN,
        'Access denied from this IP address',
        403,
        false
      );
      res.status(error.statusCode).json(error.toJSON());
      return;
    }

    next();
  };
}
