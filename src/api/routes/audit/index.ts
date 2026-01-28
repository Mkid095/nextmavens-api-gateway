/**
 * Audit Log Routes
 *
 * Defines all audit log API endpoints and their middleware.
 *
 * US-008: Create Audit Log API Endpoint
 */

import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getAuditLogs } from './audit.controller.js';
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Audit endpoint rate limiter
 * Prevents abuse of audit log queries
 */
const auditLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const error = ApiError.rateLimited();
    res.status(error.statusCode).json(error.toJSON());
  }
});

/**
 * Configure and return audit log routes
 *
 * Routes:
 * - GET /api/audit - Query audit logs (requires authentication)
 *
 * @param router - Express router instance
 */
export function configureAuditRoutes(router: Router): void {
  /**
   * GET /api/audit
   * Query audit logs with filters and pagination
   *
   * MIDDLEWARE CHAIN:
   * 1. auditLimiter - Rate limiting to prevent abuse
   * 2. requireJwtAuth - JWT authentication required
   * 3. getAuditLogs - Handle the request
   *
   * SECURITY:
   * - Requires valid JWT token
   * - Rate limited to prevent DoS
   * - SQL injection protected through parameterized queries
   */
  router.get('/audit', auditLimiter, requireJwtAuth, getAuditLogs);
}
