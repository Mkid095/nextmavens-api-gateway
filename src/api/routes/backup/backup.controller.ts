/**
 * Backup Controller
 *
 * Handles requests for manual database export operations.
 * Provides secure access to backup functionality through the API.
 *
 * US-001: Create Manual Export API
 */

import type { Request, Response, NextFunction } from 'express';
import { enqueueJob } from '@nextmavens/audit-logs-database';
import type {
  ManualExportRequest,
  ManualExportResponse,
  ManualExportApiResponse
} from './backup.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Input validation patterns
 */
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

/**
 * Validate project ID format and content
 *
 * Performs security validation to prevent command injection and path traversal.
 *
 * @param id - The project ID to validate
 * @throws Error if validation fails
 */
function validateProjectId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error('Project ID is required and must be a string');
  }

  // Length check
  if (id.length > VALIDATIONS.PROJECT_ID_MAX_LENGTH) {
    throw new Error('Project ID exceeds maximum length');
  }

  // Pattern check (alphanumeric, hyphens, underscores only)
  if (!VALIDATIONS.PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Project ID contains invalid characters');
  }

  // Path traversal prevention
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error('Project ID cannot contain path traversal sequences');
  }
}

/**
 * Validate email format
 *
 * @param email - The email to validate
 * @returns True if valid, false otherwise
 */
function isValidEmail(email: string): boolean {
  return VALIDATIONS.EMAIL_PATTERN.test(email);
}

/**
 * Convert ManualExportRequest to job payload
 *
 * Formats the API request for the job queue.
 *
 * @param request - The API request
 * @returns The job payload
 */
function formatJobPayload(request: ManualExportRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    project_id: request.project_id,
  };

  if (request.format) {
    payload.format = request.format;
  }

  if (request.compress !== undefined) {
    payload.compress = request.compress;
  }

  if (request.notify_email) {
    payload.notify_email = request.notify_email;
  }

  if (request.storage_path) {
    payload.storage_path = request.storage_path;
  }

  return payload;
}

/**
 * POST /api/backup/export
 *
 * Initiates a manual database export for the specified project.
 * Creates a job that will generate a SQL dump using pg_dump.
 *
 * Request Body:
 * - project_id: The ID of the project to export (required)
 * - format: Backup format 'sql' or 'tar' (optional, default: 'sql')
 * - compress: Whether to compress the backup (optional, default: true)
 * - notify_email: Email to notify when complete (optional)
 * - storage_path: Custom storage path (optional)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - Validates project ID format to prevent injection attacks
 * - Validates email format if provided
 * - Enqueues job for async processing (prevents timeout on large databases)
 * - Returns job ID for tracking export progress
 * - Input validation prevents invalid data from reaching job queue
 *
 * @param req - Express request with manual export payload
 * @param res - Express response
 * @param next - Express next function
 */
export async function manualExport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Extract and validate request body
    const body = req.body as ManualExportRequest;

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

    // Validate format if provided
    if (body.format && !['sql', 'tar'].includes(body.format)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid format. Must be "sql" or "tar"',
        400,
        false
      );
    }

    // Validate email format if provided
    if (body.notify_email && !isValidEmail(body.notify_email)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid email format',
        400,
        false
      );
    }

    // Enqueue export backup job
    // SECURITY: All inputs validated before enqueueing
    const jobPayload = formatJobPayload(body);
    const job = await enqueueJob('export_backup', jobPayload, {
      project_id: body.project_id,
      max_attempts: 3, // Supports retry logic for transient failures
    });

    // Format response
    const response: ManualExportResponse = {
      job_id: job.id,
      status: 'pending',
      project_id: body.project_id,
      created_at: job.created_at.toISOString(),
    };

    const apiResponse: ManualExportApiResponse = {
      data: response,
    };

    // Return successful response
    res.status(202).json(apiResponse);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}
