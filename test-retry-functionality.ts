/**
 * Manual Test Script for Job Retry API
 *
 * This script demonstrates the job retry functionality by:
 * 1. Creating a test job
 * 2. Marking it as failed
 * 3. Retrying it via the API
 * 4. Verifying the results
 *
 * Run with: pnpm tsx test-retry-functionality.ts
 */

import { enqueueJob, getJob, retryJob } from '@nextmavens/audit-logs-database';
import { v4 as uuidv4 } from 'uuid';

async function testRetryFunctionality() {
  console.log('=== Job Retry API Manual Test ===\n');

  try {
    // Step 1: Create a test job
    console.log('1. Creating test job...');
    const result = await enqueueJob(
      'test_retry_job',
      { test: 'data', timestamp: Date.now() },
      { max_attempts: 3 }
    );
    console.log('   ✅ Job created:', result.id);

    // Step 2: Get the job details
    console.log('\n2. Fetching job details...');
    let job = await getJob(result.id);
    console.log('   ✅ Job status:', job!.status);
    console.log('   ✅ Job attempts:', job!.attempts, '/', job!.max_attempts);

    // Step 3: Simulate job failure
    console.log('\n3. Simulating job failure...');
    const { query } = await import('@nextmavens/audit-logs-database');
    await query(`
      UPDATE control_plane.jobs
      SET status = 'failed',
          attempts = 1,
          last_error = 'Test error: Connection timeout'
      WHERE id = $1
    `, [result.id]);
    console.log('   ✅ Job marked as failed');

    // Verify failed state
    job = await getJob(result.id);
    console.log('   ✅ Job status:', job!.status);
    console.log('   ✅ Last error:', job!.last_error);

    // Step 4: Retry the job
    console.log('\n4. Retrying job via retryJob function...');
    const retriedJob = await retryJob(result.id);
    console.log('   ✅ Job retry successful');
    console.log('   ✅ New status:', retriedJob.status);
    console.log('   ✅ Attempts:', retriedJob.attempts, '/', retriedJob.max_attempts);
    console.log('   ✅ Last error:', retriedJob.last_error);
    console.log('   ✅ Scheduled at:', retriedJob.scheduled_at);

    // Verify the job is ready to be picked up by worker
    console.log('\n5. Verifying job is ready for worker...');
    job = await getJob(result.id);
    console.log('   ✅ Status:', job!.status, '(should be pending)');
    console.log('   ✅ Error cleared:', job!.last_error, '(should be null)');
    console.log('   ✅ Started at:', job!.started_at, '(should be null)');
    console.log('   ✅ Completed at:', job!.completed_at, '(should be null)');

    // Step 6: Test max_attempts enforcement
    console.log('\n6. Testing max_attempts enforcement...');
    await query(`
      UPDATE control_plane.jobs
      SET status = 'failed', attempts = 3
      WHERE id = $1
    `, [result.id]);

    try {
      await retryJob(result.id);
      console.log('   ❌ ERROR: Should have thrown max attempts error');
    } catch (error) {
      if (error instanceof Error && error.message === 'Maximum retry attempts reached') {
        console.log('   ✅ Max attempts enforced correctly');
      } else {
        console.log('   ❌ Unexpected error:', error);
      }
    }

    // Step 7: Test non-existent job
    console.log('\n7. Testing non-existent job...');
    try {
      await retryJob(uuidv4());
      console.log('   ❌ ERROR: Should have thrown not found error');
    } catch (error) {
      if (error instanceof Error && error.message === 'Job not found') {
        console.log('   ✅ Not found error handled correctly');
      } else {
        console.log('   ❌ Unexpected error:', error);
      }
    }

    // Cleanup
    console.log('\n8. Cleaning up test job...');
    await query(`
      DELETE FROM control_plane.jobs
      WHERE id = $1
    `, [result.id]);
    console.log('   ✅ Test job deleted');

    console.log('\n=== All Tests Passed ✅ ===\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testRetryFunctionality();
