/**
 * Provision Project Job Handler
 *
 * Handles project provisioning by:
 * 1. Creating tenant database
 * 2. Creating tenant schema
 * 3. Registering with services (auth, realtime, storage)
 * 4. Generating API keys
 *
 * This job supports retry logic with:
 * - Retry interval: 5 minutes (300 seconds)
 * - Max attempts: 3
 * - Exponential backoff for retries
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { provisionProjectHandler } from '@/lib/jobs/handlers/provision-project.handler';
 *
 * // Register the handler
 * worker.registerHandler('provision_project', provisionProjectHandler);
 *
 * // Enqueue a provision job
 * await enqueueJob('provision_project', {
 *   project_id: 'proj-123',
 *   region: 'us-east-1'
 * }, {
 *   maxAttempts: 3
 * });
 * ```
 */

import type { JobPayload, JobExecutionResult } from '@nextmavens/audit-logs-database';
import { enqueueJob } from '../queue.js';
import {
  createTenantDatabase,
  createTenantSchema,
  registerAuthService,
  registerRealtimeService,
  registerStorageService,
  generateApiKeys,
  type ProvisionProjectPayload,
  type ProvisionProjectMetadata,
  validateProvisionProjectPayload,
  ProvisioningError,
} from './provision-project/index.js';

/**
 * Retry configuration
 * Max 3 attempts with 5-minute intervals
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  retryIntervalMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Provision Project Job Handler
 *
 * Provisions a new tenant project by:
 * 1. Validating the project exists and is eligible for provisioning
 * 2. Creating a dedicated tenant database
 * 3. Creating the tenant schema with proper permissions
 * 4. Registering with auth service (if enabled)
 * 5. Registering with realtime service (if enabled)
 * 6. Registering with storage service (if enabled)
 * 7. Generating initial API keys
 * 8. Returning the provisioned infrastructure details
 *
 * This handler supports retry logic for transient failures such as:
 * - Database connectivity issues
 * - Service registration timeouts
 * - Network errors during provisioning
 *
 * @param payload - Job payload containing project provisioning parameters
 * @returns Promise resolving to job execution result with provisioned infrastructure details
 *
 * @throws Error if project_id is missing
 * @throws Error if region is missing
 * @throws Error if project not found
 * @throws Error if database creation fails
 * @throws Error if schema creation fails
 * @throws Error if service registration fails
 * @throws Error if API key generation fails
 *
 * @example
 * ```typescript
 * const result = await provisionProjectHandler({
 *   project_id: 'proj-123',
 *   region: 'us-east-1',
 *   services: {
 *     auth: true,
 *     realtime: true,
 *     storage: true
 *   },
 *   api_keys: {
 *     count: 2,
 *     prefix: 'proj-123'
 *   }
 * });
 *
 * if (result.success) {
 *   console.log('Project provisioned:', result.data.database);
 * } else {
 *   console.error('Provisioning failed:', result.error);
 * }
 * ```
 */
export async function provisionProjectHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  // Validate payload
  const params = payload as ProvisionProjectPayload;

  try {
    // Validate all input fields
    validateProvisionProjectPayload(params);
  } catch (error) {
    if (error instanceof ProvisioningError) {
      return {
        success: false,
        error: `Validation failed: ${error.message}`,
      };
    }
    return {
      success: false,
      error: 'Validation failed',
    };
  }

  console.log(`[ProvisionProject] Starting provisioning for project: ${params.project_id}`);
  const startTime = Date.now();

  try {
    console.log(`[ProvisionProject] Provisioning project ${params.project_id} in region ${params.region}`);

    // Step 1: Create tenant database
    const databaseInfo = await createTenantDatabase(params.project_id);

    // Step 2: Create tenant schema
    const schemaInfo = await createTenantSchema(params.project_id, databaseInfo.database_name);

    // Step 3-5: Register with services (if enabled)
    const services: ProvisionProjectMetadata['services'] = {};

    if (params.services?.auth) {
      console.log(`[ProvisionProject] Registering with auth service...`);
      services.auth = await registerAuthService(params.project_id, params.region);
    }

    if (params.services?.realtime) {
      console.log(`[ProvisionProject] Registering with realtime service...`);
      services.realtime = await registerRealtimeService(params.project_id, params.region);
    }

    if (params.services?.storage) {
      console.log(`[ProvisionProject] Registering with storage service...`);
      services.storage = await registerStorageService(params.project_id, params.region);
    }

    // Step 6: Generate API keys
    const apiKeyCount = params.api_keys?.count || 1;
    const apiKeyPrefix = params.api_keys?.prefix;
    const apiKeys = await generateApiKeys(params.project_id, apiKeyCount, apiKeyPrefix);

    // Step 7: Compile metadata
    const metadata: ProvisionProjectMetadata = {
      projectId: params.project_id,
      database: {
        ...databaseInfo,
        ...schemaInfo,
      },
      services,
      api_keys: apiKeys.map((key) => ({
        key_id: key.key_id,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
      })),
      metadata: {
        provisioned_at: new Date(),
        region: params.region,
        owner_id: params.owner_id,
        organization_id: params.organization_id,
      },
    };

    const durationMs = Date.now() - startTime;

    console.log(
      `[ProvisionProject] Successfully provisioned project ${params.project_id} in ${durationMs}ms`
    );

    return {
      success: true,
      data: metadata,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProvisionProject] Failed to provision project ${params.project_id}:`, errorMessage);

    return {
      success: false,
      error: 'Failed to provision project',
    };
  }
}

/**
 * Convenience function to enqueue a provision_project job
 *
 * @param projectId - The ID of the project to provision
 * @param region - The target region for provisioning
 * @param options - Optional configuration for provisioning
 * @returns Promise resolving to the job ID
 *
 * @example
 * ```typescript
 * import { enqueueProvisionProjectJob } from '@/lib/jobs/handlers/provision-project.handler';
 *
 * // Basic provisioning with defaults
 * const jobId1 = await enqueueProvisionProjectJob('proj-123', 'us-east-1');
 *
 * // Provisioning with custom options
 * const jobId2 = await enqueueProvisionProjectJob('proj-456', 'eu-west-1', {
 *   database: {
 *     engine: 'postgresql',
 *     version: '15',
 *     size: 'db.t3.micro',
 *     storage_gb: 20
 *   },
 *   services: {
 *     auth: true,
 *     realtime: true,
 *     storage: true
 *   },
 *   api_keys: {
 *     count: 3,
 *     prefix: 'prod'
 *   },
 *   owner_id: 'user-123',
 *   organization_id: 'org-456'
 * });
 * ```
 */
export async function enqueueProvisionProjectJob(
  projectId: string,
  region: string,
  options?: Partial<Omit<ProvisionProjectPayload, 'project_id' | 'region'>>
): Promise<string> {
  const payload: ProvisionProjectPayload = {
    project_id: projectId,
    region,
    ...options,
  };

  const result = await enqueueJob('provision_project', payload, {
    maxAttempts: RETRY_CONFIG.maxAttempts,
  });

  return result.id;
}
