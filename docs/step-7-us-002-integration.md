# Step 7 - US-002: Validate Project Status Integration

## Overview
This document describes the integration of project status validation into the main API Gateway application (Step 7 of US-002).

## What Was Integrated

### 1. Validation Middleware Integration
The validation middleware created in Steps 1-2 has been integrated into the main gateway application (`src/index.ts`):

- **validateProjectStatus**: Primary middleware for validating project status
- **requireActiveProject**: Alternative middleware with slightly different error handling
- **attachProjectData**: Optional middleware that attaches project data without blocking

### 2. Protected Routes
Four new protected routes have been added to demonstrate the validation:

#### GET /api/protected
- **Purpose**: Main protected endpoint with project status validation
- **Requires**: `x-project-id` header or `project_id` query parameter
- **Behavior**: Rejects requests from SUSPENDED, ARCHIVED, or DELETED projects
- **Success Response**: Returns project info and snapshot statistics
- **Error Responses**:
  - `400 BAD_REQUEST`: No project ID provided
  - `403 PROJECT_SUSPENDED`: Project is suspended
  - `403 PROJECT_ARCHIVED`: Project is archived
  - `403 PROJECT_DELETED`: Project is deleted
  - `404 PROJECT_NOT_FOUND`: Project doesn't exist
  - `503 SNAPSHOT_UNAVAILABLE`: Snapshot service not initialized

#### POST /api/data
- **Purpose**: Example data endpoint with validation
- **Requires**: `x-project-id` header
- **Behavior**: Only active projects can POST data
- **Use Case**: Demonstrates a realistic protected endpoint

#### GET /api/status
- **Purpose**: Check project status without blocking
- **Requires**: Optional `x-project-id` header
- **Behavior**: Returns project status info if project ID provided
- **Use Case**: Useful for checking why a project can't access resources

#### GET /api/strict
- **Purpose**: Strict validation endpoint
- **Requires**: `x-project-id` header
- **Behavior**: Uses `requireActiveProject` middleware
- **Use Case**: Alternative validation approach

### 3. Error Handling Integration
The main error handler has been updated to properly handle `ApiError` instances:

```typescript
// Error handler now checks for ApiError instances
app.use((err: Error, _req, res, _next) => {
  if (err instanceof ApiError) {
    const errorResponse = err.toJSON();
    return res.status(err.statusCode).json(errorResponse);
  }
  // Handle generic errors
});
```

This ensures all validation errors are returned in the standard format:
```json
{
  "error": {
    "code": "PROJECT_SUSPENDED",
    "message": "Project 'MyProject' is suspended. Please contact support.",
    "retryable": false
  }
}
```

## Data Flow

### Request Validation Flow

1. **Request arrives** at protected endpoint (e.g., `/api/protected`)

2. **Project ID extraction** from:
   - `x-project-id` header (preferred)
   - `project_id` query parameter (fallback)

3. **Snapshot retrieval** from SnapshotService
   - Cached snapshot (30s TTL)
   - Background refresh

4. **Project lookup** from snapshot data

5. **Status validation** using ProjectStatusValidator:
   - `ACTIVE` → Proceed
   - `SUSPENDED` → Return 403 PROJECT_SUSPENDED
   - `ARCHIVED` → Return 403 PROJECT_ARCHIVED
   - `DELETED` → Return 403 PROJECT_DELETED
   - Not found → Return 404 PROJECT_NOT_FOUND

6. **Request processing** if validation passes
   - Project data attached to request
   - Route handler executes

## Error Codes

### Validation Errors
- `PROJECT_NOT_FOUND` (404): Project doesn't exist in snapshot
- `PROJECT_SUSPENDED` (403): Project is suspended
- `PROJECT_ARCHIVED` (403): Project is archived
- `PROJECT_DELETED` (403): Project is deleted

### System Errors
- `SNAPSHOT_UNAVAILABLE` (503): Snapshot service not initialized
- `BAD_REQUEST` (400): Missing project ID
- `INTERNAL_ERROR` (500): Unexpected system error

## Testing the Integration

### Prerequisites
1. Ensure snapshot service is running with test data
2. Start the gateway: `pnpm run dev`

### Test Scenarios

#### 1. Active Project (Success)
```bash
curl -H "x-project-id: active-project-123" http://localhost:8080/api/protected
```

Expected response:
```json
{
  "message": "This endpoint is protected by project status validation",
  "project": {
    "id": "active-project-123",
    "status": "ACTIVE",
    "validated": true
  },
  "snapshotVersion": "v1",
  "projectCount": 5,
  "serviceCount": 10
}
```

#### 2. Suspended Project (Rejected)
```bash
curl -H "x-project-id: suspended-project-456" http://localhost:8080/api/protected
```

Expected response:
```json
{
  "error": {
    "code": "PROJECT_SUSPENDED",
    "message": "Project 'SuspendedProject' is suspended. Please contact support.",
    "retryable": false
  }
}
```

#### 3. Archived Project (Rejected)
```bash
curl -H "x-project-id: archived-project-789" http://localhost:8080/api/protected
```

Expected response:
```json
{
  "error": {
    "code": "PROJECT_ARCHIVED",
    "message": "Project 'ArchivedProject' is archived and cannot accept requests.",
    "retryable": false
  }
}
```

#### 4. Missing Project ID (Bad Request)
```bash
curl http://localhost:8080/api/protected
```

Expected response:
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Project ID required. Provide via x-project-id header or project_id query parameter.",
    "retryable": false
  }
}
```

## Architecture Integration

### Components Integrated

1. **Validation Middleware** (`src/validation/middleware/project-status.middleware.ts`)
   - Extracts project ID from request
   - Validates against snapshot
   - Attaches project data to request
   - Throws appropriate errors

2. **Project Status Validator** (`src/validation/project-status.validator.ts`)
   - Core validation logic
   - Returns appropriate error for each status
   - Type-safe validation

3. **Snapshot Service** (`src/snapshot/snapshot.service.ts`)
   - Data source (already existing from US-001)
   - Provides project data from snapshot

4. **Error Handler** (`src/api/middleware/error.handler.ts`)
   - Centralized error handling (already existing)
   - Formats all errors consistently

### Import Structure
All imports use `@/` path aliases:
```typescript
import {
  validateProjectStatus,
  requireActiveProject,
  attachProjectData,
  type ValidatedRequest
} from '@/validation/middleware/project-status.middleware.js';

import { ApiError } from '@/api/middleware/error.handler.js';
```

## Quality Checks

✅ **Typecheck passes**: `pnpm run typecheck`
✅ **Build succeeds**: `pnpm run build`
✅ **No 'any' types**: All types properly defined
✅ **@ path aliases**: All imports use @/ prefix
✅ **Error handling**: All errors properly handled
✅ **Documentation**: Code is well-documented

## Acceptance Criteria Met

From US-002 PRD:
- ✅ Gateway checks status from snapshot
- ✅ SUSPENDED returns PROJECT_SUSPENDED error
- ✅ ARCHIVED returns PROJECT_ARCHIVED error
- ✅ DELETED returns PROJECT_DELETED error
- ✅ Only ACTIVE requests proceed
- ✅ Typecheck passes

## Next Steps

This integration completes Step 7 of US-002. The validation system is now:
- ✅ Fully integrated into the gateway
- ✅ Tested via protected routes
- ✅ Ready for Step 10 (Final Testing)

## Files Modified

1. `src/index.ts` - Added validation middleware imports and protected routes
2. Updated error handler to properly handle ApiError instances
3. Updated startup banner to reflect new protected endpoints

## Files Created

1. `docs/step-7-us-002-integration.md` - This documentation

## Related Files (No Changes)

- `src/validation/middleware/project-status.middleware.ts`
- `src/validation/project-status.validator.ts`
- `src/validation/services/validation-data.service.ts`
- `src/validation/integration/snapshot-integration.ts`
- `src/validation/types/validation.types.ts`
- `src/api/middleware/error.handler.ts`
- `src/snapshot/snapshot.service.ts`
- `src/snapshot/snapshot.middleware.ts`
