import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import { createProjectStatusValidator } from '@/validation/project-status.validator.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import type {
  ValidationContext,
  ValidationResult,
  ProjectValidationData,
  ValidationOptions,
  ValidationCacheEntry,
  ValidationMetrics
} from '@/validation/types/validation.types.js';

/**
 * Validation data service
 * Coordinates between snapshot service and validators
 * Provides caching and metrics for validation operations
 */
export class ValidationDataService {
  private cache: Map<string, ValidationCacheEntry>;
  private metrics: ValidationMetrics;
  private cacheTTL: number;

  constructor(cacheTTLSeconds: number = 5) {
    this.cache = new Map();
    this.cacheTTL = cacheTTLSeconds * 1000;
    this.metrics = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastValidationTime: null
    };
  }

  /**
   * Validate project status with full context
   */
  async validateProjectStatus(
    projectId: string,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const {
      throwOnError = false,
      includeContext = true,
      cacheResult = true
    } = options;

    this.metrics.totalValidations++;

    // Check cache first
    if (cacheResult) {
      const cached = this.getCachedValidation(projectId);
      if (cached) {
        this.metrics.cacheHits++;
        this.metrics.lastValidationTime = Date.now();
        return cached;
      }
      this.metrics.cacheMisses++;
    }

    // Build validation context
    const context: ValidationContext = {
      projectId,
      timestamp: Date.now(),
      requestId: includeContext ? this.generateRequestId() : undefined
    };

    try {
      // Get project data from snapshot
      const projectData = await this.getProjectData(projectId);

      // Validate using validator
      const validator = createProjectStatusValidator();
      const validation = validator.validateProjectStatus(projectData.project);

      // Add context to result
      const result: ValidationResult = {
        ...validation,
        context
      };

      // Update metrics
      if (validation.isValid) {
        this.metrics.successfulValidations++;
      } else {
        this.metrics.failedValidations++;
      }
      this.metrics.lastValidationTime = Date.now();

      // Cache result
      if (cacheResult && validation.isValid) {
        this.cacheValidation(projectId, result);
      }

      // Throw if requested and invalid
      if (throwOnError && !validation.isValid && validation.error) {
        throw validation.error;
      }

      return result;
    } catch (error) {
      this.metrics.failedValidations++;
      this.metrics.lastValidationTime = Date.now();

      if (error instanceof ApiError) {
        return {
          isValid: false,
          error,
          context
        };
      }

      throw error;
    }
  }

  /**
   * Get project validation data from snapshot
   */
  async getProjectData(projectId: string): Promise<ProjectValidationData> {
    const snapshotService = getSnapshotService();

    if (!snapshotService) {
      throw new ApiError(
        ApiErrorCode.SNAPSHOT_UNAVAILABLE,
        'Snapshot service not initialized',
        503,
        true
      );
    }

    const project = snapshotService.getProject(projectId);

    return {
      project,
      exists: project !== null,
      isActive: project ? project.status === 'ACTIVE' : false,
      status: project ? project.status : 'NOT_FOUND'
    };
  }

  /**
   * Validate multiple projects in batch
   */
  async validateBatch(
    projectIds: string[],
    options: ValidationOptions = {}
  ): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    await Promise.all(
      projectIds.map(async (projectId) => {
        try {
          const result = await this.validateProjectStatus(projectId, options);
          results.set(projectId, result);
        } catch (error) {
          if (error instanceof ApiError) {
            results.set(projectId, {
              isValid: false,
              error,
              context: {
                projectId,
                timestamp: Date.now()
              }
            });
          }
        }
      })
    );

    return results;
  }

  /**
   * Check if project is active without throwing
   */
  isProjectActive(projectId: string): boolean {
    const snapshotService = getSnapshotService();
    if (!snapshotService) {
      return false;
    }

    return snapshotService.isProjectActive(projectId);
  }

  /**
   * Get validation metrics
   */
  getMetrics(): ValidationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastValidationTime: null
    };
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ projectId: string; expiresAt: number }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([projectId, entry]) => ({
      projectId,
      expiresAt: entry.expiresAt
    }));

    return {
      size: this.cache.size,
      entries
    };
  }

  /**
   * Clean expired cache entries
   */
  cleanExpiredCache(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [projectId, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(projectId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get cached validation result
   */
  private getCachedValidation(projectId: string): ValidationResult | null {
    const entry = this.cache.get(projectId);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(projectId);
      return null;
    }

    return entry.result;
  }

  /**
   * Cache validation result
   */
  private cacheValidation(projectId: string, result: ValidationResult): void {
    const entry: ValidationCacheEntry = {
      projectId,
      result,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.cacheTTL
    };

    this.cache.set(projectId, entry);
  }

  /**
   * Generate request ID for tracking
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Create a singleton instance of the validation data service
 */
let validationDataServiceInstance: ValidationDataService | null = null;

export function createValidationDataService(
  cacheTTLSeconds?: number
): ValidationDataService {
  if (validationDataServiceInstance) {
    return validationDataServiceInstance;
  }

  validationDataServiceInstance = new ValidationDataService(cacheTTLSeconds);
  return validationDataServiceInstance;
}

export function getValidationDataService(): ValidationDataService | null {
  return validationDataServiceInstance;
}
