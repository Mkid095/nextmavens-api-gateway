/**
 * Restore Controller
 *
 * Handles requests for restoring database backups from Telegram storage.
 * Provides secure access to restore functionality through the API.
 *
 * US-006: Implement Restore from Backup - Step 1: Foundation
 */

import type { Request, Response, NextFunction } from 'express';
import type {
  RestoreRequest,
  RestoreResponse,
  RestoreApiResponse
} from './backup.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import { restoreFromBackup } from '@/lib/backups/restore.service.js';

/**
 * Input validation patterns
 */
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  BACKUP_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  FILE_ID_MAX_LENGTH: 500,
} as const;

/**
 * Validate project ID format and content
 *
 * @param id - The project ID to validate
 * @throws Error if validation fails
 */
function validateProjectId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('Project ID is required and must be a string');
  }

  if (id.length > VALIDATIONS.PROJECT_ID_MAX_LENGTH) {
    throw new Error('Project ID exceeds maximum length');
  }

  if (!VALIDATIONS.PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Project ID contains invalid characters');
  }

  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Project ID cannot contain path traversal sequences');
  }
}

/**
 * Validate backup ID format
 *
 * @param id - The backup ID to validate
 * @throws Error if validation fails
 */
function validateBackupId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('Backup ID must be a string');
  }

  if (!VALIDATIONS.BACKUP_ID_PATTERN.test(id)) {
    throw new Error('Backup ID must be a valid UUID');
  }
}

/**
 * Validate file ID format
 *
 * @param id - The file ID to validate
 * @throws Error if validation fails
 */
function validateFileId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('File ID must be a string');
  }

  if (id.trim().length === 0) {
    throw new Error('File ID cannot be empty');
  }

  if (id.length > VALIDATIONS.FILE_ID_MAX_LENGTH) {
    throw new Error('File ID exceeds maximum length');
  }
}

/**
 * POST /api/backup/restore
 *
 * Restores a database backup from Telegram storage.
 * Supports both synchronous (small backups) and asynchronous (large backups) restoration.
 *
 * Request Body:
 * - project_id: The ID of the project (required)
 * - backup_id: The ID of the backup to restore (optional if file_id is provided)
 * - file_id: The Telegram file ID to restore directly (optional if backup_id is provided)
 * - force: Whether to force restore without confirmation (optional, default: false)
 * - async: Whether to use async processing (optional, default: auto-detected)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - Validates project ID format to prevent injection attacks
 * - Validates backup_id and file_id format
 * - Requires force=true to prevent accidental data overwrite
 * - Returns warning about data overwrite in all responses
 * - Enqueues job for async processing on large backups
 * - Input validation prevents invalid data from reaching restore service
 *
 * @param req - Express request with restore payload
 * @param res - Express response
 * @param next - Express next function
 */
export async function restoreBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const startTime = Date.now();

    // SECURITY CRITICAL: Verify user is authenticated
    // JWT middleware should have set req.projectId and req.jwtPayload
    if (!req.projectId || !req.jwtPayload) {
      throw new ApiError(
        ApiErrorCode.UNAUTHORIZED,
        'Authentication required',
        401,
        false
      );
    }

    // Extract and validate request body
    const body = req.body as RestoreRequest;

    // Validate project_id
    if (!body.project_id) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Missing required field: project_id',
        400,
        false
      );
    }

    // Validate project_id format
    try {
      validateProjectId(body.project_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid project ID';
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        message,
        400,
        false
      );
    }

    // SECURITY CRITICAL: Authorization check - verify project_id in request matches JWT
    // This prevents users from restoring backups for other projects
    if (body.project_id !== req.projectId) {
      // Log the unauthorized attempt for security monitoring
      console.error('[Security] Unauthorized restore attempt:', {
        authenticated_project_id: req.projectId,
        requested_project_id: body.project_id,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        user_agent: req.headers['user-agent']
      });

      throw new ApiError(
        ApiErrorCode.FORBIDDEN,
        'Access denied', // Generic message to prevent project enumeration
        403,
        false
      );
    }

    // Validate that either backup_id or file_id is provided
    if (!body.backup_id && !body.file_id) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Either backup_id or file_id must be provided',
        400,
        false
      );
    }

    // Validate backup_id format if provided
    if (body.backup_id) {
      try {
        validateBackupId(body.backup_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid backup ID';
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          message,
          400,
          false
        );
      }
    }

    // Validate file_id format if provided
    if (body.file_id) {
      try {
        validateFileId(body.file_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid file ID';
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          message,
          400,
          false
        );
      }
    }

    // Validate force flag
    if (!body.force) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Restore requires force=true to confirm data overwrite. This operation will overwrite existing data and cannot be undone.',
        400,
        false
      );
    }

    // SECURITY: Log restore attempt for audit trail
    console.log('[Audit] Restore operation initiated:', {
      project_id: body.project_id,
      backup_id: body.backup_id,
      file_id: body.file_id,
      force: body.force,
      async: body.async,
      authenticated_project_id: req.projectId,
      timestamp: new Date().toISOString(),
      ip: req.ip
    });

    // Perform restore operation
    const restoreResult = await restoreFromBackup({
      backup_id: body.backup_id,
      file_id: body.file_id,
      project_id: body.project_id,
      force: body.force || false,
      async: body.async,
    });

    // SECURITY: Log restore result for audit trail
    console.log('[Audit] Restore operation completed:', {
      project_id: body.project_id,
      success: restoreResult.success,
      status: restoreResult.status,
      duration_ms: Date.now() - startTime,
      authenticated_project_id: req.projectId,
      timestamp: new Date().toISOString()
    });

    // Format response
    const response: RestoreResponse = {
      success: restoreResult.success,
      status: restoreResult.status,
      job_id: restoreResult.job_id,
      error: restoreResult.error,
      tables_restored: restoreResult.tables_restored,
      backup_size: restoreResult.backup_size,
      duration_ms: restoreResult.duration_ms,
      warning: restoreResult.warning,
      created_at: new Date(startTime).toISOString(),
    };

    const apiResponse: RestoreApiResponse = {
      data: response,
    };

    // Determine appropriate status code
    if (restoreResult.success) {
      if (restoreResult.status === 'queued') {
        // 202 Accepted for async restore
        res.status(202).json(apiResponse);
      } else {
        // 200 OK for sync restore
        res.status(200).json(apiResponse);
      }
    } else {
      // Return 400 for validation/force errors, 500 for other failures
      const statusCode = restoreResult.error?.includes('force=true') ? 400 : 500;
      res.status(statusCode).json(apiResponse);
    }
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}
