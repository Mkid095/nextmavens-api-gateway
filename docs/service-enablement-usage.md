# Service Enablement Validation - Usage Examples

This document provides usage examples for the service enablement validation middleware.

## Overview

The service enablement validation ensures that only enabled services can be accessed for a given project. This is part of the API Gateway enforcement layer (US-003).

## Installation

The service enablement validator and middleware are automatically available in the validation module:

```typescript
import {
  validateServiceEnablement,
  requireServiceEnabled,
  validateServiceEnabledFor,
  attachServiceData,
  createServiceEnablementValidator
} from '@/validation/index.js';
```

## Usage Examples

### Example 1: Basic Middleware Usage

```typescript
import express from 'express';
import { validateServiceEnablement } from '@/validation/index.js';

const app = express();

// Apply service enablement validation to a route
app.get('/api/data', validateServiceEnablement, (req, res) => {
  // If we reach here, the service is enabled
  res.json({ message: 'Service access granted' });
});

// Client must provide:
// - x-project-id header: Project ID
// - x-service-name header OR ?service query parameter OR route parameter
```

### Example 2: Pre-configured Service Middleware

```typescript
import { validateServiceEnabledFor } from '@/validation/index.js';

// Create middleware for a specific service
const requireDataService = validateServiceEnabledFor('data-service');

app.get('/api/data', requireDataService, (req, res) => {
  // Service 'data-service' is validated automatically
  res.json({ data: [] });
});

const requireAnalyticsService = validateServiceEnabledFor('analytics-service');

app.get('/api/analytics', requireAnalyticsService, (req, res) => {
  // Service 'analytics-service' is validated automatically
  res.json({ analytics: [] });
});
```

### Example 3: Combined with Project Status Validation

```typescript
import {
  validateProjectStatus,
  validateServiceEnablement
} from '@/validation/index.js';

// Validate both project status AND service enablement
app.get(
  '/api/data',
  validateProjectStatus,    // Check project is ACTIVE
  validateServiceEnablement, // Check service is enabled
  (req, res) => {
    res.json({ message: 'Access granted' });
  }
);
```

### Example 4: Using Route Parameters

```typescript
import { validateServiceEnablement } from '@/validation/index.js';

// The middleware will extract service name from req.params.serviceName
app.get('/api/:serviceName/data', validateServiceEnablement, (req, res) => {
  const serviceName = req.service?.name;
  res.json({ message: `Access granted to ${serviceName}` });
});

// Request: GET /api/my-service/data
// Middleware validates that 'my-service' is enabled for the project
```

### Example 5: Using Query Parameters

```typescript
import { validateServiceEnablement } from '@/validation/index.js';

// The middleware will extract service name from req.query.service
app.get('/api/data', validateServiceEnablement, (req, res) => {
  const serviceName = req.service?.name;
  res.json({ message: `Access granted to ${serviceName}` });
});

// Request: GET /api/data?service=my-service
// Headers: x-project-id: project-123
```

### Example 6: Using Headers

```typescript
import { validateServiceEnablement } from '@/validation/index.js';

// The middleware will extract service name from req.headers['x-service-name']
app.get('/api/data', validateServiceEnablement, (req, res) => {
  const serviceName = req.service?.name;
  res.json({ message: `Access granted to ${serviceName}` });
});

// Request: GET /api/data
// Headers:
//   x-project-id: project-123
//   x-service-name: my-service
```

### Example 7: Direct Validator Usage

```typescript
import { createServiceEnablementValidator } from '@/validation/index.js';
import { getSnapshotService } from '@/snapshot/snapshot.service.js';

const validator = createServiceEnablementValidator();
const snapshotService = getSnapshotService();

// Get project from snapshot
const project = snapshotService?.getProject('project-123');

// Validate service enablement
const result = validator.validateServiceEnablement(project, 'data-service');

if (!result.isValid) {
  // Handle error
  console.error('Error:', result.error?.message);
} else {
  // Service is enabled, proceed
  console.log('Service is enabled');
}
```

### Example 8: Accessing Validated Data

```typescript
import { validateServiceEnablement } from '@/validation/index.js';
import type { ServiceValidatedRequest } from '@/validation/index.js';

app.get('/api/data', validateServiceEnablement, (req: ServiceValidatedRequest, res) => {
  // Access validated service data
  const serviceName = req.service?.name; // string
  const serviceEnabled = req.service?.enabled; // boolean

  // Access validated project data (if also validated)
  const projectId = req.project?.id; // string
  const projectConfig = req.project?.config; // ProjectConfig

  res.json({
    service: serviceName,
    project: projectId
  });
});
```

### Example 9: Optional Service Attachment

```typescript
import { attachServiceData } from '@/validation/index.js';

// Attach service data if available, but don't block if missing
app.get('/api/data', attachServiceData, (req, res) => {
  if (req.service) {
    // Service data was attached
    res.json({ service: req.service.name });
  } else {
    // No service data, but request continues
    res.json({ message: 'No service context' });
  }
);
```

## Error Responses

When service validation fails, the middleware returns a standardized error response:

### Service Disabled (403)

```json
{
  "error": {
    "code": "SERVICE_DISABLED",
    "message": "Service 'my-service' is not enabled for this project. Please enable it in the developer portal.",
    "retryable": false
  }
}
```

### Project Not Found (404)

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Project not found or access denied",
    "retryable": false
  }
}
```

### Service Unavailable (503)

```json
{
  "error": {
    "code": "SNAPSHOT_UNAVAILABLE",
    "message": "Service temporarily unavailable",
    "retryable": true
  }
}
```

### Bad Request (400)

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Service name required. Provide via x-service-name header, ?service query parameter, or route parameter.",
    "retryable": false
  }
}
```

## Security Features

1. **Service Name Validation**: Service names are strictly validated (alphanumeric with hyphens/underscores, 1-100 chars)
2. **Fail-Closed**: If snapshot is unavailable, all requests are rejected
3. **Timing Attack Resistance**: Constant-time validation prevents timing leaks
4. **Generic Error Messages**: Error messages prevent service enumeration
5. **Input Sanitization**: All inputs are trimmed and validated before processing

## Priority Order for Service Name Extraction

The middleware extracts the service name in the following priority order:

1. **Route parameter** (`req.params.serviceName`) - Most reliable
2. **Header** (`req.headers['x-service-name']`) - More secure than query
3. **Query parameter** (`req.query.service`) - Least secure but still valid

## Integration with Existing Middleware

The service enablement validation integrates seamlessly with existing validation middleware:

```typescript
import {
  validateProjectStatus,
  validateServiceEnablement
} from '@/validation/index.js';

// Validation pipeline
app.use('/api/*',
  validateProjectStatus,      // US-002: Check project status
  validateServiceEnablement    // US-003: Check service enablement
);
```

## Testing

To test service enablement validation:

```typescript
import request from 'supertest';
import { createTestApp } from './test-setup';

const app = createTestApp();

// Test with disabled service
await request(app)
  .get('/api/data')
  .set('x-project-id', 'test-project')
  .set('x-service-name', 'disabled-service')
  .expect(403);

// Test with enabled service
await request(app)
  .get('/api/data')
  .set('x-project-id', 'test-project')
  .set('x-service-name', 'enabled-service')
  .expect(200);
```
