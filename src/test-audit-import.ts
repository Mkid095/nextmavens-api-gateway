/**
 * Test file to verify audit-logs-database package can be imported and used
 *
 * This file verifies that the @nextmavens/audit-logs-database package
 * is properly configured and its types are accessible.
 *
 * Run with: npx tsx src/test-audit-import.ts
 */

import {
  logProjectAction,
  userActor,
  systemActor,
  ActorInfo,
  AuditLogOptions
} from '@nextmavens/audit-logs-database';

// Test that logProjectAction is accessible
async function testProjectAuditFunctions() {
  console.log('Testing audit-logs-database package imports...');

  // Test that types work
  const testActor: ActorInfo = userActor('test-user-123');
  console.log('Actor type test:', testActor.type);

  // Test function signatures (won't actually execute without DB)
  const testOptions: AuditLogOptions = {
    metadata: {
      test: 'verification',
      source: 'test-audit-import'
    }
  };
  console.log('Options test:', testOptions.metadata?.source);

  // Verify logProjectAction.created exists
  console.log('logProjectAction.created:', typeof logProjectAction.created);

  // Verify logProjectAction.updated exists
  console.log('logProjectAction.updated:', typeof logProjectAction.updated);

  // Verify logProjectAction.deleted exists
  console.log('logProjectAction.deleted:', typeof logProjectAction.deleted);

  // Verify actor helpers exist
  console.log('userActor:', typeof userActor);
  console.log('systemActor:', typeof systemActor);

  console.log('\nAll imports are accessible!');
  console.log('Package @nextmavens/audit-logs-database is properly configured.');
}

// Run the test
testProjectAuditFunctions().catch(console.error);
