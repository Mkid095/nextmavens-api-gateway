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
   */
  validateProjectStatus(project: ProjectConfig | null): ProjectStatusValidation {
    // Check if project exists
    if (!project) {
      return {
        isValid: false,
        error: ApiError.projectNotFound('unknown')
      };
    }

    // Check project status
    switch (project.status) {
      case ProjectStatus.ACTIVE:
        return { isValid: true };

      case ProjectStatus.SUSPENDED:
        return {
          isValid: false,
          error: this.createProjectSuspendedError()
        };

      case ProjectStatus.ARCHIVED:
        return {
          isValid: false,
          error: this.createProjectArchivedError()
        };

      case ProjectStatus.DELETED:
        return {
          isValid: false,
          error: this.createProjectDeletedError()
        };

      default:
        // Handle unknown status values
        return {
          isValid: false,
          error: new ApiError(
            ApiErrorCode.INTERNAL_ERROR,
            `Unknown project status: ${project.status}`,
            500,
            false,
            { projectId: project.projectId, status: project.status }
          )
        };
    }
  }

  /**
   * Validate project status and throw error if invalid
   * Throws ApiError if project is not active
   */
  validateProjectStatusOrThrow(project: ProjectConfig | null): void {
    const validation = this.validateProjectStatus(project);

    if (!validation.isValid && validation.error) {
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
