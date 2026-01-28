# Step 7 - Integration Map

## System Architecture After Step 7 Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway (src/index.ts)                   │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Public Routes│  │ 404 Handler  │  │ Error Handler│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Protected Routes (NEW - Step 7)            │    │
│  │                                                           │    │
│  │  • GET /api/protected  → validateProjectStatus          │    │
│  │  • POST /api/data      → validateProjectStatus          │    │
│  │  • GET /api/status     → attachProjectData              │    │
│  │  • GET /api/strict     → requireActiveProject           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ imports
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│         Validation Middleware (Step 2 - US-002)                 │
│  src/validation/middleware/project-status.middleware.ts         │
│                                                                   │
│  • validateProjectStatus()        - Main validation middleware │
│  • requireActiveProject()         - Strict validation          │
│  • attachProjectData()            - Optional attachment        │
│  • extractProjectId()             - ID extraction logic        │
│  • ValidatedRequest interface     - Extended Request type      │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ uses
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│         Project Status Validator (Step 1 - US-002)              │
│  src/validation/project-status.validator.ts                     │
│                                                                   │
│  • ProjectStatusValidator class                                 │
│  • validateProjectStatus()       - Returns validation result   │
│  • validateProjectStatusOrThrow() - Throws on invalid          │
│  • isProjectActive()             - Boolean check               │
│  • Error creation methods                                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ reads from
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│              Snapshot Service (US-001 - Existing)               │
│  src/snapshot/snapshot.service.ts                               │
│                                                                   │
│  • SnapshotService class                                        │
│  • getSnapshot()                  - Get full snapshot           │
│  • getProject(projectId)          - Get single project          │
│  • isServiceEnabled()             - Check service access        │
│  • 30s TTL cache with background refresh                        │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ fetches from
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│              Snapshot Client (US-001 - Existing)                │
│  src/api/client/snapshot.client.ts                              │
│                                                                   │
│  • HTTP client for snapshot API                                 │
│  • Axios-based                                                  │
│  • Configured with SNAPSHOP_API_URL                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ throws
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│           Error Handler (US-001 - Enhanced in Step 7)           │
│  src/api/middleware/error.handler.ts                            │
│                                                                   │
│  • ApiError class                                               │
│  • ApiErrorCode enum                                            │
│  • Standard error format:                                        │
│    {                                                             │
│      error: {                                                    │
│        code: "PROJECT_SUSPENDED",                               │
│        message: "...",                                          │
│        retryable: false                                         │
│      }                                                           │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

## Request Flow Diagram

### Successful Request (Active Project)

```
1. Client Request
   ↓
   Headers: x-project-id: proj-active-001
   ↓
2. Gateway (src/index.ts)
   ↓
3. Protected Route: GET /api/protected
   ↓
4. Validation Middleware: validateProjectStatus()
   ↓
   a. Extract project ID: "proj-active-001"
   ↓
   b. Get snapshot service
   ↓
   c. Lookup project in snapshot
   ↓
   d. Call validator.validateProjectStatusOrThrow(project)
   ↓
5. Project Status Validator
   ↓
   Check: project.status === 'ACTIVE'
   ↓
   Result: ✅ Valid - No error thrown
   ↓
6. Middleware attaches project data to request
   ↓
   req.project = { id: "proj-active-001", config: {...} }
   ↓
7. Route handler executes
   ↓
8. Success Response: 200 OK
   {
     "message": "This endpoint is protected...",
     "project": { "id": "...", "status": "ACTIVE", "validated": true },
     ...
   }
```

### Rejected Request (Suspended Project)

```
1. Client Request
   ↓
   Headers: x-project-id: proj-suspended-002
   ↓
2. Gateway (src/index.ts)
   ↓
3. Protected Route: GET /api/protected
   ↓
4. Validation Middleware: validateProjectStatus()
   ↓
   a. Extract project ID: "proj-suspended-002"
   ↓
   b. Get snapshot service
   ↓
   c. Lookup project in snapshot
   ↓
   d. Call validator.validateProjectStatusOrThrow(project)
   ↓
5. Project Status Validator
   ↓
   Check: project.status === 'SUSPENDED'
   ↓
   Result: ❌ Invalid - Throw ApiError
   ↓
   throw ApiError.projectSuspended('ProjectName')
   ↓
6. Error thrown to next()
   ↓
7. Gateway Error Handler (src/index.ts)
   ↓
   Check: err instanceof ApiError
   ↓
   Format: err.toJSON()
   ↓
8. Error Response: 403 Forbidden
   {
     "error": {
       "code": "PROJECT_SUSPENDED",
       "message": "Project 'ProjectName' is suspended...",
       "retryable": false
     }
   }
```

## Error Code Mapping

| Project Status | Validator Action | Error Code | HTTP Status |
|----------------|------------------|------------|-------------|
| ACTIVE | Allow | - | 200 |
| SUSPENDED | Throw error | PROJECT_SUSPENDED | 403 |
| ARCHIVED | Throw error | PROJECT_ARCHIVED | 403 |
| DELETED | Throw error | PROJECT_DELETED | 403 |
| Not Found | Throw error | PROJECT_NOT_FOUND | 404 |
| Unknown | Throw error | INTERNAL_ERROR | 500 |
| No Project ID | Throw error | BAD_REQUEST | 400 |
| Snapshot Unavailable | Throw error | SNAPSHOT_UNAVAILABLE | 503 |

## Module Dependencies

### src/index.ts (Gateway - Step 7)
```typescript
// Validation middleware (NEW in Step 7)
import {
  validateProjectStatus,
  requireActiveProject,
  attachProjectData,
  type ValidatedRequest
} from '@/validation/middleware/project-status.middleware.js';

// Error handler (Enhanced in Step 7)
import { ApiError } from '@/api/middleware/error.handler.js';

// Existing imports (unchanged)
import { createSnapshotService, getSnapshotService } from '@/snapshot/snapshot.service.js';
import { checkSnapshotHealth } from '@/snapshot/snapshot.middleware.js';
```

### src/validation/middleware/project-status.middleware.ts (Step 2)
```typescript
// Uses validator from Step 1
import { createProjectStatusValidator } from '@/validation/project-status.validator.js';

// Uses error handler from US-001
import { ApiError, ApiErrorCode, withErrorHandling } from '@/api/middleware/error.handler.js';

// Uses snapshot service from US-001
import { getSnapshotService } from '@/snapshot/snapshot.service.js';
```

### src/validation/project-status.validator.ts (Step 1)
```typescript
// Uses types from US-001
import { ProjectStatus, ProjectConfig } from '@/types/snapshot.types.js';

// Uses error handler from US-001
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
```

## File Structure

```
src/
├── index.ts                           ← MODIFIED (Step 7)
│   └── Added: Validation middleware imports
│   └── Added: 4 protected routes
│   └── Enhanced: Error handler
│
├── api/
│   ├── client/
│   │   └── snapshot.client.ts        (US-001 - No change)
│   └── middleware/
│       └── error.handler.ts          (US-001 - Referenced)
│
├── snapshot/
│   ├── snapshot.service.ts           (US-001 - No change)
│   └── snapshot.middleware.ts        (US-001 - No change)
│
├── types/
│   └── snapshot.types.ts             (US-001 - No change)
│
└── validation/                        ← NEW (Steps 1-2)
    ├── index.ts
    ├── project-status.validator.ts   (Step 1)
    ├── middleware/
    │   └── project-status.middleware.ts  (Step 2)
    ├── services/
    │   └── validation-data.service.ts    (Step 2)
    ├── integration/
    │   └── snapshot-integration.ts       (Step 2)
    └── types/
        └── validation.types.ts           (Step 2)
```

## Integration Points

### 1. Import Integration (Step 7)
- Gateway imports validation middleware
- Gateway imports ApiError for error handling

### 2. Middleware Integration (Step 7)
- Validation middleware applied to protected routes
- Middleware integrates with Express routing
- Error handling integrated with Express error handler

### 3. Data Flow Integration (Step 7)
- Request → Middleware → Validator → Snapshot Service → Client
- Response flows back through error handler

### 4. Error Handling Integration (Step 7)
- ApiError instances caught and formatted
- Standard error response format maintained
- Proper HTTP status codes returned

## Key Integration Features

✅ **Loose Coupling**: Validation layer doesn't depend on gateway
✅ **Type Safety**: All types properly defined with TypeScript
✅ **Error Handling**: Centralized error handling with ApiError
✅ **Extensibility**: Easy to add new validation rules
✅ **Testability**: Each layer can be tested independently
✅ **Path Aliases**: All imports use @/ prefix
✅ **No Any Types**: Full type safety throughout

## Summary

Step 7 successfully integrated the validation system (Steps 1-2) into the main gateway application. The integration maintains clean architecture with proper separation of concerns, type safety, and error handling.
