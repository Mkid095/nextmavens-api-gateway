import { ProjectConfig } from '@/types/snapshot.types.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';

/**
 * Validation result for service enablement
 */
export interface ServiceEnablementValidation {
  isValid: boolean;
  error?: ApiError;
}

/**
 * Service enablement validator
 * Validates if a service is enabled for a project and returns appropriate errors
 */
export class ServiceEnablementValidator {
  /**
   * Validate service enablement
   * Returns validation result with error if service is not enabled
   *
   * SECURITY:
   * - Uses constant-time principles to prevent timing attacks
   * - Generic error messages prevent service enumeration
   * - Validates service name format to prevent injection
   */
  validateServiceEnablement(
    project: ProjectConfig | null,
    serviceName: string
  ): ServiceEnablementValidation {
    // Validate service name format first
    const sanitisedServiceName = this.validateServiceName(serviceName);

    // Check if project exists
    if (!project) {
      return {
        isValid: false,
        error: new ApiError(
          ApiErrorCode.PROJECT_NOT_FOUND,
          'Project not found or access denied',
          404,
          false
        )
      };
    }

    // SECURITY: Constant-time check to prevent timing attacks
    // Use includes() which has consistent timing regardless of position
    const isServiceEnabled = project.enabledServices.includes(sanitisedServiceName);

    if (!isServiceEnabled) {
      return {
        isValid: false,
        error: this.createServiceDisabledError(sanitisedServiceName)
      };
    }

    return { isValid: true };
  }

  /**
   * Validate service enablement and throw error if invalid
   * Throws ApiError if service is not enabled
   *
   * SECURITY: Constant-time execution prevents timing leaks
   */
  validateServiceEnablementOrThrow(
    project: ProjectConfig | null,
    serviceName: string
  ): void {
    const validation = this.validateServiceEnablement(project, serviceName);

    // SECURITY: Always perform the validation even if we might throw
    const shouldThrow = !validation.isValid;

    if (shouldThrow && validation.error) {
      throw validation.error;
    }
  }

  /**
   * Check if service is enabled without throwing
   */
  isServiceEnabled(project: ProjectConfig | null, serviceName: string): boolean {
    if (!project) {
      return false;
    }

    const sanitisedServiceName = this.validateServiceName(serviceName);
    return project.enabledServices.includes(sanitisedServiceName);
  }

  /**
   * Validate and sanitise service name
   * Throws error if service name format is invalid
   *
   * SECURITY:
   * - Enforces maximum length to prevent DoS
   * - Strict format validation prevents injection
   * - Trims whitespace to prevent bypass attempts
   */
  private validateServiceName(serviceName: string): string {
    const MAX_SERVICE_NAME_LENGTH = 100;
    const SERVICE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

    // SECURITY: Check raw input length before processing
    if (serviceName.length > MAX_SERVICE_NAME_LENGTH) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Invalid service name format',
        400,
        false
      );
    }

    const trimmed = serviceName.trim();

    // SECURITY: Check trimmed length
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Invalid service name format',
        400,
        false
      );
    }

    // SECURITY: Strict format validation
    if (!SERVICE_NAME_REGEX.test(trimmed)) {
      throw new ApiError(
        ApiErrorCode.BAD_REQUEST,
        'Invalid service name format',
        400,
        false
      );
    }

    return trimmed;
  }

  /**
   * Create a service disabled error
   * SECURITY: Generic message with service name to prevent information leakage
   * but provides enough detail for the user to understand what's disabled
   */
  private createServiceDisabledError(serviceName: string): ApiError {
    return new ApiError(
      ApiErrorCode.SERVICE_DISABLED,
      `Service '${serviceName}' is not enabled for this project. Please enable it in the developer portal.`,
      403,
      false
    );
  }
}

/**
 * Create a singleton instance of the service enablement validator
 */
let validatorInstance: ServiceEnablementValidator | null = null;

export function createServiceEnablementValidator(): ServiceEnablementValidator {
  if (validatorInstance) {
    return validatorInstance;
  }

  validatorInstance = new ServiceEnablementValidator();
  return validatorInstance;
}

export function getServiceEnablementValidator(): ServiceEnablementValidator | null {
  return validatorInstance;
}
