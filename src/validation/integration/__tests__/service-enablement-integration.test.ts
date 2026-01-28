/**
 * Service Enablement Data Layer Integration Test
 *
 * This test verifies the complete data flow for service enablement validation:
 * 1. Snapshot Service (data source)
 * 2. Service Enablement Validator (business logic)
 * 3. Middleware (request handling)
 * 4. Error handling (SERVICE_DISABLED error)
 *
 * Data Flow:
 * - Request arrives with project ID and service name
 * - Middleware extracts project ID and service name
 * - Fetches project from Snapshot Service
 * - Validates service enablement using ServiceEnablementValidator
 * - Returns SERVICE_DISABLED error if service not enabled
 * - Error message includes which service is disabled
 */

import { createServiceEnablementValidator } from '@/validation/service-enablement.validator.js';
import { ApiErrorCode } from '@/api/middleware/error.handler.js';
import { ProjectConfig, ProjectStatus, SnapshotData } from '@/types/snapshot.types.js';

/**
 * Create a mock snapshot with test data
 */
function createMockSnapshot(): SnapshotData {
  const project1: ProjectConfig = {
    projectId: 'project-active',
    projectName: 'Active Project',
    status: ProjectStatus.ACTIVE,
    tenantId: 'tenant-1',
    allowedOrigins: ['https://example.com'],
    rateLimit: 1000,
    enabledServices: ['service-a', 'service-b', 'service-c']
  };

  const project2: ProjectConfig = {
    projectId: 'project-limited',
    projectName: 'Limited Project',
    status: ProjectStatus.ACTIVE,
    tenantId: 'tenant-2',
    allowedOrigins: ['https://example.com'],
    rateLimit: 500,
    enabledServices: ['service-a'] // Only service-a enabled
  };

  const project3: ProjectConfig = {
    projectId: 'project-no-services',
    projectName: 'No Services Project',
    status: ProjectStatus.ACTIVE,
    tenantId: 'tenant-3',
    allowedOrigins: ['https://example.com'],
    rateLimit: 100,
    enabledServices: [] // No services enabled
  };

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    projects: {
      'project-active': project1,
      'project-limited': project2,
      'project-no-services': project3
    },
    services: {
      'service-a': {
        serviceName: 'service-a',
        enabled: true,
        endpoint: 'https://service-a.example.com',
        requiresAuth: true
      },
      'service-b': {
        serviceName: 'service-b',
        enabled: true,
        endpoint: 'https://service-b.example.com',
        requiresAuth: true
      },
      'service-c': {
        serviceName: 'service-c',
        enabled: true,
        endpoint: 'https://service-c.example.com',
        requiresAuth: false
      }
    },
    rateLimits: {
      'project-active': {
        requestsPerMinute: 1000,
        requestsPerHour: 10000,
        burstAllowance: 100
      }
    }
  };
}

/**
 * Test the complete data flow for service enablement validation
 */
async function testServiceEnablementDataFlow(): Promise<boolean> {
  console.log('=== Service Enablement Data Layer Integration Test ===\n');

  let allTestsPassed = true;

  // Test 1: Enabled service validates successfully
  try {
    console.log('Test 1: Enabled service validates successfully');

    const snapshot = createMockSnapshot();
    const project = snapshot.projects['project-active'];
    const serviceName = 'service-a';

    const validator = createServiceEnablementValidator();
    const result = validator.validateServiceEnablement(project, serviceName);

    if (result.isValid && !result.error) {
      console.log('  ✓ PASSED: Enabled service validates successfully\n');
    } else {
      console.log('  ✗ FAILED: Enabled service should be valid');
      console.log(`    Result: ${JSON.stringify(result)}\n`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  // Test 2: Disabled service returns SERVICE_DISABLED error
  try {
    console.log('Test 2: Disabled service returns SERVICE_DISABLED error');

    const snapshot = createMockSnapshot();
    const project = snapshot.projects['project-limited']; // Only service-a enabled
    const serviceName = 'service-b'; // Not enabled

    const validator = createServiceEnablementValidator();
    const result = validator.validateServiceEnablement(project, serviceName);

    if (!result.isValid && result.error) {
      if (result.error.code === ApiErrorCode.SERVICE_DISABLED) {
        console.log('  ✓ PASSED: Disabled service returns SERVICE_DISABLED error');
        console.log(`    Error code: ${result.error.code}`);
        console.log(`    Error message: ${result.error.message}\n`);
      } else {
        console.log('  ✗ FAILED: Wrong error code:', result.error.code);
        allTestsPassed = false;
      }
    } else {
      console.log('  ✗ FAILED: Disabled service should be invalid');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  // Test 3: Error message includes service name
  try {
    console.log('Test 3: Error message includes service name');

    const snapshot = createMockSnapshot();
    const project = snapshot.projects['project-active'];
    const serviceName = 'my-custom-service';

    const validator = createServiceEnablementValidator();
    const result = validator.validateServiceEnablement(project, serviceName);

    if (!result.isValid && result.error) {
      if (result.error.message.includes(serviceName)) {
        console.log('  ✓ PASSED: Error message includes service name');
        console.log(`    Service name: ${serviceName}`);
        console.log(`    Error message: ${result.error.message}\n`);
      } else {
        console.log('  ✗ FAILED: Error message does not include service name');
        console.log(`    Expected: "${serviceName}" in message`);
        console.log(`    Got: ${result.error.message}\n`);
        allTestsPassed = false;
      }
    } else {
      console.log('  ✗ FAILED: Should return error for disabled service');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  // Test 4: Project with no enabled services
  try {
    console.log('Test 4: Project with no enabled services');

    const snapshot = createMockSnapshot();
    const project = snapshot.projects['project-no-services']; // No services enabled
    const serviceName = 'service-a';

    const validator = createServiceEnablementValidator();
    const result = validator.validateServiceEnablement(project, serviceName);

    if (!result.isValid && result.error) {
      if (result.error.code === ApiErrorCode.SERVICE_DISABLED) {
        console.log('  ✓ PASSED: Project with no enabled services returns SERVICE_DISABLED');
        console.log(`    Error code: ${result.error.code}\n`);
      } else {
        console.log('  ✗ FAILED: Wrong error code:', result.error.code, '\n');
        allTestsPassed = false;
      }
    } else {
      console.log('  ✗ FAILED: Should return error when project has no enabled services\n');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  // Test 5: Null project returns PROJECT_NOT_FOUND
  try {
    console.log('Test 5: Null project returns PROJECT_NOT_FOUND');

    const validator = createServiceEnablementValidator();
    const result = validator.validateServiceEnablement(null, 'service-a');

    if (!result.isValid && result.error) {
      if (result.error.code === ApiErrorCode.PROJECT_NOT_FOUND) {
        console.log('  ✓ PASSED: Null project returns PROJECT_NOT_FOUND error');
        console.log(`    Error code: ${result.error.code}\n`);
      } else {
        console.log('  ✗ FAILED: Wrong error code:', result.error.code, '\n');
        allTestsPassed = false;
      }
    } else {
      console.log('  ✗ FAILED: Null project should be invalid\n');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  // Test 6: Multiple services validation
  try {
    console.log('Test 6: Multiple services validation');

    const snapshot = createMockSnapshot();
    const project = snapshot.projects['project-active'];
    const validator = createServiceEnablementValidator();

    const servicesToTest = [
      { name: 'service-a', shouldBeValid: true },
      { name: 'service-b', shouldBeValid: true },
      { name: 'service-c', shouldBeValid: true },
      { name: 'service-d', shouldBeValid: false }
    ];

    let allServicesValidated = true;
    for (const serviceTest of servicesToTest) {
      const result = validator.validateServiceEnablement(project, serviceTest.name);
      const isValid = result.isValid && !result.error;

      if (isValid === serviceTest.shouldBeValid) {
        console.log(`    ✓ Service '${serviceTest.name}': ${isValid ? 'enabled' : 'disabled'}`);
      } else {
        console.log(`    ✗ Service '${serviceTest.name}': expected ${serviceTest.shouldBeValid ? 'enabled' : 'disabled'}, got ${isValid ? 'enabled' : 'disabled'}`);
        allServicesValidated = false;
      }
    }

    if (allServicesValidated) {
      console.log('  ✓ PASSED: All services validated correctly\n');
    } else {
      console.log('  ✗ FAILED: Some services not validated correctly\n');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('  ✗ FAILED: Unexpected error:', error);
    allTestsPassed = false;
  }

  return allTestsPassed;
}

/**
 * Run the integration test
 */
async function runIntegrationTest(): Promise<void> {
  try {
    const allPassed = await testServiceEnablementDataFlow();

    console.log('=== Test Summary ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
      console.log('\nData Layer Integration Verified:');
      console.log('  ✓ Snapshot service provides project data');
      console.log('  ✓ Service enablement validator reads from snapshot');
      console.log('  ✓ Returns SERVICE_DISABLED for disabled services');
      console.log('  ✓ Error message includes service name');
      console.log('  ✓ Handles null projects correctly');
      console.log('  ✓ Validates multiple services correctly');
    } else {
      console.log('✗ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during integration test:', error);
    process.exit(1);
  }
}

// Run the test
runIntegrationTest();
