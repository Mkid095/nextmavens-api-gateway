/**
 * Service Registration
 *
 * Handles registration of tenants with auth, realtime, and storage services.
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 */

import axios, { AxiosError } from 'axios';
import { getServiceConfig } from './config.js';

/**
 * Registration error with safe error messages
 */
class ServiceRegistrationError extends Error {
  constructor(serviceName: string, originalError: unknown) {
    // Generic error message to avoid leaking service details
    super(`Failed to register with ${serviceName} service`);
    this.name = 'ServiceRegistrationError';

    // Log the actual error internally for debugging
    if (originalError instanceof AxiosError) {
      console.error(`[ProvisionProject] ${serviceName} service error:`, {
        status: originalError.response?.status,
        statusText: originalError.response?.statusText,
        message: originalError.message,
      });
    } else if (originalError instanceof Error) {
      console.error(`[ProvisionProject] ${serviceName} service error:`, originalError.message);
    }
  }
}

/**
 * Register with auth service
 *
 * Registers the tenant with the authentication service via HTTP API.
 * Uses service-to-service authentication if configured.
 *
 * @param projectId - The project/tenant ID
 * @param region - The target region
 * @returns Promise resolving to auth service details
 * @throws Error if registration fails
 */
export async function registerAuthService(
  projectId: string,
  region: string
): Promise<{ enabled: boolean; tenant_id: string; endpoint: string }> {
  const config = getServiceConfig();
  const endpoint = `${config.authServiceUrl}/api/tenants/${encodeURIComponent(projectId)}`;

  console.log(`[ProvisionProject] Registering with auth service: ${endpoint}`);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add service-to-service authentication token if configured
    if (config.authServiceToken) {
      headers['Authorization'] = `Bearer ${config.authServiceToken}`;
    }

    await axios.post(
      endpoint,
      {
        tenant_id: projectId,
        region,
        created_at: new Date().toISOString(),
      },
      {
        timeout: 10000, // 10 second timeout
        headers,
      }
    );

    console.log(`[ProvisionProject] Successfully registered with auth service`);

    return {
      enabled: true,
      tenant_id: projectId,
      endpoint: `${config.authServiceUrl}/api/tenants/${encodeURIComponent(projectId)}`,
    };
  } catch (error) {
    throw new ServiceRegistrationError('auth', error);
  }
}

/**
 * Register with realtime service
 *
 * Registers the tenant with the realtime/WebSocket service via HTTP API.
 * Uses service-to-service authentication if configured.
 *
 * @param projectId - The project/tenant ID
 * @param region - The target region
 * @returns Promise resolving to realtime service details
 * @throws Error if registration fails
 */
export async function registerRealtimeService(
  projectId: string,
  region: string
): Promise<{ enabled: boolean; tenant_id: string; endpoint: string }> {
  const config = getServiceConfig();
  const endpoint = `${config.realtimeServiceUrl}/api/tenants/${encodeURIComponent(projectId)}`;

  console.log(`[ProvisionProject] Registering with realtime service: ${endpoint}`);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add service-to-service authentication token if configured
    if (config.realtimeServiceToken) {
      headers['Authorization'] = `Bearer ${config.realtimeServiceToken}`;
    }

    await axios.post(
      endpoint,
      {
        tenant_id: projectId,
        region,
        created_at: new Date().toISOString(),
      },
      {
        timeout: 10000,
        headers,
      }
    );

    console.log(`[ProvisionProject] Successfully registered with realtime service`);

    // Construct WebSocket endpoint URL
    const wsUrl = config.realtimeServiceUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return {
      enabled: true,
      tenant_id: projectId,
      endpoint: `${wsUrl}/ws/${encodeURIComponent(projectId)}`,
    };
  } catch (error) {
    throw new ServiceRegistrationError('realtime', error);
  }
}

/**
 * Register with storage service
 *
 * Registers the tenant with the storage service via HTTP API.
 * Uses service-to-service authentication if configured.
 *
 * @param projectId - The project/tenant ID
 * @param region - The target region
 * @returns Promise resolving to storage service details
 * @throws Error if registration fails
 */
export async function registerStorageService(
  projectId: string,
  region: string
): Promise<{ enabled: boolean; tenant_id: string; endpoint: string; bucket_name: string }> {
  const config = getServiceConfig();
  const endpoint = `${config.storageServiceUrl}/api/buckets`;
  const bucketName = `bucket-${projectId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  console.log(`[ProvisionProject] Registering with storage service: ${endpoint}`);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add service-to-service authentication token if configured
    if (config.storageServiceToken) {
      headers['Authorization'] = `Bearer ${config.storageServiceToken}`;
    }

    await axios.post(
      endpoint,
      {
        bucket_name: bucketName,
        tenant_id: projectId,
        region,
        created_at: new Date().toISOString(),
      },
      {
        timeout: 10000,
        headers,
      }
    );

    console.log(`[ProvisionProject] Successfully registered with storage service`);

    return {
      enabled: true,
      tenant_id: projectId,
      endpoint: `${config.storageServiceUrl}/api/buckets/${encodeURIComponent(bucketName)}`,
      bucket_name: bucketName,
    };
  } catch (error) {
    throw new ServiceRegistrationError('storage', error);
  }
}
