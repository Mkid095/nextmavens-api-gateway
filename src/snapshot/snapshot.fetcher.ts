import axios, { AxiosError } from 'axios';
import type {
  SnapshotData,
  SnapshotResponse,
  ProjectConfig,
  ServiceConfig,
  RateLimitConfig
} from '@/types/snapshot.types.js';
import { ProjectStatus } from '@/types/snapshot.types.js';

/**
 * Snapshot fetcher error types
 */
export class SnapshotFetchError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'SnapshotFetchError';
  }
}

/**
 * Control Plane Snapshot Response Format (ACTUAL)
 * This is what the Developer Portal actually returns
 */
interface ControlPlaneResponse {
  snapshot: {
    version: string;
    project: {
      id: string;
      status: 'CREATED' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'DELETED';
      environment: 'development' | 'staging' | 'production';
      tenant_id: string;
      created_at: string;
      updated_at: string;
    };
    services: {
      auth: { enabled: boolean; config?: Record<string, unknown> };
      graphql: { enabled: boolean; config?: Record<string, unknown> };
      realtime: { enabled: boolean; config?: Record<string, unknown> };
      storage: { enabled: boolean; config?: Record<string, unknown> };
      database: { enabled: boolean; config?: Record<string, unknown> };
      functions: { enabled: boolean; config?: Record<string, unknown> };
    };
    limits: {
      requests_per_minute: number;
      requests_per_hour: number;
      requests_per_day: number;
    };
    quotas: {
      db_queries_per_day: number;
      realtime_connections: number;
      storage_uploads_per_day: number;
      function_invocations_per_day: number;
    };
  };
  metadata: {
    generatedAt: string;
    ttl: number;
    cacheHit: boolean;
  };
}

/**
 * Snapshot fetcher configuration
 */
interface FetcherConfig {
  snapshotApiUrl: string;
  requestTimeoutMs: number;
  projectId: string;
}

/**
 * Snapshot fetcher
 * Handles fetching and validating snapshot data from control plane API
 *
 * UPDATED: Now correctly parses the Control Plane response format
 */
export class SnapshotFetcher {
  private lastFetchAttempt = 0;
  private fetchFailures = 0;

  constructor(private readonly config: FetcherConfig) {}

  /**
   * Fetch snapshot from control plane API
   *
   * This method:
   * 1. Fetches snapshot for the configured project
   * 2. Parses the Control Plane response format
   * 3. Transforms it to the Gateway's internal format
   * 4. Validates the data structure
   */
  async fetchSnapshot(): Promise<SnapshotData> {
    try {
      this.lastFetchAttempt = Date.now();

      const response = await axios.get<ControlPlaneResponse>(
        this.config.snapshotApiUrl,
        {
          timeout: this.config.requestTimeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'nextmavens-gateway/1.0.0'
          },
          params: {
            project_id: this.config.projectId
          }
        }
      );

      // Validate response has snapshot
      if (!response.data.snapshot) {
        throw new SnapshotFetchError('Control Plane returned no snapshot data');
      }

      // Transform Control Plane format to Gateway format
      const snapshotData = this.transformSnapshot(response.data);

      // Validate snapshot data structure
      this.validateSnapshotData(snapshotData);

      // Reset failure counter on success
      this.fetchFailures = 0;

      return snapshotData;
    } catch (error) {
      this.fetchFailures++;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        throw new SnapshotFetchError(
          `Failed to fetch snapshot: ${axiosError.message}`,
          axiosError
        );
      }

      throw error;
    }
  }

  /**
   * Transform Control Plane snapshot format to Gateway internal format
   */
  private transformSnapshot(controlPlaneResponse: ControlPlaneResponse): SnapshotData {
    const { snapshot, metadata } = controlPlaneResponse;

    // Parse version (e.g., "v123" -> 123)
    const version = parseInt(snapshot.version.replace(/^v/, ''), 10);
    if (isNaN(version)) {
      throw new SnapshotFetchError(`Invalid snapshot version: ${snapshot.version}`);
    }

    // Transform project data
    const projectConfig: ProjectConfig = {
      projectId: snapshot.project.id,
      projectName: snapshot.project.id, // Using ID as name for now
      status: this.mapProjectStatus(snapshot.project.status),
      tenantId: snapshot.project.tenant_id,
      allowedOrigins: [], // TODO: Add to snapshot if needed
      rateLimit: snapshot.limits.requests_per_day,
      enabledServices: this.extractEnabledServices(snapshot.services)
    };

    // Transform services data
    const services: Record<string, ServiceConfig> = {
      auth: this.createServiceConfig('auth', snapshot.services.auth),
      graphql: this.createServiceConfig('graphql', snapshot.services.graphql),
      realtime: this.createServiceConfig('realtime', snapshot.services.realtime),
      storage: this.createServiceConfig('storage', snapshot.services.storage),
      database: this.createServiceConfig('database', snapshot.services.database),
      functions: this.createServiceConfig('functions', snapshot.services.functions)
    };

    // Transform rate limits
    const rateLimits: Record<string, RateLimitConfig> = {
      [snapshot.project.id]: {
        requestsPerMinute: snapshot.limits.requests_per_minute,
        requestsPerHour: snapshot.limits.requests_per_hour,
        burstAllowance: Math.ceil(snapshot.limits.requests_per_minute / 10) // 10% burst
      }
    };

    return {
      version,
      timestamp: metadata.generatedAt,
      projects: {
        [snapshot.project.id]: projectConfig
      },
      services,
      rateLimits
    };
  }

  /**
   * Map Control Plane project status to Gateway enum
   */
  private mapProjectStatus(
    status: 'CREATED' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'DELETED'
  ): ProjectStatus {
    switch (status) {
      case 'CREATED':
        return ProjectStatus.ACTIVE; // Treat CREATED as ACTIVE
      case 'ACTIVE':
        return ProjectStatus.ACTIVE;
      case 'SUSPENDED':
        return ProjectStatus.SUSPENDED;
      case 'ARCHIVED':
        return ProjectStatus.ARCHIVED;
      case 'DELETED':
        return ProjectStatus.DELETED;
      default:
        return ProjectStatus.ACTIVE;
    }
  }

  /**
   * Extract list of enabled service names
   */
  private extractEnabledServices(services: ControlPlaneResponse['snapshot']['services']): string[] {
    const enabled: string[] = [];

    if (services.auth?.enabled) enabled.push('auth');
    if (services.graphql?.enabled) enabled.push('graphql');
    if (services.realtime?.enabled) enabled.push('realtime');
    if (services.storage?.enabled) enabled.push('storage');
    if (services.database?.enabled) enabled.push('database');
    if (services.functions?.enabled) enabled.push('functions');

    return enabled;
  }

  /**
   * Create service config from control plane service data
   */
  private createServiceConfig(
    serviceName: string,
    serviceData: { enabled: boolean; config?: Record<string, unknown> }
  ): ServiceConfig {
    return {
      serviceName,
      enabled: serviceData.enabled,
      endpoint: this.getServiceEndpoint(serviceName),
      requiresAuth: true
    };
  }

  /**
   * Get service endpoint URL from environment
   */
  private getServiceEndpoint(serviceName: string): string {
    const envVar = `SERVICE_${serviceName.toUpperCase()}_ENDPOINT`;

    // Default endpoints for development
    const defaults: Record<string, string> = {
      auth: 'http://localhost:4000',
      graphql: 'http://localhost:4004',
      realtime: 'http://localhost:4003',
      storage: 'http://localhost:3000',
      database: process.env.DATABASE_URL || '',
      functions: 'http://localhost:4005'
    };

    return process.env[envVar] || defaults[serviceName] || `http://${serviceName}:8080`;
  }

  /**
   * Validate snapshot data structure
   * SECURITY: Prevents cache poisoning through malformed data
   */
  private validateSnapshotData(data: SnapshotData): void {
    if (!data) {
      throw new SnapshotFetchError('Snapshot data is null or undefined');
    }

    // SECURITY: Validate version is a positive number
    if (typeof data.version !== 'number' || data.version < 0 || !Number.isFinite(data.version)) {
      throw new SnapshotFetchError('Invalid snapshot version');
    }

    // SECURITY: Validate timestamp exists and is a string
    if (!data.timestamp || typeof data.timestamp !== 'string') {
      throw new SnapshotFetchError('Invalid snapshot timestamp');
    }

    // SECURITY: Validate projects object
    if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) {
      throw new SnapshotFetchError('Invalid projects data in snapshot');
    }

    // SECURITY: Validate services object
    if (!data.services || typeof data.services !== 'object' || Array.isArray(data.services)) {
      throw new SnapshotFetchError('Invalid services data in snapshot');
    }

    // SECURITY: Validate rate limits object
    if (!data.rateLimits || typeof data.rateLimits !== 'object' || Array.isArray(data.rateLimits)) {
      throw new SnapshotFetchError('Invalid rate limits data in snapshot');
    }

    // SECURITY: Validate no prototype pollution in objects
    this.validateObjectSafety(data.projects);
    this.validateObjectSafety(data.services);
    this.validateObjectSafety(data.rateLimits);
  }

  /**
   * Validate object for prototype pollution attacks
   * SECURITY: Prevents __proto__ and constructor pollution
   */
  private validateObjectSafety(obj: Record<string, unknown>): void {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key of Object.keys(obj)) {
      if (dangerousKeys.includes(key)) {
        throw new SnapshotFetchError('Dangerous key detected in snapshot data');
      }
    }
  }

  /**
   * Get fetch statistics
   */
  getFetchStats(): {
    fetchFailures: number;
    lastFetchAttempt: number;
  } {
    return {
      fetchFailures: this.fetchFailures,
      lastFetchAttempt: this.lastFetchAttempt
    };
  }
}
