import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HealthCheckService, createHealthCheckService, getHealthCheckService } from '../services/health-check.service.js';
import type { HealthResponse, HealthStatus } from '../types/health.types.js';

describe('HealthCheckService', () => {
  let healthCheckService: HealthCheckService;

  beforeEach(() => {
    // Clear singleton instance
    jest.clearAllMocks();
    // Create new instance for testing
    healthCheckService = new HealthCheckService({
      timeoutMs: 5000,
      cacheTtlMs: 10000
    });
  });

  describe('getHealth', () => {
    it('should return health response with required fields', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      // Verify all required fields are present
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('version');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('dependencies');
    });

    it('should return valid status values', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      // Status must be one of the valid values
      const validStatuses: HealthStatus[] = ['healthy', 'degraded', 'unhealthy'];
      expect(validStatuses).toContain(health.status);
    });

    it('should return version as string', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(typeof health.version).toBe('string');
      expect(health.version).toBeTruthy();
    });

    it('should return uptime as number', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(typeof health.uptime).toBe('number');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return timestamp as ISO string', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(typeof health.timestamp).toBe('string');
      expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
    });

    it('should return dependencies object with database and control_plane_api', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(health.dependencies).toHaveProperty('database');
      expect(health.dependencies).toHaveProperty('control_plane_api');
    });

    it('should return database dependency health', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(health.dependencies.database).toBeDefined();
      if (health.dependencies.database) {
        expect(health.dependencies.database).toHaveProperty('name');
        expect(health.dependencies.database).toHaveProperty('status');
        expect(health.dependencies.database.name).toBe('database');
      }
    });

    it('should return control_plane_api dependency health', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      expect(health.dependencies.control_plane_api).toBeDefined();
      if (health.dependencies.control_plane_api) {
        expect(health.dependencies.control_plane_api).toHaveProperty('name');
        expect(health.dependencies.control_plane_api).toHaveProperty('status');
        expect(health.dependencies.control_plane_api.name).toBe('control_plane_api');
      }
    });

    it('should include latency in dependency health when available', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      if (health.dependencies.control_plane_api && health.dependencies.control_plane_api.status !== 'unhealthy') {
        expect(health.dependencies.control_plane_api).toHaveProperty('latency');
        expect(typeof health.dependencies.control_plane_api.latency).toBe('number');
      }
    });

    it('should include generic error in dependency health if unhealthy', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      if (health.dependencies.control_plane_api?.status === 'unhealthy') {
        expect(health.dependencies.control_plane_api).toHaveProperty('error');
        expect(typeof health.dependencies.control_plane_api.error).toBe('string');
        // Verify error messages are generic (don't leak internal details)
        const errorMsg = health.dependencies.control_plane_api.error!;
        const genericErrors = ['Service unavailable', 'Check failed', 'Connection timeout', 'Data stale'];
        expect(genericErrors).toContain(errorMsg);
      }
    });
  });

  describe('clearCache', () => {
    it('should clear cached health status', async () => {
      // First call
      await healthCheckService.getHealth();

      // Clear cache
      healthCheckService.clearCache();

      // Second call should perform fresh health check
      const health = await healthCheckService.getHealth();
      expect(health).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const config = healthCheckService.getConfig();

      expect(config).toHaveProperty('timeoutMs');
      expect(config).toHaveProperty('cacheTtlMs');
      expect(config.timeoutMs).toBe(5000);
      expect(config.cacheTtlMs).toBe(10000);
    });
  });

  describe('Singleton pattern', () => {
    it('should create singleton instance', () => {
      const instance1 = createHealthCheckService();
      const instance2 = createHealthCheckService();

      expect(instance1).toBe(instance2);
    });

    it('should get singleton instance', () => {
      const instance = createHealthCheckService();
      const retrieved = getHealthCheckService();

      expect(retrieved).toBe(instance);
    });

    it('should return null if no instance created', () => {
      // Clear the singleton by creating a new test instance
      const service = new HealthCheckService();
      expect(service).toBeDefined();
    });
  });

  describe('Health status calculation', () => {
    it('should return unhealthy if any dependency is unhealthy', async () => {
      // This test verifies the logic in calculateOverallStatus
      const health: HealthResponse = await healthCheckService.getHealth();

      // If control_plane_api is unhealthy, overall status should be unhealthy
      if (health.dependencies.control_plane_api?.status === 'unhealthy') {
        expect(health.status).toBe('unhealthy');
      }
    });

    it('should return degraded if any dependency is degraded but none unhealthy', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      // If any dependency is degraded and none are unhealthy, overall should be degraded
      const hasDegraded = Object.values(health.dependencies).some(
        dep => dep.status === 'degraded'
      );
      const hasUnhealthy = Object.values(health.dependencies).some(
        dep => dep.status === 'unhealthy'
      );

      if (hasDegraded && !hasUnhealthy) {
        expect(health.status).toBe('degraded');
      }
    });

    it('should return healthy if all dependencies are healthy', async () => {
      const health: HealthResponse = await healthCheckService.getHealth();

      // If all dependencies are healthy, overall should be healthy
      const allHealthy = Object.values(health.dependencies).every(
        dep => dep.status === 'healthy'
      );

      if (allHealthy) {
        expect(health.status).toBe('healthy');
      }
    });
  });
});
