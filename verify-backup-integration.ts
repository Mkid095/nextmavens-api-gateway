#!/usr/bin/env tsx

/**
 * Backup API Integration Verification Script
 *
 * This script verifies that the backup export API is properly integrated
 * with the job queue system without requiring a full server startup.
 *
 * US-001: Create Manual Export API - Step 7: Integration
 */

import { enqueueJob } from './src/lib/jobs/queue.js';
import { exportBackupHandler } from './src/lib/jobs/handlers/export-backup.handler.js';
import { JobStatus } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import { generateTestToken } from './src/api/middleware/jwt.middleware.js';

interface VerificationResult {
  name: string;
  status: 'PASS' | 'FAIL';
  message: string;
  details?: string;
}

const results: VerificationResult[] = [];

function logResult(result: VerificationResult) {
  const status = result.status === 'PASS' ? '✓' : '✗';
  console.log(`${status} ${result.name}: ${result.message}`);
  if (result.details) {
    console.log(`  Details: ${result.details}`);
  }
  results.push(result);
}

async function verifyIntegration() {
  console.log('='.repeat(60));
  console.log('US-001: Backup Export API Integration Verification');
  console.log('='.repeat(60));
  console.log();

  // Set JWT_SECRET for testing
  process.env.JWT_SECRET = 'test-secret-for-testing-minimum-32-characters-long';

  // Verify 1: Job queue system is available
  try {
    const result = await enqueueJob('test', {}, { maxAttempts: 1 });
    logResult({
      name: 'Job Queue System',
      status: 'PASS',
      message: 'Job queue is operational',
      details: `Job ID: ${result.id}`,
    });
    // Clean up test job
    await query('DELETE FROM control_plane.jobs WHERE id = $1', [result.id]);
  } catch (error) {
    logResult({
      name: 'Job Queue System',
      status: 'FAIL',
      message: 'Job queue not operational',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 2: export_backup handler is available
  try {
    const result = await exportBackupHandler({ project_id: 'test-project-123' });
    logResult({
      name: 'Export Backup Handler',
      status: 'PASS',
      message: 'Handler is callable',
      details: `Success: ${result.success}, Error: ${result.error || 'None'}`,
    });
  } catch (error) {
    logResult({
      name: 'Export Backup Handler',
      status: 'FAIL',
      message: 'Handler not available',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 3: Handler validates project_id
  try {
    const result = await exportBackupHandler({});
    if (!result.success && result.error?.includes('project_id')) {
      logResult({
        name: 'Handler Validation',
        status: 'PASS',
        message: 'Validates project_id correctly',
        details: result.error,
      });
    } else {
      logResult({
        name: 'Handler Validation',
        status: 'FAIL',
        message: 'Missing project_id validation',
      });
    }
  } catch (error) {
    logResult({
      name: 'Handler Validation',
      status: 'FAIL',
      message: 'Validation failed with error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 4: JWT token generation works
  try {
    const token = generateTestToken({ project_id: 'test-project-123' });
    if (token && token.split('.').length === 3) {
      logResult({
        name: 'JWT Token Generation',
        status: 'PASS',
        message: 'JWT tokens can be generated',
        details: `Token length: ${token.length}`,
      });
    } else {
      logResult({
        name: 'JWT Token Generation',
        status: 'FAIL',
        message: 'Invalid token format',
      });
    }
  } catch (error) {
    logResult({
      name: 'JWT Token Generation',
      status: 'FAIL',
      message: 'JWT generation failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 5: export_backup job can be enqueued
  try {
    const result = await enqueueJob(
      'export_backup',
      {
        project_id: 'verification-test-project',
        format: 'sql',
        compress: true,
      },
      { maxAttempts: 3 }
    );

    // Verify job was created
    const jobResult = await query(
      'SELECT * FROM control_plane.jobs WHERE id = $1',
      [result.id]
    );

    if (jobResult.rows.length > 0) {
      const job = jobResult.rows[0];
      logResult({
        name: 'Export Backup Job Enqueue',
        status: 'PASS',
        message: 'Job successfully enqueued and persisted',
        details: `Job ID: ${result.id}, Status: ${job.status}, Payload: ${JSON.stringify(job.payload)}`,
      });

      // Clean up
      await query('DELETE FROM control_plane.jobs WHERE id = $1', [result.id]);
    } else {
      logResult({
        name: 'Export Backup Job Enqueue',
        status: 'FAIL',
        message: 'Job not found in database after enqueue',
      });
    }
  } catch (error) {
    logResult({
      name: 'Export Backup Job Enqueue',
      status: 'FAIL',
      message: 'Job enqueue failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 6: Database tables exist
  try {
    const tablesResult = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'control_plane'
        AND table_name IN ('jobs', 'projects')
    `);

    if (tablesResult.rows.length === 2) {
      logResult({
        name: 'Database Schema',
        status: 'PASS',
        message: 'Required tables exist',
        details: `Tables: ${tablesResult.rows.map(r => r.table_name).join(', ')}`,
      });
    } else {
      logResult({
        name: 'Database Schema',
        status: 'FAIL',
        message: 'Missing required tables',
        details: `Found ${tablesResult.rows.length} of 2 required tables`,
      });
    }
  } catch (error) {
    logResult({
      name: 'Database Schema',
      status: 'FAIL',
      message: 'Database query failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Verify 7: Job metadata structure
  try {
    const result = await enqueueJob('export_backup', { project_id: 'test' }, { maxAttempts: 5 });
    const jobResult = await query(
      'SELECT * FROM control_plane.jobs WHERE id = $1',
      [result.id]
    );

    if (jobResult.rows.length > 0) {
      const job = jobResult.rows[0];
      const hasRequiredFields =
        job.id &&
        job.type === 'export_backup' &&
        job.status === JobStatus.PENDING &&
        job.attempts === 0 &&
        job.max_attempts === 5 &&
        job.scheduled_at &&
        job.created_at;

      logResult({
        name: 'Job Metadata Structure',
        status: hasRequiredFields ? 'PASS' : 'FAIL',
        message: hasRequiredFields ? 'Job metadata is correct' : 'Job metadata incomplete',
        details: `Status: ${job.status}, Attempts: ${job.attempts}/${job.max_attempts}`,
      });

      // Clean up
      await query('DELETE FROM control_plane.jobs WHERE id = $1', [result.id]);
    }
  } catch (error) {
    logResult({
      name: 'Job Metadata Structure',
      status: 'FAIL',
      message: 'Metadata verification failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Verification Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;

  console.log(`Total Checks: ${total}`);
  console.log(`Passed: ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Failed: ${failed} (${Math.round((failed / total) * 100)}%)`);
  console.log();

  if (failed === 0) {
    console.log('✓ All integration checks passed!');
    console.log();
    console.log('The backup export API is properly integrated with the job queue system.');
    process.exit(0);
  } else {
    console.log('✗ Some integration checks failed.');
    console.log();
    console.log('Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
      if (r.details) {
        console.log(`    ${r.details}`);
      }
    });
    process.exit(1);
  }
}

// Run verification
verifyIntegration().catch((error) => {
  console.error('Verification failed with error:', error);
  process.exit(1);
});
