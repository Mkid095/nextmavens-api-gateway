/**
 * Validation module exports
 * Centralized exports for all validators, middleware, and services
 */

// Validators
export {
  ProjectStatusValidator,
  createProjectStatusValidator,
  getProjectStatusValidator,
  type ProjectStatusValidation
} from './project-status.validator.js';

// Middleware
export {
  validateProjectStatus,
  requireActiveProject,
  attachProjectData,
  type ValidatedRequest
} from './middleware/project-status.middleware.js';

// Services
export {
  ValidationDataService,
  createValidationDataService,
  getValidationDataService
} from './services/validation-data.service.js';

// Types
export type {
  ValidationContext,
  ValidationResult,
  ProjectValidationData,
  ValidationOptions,
  ValidationCacheEntry,
  ValidationMetrics,
  ValidationErrorDetails
} from './types/validation.types.js';

// Integration
export {
  ValidationDataLayer,
  getValidationDataLayer,
  resetValidationDataLayer,
  type ValidationPipelineResult
} from './integration/snapshot-integration.js';
