/**
 * Provision Project Types
 *
 * Type definitions and validation schemas for project provisioning job handler.
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 */

import type { JobPayload } from '@nextmavens/audit-logs-database';

/**
 * Provision project handler payload
 */
export interface ProvisionProjectPayload extends JobPayload {
  /**
   * The ID of the project to provision
   * Must be a valid UUID or alphanumeric string with hyphens/underscores
   */
  project_id: string;

  /**
   * Target region for infrastructure deployment
   * Must be a valid AWS/GCP region format (e.g., us-east-1, eu-west-1)
   */
  region: string;

  /**
   * Database configuration options
   */
  database?: {
    /**
     * Database engine type
     */
    engine?: 'postgresql' | 'mysql';
    /**
     * Database version
     */
    version?: string;
    /**
     * Instance size
     */
    size?: string;
    /**
     * Storage size in GB (1-1000)
     */
    storage_gb?: number;
  };

  /**
   * Service integration flags
   */
  services?: {
    /**
     * Enable auth service integration
     */
    auth?: boolean;
    /**
     * Enable realtime service integration
     */
    realtime?: boolean;
    /**
     * Enable storage service integration
     */
    storage?: boolean;
  };

  /**
   * API key generation options
   */
  api_keys?: {
    /**
     * Number of keys to generate (1-10)
     */
    count?: number;
    /**
     * Key prefix for identification (alphanumeric and hyphens only)
     */
    prefix?: string;
  };

  /**
   * Optional owner/user ID
   */
  owner_id?: string;

  /**
   * Organization ID for multi-tenant support
   */
  organization_id?: string;
}

/**
 * Validation error class for provisioning errors
 */
export class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

/**
 * Validate provision project payload
 *
 * @param payload - The payload to validate
 * @throws ProvisioningError if validation fails
 */
export function validateProvisionProjectPayload(
  payload: ProvisionProjectPayload
): void {
  // Validate project_id
  if (!payload.project_id) {
    throw new ProvisioningError('project_id is required', 'project_id', 'REQUIRED');
  }

  const projectIdPattern = /^[a-zA-Z0-9-_]+$/;
  if (!projectIdPattern.test(payload.project_id)) {
    throw new ProvisioningError(
      'project_id must contain only alphanumeric characters, hyphens, and underscores',
      'project_id',
      'INVALID_FORMAT'
    );
  }

  if (payload.project_id.length > 64) {
    throw new ProvisioningError('project_id must be less than 64 characters', 'project_id', 'TOO_LONG');
  }

  // Validate region
  if (!payload.region) {
    throw new ProvisioningError('region is required', 'region', 'REQUIRED');
  }

  const regionPattern = /^[a-z]{2}-[a-z]+-\d{1,2}$/;
  if (!regionPattern.test(payload.region)) {
    throw new ProvisioningError(
      'region must be in format like us-east-1, eu-west-1',
      'region',
      'INVALID_FORMAT'
    );
  }

  // Validate database options
  if (payload.database?.storage_gb !== undefined) {
    if (payload.database.storage_gb < 1 || payload.database.storage_gb > 1000) {
      throw new ProvisioningError(
        'storage_gb must be between 1 and 1000',
        'database.storage_gb',
        'OUT_OF_RANGE'
      );
    }
  }

  // Validate API key options
  if (payload.api_keys?.count !== undefined) {
    if (payload.api_keys.count < 1 || payload.api_keys.count > 10) {
      throw new ProvisioningError(
        'API key count must be between 1 and 10',
        'api_keys.count',
        'OUT_OF_RANGE'
      );
    }
  }

  if (payload.api_keys?.prefix) {
    const prefixPattern = /^[a-zA-Z0-9-]+$/;
    if (!prefixPattern.test(payload.api_keys.prefix)) {
      throw new ProvisioningError(
        'API key prefix must contain only alphanumeric characters and hyphens',
        'api_keys.prefix',
        'INVALID_FORMAT'
      );
    }

    if (payload.api_keys.prefix.length > 32) {
      throw new ProvisioningError(
        'API key prefix must be less than 32 characters',
        'api_keys.prefix',
        'TOO_LONG'
      );
    }
  }
}

/**
 * Provisioning result metadata
 */
export interface ProvisionProjectMetadata extends Record<string, unknown> {
  /**
   * The ID of the provisioned project
   */
  projectId: string;

  /**
   * Database connection details (without password for security)
   */
  database?: {
    host: string;
    port: number;
    database_name: string;
    schema_name: string;
  };

  /**
   * Registered service details
   */
  services?: {
    auth?: {
      enabled: boolean;
      tenant_id: string;
      endpoint: string;
    };
    realtime?: {
      enabled: boolean;
      tenant_id: string;
      endpoint: string;
    };
    storage?: {
      enabled: boolean;
      tenant_id: string;
      endpoint: string;
      bucket_name: string;
    };
  };

  /**
   * Generated API keys
   */
  api_keys?: Array<{
    key_id: string;
    key_prefix: string;
    created_at: Date;
  }>;

  /**
   * Provisioning metadata
   */
  metadata: {
    provisioned_at: Date;
    region: string;
    owner_id?: string;
    organization_id?: string;
  };
}
