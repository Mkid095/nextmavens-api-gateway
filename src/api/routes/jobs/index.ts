/**
 * Job Status Routes
 *
 * Defines all job status API endpoints and their middleware.
 *
 * US-010: Create Job Status API
 * US-011: Create Job Retry API
 */

import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getJobStatus, retryJobEndpoint } from './jobs.controller.js';
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Job status endpoint rate limiter
 * Prevents abuse of job status queries
 */
const jobStatusLimiter = rateLimit({
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
 * Configure and return job status routes
 *
 * Routes:
 * - GET /api/jobs/:id - Query job status (requires authentication)
 * - POST /api/jobs/:id/retry - Retry a failed job (requires authentication)
 *
 * @param router - Express router instance
 */
export function configureJobRoutes(router: Router): void {
  /**
   * GET /api/jobs/:id
   * Query job status by ID
   *
   * MIDDLEWARE CHAIN:
   * 1. jobStatusLimiter - Rate limiting to prevent abuse
   * 2. requireJwtAuth - JWT authentication required
   * 3. getJobStatus - Handle the request
   *
   * SECURITY:
   * - Requires valid JWT token
   * - Rate limited to prevent DoS
   * - SQL injection protected through parameterized queries
   * - Validates job ID format before querying database
   */
  router.get('/jobs/:id', jobStatusLimiter, requireJwtAuth, getJobStatus);

  /**
   * POST /api/jobs/:id/retry
   * Retry a failed job
   *
   * MIDDLEWARE CHAIN:
   * 1. jobStatusLimiter - Rate limiting to prevent abuse
   * 2. requireJwtAuth - JWT authentication required
   * 3. retryJobEndpoint - Handle the request
   *
   * SECURITY:
   * - Requires valid JWT token
   * - Rate limited to prevent DoS
   * - SQL injection protected through parameterized queries
   * - Validates job ID format before querying database
   * - Checks max_attempts limit to prevent infinite retries
   * - Only failed jobs can be retried
   */
  router.post('/jobs/:id/retry', jobStatusLimiter, requireJwtAuth, retryJobEndpoint);
}
