# JWT Authentication Middleware

## Overview

The JWT authentication middleware provides secure JSON Web Token validation for the API Gateway. It extracts and validates JWT tokens from the `Authorization` header, extracts the `project_id` claim, and attaches it to the request for downstream middleware.

## Architecture

### Components

1. **Token Extraction** (`extractJwtToken`)
   - Extracts JWT from `Authorization: Bearer <token>` header
   - Validates Bearer scheme format
   - Enforces token length limits (1-4096 characters)

2. **Token Validation** (`validateJwtToken`)
   - Verifies JWT signature using configured secret
   - Validates expiration (exp claim)
   - Validates not-before (nbf claim)
   - Validates issuer (iss claim) if configured
   - Validates audience (aud claim) if configured
   - Validates `project_id` claim presence and format

3. **Middleware Functions**
   - `requireJwtAuth`: Required authentication, fails closed
   - `optionalJwtAuth`: Optional authentication, continues on failure
   - `extractProjectIdFromJwt`: Extracts project ID from authenticated request

### Security Features

#### Fail-Closed Architecture
- Rejects all requests with invalid tokens
- No fallback to unauthenticated access
- Generic error messages prevent information leakage

#### Input Validation
- Project ID format validation: `/^[a-zA-Z0-9_-]{1,100}$/`
- Token length limits prevent DoS attacks
- Bearer scheme strict validation

#### Constant-Time Operations
- JWT verification uses constant-time comparison
- Prevents timing attacks on token validation

#### Generic Error Messages
- All JWT failures return `KEY_INVALID` error
- Prevents enumeration of token structure
- No leakage about signature, expiration, or claims

## Configuration

### Environment Variables

```bash
# Required
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long

# Optional
JWT_ALGORITHM=HS256  # Default: HS256
JWT_ISSUER=nextmavens-platform  # Default: undefined
JWT_AUDIENCE=api-gateway  # Default: undefined
```

### JWT Secret Requirements

- **Minimum length**: 32 characters
- **Recommendation**: Use cryptographically secure random string
- **Storage**: Store in environment variable, never in code
- **Rotation**: Implement key rotation strategy for production

## JWT Payload Structure

### Required Claims

```typescript
interface JwtPayload {
  project_id: string;  // Required: Project identifier
}
```

### Optional Claims

```typescript
interface JwtPayload {
  project_id: string;
  iss?: string;  // Issuer
  sub?: string;  // Subject
  aud?: string;  // Audience
  exp?: number;  // Expiration time
  iat?: number;  // Issued at
  nbf?: number;  // Not before
  jti?: string;  // JWT ID
}
```

## Usage

### Required Authentication

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';

// Apply to routes that require authentication
app.use('/api/protected', requireJwtAuth, protectedRouteHandler);
```

### Optional Authentication

```typescript
import { optionalJwtAuth } from '@/api/middleware/jwt.middleware.js';

// Apply to routes that work with or without authentication
app.use('/api/public', optionalJwtAuth, publicRouteHandler);

// In handler, check if authenticated:
if (req.projectId) {
  // Authenticated request
} else {
  // Unauthenticated request
}
```

### Accessing Project ID

```typescript
// After JWT authentication middleware
const projectId = req.projectId;  // string
const jwtPayload = req.jwtPayload;  // JwtPayload
```

## Error Handling

### Error Codes

#### `KEY_INVALID` (401)
- Invalid or malformed authentication token
- Covers: signature verification failed, token expired, invalid claims
- **Response:**
  ```json
  {
    "error": {
      "code": "KEY_INVALID",
      "message": "Invalid or malformed authentication token",
      "retryable": false
    }
  }
  ```

#### `UNAUTHORIZED` (401)
- Authorization token not found
- **Response:**
  ```json
  {
    "error": {
      "code": "UNAUTHORIZED",
      "message": "Authorization token not found. Provide Bearer token in Authorization header.",
      "retryable": false
    }
  }
  ```

## Integration with Existing Middleware

### Project Status Validation

The JWT middleware integrates with the existing project status validation middleware:

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
import { validateProjectStatus } from '@/validation/middleware/project-status.middleware.js';

// Chain: JWT auth -> Project status validation -> Route handler
app.use('/api/projects', requireJwtAuth, validateProjectStatus, projectHandler);
```

### Request Flow

1. **JWT Authentication** (`requireJwtAuth`)
   - Extracts token from `Authorization` header
   - Validates signature and claims
   - Attaches `projectId` to request

2. **Project Status Validation** (`validateProjectStatus`)
   - Reads `projectId` from request (set by JWT middleware)
   - Validates project status from snapshot
   - Continues only if project is ACTIVE

3. **Route Handler**
   - Processes request with authenticated project context

## Testing

### Unit Tests

Located at: `src/api/middleware/__tests__/jwt.middleware.test.ts`

Run tests:
```bash
pnpm test
```

### Test Token Generation

For testing purposes, use the `generateTestToken` function:

```typescript
import { generateTestToken } from '@/api/middleware/jwt.middleware.js';

const token = generateTestToken({
  project_id: 'test-project-123',
  iss: 'test-issuer',
  aud: 'test-audience'
}, 'test-secret');

// Use token in Authorization header
// Authorization: Bearer <token>
```

## Best Practices

### Security

1. **Always use HTTPS** - JWT tokens sent over HTTP can be intercepted
2. **Use strong secrets** - Minimum 32 characters, cryptographically random
3. **Set expiration** - Use short-lived tokens (e.g., 1 hour)
4. **Rotate keys** - Implement key rotation strategy
5. **Validate all claims** - Don't skip claim validation
6. **Use generic errors** - Prevent information leakage

### Performance

1. **Cache verification** - Consider caching verified tokens for short duration
2. **Async operations** - Middleware uses async/await for non-blocking
3. **Fail fast** - Validate token format before signature verification

### Monitoring

1. **Log authentication failures** - Track failed attempts for security monitoring
2. **Monitor token expiration** - Track expirations to optimize token lifetime
3. **Alert on anomalies** - Set up alerts for unusual authentication patterns

## Migration from API Key Authentication

### Before (API Key)

```typescript
import { requireApiKey } from '@/api/middleware/auth.middleware.js';

app.use('/api/protected', requireApiKey, protectedRouteHandler);
```

### After (JWT)

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';

app.use('/api/protected', requireJwtAuth, protectedRouteHandler);
```

### Migration Strategy

1. **Phase 1**: Deploy JWT middleware alongside API key middleware
2. **Phase 2**: Update clients to use JWT authentication
3. **Phase 3**: Monitor for successful migration
4. **Phase 4**: Remove API key authentication

## Troubleshooting

### Common Issues

#### "JWT authentication not configured"
- **Cause**: `JWT_SECRET` environment variable not set
- **Solution**: Set `JWT_SECRET` in environment

#### "JWT secret too short"
- **Cause**: Secret is less than 32 characters
- **Solution**: Use a longer, more secure secret

#### "Project ID not found in token"
- **Cause**: JWT payload missing `project_id` claim
- **Solution**: Ensure JWT includes `project_id` claim

#### "Invalid or malformed authentication token"
- **Cause**: Token signature invalid or malformed
- **Solution**: Verify token is signed with correct secret and format

## References

- [RFC 7519 - JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [jsonwebtoken npm package](https://www.npmjs.com/package/jsonwebtoken)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)

## Changelog

### US-005 - Initial Implementation
- Created JWT authentication middleware
- Implemented token extraction and validation
- Added `KEY_INVALID` error code
- Integrated with existing project status validation
- Added comprehensive unit tests
- Updated environment configuration
