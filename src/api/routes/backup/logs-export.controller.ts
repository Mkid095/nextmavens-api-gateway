/**
 * Logs Export Controller
 *
 * Handles requests for exporting project audit logs.
 * Provides secure access to log export functionality through the API.
 *
 * US-008: Export Logs
 */

import type { Request, Response, NextFunction } from 'express';
import { enqueueJob } from '@nextmavens/audit-logs-database';
import type {
  LogsExportRequest,
  LogsExportResponse,
  LogsExportApiResponse,
  LogExportFormat
} from './logs-export.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Input validation patterns
 */
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  ISO_DATE_PATTERN: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
} as const;

/**
 * Valid log export formats
 */
const VALID_FORMATS: LogExportFormat[] = ['json', 'text'];

/**
 * Valid actor types
 */
const VALID_ACTOR_TYPES = ['user', 'system', 'api_key'] as const;

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
 * Validate ISO 8601 date format
 *
 * @param dateStr - The date string to validate
 * @returns True if valid, false otherwise
 */
function isValidISODate(dateStr: string): boolean {
  return VALIDATIONS.ISO_DATE_PATTERN.test(dateStr);
}

/**
 * Validate date range
 *
 * Ensures the date range is valid (from before to, dates are in the past, etc.)
 *
 * @param dateRange - The date range to validate
 * @throws Error if validation fails
 */
function validateDateRange(dateRange: { from: string; to: string }): void {
  if (!isValidISODate(dateRange.from) || !isValidISODate(dateRange.to)) {
    throw new Error('Invalid date format. Use ISO 8601 format (e.g., 2024-01-29T10:00:00Z)');
  }

  const fromDate = new Date(dateRange.from);
  const toDate = new Date(dateRange.to);

  if (fromDate > toDate) {
    throw new Error('Invalid date range: from date must be before to date');
  }

  const now = new Date();
  if (fromDate > now) {
    throw new Error('Invalid date range: from date cannot be in the future');
  }
}

/**
 * Validate actor type filter
 *
 * @param actorTypes - The actor types to validate
 * @throws Error if validation fails
 */
function validateActorTypeFilter(actorTypes: ('user' | 'system' | 'api_key')[]): void {
  if (!Array.isArray(actorTypes) || actorTypes.length === 0) {
    throw new Error('Actor type filter must be a non-empty array');
  }

  const invalidTypes = actorTypes.filter(
    (type) => !VALID_ACTOR_TYPES.includes(type)
  );

  if (invalidTypes.length > 0) {
    throw new Error(`Invalid actor types: ${invalidTypes.join(', ')}`);
  }
}

/**
 * Validate max entries value
 *
 * @param maxEntries - The maximum entries value
 * @throws Error if validation fails
 */
function validateMaxEntries(maxEntries: number): void {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('max_entries must be a positive integer');
  }

  if (maxEntries > 100000) {
    throw new Error('max_entries cannot exceed 100000');
  }
}

/**
 * Convert LogsExportRequest to job payload
 *
 * Formats the API request for the job queue.
 *
 * @param request - The API request
 * @returns The job payload
 */
function formatJobPayload(request: LogsExportRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    project_id: request.project_id,
  };

  if (request.format) {
    payload.format = request.format;
  }

  if (request.date_range) {
    payload.date_range = request.date_range;
  }

  if (request.action_filter) {
    payload.action_filter = request.action_filter;
  }

  if (request.actor_type_filter) {
    payload.actor_type_filter = request.actor_type_filter;
  }

  if (request.max_entries !== undefined) {
    payload.max_entries = request.max_entries;
  }

  if (request.notify_email) {
    payload.notify_email = request.notify_email;
  }

  if (request.send_to_telegram !== undefined) {
    payload.send_to_telegram = request.send_to_telegram;
  }

  if (request.storage_path) {
    payload.storage_path = request.storage_path;
  }

  if (request.compress !== undefined) {
    payload.compress = request.compress;
  }

  return payload;
}

/**
 * POST /api/backup/export-logs
 *
 * Initiates an export of audit logs for the specified project.
 * Creates a job that will query and format the logs for download or Telegram storage.
 *
 * Request Body:
 * - project_id: The ID of the project to export logs for (required)
 * - format: Export format 'json' or 'text' (optional, default: 'json')
 * - date_range: Date range filter {from, to} (optional)
 * - action_filter: Array of action types to filter (optional)
 * - actor_type_filter: Array of actor types to filter (optional)
 * - max_entries: Maximum number of entries (optional, default: 10000)
 * - notify_email: Email to notify when complete (optional)
 * - send_to_telegram: Send to Telegram storage (optional, default: true)
 * - storage_path: Custom storage path (optional)
 * - compress: Whether to compress the export (optional, default: auto)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - Validates project ID format to prevent injection attacks
 * - Validates email format if provided
 * - Validates date range format and logic
 * - Enqueues job for async processing (prevents timeout on large exports)
 * - Returns job ID for tracking export progress
 * - Input validation prevents invalid data from reaching job queue
 *
 * @param req - Express request with logs export payload
 * @param res - Express response
 * @param next - Express next function
 */
export async function exportLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Extract and validate request body
    const body = req.body as LogsExportRequest;

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
    if (body.format && !VALID_FORMATS.includes(body.format)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        `Invalid format. Must be one of: ${VALID_FORMATS.join(', ')}`,
        400,
        false
      );
    }

    // Validate date_range if provided
    if (body.date_range) {
      try {
        validateDateRange(body.date_range);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid date range';
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          message,
          400,
          false
        );
      }
    }

    // Validate action_filter if provided
    if (body.action_filter) {
      if (!Array.isArray(body.action_filter) || body.action_filter.length === 0) {
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          'action_filter must be a non-empty array',
          400,
          false
        );
      }
    }

    // Validate actor_type_filter if provided
    if (body.actor_type_filter) {
      try {
        validateActorTypeFilter(body.actor_type_filter);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid actor type filter';
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          message,
          400,
          false
        );
      }
    }

    // Validate max_entries if provided
    if (body.max_entries !== undefined) {
      try {
        validateMaxEntries(body.max_entries);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid max_entries value';
        throw new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          message,
          400,
          false
        );
      }
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

    // Enqueue export logs job
    // SECURITY: All inputs validated before enqueueing
    const jobPayload = formatJobPayload(body);
    const job = await enqueueJob('export_logs', jobPayload, {
      project_id: body.project_id,
      max_attempts: 3, // Supports retry logic for transient failures
    });

    // Format response
    const response: LogsExportResponse = {
      job_id: job.id,
      status: 'pending',
      project_id: body.project_id,
      created_at: job.created_at.toISOString(),
    };

    const apiResponse: LogsExportApiResponse = {
      data: response,
    };

    // Return successful response
    res.status(202).json(apiResponse);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}
