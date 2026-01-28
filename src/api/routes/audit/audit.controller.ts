/**
 * Audit Log Controller
 *
 * Handles requests for querying audit logs.
 * Provides secure, paginated access to audit log entries.
 *
 * US-008: Create Audit Log API Endpoint
 */

import type { Request, Response, NextFunction } from 'express';
import { queryAuditLogs } from '@nextmavens/audit-logs-database';
import type {
  AuditLogQueryParams,
  AuditLogApiResponse,
  ValidationErrorDetail
} from './audit.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Validate date string format
 * Ensures date strings are ISO 8601 compliant
 */
function isValidDateString(dateString: string): boolean {
  if (!dateString) {
    return false;
  }

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Validate and parse query parameters
 * Converts string query parameters to proper types and validates them
 *
 * SECURITY: SQL injection protection through parameterized queries
 * All string parameters are passed as bound parameters, not concatenated
 */
function validateAndParseQueryParams(params: AuditLogQueryParams): {
  valid: boolean;
  query: {
    actor_id?: string;
    action?: string;
    target_type?: string;
    target_id?: string;
    start_date?: Date;
    end_date?: Date;
    limit?: number;
    offset?: number;
  };
  errors: ValidationErrorDetail[];
} {
  const errors: ValidationErrorDetail[] = [];
  const query: {
    actor_id?: string;
    action?: string;
    target_type?: string;
    target_id?: string;
    start_date?: Date;
    end_date?: Date;
    limit?: number;
    offset?: number;
  } = {};

  // Validate actor_id (optional, but must be string if provided)
  if (params.actor_id) {
    if (typeof params.actor_id !== 'string') {
      errors.push({
        field: 'actor_id',
        message: 'actor_id must be a string',
        received: typeof params.actor_id
      });
    } else if (params.actor_id.length > 500) {
      errors.push({
        field: 'actor_id',
        message: 'actor_id must be less than 500 characters',
        received: `${params.actor_id.length} characters`
      });
    } else {
      query.actor_id = params.actor_id;
    }
  }

  // Validate action (optional, but must be string if provided)
  if (params.action) {
    if (typeof params.action !== 'string') {
      errors.push({
        field: 'action',
        message: 'action must be a string',
        received: typeof params.action
      });
    } else if (params.action.length > 100) {
      errors.push({
        field: 'action',
        message: 'action must be less than 100 characters',
        received: `${params.action.length} characters`
      });
    } else {
      query.action = params.action;
    }
  }

  // Validate target_type (optional, but must be string if provided)
  if (params.target_type) {
    if (typeof params.target_type !== 'string') {
      errors.push({
        field: 'target_type',
        message: 'target_type must be a string',
        received: typeof params.target_type
      });
    } else if (params.target_type.length > 50) {
      errors.push({
        field: 'target_type',
        message: 'target_type must be less than 50 characters',
        received: `${params.target_type.length} characters`
      });
    } else {
      query.target_type = params.target_type;
    }
  }

  // Validate target_id (optional, but must be string if provided)
  if (params.target_id) {
    if (typeof params.target_id !== 'string') {
      errors.push({
        field: 'target_id',
        message: 'target_id must be a string',
        received: typeof params.target_id
      });
    } else if (params.target_id.length > 500) {
      errors.push({
        field: 'target_id',
        message: 'target_id must be less than 500 characters',
        received: `${params.target_id.length} characters`
      });
    } else {
      query.target_id = params.target_id;
    }
  }

  // Validate start_date (optional, but must be valid date if provided)
  if (params.start_date) {
    if (!isValidDateString(params.start_date)) {
      errors.push({
        field: 'start_date',
        message: 'start_date must be a valid ISO 8601 date string',
        received: params.start_date
      });
    } else {
      query.start_date = new Date(params.start_date);
    }
  }

  // Validate end_date (optional, but must be valid date if provided)
  if (params.end_date) {
    if (!isValidDateString(params.end_date)) {
      errors.push({
        field: 'end_date',
        message: 'end_date must be a valid ISO 8601 date string',
        received: params.end_date
      });
    } else {
      query.end_date = new Date(params.end_date);
    }
  }

  // Validate date range logic
  if (query.start_date && query.end_date) {
    if (query.start_date > query.end_date) {
      errors.push({
        field: 'start_date',
        message: 'start_date must be before end_date',
        received: `${params.start_date} > ${params.end_date}`
      });
    }
  }

  // Validate limit (optional, must be positive integer if provided)
  if (params.limit) {
    const limitNum = parseInt(params.limit, 10);
    if (isNaN(limitNum)) {
      errors.push({
        field: 'limit',
        message: 'limit must be a valid integer',
        received: params.limit
      });
    } else if (limitNum < 1) {
      errors.push({
        field: 'limit',
        message: 'limit must be greater than 0',
        received: params.limit
      });
    } else if (limitNum > 1000) {
      errors.push({
        field: 'limit',
        message: 'limit cannot exceed 1000',
        received: params.limit
      });
    } else {
      query.limit = limitNum;
    }
  } else {
    // Default limit
    query.limit = 100;
  }

  // Validate offset (optional, must be non-negative integer if provided)
  if (params.offset) {
    const offsetNum = parseInt(params.offset, 10);
    if (isNaN(offsetNum)) {
      errors.push({
        field: 'offset',
        message: 'offset must be a valid integer',
        received: params.offset
      });
    } else if (offsetNum < 0) {
      errors.push({
        field: 'offset',
        message: 'offset must be greater than or equal to 0',
        received: params.offset
      });
    } else {
      query.offset = offsetNum;
    }
  } else {
    // Default offset
    query.offset = 0;
  }

  return {
    valid: errors.length === 0,
    query,
    errors
  };
}

/**
 * GET /api/audit
 *
 * Query audit logs with optional filters.
 * Returns paginated results sorted by created_at DESC.
 *
 * Query Parameters:
 * - actor_id: Filter by actor ID (overridden to authenticated user)
 * - action: Filter by action type
 * - target_type: Filter by target type
 * - target_id: Filter by target ID
 * - start_date: Filter by start date (ISO 8601)
 * - end_date: Filter by end date (ISO 8601)
 * - limit: Maximum number of results (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 *
 * SECURITY:
 * - Requires authentication (JWT)
 * - All queries use parameterized statements (SQL injection protected)
 * - Results are scoped to the authenticated user (actor_id = project_id from JWT)
 * - Users can only see logs where they were the actor (least privilege)
 * - Input validation prevents abuse
 *
 * @param req - Express request with query parameters
 * @param res - Express response
 * @param next - Express next function
 */
export async function getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Validate and parse query parameters
    const validation = validateAndParseQueryParams(req.query as AuditLogQueryParams);

    if (!validation.valid) {
      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid query parameters',
        400,
        false,
        { errors: validation.errors }
      );
    }

    // SECURITY: CRITICAL - Scope results to authenticated user
    // Users can only view audit logs where they were the actor
    // This prevents unauthorized access to other projects' audit logs
    const projectId = req.projectId;

    if (!projectId) {
      throw new ApiError(
        ApiErrorCode.UNAUTHORIZED,
        'Authentication required: project_id not found in token',
        401,
        false
      );
    }

    // SECURITY: Override actor_id filter with authenticated user's project_id
    // This ensures users can only see their own audit logs
    const scopedQuery = {
      ...validation.query,
      actor_id: projectId
    };

    // Query audit logs using the database service
    // SECURITY: queryAuditLogs uses parameterized queries internally
    const result = await queryAuditLogs(scopedQuery);

    // Format response
    const response: AuditLogApiResponse = {
      data: result.data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        has_more: result.has_more
      }
    };

    // Return successful response
    res.status(200).json(response);
  } catch (error) {
    // Pass error to error handler middleware
    next(error);
  }
}
