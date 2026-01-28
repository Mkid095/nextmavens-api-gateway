/**
 * Unit tests for ServiceEnablementValidator
 *
 * Run with: npx ts-node src/validation/__tests__/service-enablement.validator.test.ts
 */

import { ServiceEnablementValidator, createServiceEnablementValidator } from '../service-enablement.validator.js';
import { ProjectConfig } from '@/types/snapshot.types.js';
import { ProjectStatus } from '@/types/snapshot.types.js';
import { ApiErrorCode } from '@/api/middleware/error.handler.js';

// Test helper to create a mock project
function createMockProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    projectId: 'test-project-1',
    projectName: 'Test Project',
    status: ProjectStatus.ACTIVE,
    tenantId: 'tenant-1',
    allowedOrigins: ['https://example.com'],
    rateLimit: 1000,
    enabledServices: ['service-a', 'service-b', 'service-c'],
    ...overrides
  };
}

// Test helper to create a validator
function createValidator(): ServiceEnablementValidator {
  return createServiceEnablementValidator();
}

console.log('Running ServiceEnablementValidator tests...\n');

// Test 1: Validate enabled service
try {
  const validator = createValidator();
  const project = createMockProject();
  const result = validator.validateServiceEnablement(project, 'service-a');

  if (result.isValid && !result.error) {
    console.log('✓ Test 1 PASSED: Enabled service validates successfully');
  } else {
    console.log('✗ Test 1 FAILED: Enabled service should be valid');
  }
} catch (error) {
  console.log('✗ Test 1 FAILED:', error);
}

// Test 2: Validate disabled service
try {
  const validator = createValidator();
  const project = createMockProject();
  const result = validator.validateServiceEnablement(project, 'service-disabled');

  if (!result.isValid && result.error) {
    if (result.error.code === ApiErrorCode.SERVICE_DISABLED) {
      console.log('✓ Test 2 PASSED: Disabled service returns SERVICE_DISABLED error');
    } else {
      console.log('✗ Test 2 FAILED: Wrong error code:', result.error.code);
    }
  } else {
    console.log('✗ Test 2 FAILED: Disabled service should be invalid');
  }
} catch (error) {
  console.log('✗ Test 2 FAILED:', error);
}

// Test 3: Validate with null project
try {
  const validator = createValidator();
  const result = validator.validateServiceEnablement(null, 'service-a');

  if (!result.isValid && result.error) {
    if (result.error.code === ApiErrorCode.PROJECT_NOT_FOUND) {
      console.log('✓ Test 3 PASSED: Null project returns PROJECT_NOT_FOUND error');
    } else {
      console.log('✗ Test 3 FAILED: Wrong error code:', result.error.code);
    }
  } else {
    console.log('✗ Test 3 FAILED: Null project should be invalid');
  }
} catch (error) {
  console.log('✗ Test 3 FAILED:', error);
}

// Test 4: Error message includes service name
try {
  const validator = createValidator();
  const project = createMockProject();
  const result = validator.validateServiceEnablement(project, 'my-custom-service');

  if (!result.isValid && result.error) {
    if (result.error.message.includes('my-custom-service')) {
      console.log('✓ Test 4 PASSED: Error message includes service name');
    } else {
      console.log('✗ Test 4 FAILED: Error message does not include service name:', result.error.message);
    }
  } else {
    console.log('✗ Test 4 FAILED: Should return error for disabled service');
  }
} catch (error) {
  console.log('✗ Test 4 FAILED:', error);
}

// Test 5: isServiceEnabled returns true for enabled service
try {
  const validator = createValidator();
  const project = createMockProject();
  const isEnabled = validator.isServiceEnabled(project, 'service-a');

  if (isEnabled === true) {
    console.log('✓ Test 5 PASSED: isServiceEnabled returns true for enabled service');
  } else {
    console.log('✗ Test 5 FAILED: isServiceEnabled should return true');
  }
} catch (error) {
  console.log('✗ Test 5 FAILED:', error);
}

// Test 6: isServiceEnabled returns false for disabled service
try {
  const validator = createValidator();
  const project = createMockProject();
  const isEnabled = validator.isServiceEnabled(project, 'service-disabled');

  if (isEnabled === false) {
    console.log('✓ Test 6 PASSED: isServiceEnabled returns false for disabled service');
  } else {
    console.log('✗ Test 6 FAILED: isServiceEnabled should return false');
  }
} catch (error) {
  console.log('✗ Test 6 FAILED:', error);
}

// Test 7: Invalid service name format
try {
  const validator = createValidator();
  const project = createMockProject();

  try {
    validator.validateServiceEnablement(project, 'invalid service name with spaces!');
    console.log('✗ Test 7 FAILED: Should throw error for invalid service name');
  } catch (error: unknown) {
    if ((error as { code: string }).code === ApiErrorCode.BAD_REQUEST) {
      console.log('✓ Test 7 PASSED: Invalid service name format throws BAD_REQUEST error');
    } else {
      console.log('✗ Test 7 FAILED: Wrong error code for invalid service name');
    }
  }
} catch (error) {
  console.log('✗ Test 7 FAILED:', error);
}

// Test 8: validateServiceEnablementOrThrow throws for disabled service
try {
  const validator = createValidator();
  const project = createMockProject();

  try {
    validator.validateServiceEnablementOrThrow(project, 'service-disabled');
    console.log('✗ Test 8 FAILED: Should throw error for disabled service');
  } catch (error: unknown) {
    if ((error as { code: string }).code === ApiErrorCode.SERVICE_DISABLED) {
      console.log('✓ Test 8 PASSED: validateServiceEnablementOrThrow throws for disabled service');
    } else {
      console.log('✗ Test 8 FAILED: Wrong error code:', (error as { code: string }).code);
    }
  }
} catch (error) {
  console.log('✗ Test 8 FAILED:', error);
}

// Test 9: validateServiceEnablementOrThrow does not throw for enabled service
try {
  const validator = createValidator();
  const project = createMockProject();

  try {
    validator.validateServiceEnablementOrThrow(project, 'service-a');
    console.log('✓ Test 9 PASSED: validateServiceEnablementOrThrow does not throw for enabled service');
  } catch (error) {
    console.log('✗ Test 9 FAILED: Should not throw error for enabled service:', error);
  }
} catch (error) {
  console.log('✗ Test 9 FAILED:', error);
}

// Test 10: Empty project with no enabled services
try {
  const validator = createValidator();
  const project = createMockProject({ enabledServices: [] });
  const result = validator.validateServiceEnablement(project, 'any-service');

  if (!result.isValid && result.error) {
    if (result.error.code === ApiErrorCode.SERVICE_DISABLED) {
      console.log('✓ Test 10 PASSED: Project with no enabled services returns SERVICE_DISABLED');
    } else {
      console.log('✗ Test 10 FAILED: Wrong error code:', result.error.code);
    }
  } else {
    console.log('✗ Test 10 FAILED: Should return error when project has no enabled services');
  }
} catch (error) {
  console.log('✗ Test 10 FAILED:', error);
}

console.log('\nAll tests completed!');
