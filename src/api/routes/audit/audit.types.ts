/**
 * Audit Log API Types
 *
 * Type definitions for the audit log API endpoints.
 * These types define the request and response structures for the /api/audit endpoints.
 *
 * US-008: Create Audit Log API Endpoint
 */

import type { AuditLog } from '@nextmavens/audit-logs-database';

/**
 * Query parameters for the GET /api/audit endpoint
 * All parameters are optional and used for filtering audit logs
 */
export interface AuditLogQueryParams {
  actor_id?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  request_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: string;
  offset?: string;
}

/**
 * Audit log API response
 * Returns paginated audit log entries with metadata
 */
export interface AuditLogApiResponse {
  data: AuditLog[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/**
 * Error response structure
 * Used when audit log queries fail
 */
export interface AuditLogErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Validation error details
 * Provides specific information about validation failures
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  received?: unknown;
}

/**
 * Extended Express Request for audit endpoints
 * Includes JWT payload after authentication
 */
export interface AuditApiRequest {
  query: AuditLogQueryParams;
  jwtPayload?: {
    project_id: string;
    sub?: string;
    [key: string]: unknown;
  };
}
