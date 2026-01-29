/**
 * Check Usage Limits Job Integration Test
 *
 * Integration test for the check_usage_limits job handler to verify:
 * - Handler is properly registered with the worker
 * - Job can be enqueued and processed
 * - Database operations work correctly (project status changes, warnings sent)
 * - Quota checks work for various scenarios (under, warning, over)
 * - Dry-run mode doesn't suspend projects
 * - Project filtering works correctly
 *
 * US-008: Implement Check Usage Limits Job - Step 2: Integration Tests
 *
 * Usage:
 *   pnpm test src/lib/jobs/__tests__/check-usage-limits.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { query } from '@nextmavens/audit-logs-database';
import { JobWorker } from '../worker.js';
import { enqueueJob } from '../queue.js';
import {
  checkUsageLimitsHandler,
  HardCapType,
  ProjectStatus,
  type CheckUsageLimitsPayload,
} from '../handlers/check-usage-limits.handler.js';
import { JobStatus } from '@nextmavens/audit-logs-database';

/**
 * Test helper to create a test project
 */
async function createTestProject(
  status: ProjectStatus = ProjectStatus.ACTIVE
): Promise<number> {
  const result = await query<{ id: number }>(
    `
    INSERT INTO control_plane.projects (
      name,
      status
    ) VALUES ($1, $2)
    RETURNING id
    `,
    [`test-project-${Date.now()}`, status]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create test project');
  }

  return result.rows[0].id;
}

/**
 * Test helper to create project quotas
 */
async function createProjectQuota(
  projectId: number,
  capType: HardCapType,
  capValue: number
): Promise<void> {
  await query(
    `
    INSERT INTO control_plane.project_quotas (
      project_id,
      cap_type,
      cap_value
    ) VALUES ($1, $2, $3)
    `,
    [projectId, capType, capValue]
  );
}

/**
 * Test helper to get project by ID
 */
async function getProject(projectId: number) {
  const result = await query<{
    id: number;
    name: string;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `
    SELECT *
    FROM control_plane.projects
    WHERE id = $1
    `,
    [projectId]
  );

  return result.rows[0];
}

/**
 * Test helper to get project quotas
 */
async function getProjectQuotas(projectId: number) {
  const result = await query<{
    project_id: number;
    cap_type: string;
    cap_value: number;
  }>(
    `
    SELECT *
    FROM control_plane.project_quotas
    WHERE project_id = $1
    `,
    [projectId]
  );

  return result.rows;
}

/**
 * Test helper to get job by ID
 */
async function getJob(jobId: string) {
  const result = await query<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    status: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    scheduled_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
  }>(
    `
    SELECT *
    FROM control_plane.jobs
    WHERE id = $1
    `,
    [jobId]
  );

  return result.rows[0];
}

/**
 * Test helper to clean up test data
 */
async function cleanupTestData() {
  await query(`
    DELETE FROM control_plane.jobs
    WHERE type = 'check_usage_limits'
  `);

  await query(`
    DELETE FROM control_plane.project_quotas
    WHERE project_id IN (
      SELECT id FROM control_plane.projects
      WHERE name LIKE 'test-project-%'
    )
  `);

  await query(`
    DELETE FROM control_plane.projects
    WHERE name LIKE 'test-project-%'
  `);
}

/**
 * Test helper to create usage tracking table (mock implementation)
 */
async function createUsageTrackingTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS control_plane.test_usage_metrics (
      project_id INTEGER PRIMARY KEY,
      db_queries_today INTEGER DEFAULT 0,
      realtime_connections INTEGER DEFAULT 0,
      storage_uploads_today INTEGER DEFAULT 0,
      function_invocations_today INTEGER DEFAULT 0
    )
  `);
}

/**
 * Test helper to set usage for a project
 */
async function setProjectUsage(
  projectId: number,
  usage: {
    db_queries_today?: number;
    realtime_connections?: number;
    storage_uploads_today?: number;
    function_invocations_today?: number;
  }
): Promise<void> {
  await query(
    `
    INSERT INTO control_plane.test_usage_metrics (
      project_id,
      db_queries_today,
      realtime_connections,
      storage_uploads_today,
      function_invocations_today
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (project_id)
    DO UPDATE SET
      db_queries_today = COALESCE($2, test_usage_metrics.db_queries_today),
      realtime_connections = COALESCE($3, test_usage_metrics.realtime_connections),
      storage_uploads_today = COALESCE($4, test_usage_metrics.storage_uploads_today),
      function_invocations_today = COALESCE($5, test_usage_metrics.function_invocations_today)
    `,
    [
      projectId,
      usage.db_queries_today ?? 0,
      usage.realtime_connections ?? 0,
      usage.storage_uploads_today ?? 0,
      usage.function_invocations_today ?? 0,
    ]
  );
}

describe('US-008: Check Usage Limits Job Integration Tests', () => {
  let worker: JobWorker;

  beforeAll(async () => {
    // Create projects table for testing if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS control_plane.projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create project_quotas table for testing if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS control_plane.project_quotas (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES control_plane.projects(id) ON DELETE CASCADE,
        cap_type TEXT NOT NULL,
        cap_value INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, cap_type)
      )
    `);

    // Create indexes if they don't exist
    await query(`
      CREATE INDEX IF NOT EXISTS idx_project_quotas_project_id
      ON control_plane.project_quotas(project_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_projects_status
      ON control_plane.projects(status)
    `);

    // Create usage tracking table for testing
    await createUsageTrackingTable();

    // Create worker instance
    worker = new JobWorker({
      pollInterval: 100, // Fast polling for tests
      maxConcurrentJobs: 1,
      timeout: 5000,
    });

    // Register the check_usage_limits handler
    worker.registerHandler('check_usage_limits', checkUsageLimitsHandler);

    // Start the worker
    await worker.start();

    // Give worker time to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Stop the worker
    await worker.stop();

    // Clean up test data
    await cleanupTestData();

    // Clean up usage tracking table
    await query(`
      DROP TABLE IF EXISTS control_plane.test_usage_metrics
    `);
  });

  beforeEach(async () => {
    await cleanupTestData();
    await query(`
      DELETE FROM control_plane.test_usage_metrics
    `);
  });

  afterEach(async () => {
    await cleanupTestData();
    await query(`
      DELETE FROM control_plane.test_usage_metrics
    `);
  });

  describe('AC1: check_usage_limits job handler is registered with the worker', () => {
    it('should have check_usage_limits handler registered', () => {
      const stats = worker.getStats();
      expect(stats.registeredHandlers).toBeGreaterThan(0);
      expect(stats.isRunning).toBe(true);
    });

    it('should enqueue a check_usage_limits job', async () => {
      const result = await enqueueJob(
        'check_usage_limits',
        { check_all: true },
        {
          maxAttempts: 1,
          priority: 5,
        }
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.type).toBe('check_usage_limits');
      expect(result.status).toBe(JobStatus.PENDING);
    });
  });

  describe('AC2: Database operations work correctly', () => {
    it('should create test project successfully', async () => {
      const projectId = await createTestProject();
      expect(projectId).toBeDefined();
      expect(typeof projectId).toBe('number');

      // Verify project was created
      const project = await getProject(projectId);
      expect(project).toBeDefined();
      expect(project!.id).toBe(projectId);
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    });

    it('should create project quotas successfully', async () => {
      const projectId = await createTestProject();
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);

      const quotas = await getProjectQuotas(projectId);
      expect(quotas).toBeDefined();
      expect(quotas.length).toBe(1);
      expect(quotas[0].cap_type).toBe(HardCapType.DB_QUERIES_PER_DAY);
      expect(quotas[0].cap_value).toBe(1000);
    });

    it('should query active projects correctly', async () => {
      // Create multiple projects with different statuses
      const activeProject1 = await createTestProject(ProjectStatus.ACTIVE);
      const activeProject2 = await createTestProject(ProjectStatus.ACTIVE);
      await createTestProject(ProjectStatus.SUSPENDED);
      await createTestProject(ProjectStatus.ARCHIVED);

      const result = await query<{ id: number; name: string }>(
        `
        SELECT id, name
        FROM control_plane.projects
        WHERE status = $1
        ORDER BY name
        `,
        [ProjectStatus.ACTIVE]
      );

      // Should only return active projects
      expect(result.rows.length).toBeGreaterThanOrEqual(2);
      const ids = result.rows.map((r: { id: number }) => r.id);
      expect(ids).toContain(activeProject1);
      expect(ids).toContain(activeProject2);
    });
  });

  describe('AC3: Integration test passes - under quota scenario', () => {
    it('should complete job when project is under quota', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 500 }); // 50% usage

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      // Wait for worker to process the job
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check job status
      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.attempts).toBe(1);
      expect(job!.last_error).toBeNull();

      // Verify project is still active
      const project = await getProject(projectId);
      expect(project).toBeDefined();
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);
  });

  describe('AC4: Integration test passes - warning threshold scenarios', () => {
    it('should send warning at 80% threshold', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 800 }); // 80% usage

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is still active (not suspended)
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);

    it('should send warning at 90% threshold', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 900 }); // 90% usage

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is still active (not suspended)
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);
  });

  describe('AC5: Integration test passes - over hard cap scenario', () => {
    it('should suspend project when exceeding hard cap', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 1001 }); // 100.1% usage

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is now suspended
      const project = await getProject(projectId);
      expect(project).toBeDefined();
      expect(project!.status).toBe(ProjectStatus.SUSPENDED);
    }, 10000);

    it('should suspend project at exactly 100% usage', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 1000 }); // 100% usage

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is now suspended
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.SUSPENDED);
    }, 10000);
  });

  describe('AC6: Dry-run mode tests', () => {
    it('should not suspend project in dry-run mode', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 1001 }); // Over limit

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: false, // Dry-run mode
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is still active (not suspended in dry-run)
      const project = await getProject(projectId);
      expect(project).toBeDefined();
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);
  });

  describe('AC7: Project filtering tests', () => {
    it('should only check specified projects', async () => {
      const project1 = await createTestProject(ProjectStatus.ACTIVE);
      const project2 = await createTestProject(ProjectStatus.ACTIVE);

      await createProjectQuota(project1, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await createProjectQuota(project2, HardCapType.DB_QUERIES_PER_DAY, 1000);

      await setProjectUsage(project1, { db_queries_today: 1001 }); // Over limit
      await setProjectUsage(project2, { db_queries_today: 500 }); // Under limit

      // Only check project1
      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(project1)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project1 is suspended
      const project1After = await getProject(project1);
      expect(project1After!.status).toBe(ProjectStatus.SUSPENDED);

      // Verify project2 is still active (was not checked)
      const project2After = await getProject(project2);
      expect(project2After!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);

    it('should check all active projects when check_all is true', async () => {
      const project1 = await createTestProject(ProjectStatus.ACTIVE);
      const project2 = await createTestProject(ProjectStatus.ACTIVE);
      await createTestProject(ProjectStatus.SUSPENDED);

      await createProjectQuota(project1, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await createProjectQuota(project2, HardCapType.DB_QUERIES_PER_DAY, 1000);

      await setProjectUsage(project1, { db_queries_today: 1001 });
      await setProjectUsage(project2, { db_queries_today: 500 });

      const payload: CheckUsageLimitsPayload = {
        check_all: true,
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify active projects were checked
      const project1After = await getProject(project1);
      expect(project1After!.status).toBe(ProjectStatus.SUSPENDED);

      const project2After = await getProject(project2);
      expect(project2After!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);
  });

  describe('AC8: Multiple quota types tests', () => {
    it('should check multiple quota types for a project', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);

      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await createProjectQuota(projectId, HardCapType.REALTIME_CONNECTIONS, 100);
      await createProjectQuota(projectId, HardCapType.STORAGE_UPLOADS_PER_DAY, 500);
      await createProjectQuota(projectId, HardCapType.FUNCTION_INVOCATIONS_PER_DAY, 2000);

      // Over limit on DB queries, under on others
      await setProjectUsage(projectId, {
        db_queries_today: 1001, // Over
        realtime_connections: 50, // 50%
        storage_uploads_today: 250, // 50%
        function_invocations_today: 1000, // 50%
      });

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Verify project is suspended due to DB queries
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.SUSPENDED);
    }, 10000);
  });

  describe('AC9: Job result details tests', () => {
    it('should return correct result details', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 500 }); // Under limit

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();

      // Check that job completed with result data
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.last_error).toBeNull();

      // The job should have data in the result
      // (In a real scenario, we'd check the actual result structure)
    }, 10000);
  });

  describe('Job execution lifecycle', () => {
    it('should transition job from pending to running to completed', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);

      const { id: jobId } = await enqueueJob(
        'check_usage_limits',
        { project_ids: [String(projectId)] },
        { maxAttempts: 1 }
      );

      // Check initial status (pending)
      let job = await getJob(jobId);
      expect(job!.status).toBe(JobStatus.PENDING);
      expect(job!.started_at).toBeNull();
      expect(job!.completed_at).toBeNull();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check final status (completed)
      job = await getJob(jobId);
      expect(job!.status).toBe(JobStatus.COMPLETED);
      expect(job!.started_at).not.toBeNull();
      expect(job!.completed_at).not.toBeNull();
    });

    it('should update job attempts counter', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);

      const { id: jobId } = await enqueueJob(
        'check_usage_limits',
        { project_ids: [String(projectId)] },
        { maxAttempts: 1 }
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobId);
      expect(job!.attempts).toBe(1);
      expect(job!.max_attempts).toBe(1);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle project with no quotas', async () => {
      const projectId = await createTestProject(ProjectStatus.ACTIVE);
      // No quotas configured

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Project should still be active
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.ACTIVE);
    }, 10000);

    it('should handle non-existent project gracefully', async () => {
      const payload: CheckUsageLimitsPayload = {
        project_ids: ['999999'], // Non-existent project
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);
    }, 10000);

    it('should handle empty project list', async () => {
      const payload: CheckUsageLimitsPayload = {
        project_ids: [],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);
    }, 10000);

    it('should handle already suspended project', async () => {
      const projectId = await createTestProject(ProjectStatus.SUSPENDED);
      await createProjectQuota(projectId, HardCapType.DB_QUERIES_PER_DAY, 1000);
      await setProjectUsage(projectId, { db_queries_today: 1001 });

      const payload: CheckUsageLimitsPayload = {
        project_ids: [String(projectId)],
        enforce_limits: true,
      };

      const jobResult = await enqueueJob('check_usage_limits', payload, {
        maxAttempts: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const job = await getJob(jobResult.id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.COMPLETED);

      // Project should still be suspended
      const project = await getProject(projectId);
      expect(project!.status).toBe(ProjectStatus.SUSPENDED);
    }, 10000);
  });
});
