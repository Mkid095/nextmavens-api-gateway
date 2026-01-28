/**
 * Data Layer Integration for Validation
 *
 * This module demonstrates the integration between:
 * - Snapshot Service (data source)
 * - Validation Data Service (orchestrator)
 * - Validators (business logic)
 * - Middleware (request handling)
 *
 * Data Flow:
 * 1. Request arrives with project ID
 * 2. Middleware extracts project ID
 * 3. Validation Data Service coordinates:
 *    - Fetches project from Snapshot Service
 *    - Validates using ProjectStatusValidator
 *    - Caches results for performance
 * 4. Middleware handles validation result
 * 5. Request proceeds or is rejected
 */

import { createValidationDataService } from '@/validation/services/validation-data.service.js';
import { ApiError } from '@/api/middleware/error.handler.js';
import type { ProjectValidationData } from '@/validation/types/validation.types.js';

/**
 * Validation pipeline result
 */
export interface ValidationPipelineResult {
  success: boolean;
  projectExists: boolean;
  isActive: boolean;
  error?: ApiError;
}

/**
 * Data layer integration for project status validation
 * Provides a clean interface for the validation data flow
 */
export class ValidationDataLayer {
  private validationService: ReturnType<typeof createValidationDataService>;

  constructor() {
    this.validationService = createValidationDataService(5); // 5 second cache
  }

  /**
   * Validate project status through the complete data layer
   */
  async validateProject(projectId: string): Promise<ValidationPipelineResult> {
    try {
      // Step 1: Get validation result from service
      const result = await this.validationService.validateProjectStatus(
        projectId,
        {
          throwOnError: false,
          includeContext: true,
          cacheResult: true
        }
      );

      // Step 2: Extract project data
      const projectData = await this.getProjectData(projectId);

      return {
        success: result.isValid,
        projectExists: projectData.exists,
        isActive: projectData.isActive,
        error: result.error
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return {
          success: false,
          projectExists: false,
          isActive: false,
          error
        };
      }

      throw error;
    }
  }

  /**
   * Get project data directly from snapshot
   */
  async getProjectData(projectId: string): Promise<ProjectValidationData> {
    return this.validationService.getProjectData(projectId);
  }

  /**
   * Quick check if project is active (uses cached snapshot)
   */
  isProjectActive(projectId: string): boolean {
    return this.validationService.isProjectActive(projectId);
  }

  /**
   * Validate multiple projects in batch
   */
  async validateBatch(projectIds: string[]): Promise<Map<string, ValidationPipelineResult>> {
    const results = new Map<string, ValidationPipelineResult>();
    const validationResults = await this.validationService.validateBatch(projectIds);

    for (const [projectId, validation] of validationResults.entries()) {
      results.set(projectId, {
        success: validation.isValid,
        projectExists: validation.context.projectId !== 'unknown',
        isActive: validation.isValid,
        error: validation.error
      });
    }

    return results;
  }

  /**
   * Get validation metrics
   */
  getMetrics() {
    return this.validationService.getMetrics();
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.validationService.clearCache();
  }
}

/**
 * Singleton instance
 */
let dataLayerInstance: ValidationDataLayer | null = null;

/**
 * Get or create the validation data layer instance
 */
export function getValidationDataLayer(): ValidationDataLayer {
  if (!dataLayerInstance) {
    dataLayerInstance = new ValidationDataLayer();
  }
  return dataLayerInstance;
}

/**
 * Reset the data layer instance (useful for testing)
 */
export function resetValidationDataLayer(): void {
  if (dataLayerInstance) {
    dataLayerInstance.cleanup();
    dataLayerInstance = null;
  }
}
