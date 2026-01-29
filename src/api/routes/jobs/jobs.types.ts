/**
 * Job Status API Types
 *
 * Type definitions for the job status and retry API endpoints.
 * These types define the request and response structures for the /api/jobs endpoints.
 *
 * US-010: Create Job Status API
 * US-011: Create Job Retry API
 */

import type { JobStatus } from '@nextmavens/audit-logs-database';

/**
 * Job status API response
 * Returns job details with all relevant information for monitoring
 */
export interface JobStatusApiResponse {
  data: JobStatusResponse;
}

/**
 * Job status response structure
 * Contains all job information including status, timestamps, and error details
 */
export interface JobStatusResponse {
  id: string;
  type: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * Error response structure
 * Used when job status queries fail
 */
export interface JobStatusErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Extended Express Request for job status endpoints
 * Includes JWT payload after authentication
 */
export interface JobStatusApiRequest {
  params: {
    id: string;
  };
  jwtPayload?: {
    project_id: string;
    sub?: string;
    [key: string]: unknown;
  };
}

/**
 * Job retry API response
 * Returns job details after successful retry
 */
export interface JobRetryApiResponse {
  data: JobRetryResponse;
}

/**
 * Job retry response structure
 * Contains essential job information after retry
 */
export interface JobRetryResponse {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  created_at: string;
}
