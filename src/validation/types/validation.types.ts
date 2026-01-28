import { ProjectConfig } from '@/types/snapshot.types.js';
import { ApiError } from '@/api/middleware/error.handler.js';

/**
 * Validation context metadata
 */
export interface ValidationContext {
  projectId: string;
  timestamp: number;
  requestId?: string;
}

/**
 * Validation result with error details
 */
export interface ValidationResult {
  isValid: boolean;
  error?: ApiError;
  context: ValidationContext;
}

/**
 * Project validation data from snapshot
 */
export interface ProjectValidationData {
  project: ProjectConfig | null;
  exists: boolean;
  isActive: boolean;
  status: string;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  throwOnError?: boolean;
  includeContext?: boolean;
  cacheResult?: boolean;
}

/**
 * Validation cache entry
 */
export interface ValidationCacheEntry {
  projectId: string;
  result: ValidationResult;
  timestamp: number;
  expiresAt: number;
}

/**
 * Validation metrics
 */
export interface ValidationMetrics {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  cacheHits: number;
  cacheMisses: number;
  lastValidationTime: number | null;
}

/**
 * Validation error details
 */
export interface ValidationErrorDetails {
  projectId: string;
  projectStatus?: string;
  projectName?: string;
  timestamp: number;
}
