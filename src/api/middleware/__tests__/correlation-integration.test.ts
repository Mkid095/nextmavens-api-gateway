/**
 * Correlation Middleware Integration Test
 *
 * This test verifies that the correlation middleware works correctly
 * in an Express application context.
 */

import request from 'supertest';
import express, { Request, Response } from 'express';
import { correlationMiddleware } from '../correlation.middleware.js';

describe('Correlation Middleware Integration', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();

    // Add correlation middleware
    app.use(correlationMiddleware);

    // Add a test endpoint that returns the correlation ID
    app.get('/test', (req: Request, res: Response) => {
      res.json({
        correlationId: req.correlationId,
        message: 'Success'
      });
    });

    // Add an endpoint that echoes headers
    app.get('/echo-headers', (req: Request, res: Response) => {
      res.json({
        requestId: req.headers['x-request-id'],
        correlationId: req.correlationId
      });
    });
  });

  it('should generate correlation ID when not provided', async () => {
    const response = await request(app)
      .get('/test')
      .expect(200);

    expect(response.body.correlationId).toBeDefined();
    expect(typeof response.body.correlationId).toBe('string');
    expect(response.body.correlationId.length).toBe(36); // UUID v4 length

    // Verify response header
    expect(response.headers['x-request-id']).toBe(response.body.correlationId);
  });

  it('should use provided correlation ID from header', async () => {
    const providedId = 'my-custom-correlation-id-123';

    const response = await request(app)
      .get('/test')
      .set('x-request-id', providedId)
      .expect(200);

    expect(response.body.correlationId).toBe(providedId);
    expect(response.headers['x-request-id']).toBe(providedId);
  });

  it('should attach correlation ID to request headers', async () => {
    const response = await request(app)
      .get('/echo-headers')
      .expect(200);

    // Both should be present and match
    expect(response.body.requestId).toBeDefined();
    expect(response.body.correlationId).toBeDefined();
    expect(response.body.requestId).toBe(response.body.correlationId);
  });

  it('should generate unique IDs for concurrent requests', async () => {
    const [response1, response2] = await Promise.all([
      request(app).get('/test'),
      request(app).get('/test')
    ]);

    expect(response1.body.correlationId).toBeDefined();
    expect(response2.body.correlationId).toBeDefined();
    expect(response1.body.correlationId).not.toBe(response2.body.correlationId);
  });
});
