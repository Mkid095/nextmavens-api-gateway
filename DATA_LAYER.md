# Data Layer Architecture

## Overview

The API Gateway implements a robust, centralized data layer for snapshot consumption and management. This document describes the architecture and components.

## Components

### 1. Type Definitions (`src/types/snapshot.types.ts`)

Strongly-typed interfaces for all snapshot data structures:

- `ProjectConfig`: Project configuration and status
- `ServiceConfig`: Service endpoint and configuration
- `RateLimitConfig`: Rate limiting rules
- `SnapshotData`: Complete snapshot structure
- `SnapshotResponse`: API response wrapper
- `SnapshotCacheEntry`: Cached snapshot with metadata
- `ProjectStatus`: Project status enum (ACTIVE, SUSPENDED, ARCHIVED, DELETED)

**No `any` types used** - All data is properly typed.

### 2. HTTP Client Layer (`src/api/client/snapshot.client.ts`)

Centralized HTTP communication with the control plane API:

**Features:**
- Singleton pattern for consistent configuration
- Automatic retry logic with exponential backoff
- Configurable timeout and retry settings
- Health check endpoint
- Proper error classification (retryable vs non-retryable)
- Type-safe request/response handling

**Configuration:**
```typescript
interface SnapshotClientConfig {
  baseUrl: string;      // Control plane API URL
  timeout: number;      // Request timeout (ms)
  retries: number;      // Number of retry attempts
  retryDelay: number;   // Delay between retries (ms)
}
```

**Environment Variables:**
- `SNAPSHOT_API_URL`: Control plane API endpoint (default: http://localhost:4000/api)
- `SNAPSHOT_REQUEST_TIMEOUT`: Request timeout in ms (default: 5000)
- `SNAPSHOT_FETCH_RETRIES`: Number of retry attempts (default: 3)
- `SNAPSHOT_RETRY_DELAY`: Retry delay in ms (default: 1000)

### 3. Snapshot Service (`src/snapshot/snapshot.service.ts`)

Core snapshot management with caching and background refresh:

**Features:**
- **30-second TTL caching** - Snapshot expires after 30s
- **Background refresh** - Refreshes every 25s (5s before expiration)
- **Fail-closed behavior** - Rejects requests if snapshot unavailable
- **Singleton pattern** - Single instance across the application
- **Type-safe access** - Strongly-typed getter methods
- **Cache statistics** - Exposes cache metrics
- **Graceful shutdown** - Cleanup on SIGTERM/SIGINT

**Public Methods:**
- `initialize()`: Fetch initial snapshot and start background refresh
- `getSnapshot()`: Get current snapshot (throws if expired/unavailable)
- `getProject(projectId)`: Get project configuration
- `getService(serviceName)`: Get service configuration
- `getRateLimit(projectId)`: Get rate limit configuration
- `isProjectActive(projectId)`: Check if project is ACTIVE
- `isServiceEnabled(projectId, serviceName)`: Check if service enabled for project
- `stop()`: Stop background refresh
- `getCacheStats()`: Get cache statistics

**Custom Error Types:**
- `SnapshotFetchError`: Failed to fetch from control plane
- `SnapshotUnavailableError`: No snapshot available or expired

**Environment Variables:**
- `SNAPSHOT_API_URL`: Control plane API endpoint
- `SNAPSHOT_CACHE_TTL`: Cache TTL in seconds (default: 30)
- `SNAPSHOT_REFRESH_INTERVAL`: Refresh interval in seconds (default: 25)
- `SNAPSHOT_REQUEST_TIMEOUT`: Request timeout in ms (default: 5000)

### 4. Error Handling Middleware (`src/api/middleware/error.handler.ts`)

Centralized error handling and formatting:

**Features:**
- Standardized error codes (`ApiErrorCode` enum)
- `ApiError` class with structured error responses
- Error wrapping functions (`withErrorHandling`, `withErrorHandlingSync`)
- Structured error logging
- Helper methods for common errors

**Error Response Format:**
```json
{
  "error": {
    "code": "SNAPSHOT_UNAVAILABLE",
    "message": "Snapshot unavailable",
    "retryable": true,
    "details": {}
  }
}
```

**Error Codes:**
- Snapshot errors: `SNAPSHOT_UNAVAILABLE`, `SNAPSHOT_EXPIRED`, `SNAPSHOT_FETCH_FAILED`
- Project errors: `PROJECT_NOT_FOUND`, `PROJECT_SUSPENDED`, `PROJECT_ARCHIVED`, `PROJECT_DELETED`
- Service errors: `SERVICE_DISABLED`, `SERVICE_NOT_FOUND`
- Auth errors: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_API_KEY`
- Rate limiting: `RATE_LIMIT_EXCEEDED`
- Generic: `INTERNAL_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `SERVICE_UNAVAILABLE`

### 5. Authentication Middleware (`src/api/middleware/auth.middleware.ts`)

API key authentication and authorization:

**Features:**
- API key extraction from header or query
- API key format validation
- Project ID extraction from API key
- Express middleware for authentication
- Optional authentication support

**API Key Format:**
```
nm_proj_<projectId>_<signature>
```

**Middleware:**
- `requireApiKey`: Require valid API key
- `extractProjectId`: Extract project ID from authenticated request
- `optionalApiKey`: Optional authentication (doesn't fail if missing)

**Express Request Extensions:**
- `req.projectId`: Project ID extracted from API key
- `req.userId`: User ID (for future use)

### 6. Snapshot Validation Middleware (`src/snapshot/snapshot.middleware.ts`)

Request validation using snapshot data:

**Features:**
- Project status validation (rejects SUSPENDED, ARCHIVED, DELETED)
- Service enablement checks
- Fail-closed behavior
- Health check endpoint
- Standardized error responses

**Middleware:**
- `validateProjectFromRequest`: Extract and validate project ID
- `validateProjectStatus`: Check project status from snapshot
- `validateServiceEnabled(serviceName)`: Check if service enabled
- `validateProjectAndService(serviceName)`: Combined validation
- `checkSnapshotHealth`: Health check endpoint

**Error Response Format:**
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

### 1. Gateway Startup
```
index.ts
  ↓
createSnapshotService()
  ↓
snapshotService.initialize()
  ↓
snapshotClient.fetchSnapshot() [with retries]
  ↓
validateSnapshotData()
  ↓
Cache snapshot with TTL
  ↓
startBackgroundRefresh() [every 25s]
  ↓
Gateway ready
```

### 2. Incoming Request
```
Request arrives
  ↓
requireApiKey [Auth middleware]
  ↓
validateProjectFromRequest [Extract project ID]
  ↓
validateProjectStatus [Check project status]
  ↓
validateServiceEnabled [Check service access]
  ↓
Process request
```

### 3. Background Refresh
```
Every 25 seconds
  ↓
fetchSnapshot()
  ↓
If success: Update cache, reset failure counter
  ↓
If failure: Log error, keep using cached data
  ↓
Continue serving requests
```

## Fail-Closed Behavior

The gateway implements **fail-closed** security:

1. **Startup**: If initial snapshot fetch fails, gateway exits
2. **Request validation**: If snapshot unavailable/expired, reject all requests
3. **Background refresh**: Failures are logged but don't crash the service
4. **Error responses**: Clear error codes and retryable flags

## Caching Strategy

- **TTL**: 30 seconds (configurable)
- **Refresh interval**: 25 seconds (5s before expiration)
- **Background refresh**: Non-blocking, continues serving from cache
- **Stale data**: Better to serve slightly stale data than reject all requests
- **Expiration**: Hard stop after TTL - must have fresh snapshot

## Import Aliases

All imports use `@/` alias (no relative imports):

```typescript
// Correct
import { SnapshotService } from '@/snapshot/snapshot.service.js';
import { ApiError } from '@/api/middleware/error.handler.js';

// Incorrect (relative imports not used)
import { SnapshotService } from '../../snapshot/snapshot.service.js';
```

## Type Safety

- **Zero `any` types**: All code is properly typed
- **Strict mode enabled**: `tsconfig.json` has `strict: true`
- **No implicit any**: `noImplicitAny: true`
- **Type checking**: `pnpm typecheck` passes

## Testing

To verify the data layer:

```bash
# Type check
pnpm typecheck

# Build
pnpm build

# Run gateway
pnpm dev
```

### Health Check Endpoints

- `GET /health`: Gateway health with snapshot stats
- `GET /health/snapshot`: Detailed snapshot service status

### Example Responses

**Healthy:**
```json
{
  "status": "healthy",
  "snapshot": {
    "available": true,
    "stats": {
      "hasCachedData": true,
      "version": 123,
      "fetchedAt": 1706448000000,
      "expiresAt": 1706448030000,
      "isExpired": false,
      "fetchFailures": 0,
      "lastFetchAttempt": 1706448010000
    }
  }
}
```

## Summary

The data layer provides:

✅ Centralized snapshot management
✅ Type-safe data access (no `any` types)
✅ 30-second TTL caching
✅ Background refresh every 25 seconds
✅ Fail-closed security
✅ Automatic retry logic
✅ Structured error handling
✅ API key authentication
✅ Project status validation
✅ Service enablement checks
✅ Health monitoring
✅ Import path aliases (`@/`)
✅ Typecheck passing
