# JWT Authentication Quick Start

## Setup

### 1. Configure Environment Variables

Add to your `.env` file:

```bash
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long
JWT_ALGORITHM=HS256
JWT_ISSUER=nextmavens-platform
JWT_AUDIENCE=api-gateway
```

### 2. Import Middleware

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
```

## Usage Examples

### Protect a Route

```typescript
import express from 'express';
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';

const app = express();

// Protect a route with JWT authentication
app.get('/api/protected', requireJwtAuth, (req, res) => {
  // Access project ID from JWT
  const projectId = req.projectId;
  const jwtPayload = req.jwtPayload;

  res.json({
    message: 'Access granted',
    projectId: projectId
  });
});
```

### Chain with Other Middleware

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';
import { validateProjectStatus } from '@/validation/middleware/project-status.middleware.js';
import { validateServiceEnablement } from '@/validation/middleware/service-enablement.middleware.js';

// Full middleware chain
app.use('/api/services',
  requireJwtAuth,              // 1. Authenticate with JWT
  validateProjectStatus,        // 2. Validate project is ACTIVE
  validateServiceEnablement,    // 3. Validate service is enabled
  serviceHandler                // 4. Handle request
);
```

### Optional Authentication

```typescript
import { optionalJwtAuth } from '@/api/middleware/jwt.middleware.js';

// Works with or without authentication
app.get('/api/public', optionalJwtAuth, (req, res) => {
  if (req.projectId) {
    // Authenticated request
    res.json({
      message: 'Hello, authenticated user!',
      projectId: req.projectId
    });
  } else {
    // Unauthenticated request
    res.json({
      message: 'Hello, anonymous user!'
    });
  }
});
```

## Client-Side Usage

### Making Authenticated Requests

```javascript
// After obtaining JWT token from your auth service
const token = 'your-jwt-token-here';

fetch('http://gateway:8080/api/protected', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
  .then(response => response.json())
  .then(data => console.log(data));
```

## JWT Token Format

### Required Payload

```json
{
  "project_id": "your-project-id"
}
```

### Complete Example

```json
{
  "project_id": "proj-abc123",
  "iss": "nextmavens-platform",
  "aud": "api-gateway",
  "iat": 1234567890,
  "exp": 1234571490
}
```

## Error Responses

### Missing Token (401)

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authorization token not found. Provide Bearer token in Authorization header.",
    "retryable": false
  }
}
```

### Invalid Token (401)

```json
{
  "error": {
    "code": "KEY_INVALID",
    "message": "Invalid or malformed authentication token",
    "retryable": false
  }
}
```

## Testing

### Generate Test Token

```typescript
import { generateTestToken } from '@/api/middleware/jwt.middleware.js';

const token = generateTestToken({
  project_id: 'test-project-123',
  iss: 'test-issuer',
  aud: 'test-audience'
}, 'test-secret');

console.log(token);
```

### Use Test Token

```bash
curl -H "Authorization: Bearer <your-test-token>" \
     http://localhost:8080/api/protected
```

## Common Patterns

### Extract User Information

```typescript
app.get('/api/user', requireJwtAuth, (req, res) => {
  const { project_id, iss, aud, exp } = req.jwtPayload;

  res.json({
    projectId: project_id,
    issuer: iss,
    audience: aud,
    expiresAt: new Date(exp * 1000)
  });
});
```

### Check Token Expiration

```typescript
app.get('/api/check-expiry', requireJwtAuth, (req, res) => {
  const { exp } = req.jwtPayload;
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = exp - now;

  res.json({
    expired: timeUntilExpiry <= 0,
    expiresIn: timeUntilExpiry,
    expiresAt: new Date(exp * 1000)
  });
});
```

## Troubleshooting

### "JWT authentication not configured"
- Set `JWT_SECRET` environment variable
- Ensure secret is at least 32 characters

### "Project ID not found in token"
- Include `project_id` claim in JWT payload
- Ensure `project_id` is a string

### "Invalid or malformed authentication token"
- Check token format: `Authorization: Bearer <token>`
- Verify token is signed with correct secret
- Ensure token hasn't expired

## Security Best Practices

1. **Always use HTTPS** - Never transmit tokens over HTTP
2. **Use short expiration** - Set token expiration to 1 hour or less
3. **Rotate secrets** - Implement key rotation strategy
4. **Validate all claims** - Don't skip claim validation
5. **Monitor failures** - Track authentication failures for security

## Migration from API Keys

### Before (API Key)

```typescript
import { requireApiKey } from '@/api/middleware/auth.middleware.js';

app.use('/api/protected', requireApiKey, handler);
```

### After (JWT)

```typescript
import { requireJwtAuth } from '@/api/middleware/jwt.middleware.js';

app.use('/api/protected', requireJwtAuth, handler);
```

## Additional Resources

- [Full Documentation](./jwt-authentication.md)
- [Implementation Summary](./us-005-implementation-summary.md)
- [JWT.io](https://jwt.io/) - JWT debugger and documentation
