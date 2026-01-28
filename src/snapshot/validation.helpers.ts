import { Response } from 'express';
import { ProjectStatus } from '@/types/snapshot.types.js';

/**
 * Error codes for gateway enforcement
 */
export enum GatewayErrorCode {
  PROJECT_SUSPENDED = 'PROJECT_SUSPENDED',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PROJECT_DELETED = 'PROJECT_DELETED',
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  SERVICE_DISABLED = 'SERVICE_DISABLED',
  SNAPSHOT_UNAVAILABLE = 'SNAPSHOT_UNAVAILABLE',
  KEY_INVALID = 'KEY_INVALID'
}

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

/**
 * Send standardized error response
 */
export function sendErrorResponse(
  res: Response,
  code: GatewayErrorCode,
  message: string,
  status: number = 403
): void {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      retryable: code === GatewayErrorCode.SNAPSHOT_UNAVAILABLE
    }
  };

  res.status(status).json(response);
}

/**
 * Check project status and send appropriate error response
 * Returns true if project is active, false if error response was sent
 */
export function validateProjectStatusAndRespond(
  res: Response,
  projectName: string,
  status: ProjectStatus
): boolean {
  switch (status) {
    case ProjectStatus.ACTIVE:
      return true;

    case ProjectStatus.SUSPENDED:
      sendErrorResponse(
        res,
        GatewayErrorCode.PROJECT_SUSPENDED,
        `Project '${projectName}' is suspended. Please contact support.`,
        403
      );
      return false;

    case ProjectStatus.ARCHIVED:
      sendErrorResponse(
        res,
        GatewayErrorCode.PROJECT_ARCHIVED,
        `Project '${projectName}' is archived and cannot accept requests.`,
        403
      );
      return false;

    case ProjectStatus.DELETED:
      sendErrorResponse(
        res,
        GatewayErrorCode.PROJECT_DELETED,
        `Project '${projectName}' has been deleted.`,
        403
      );
      return false;

    default:
      sendErrorResponse(
        res,
        GatewayErrorCode.PROJECT_SUSPENDED,
        `Project '${projectName}' has unknown status: ${status}`,
        403
      );
      return false;
  }
}
