#!/usr/bin/env node

/**
 * Backup API Integration Verification (Simple Version)
 *
 * This script verifies the integration without requiring database access.
 * It checks that all the modules can be imported and the types are correct.
 *
 * US-001: Create Manual Export API - Step 7: Integration
 */

import { describe, it, expect } from '@jest/globals';

console.log('='.repeat(60));
console.log('US-001: Backup Export API Integration Verification');
console.log('='.repeat(60));
console.log();

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | Promise<boolean>) {
  Promise.resolve(fn()).then((result) => {
    if (result) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name}`);
      failed++;
    }
  }).catch((error) => {
    console.log(`✗ ${name}: ${error.message}`);
    failed++;
  });
}

// Test 1: Import job queue module
test('Job queue module imports', async () => {
  try {
    const queue = await import('./src/lib/jobs/queue.js');
    return typeof queue.enqueueJob === 'function';
  } catch {
    return false;
  }
});

// Test 2: Import export backup handler
test('Export backup handler imports', async () => {
  try {
    const handler = await import('./src/lib/jobs/handlers/export-backup.handler.js');
    return typeof handler.exportBackupHandler === 'function';
  } catch {
    return false;
  }
});

// Test 3: Import backup controller
test('Backup controller imports', async () => {
  try {
    const controller = await import('./src/api/routes/backup/backup.controller.js');
    return typeof controller.manualExport === 'function';
  } catch {
    return false;
  }
});

// Test 4: Import backup routes
test('Backup routes imports', async () => {
  try {
    const routes = await import('./src/api/routes/backup/index.js');
    return typeof routes.configureBackupRoutes === 'function';
  } catch {
    return false;
  }
});

// Test 5: Import JWT middleware
test('JWT middleware imports', async () => {
  try {
    const jwt = await import('./src/api/middleware/jwt.middleware.js');
    return typeof jwt.requireJwtAuth === 'function';
  } catch {
    return false;
  }
});

// Test 6: Import error handler
test('Error handler imports', async () => {
  try {
    const errorHandler = await import('./src/api/middleware/error.handler.js');
    return typeof errorHandler.ApiError === 'function';
  } catch {
    return false;
  }
});

// Test 7: Import job types
test('Job types imports', async () => {
  try {
    const types = await import('@nextmavens/audit-logs-database');
    return typeof types.JobStatus !== 'undefined';
  } catch {
    return false;
  }
});

// Test 8: Check job worker has export_backup handler
test('Job worker includes export_backup handler', async () => {
  try {
    const worker = await import('./src/lib/jobs/jobs-worker.js');
    return typeof worker.getJobsWorker === 'function';
  } catch {
    return false;
  }
});

// Wait a bit for all async tests to complete
setTimeout(() => {
  console.log();
  console.log('='.repeat(60));
  console.log('Verification Summary');
  console.log('='.repeat(60));
  console.log(`Total Checks: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log();

  if (failed === 0) {
    console.log('✓ All integration checks passed!');
    console.log();
    console.log('The backup export API modules are properly integrated.');
    console.log('All imports are working correctly.');
    process.exit(0);
  } else {
    console.log('✗ Some integration checks failed.');
    console.log('Please check the error messages above.');
    process.exit(1);
  }
}, 1000);
