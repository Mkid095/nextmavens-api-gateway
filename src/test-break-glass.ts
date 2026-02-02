/**
 * Break Glass Authentication Test Script
 *
 * Test script to verify break glass authentication functionality.
 *
 * US-003: Implement Break Glass Authentication - Step 1: Foundation
 *
 * Usage:
 *   pnpm test:break-glass
 *
 * Prerequisites:
 *   - Database must be running
 *   - Admin user must exist
 *   - JWT secret must be configured
 */

import jwt from 'jsonwebtoken';
import { createAdminSession, validateAdminSession } from '@nextmavens/audit-logs-database';
import { AccessMethod } from '@nextmavens/audit-logs-database';

interface BreakGlassJwtPayload {
  session_id: string;
  admin_id: string;
  scope: 'break_glass';
  exp: number;
  iat: number;
}

/**
 * Test break glass authentication flow
 */
async function testBreakGlassAuthentication() {
  console.log('=== Break Glass Authentication Test ===\n');

  const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
  const admin_id = 'test-admin-' + Date.now();
  const reason = 'Production incident - locked out of critical project';

  try {
    // Step 1: Create admin session
    console.log('Step 1: Creating admin session...');
    const session = await createAdminSession({
      admin_id,
      reason,
      access_method: AccessMethod.OTP,
    });

    console.log('✓ Admin session created');
    console.log('  Session ID:', session.id);
    console.log('  Admin ID:', session.admin_id);
    console.log('  Access Method:', session.access_method);
    console.log('  Expires At:', session.expires_at);
    console.log('  Reason:', session.reason);
    console.log();

    // Step 2: Generate JWT token
    console.log('Step 2: Generating JWT token...');
    const tokenPayload: BreakGlassJwtPayload = {
      session_id: session.id,
      admin_id: session.admin_id,
      scope: 'break_glass',
      exp: Math.floor(new Date(session.expires_at).getTime() / 1000),
      iat: Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET);
    console.log('✓ JWT token generated');
    console.log('  Token:', token.substring(0, 50) + '...');
    console.log();

    // Step 3: Validate JWT token
    console.log('Step 3: Validating JWT token...');
    const decoded = jwt.verify(token, JWT_SECRET) as BreakGlassJwtPayload;
    console.log('✓ JWT token validated');
    console.log('  Session ID:', decoded.session_id);
    console.log('  Admin ID:', decoded.admin_id);
    console.log('  Scope:', decoded.scope);
    console.log();

    // Step 4: Validate admin session
    console.log('Step 4: Validating admin session...');
    const validation = await validateAdminSession(session.id);

    if (!validation.valid) {
      console.error('✗ Session validation failed:', validation.reason);
      process.exit(1);
    }

    console.log('✓ Admin session validated');
    console.log('  Valid:', validation.valid);
    console.log('  Expires In:', validation.expires_in_seconds, 'seconds');
    console.log();

    // Step 5: Test token expiration (simulate expired token)
    console.log('Step 5: Testing expired token...');
    const expiredPayload: BreakGlassJwtPayload = {
      ...tokenPayload,
      exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    };

    const expiredToken = jwt.sign(expiredPayload, JWT_SECRET);

    try {
      jwt.verify(expiredToken, JWT_SECRET);
      console.error('✗ Expired token should have been rejected');
      process.exit(1);
    } catch (error) {
      console.log('✓ Expired token correctly rejected');
      console.log('  Error:', (error as Error).message);
      console.log();
    }

    console.log('=== All Tests Passed ===');
  } catch (error) {
    console.error('✗ Test failed:', error);
    process.exit(1);
  }
}

// Run test
testBreakGlassAuthentication()
  .then(() => {
    console.log('\n✓ Break glass authentication test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Break glass authentication test failed:', error);
    process.exit(1);
  });
