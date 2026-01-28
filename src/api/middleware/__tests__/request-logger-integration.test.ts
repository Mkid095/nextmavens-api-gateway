import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { correlationMiddleware } from '../correlation.middleware.js';
import { requestLoggerMiddleware } from '../request-logger.middleware.js';

// Mock console.log to capture output
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Request Logger Integration Tests (US-008)', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a fresh Express app for each test
    app = express();
    app.use(correlationMiddleware);
    app.use(requestLoggerMiddleware);

    // Add a simple test route
    app.get('/test', (_req, res) => {
      res.json({ message: 'test' });
    });

    app.post('/data', (_req, res) => {
      res.status(201).json({ created: true });
    });

    app.get('/error', (_req, res) => {
      res.status(500).json({ error: 'test error' });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should log requests with correlation ID', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'test' });

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    // Verify logging occurred
    expect(mockConsoleLog).toHaveBeenCalled();

    // Check that we have both the initial log and the RequestLog
    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    expect(requestLog).toBeDefined();

    // Verify the log contains expected fields
    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData).toHaveProperty('correlationId');
    expect(logData).toHaveProperty('method', 'GET');
    expect(logData).toHaveProperty('path', '/test');
    expect(logData).toHaveProperty('statusCode', 200);
    expect(logData).toHaveProperty('duration');
    expect(logData).toHaveProperty('timestamp');
  });

  it('should log different HTTP methods correctly', async () => {
    const response = await request(app).post('/data').send({ test: 'data' });

    expect(response.status).toBe(201);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.method).toBe('POST');
    expect(logData.path).toBe('/data');
    expect(logData.statusCode).toBe(201);
  });

  it('should log error responses', async () => {
    const response = await request(app).get('/error');

    expect(response.status).toBe(500);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.statusCode).toBe(500);
    expect(logData.path).toBe('/error');
  });

  it('should include x-request-id header in response', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(typeof response.headers['x-request-id']).toBe('string');

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    // Verify the correlation ID in the log matches the header
    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.correlationId).toBe(response.headers['x-request-id']);
  });

  it('should use custom x-request-id if provided', async () => {
    const customId = 'my-custom-request-id-123';

    const response = await request(app)
      .get('/test')
      .set('x-request-id', customId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(customId);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    // Verify the log uses the custom ID
    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.correlationId).toBe(customId);
  });

  it('should log duration in milliseconds', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.duration).toBeGreaterThanOrEqual(0);
    expect(logData.duration).toBeLessThan(1000); // Should be fast
    expect(typeof logData.duration).toBe('number');
  });

  it('should log ISO 8601 timestamp', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.timestamp).toBeDefined();
    expect(typeof logData.timestamp).toBe('string');

    // Verify it's a valid ISO 8601 date
    const date = new Date(logData.timestamp);
    expect(date.toISOString()).toBe(logData.timestamp);
  });

  it('should not include project_id when not authenticated', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 20));

    const logCalls = mockConsoleLog.mock.calls;
    const requestLog = logCalls.find(call =>
      call[0] && typeof call[0] === 'string' && call[0].includes('[RequestLog]')
    );

    const logString = requestLog![0] as string;
    const jsonPart = logString.replace('[RequestLog] ', '');
    const logData = JSON.parse(jsonPart);

    expect(logData.projectId).toBeUndefined();
  });
});
