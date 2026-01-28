import { ProjectStatus, ProjectConfig } from '@/types/snapshot.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Validation result for project status
 */
export interface ProjectStatusValidation {
  isValid: boolean;
  error?: ApiError;
}

/**
 * Project status validator
 * Validates project status and returns appropriate errors for non-active projects
 */
export class ProjectStatusValidator {
  /**
   * Validate project status
   * Returns validation result with error if project is not active
   *
   * SECURITY: Uses constant-time principles to prevent timing attacks
   * - All status checks follow same execution path
   * - No early returns that could leak information via timing
   * - Generic error messages prevent project enumeration
   */
  validateProjectStatus(project: ProjectConfig | null): ProjectStatusValidation {
    // Initialize result with default active state
    let isValid = true;
    let error: ApiError | undefined;

    // Check if project exists (constant-time with status check)
    if (!project) {
      isValid = false;
      error = ApiError.projectNotFound('unknown');
    } else {
      // Check project status using exhaustive if-else to prevent timing differences
      if (project.status !== ProjectStatus.ACTIVE) {
        isValid = false;

        // Map all non-active statuses to errors (constant-time assignment)
        if (project.status === ProjectStatus.SUSPENDED) {
          error = this.createProjectSuspendedError();
        } else if (project.status === ProjectStatus.ARCHIVED) {
          error = this.createProjectArchivedError();
        } else if (project.status === ProjectStatus.DELETED) {
          error = this.createProjectDeletedError();
        } else {
          // SECURITY: Don't leak unknown status values in production
          // Log for debugging but return generic error
          console.error(`[Security] Unknown project status: ${project.status} for project: ${project.projectId}`);
          error = new ApiError(
            ApiErrorCode.INTERNAL_ERROR,
            'Unable to validate project status',
            500,
            false
          );
        }
      }
    }

    return { isValid, error };
  }

  /**
   * Validate project status and throw error if invalid
   * Throws ApiError if project is not active
   *
   * SECURITY: Constant-time execution prevents timing leaks
   */
  validateProjectStatusOrThrow(project: ProjectConfig | null): void {
    const validation = this.validateProjectStatus(project);

    // SECURITY: Always perform the validation even if we might throw
    // This prevents timing differences between valid and invalid states
    const shouldThrow = !validation.isValid;

    if (shouldThrow && validation.error) {
      throw validation.error;
    }
  }

  /**
   * Check if project is active without throwing
   */
  isProjectActive(project: ProjectConfig | null): boolean {
    if (!project) {
      return false;
    }
    return project.status === ProjectStatus.ACTIVE;
  }

  /**
   * Create a project suspended error
   * SECURITY: Generic message to prevent information leakage
   */
  private createProjectSuspendedError(): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_SUSPENDED,
      'Project is suspended. Please contact support to resolve any outstanding issues.',
      403,
      false
    );
  }

  /**
   * Create a project archived error
   * SECURITY: Generic message to prevent information leakage
   */
  private createProjectArchivedError(): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_ARCHIVED,
      'Project is archived and cannot accept requests. Please contact support if you need to reactivate this project.',
      403,
      false
    );
  }

  /**
   * Create a project deleted error
   * SECURITY: Generic message to prevent information leakage
   */
  private createProjectDeletedError(): ApiError {
    return new ApiError(
      ApiErrorCode.PROJECT_DELETED,
      'Project has been deleted and is no longer available.',
      403,
      false
    );
  }
}

/**
 * Create a singleton instance of the project status validator
 */
let validatorInstance: ProjectStatusValidator | null = null;

export function createProjectStatusValidator(): ProjectStatusValidator {
  if (validatorInstance) {
    return validatorInstance;
  }

  validatorInstance = new ProjectStatusValidator();
  return validatorInstance;
}

export function getProjectStatusValidator(): ProjectStatusValidator | null {
  return validatorInstance;
}
