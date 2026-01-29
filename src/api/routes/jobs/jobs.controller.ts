/**
 * Job Status Controller
 *
 * Handles requests for querying job status and retrying failed jobs.
 * Provides secure access to job status information and retry functionality.
 *
 * US-010: Create Job Status API
 * US-011: Create Job Retry API
 */

import type { Request, Response, NextFunction } from 'express';
import { getJob, retryJob } from '@nextmavens/audit-logs-database';
import type {
  JobStatusApiResponse,
  JobStatusResponse,
  JobRetryApiResponse,
  JobRetryResponse
} from './jobs.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Validate UUID v4 format
 * Ensures job ID is a valid UUID
 */
function isValidJobId(jobId: string): boolean {
  if (!jobId || typeof jobId !== 'string') {
    return false;
  }

  // UUID v4 regex pattern
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(jobId);
}

/**
 * Convert Job to JobStatusResponse
 * Formats database Job object for API response
 */
function formatJobStatusResponse(job: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}): JobStatusResponse {
  return {
    id: job.id,
    type: job.type,
    status: job.status as any,
    payload: job.payload,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    last_error: job.last_error,
    scheduled_at: job.scheduled_at.toISOString(),
    started_at: job.started_at ? job.started_at.toISOString() : null,
    completed_at: job.completed_at ? job.completed_at.toISOString() : null,
    created_at: job.created_at.toISOString(),
  };
}

/**
 * GET /api/jobs/:id
 *
 * Query job status by ID.
 * Returns job details including status, timestamps, and error information.
 *
 * Path Parameters:
 * - id: Job ID (UUID v4)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - Returns job details including last_error if failed
 * - All timestamps are returned in ISO 8601 format
 * - Input validation prevents invalid UUIDs from reaching database
 *
 * @param req - Express request with job ID in params
 * @param res - Express response
 * @param next - Express next function
 */
export async function getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Extract job ID from request params
    const { id } = req.params;

    // Validate job ID format
    if (!id || !isValidJobId(id)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid job ID format. Job ID must be a valid UUID v4.',
        400,
        false
      );
    }

    // Query job from database
    // SECURITY: getJob uses parameterized queries internally
    const job = await getJob(id);

    // Check if job exists
    if (!job) {
      throw new ApiError(
        ApiErrorCode.NOT_FOUND,
        'Job not found',
        404,
        false
      );
    }

    // Format response
    const response: JobStatusApiResponse = {
      data: formatJobStatusResponse(job)
    };

    // Return successful response
    res.status(200).json(response);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}

/**
 * POST /api/jobs/:id/retry
 *
 * Retry a failed job by ID.
 * Resets job status to pending so it can be processed again.
 * Checks max_attempts limit before allowing retry.
 *
 * Path Parameters:
 * - id: Job ID (UUID v4)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - Validates job ID format
 * - Checks max_attempts limit to prevent infinite retries
 * - Clears last_error and resets timestamps
 * - Input validation prevents invalid UUIDs from reaching database
 *
 * @param req - Express request with job ID in params
 * @param res - Express response
 * @param next - Express next function
 */
export async function retryJobEndpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Extract job ID from request params
    const { id } = req.params;

    // Validate job ID format
    if (!id || !isValidJobId(id)) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid job ID format. Job ID must be a valid UUID v4.',
        400,
        false
      );
    }

    // Retry the job
    // SECURITY: retryJob uses parameterized queries internally
    // and checks max_attempts limit before allowing retry
    const job = await retryJob(id);

    // Format response
    const response: JobRetryApiResponse = {
      data: formatJobRetryResponse(job)
    };

    // Return successful response
    res.status(200).json(response);
  } catch (error) {
    // Handle specific error messages
    if (error instanceof Error) {
      if (error.message === 'Job not found') {
        const notFoundError = new ApiError(
          ApiErrorCode.NOT_FOUND,
          'Job not found',
          404,
          false
        );
        return next(notFoundError);
      }
      if (error.message === 'Maximum retry attempts reached') {
        const maxAttemptsError = new ApiError(
          ApiErrorCode.VALIDATION_ERROR,
          'Maximum retry attempts reached. This job cannot be retried.',
          400,
          false
        );
        return next(maxAttemptsError);
      }
    }

    // Pass other errors to error handler middleware
    next(error);
  }
}

/**
 * Convert Job to JobRetryResponse
 * Formats database Job object for API response
 */
function formatJobRetryResponse(job: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}): JobRetryResponse {
  return {
    id: job.id,
    type: job.type,
    status: job.status as any,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    scheduled_at: job.scheduled_at.toISOString(),
    created_at: job.created_at.toISOString(),
  };
}
