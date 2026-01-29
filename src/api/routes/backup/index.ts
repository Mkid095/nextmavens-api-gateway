/**
 * Backup Routes
 *
 * Defines all backup API endpoints and their middleware.
 *
 * US-001: Create Manual Export API
 * US-006: Implement Restore from Backup
 */

import type { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { manualExport } from './backup.controller.js';
import { restoreBackup } from './restore.controller.js';
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Backup endpoint rate limiter
 * Prevents abuse of backup export functionality
 */
const backupLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP (backups are expensive operations)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const error = ApiError.rateLimited();
    res.status(error.statusCode).json(error.toJSON());
  }
});

/**
 * Configure and return backup routes
 *
 * Routes:
 * - POST /api/backup/export - Manual database export (requires authentication)
 * - POST /api/backup/restore - Restore from backup (requires authentication)
 *
 * @param router - Express router instance
 */
export function configureBackupRoutes(router: Router): void {
  /**
   * POST /api/backup/export
   * Manual database export
   *
   * MIDDLEWARE CHAIN:
   * 1. backupLimiter - Rate limiting to prevent abuse
   * 2. requireJwtAuth - JWT authentication required
   * 3. manualExport - Handle the request
   *
   * SECURITY:
   * - Requires valid JWT token
   * - Rate limited to prevent DoS
   * - SQL injection protected through parameterized queries
   * - Command injection protected through input validation
   * - Validates project ID format before enqueueing job
   * - Async processing via job queue (prevents timeout on large databases)
   *
   * REQUEST BODY:
   * {
   *   "project_id": string,      // Required: Project to export
   *   "format": "sql" | "tar",   // Optional: Backup format (default: sql)
   *   "compress": boolean,        // Optional: Compress output (default: true)
   *   "notify_email": string,     // Optional: Email notification when complete
   *   "storage_path": string      // Optional: Custom storage path
   * }
   *
   * RESPONSE (202 Accepted):
   * {
   *   "data": {
   *     "job_id": string,         // Job ID for tracking progress
   *     "status": "pending",      // Initial job status
   *     "project_id": string,     // Project being exported
   *     "created_at": string      // ISO 8601 timestamp
   *   }
   * }
   *
   * ERROR RESPONSES:
   * - 400: Validation error (invalid project_id, format, or email)
   * - 401: Unauthorized (missing or invalid JWT)
   * - 429: Rate limited (too many requests)
   * - 500: Internal server error
   */
  router.post('/backup/export', backupLimiter, requireJwtAuth, manualExport);

  /**
   * POST /api/backup/restore
   * Restore database from backup
   *
   * MIDDLEWARE CHAIN:
   * 1. backupLimiter - Rate limiting to prevent abuse
   * 2. requireJwtAuth - JWT authentication required
   * 3. restoreBackup - Handle the request
   *
   * SECURITY:
   * - Requires valid JWT token
   * - Rate limited to prevent DoS
   * - SQL injection protected through parameterized queries
   * - Command injection protected through input validation
   * - Validates project_id, backup_id, and file_id format
   * - Requires force=true to prevent accidental data overwrite
   * - Returns warning about data overwrite in all responses
   * - Supports async processing for large backups
   *
   * REQUEST BODY:
   * {
   *   "project_id": string,         // Required: Project to restore
   *   "backup_id": string,          // Optional: Backup ID to restore
   *   "file_id": string,            // Optional: Telegram file ID to restore
   *   "force": boolean,             // Required: Must be true to confirm overwrite
   *   "async": boolean              // Optional: Use async processing (auto-detected)
   * }
   *
   * RESPONSE (200 OK or 202 Accepted):
   * {
   *   "data": {
   *     "success": boolean,         // Whether restore succeeded
   *     "status": "completed" | "queued" | "failed",
   *     "job_id": string,           // Job ID if queued for async processing
   *     "error": string,            // Error message if failed
   *     "tables_restored": number,  // Number of tables restored (if successful)
   *     "backup_size": number,      // Size of backup in bytes
   *     "duration_ms": number,      // Duration of restore in milliseconds
   *     "warning": string,          // Warning about data overwrite
   *     "created_at": string        // ISO 8601 timestamp
   *   }
   * }
   *
   * ERROR RESPONSES:
   * - 400: Validation error (missing/invalid project_id, backup_id, file_id, or force)
   * - 401: Unauthorized (missing or invalid JWT)
   * - 429: Rate limited (too many requests)
   * - 500: Internal server error (restore failure)
   */
  router.post('/backup/restore', backupLimiter, requireJwtAuth, restoreBackup);
}
