# Step 2: Validation Data Layer Implementation

## Overview

This document describes the data layer implementation for project status validation (US-002). The data layer integrates the validator (from Step 1) with the snapshot service to provide type-safe, cached validation operations.

## Architecture

### Data Flow

```
Request → Middleware → ValidationDataService → SnapshotService
                                      ↓
                              ProjectStatusValidator
                                      ↓
                                  ValidationResult
```

### Components

#### 1. **Validation Types** (`src/validation/types/validation.types.ts`)

Defines all type-safe interfaces for the validation data layer:

- `ValidationContext` - Metadata about validation requests
- `ValidationResult` - Result with error details and context
- `ProjectValidationData` - Project data from snapshot
- `ValidationOptions` - Configuration for validation operations
- `ValidationCacheEntry` - Cached validation results
- `ValidationMetrics` - Performance and usage metrics
- `ValidationErrorDetails` - Structured error information

#### 2. **Validation Data Service** (`src/validation/services/validation-data.service.ts`)

Core service that coordinates between snapshot and validator:

**Key Features:**
- **Caching**: 5-second TTL cache for validation results
- **Metrics**: Tracks validation statistics (success/failure rates, cache hits)
- **Batch Validation**: Validate multiple projects concurrently
- **Error Handling**: Converts all errors to standardized `ApiError`
- **Context Tracking**: Generates request IDs for traceability

**Methods:**
- `validateProjectStatus(projectId, options)` - Main validation method
- `getProjectData(projectId)` - Fetch project from snapshot
- `validateBatch(projectIds)` - Batch validation
- `isProjectActive(projectId)` - Quick active check
- `getMetrics()` - Get validation metrics
- `clearCache()` - Clear validation cache

#### 3. **Validation Middleware** (`src/validation/middleware/project-status.middleware.ts`)

Express middleware for request validation:

**Middleware Functions:**
- `validateProjectStatus` - Strict validation, throws on error
- `requireActiveProject` - Non-throwing validation check
- `attachProjectData` - Optional project data attachment

**Project ID Extraction:**
Supports multiple extraction methods:
1. `x-project-id` header
2. `project_id` query parameter
3. JWT token (placeholder for US-005)

**Extended Request Interface:**
```typescript
interface ValidatedRequest extends Request {
  project?: {
    id: string;
    config: unknown;
  };
}
```

#### 4. **Data Layer Integration** (`src/validation/integration/snapshot-integration.ts`)

High-level integration layer:

**ValidationDataLayer Class:**
- Provides clean interface for validation operations
- Coordinates all validation components
- Manages validation lifecycle
- Supports batch operations

**Usage Example:**
```typescript
const dataLayer = getValidationDataLayer();
const result = await dataLayer.validateProject('proj_123');

if (result.success) {
  // Project is active, proceed with request
} else {
  // Handle error (result.error)
}
```

## Integration with Existing Services

### Snapshot Service Integration

The validation data layer consumes the snapshot service:

```typescript
// From snapshot.service.ts
getProject(projectId: string): ProjectConfig | null

// Used by validation-data.service.ts
const snapshotService = getSnapshotService();
const project = snapshotService.getProject(projectId);
```

### Validator Integration

Uses the validator from Step 1:

```typescript
// From project-status.validator.ts (Step 1)
validateProjectStatus(project: ProjectConfig | null): ProjectStatusValidation

// Used by validation-data.service.ts
const validator = createProjectStatusValidator();
const validation = validator.validateProjectStatus(projectData.project);
```

### Error Handler Integration

Uses standardized error types:

```typescript
// From error.handler.ts
ApiErrorCode.PROJECT_SUSPENDED
ApiErrorCode.PROJECT_ARCHIVED
ApiErrorCode.PROJECT_DELETED
ApiErrorCode.SNAPSHOT_UNAVAILABLE
```

## Type Safety

All components use strict TypeScript typing:
- No `any` types
- Proper enum usage (e.g., `ApiErrorCode` instead of string literals)
- Full type exports from `@/validation/index.ts`
- `@/` path aliases for all imports

## Performance Features

### Caching Strategy
- 5-second TTL for validation results
- Automatic cache expiration
- Manual cache clearing available
- Cache metrics tracking

### Metrics Tracking
```typescript
interface ValidationMetrics {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  cacheHits: number;
  cacheMisses: number;
  lastValidationTime: number | null;
}
```

### Batch Operations
- Concurrent validation of multiple projects
- Efficient error handling for batch operations
- Map-based result aggregation

## File Structure

```
src/validation/
├── index.ts                              # Centralized exports
├── project-status.validator.ts           # Step 1: Business logic
├── types/
│   └── validation.types.ts              # Type definitions
├── services/
│   └── validation-data.service.ts       # Data layer service
├── middleware/
│   └── project-status.middleware.ts     # Express middleware
└── integration/
    └── snapshot-integration.ts          # High-level integration
```

## Export Structure

All components are exported from `@/validation/index.ts`:

```typescript
// Validators
export { ProjectStatusValidator, createProjectStatusValidator, ... }

// Middleware
export { validateProjectStatus, requireActiveProject, attachProjectData, ... }

// Services
export { ValidationDataService, createValidationDataService, ... }

// Types
export type { ValidationContext, ValidationResult, ... }

// Integration
export { ValidationDataLayer, getValidationDataLayer, ... }
```

## Usage Examples

### Basic Validation

```typescript
import { getValidationDataLayer } from '@/validation/index.js';

const dataLayer = getValidationDataLayer();
const result = await dataLayer.validateProject('proj_123');

if (!result.success) {
  console.error('Validation failed:', result.error);
}
```

### Middleware Usage

```typescript
import { validateProjectStatus } from '@/validation/index.js';
import express from 'express';

const app = express();

// Apply validation to routes
app.use('/api/protected', validateProjectStatus, (req, res) => {
  // Request only reaches here if project is active
  res.json({ message: 'Access granted' });
});
```

### Direct Service Usage

```typescript
import { createValidationDataService } from '@/validation/index.js';

const service = createValidationDataService(10); // 10 second cache
const result = await service.validateProjectStatus('proj_123', {
  throwOnError: false,
  includeContext: true,
  cacheResult: true
});

console.log('Metrics:', service.getMetrics());
```

## Quality Standards

✅ **Type Safety**: All code passes `pnpm run typecheck`
✅ **No Any Types**: Strict typing throughout
✅ **Path Aliases**: All imports use `@/` aliases
✅ **Error Handling**: Comprehensive error handling with `ApiError`
✅ **Performance**: Caching and metrics built-in
✅ **Documentation**: Full JSDoc comments on all public methods

## Next Steps

This data layer is ready for:
1. **Step 7**: Integration with full data layer (when other services are added)
2. **Step 10**: Testing and validation
3. **US-003**: Service enablement validation (can reuse this pattern)
4. **US-004**: Rate limiting validation (can reuse this pattern)

## Verification

Run typecheck to verify:
```bash
cd /home/ken/api-gateway
pnpm run typecheck
```

All code compiles without errors.
