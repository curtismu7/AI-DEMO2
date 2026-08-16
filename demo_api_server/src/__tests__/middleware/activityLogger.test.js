'use strict';

jest.mock('../../../data/store', () => ({
  createActivityLog: jest.fn().mockResolvedValue(undefined),
}));

const dataStore = require('../../../data/store');
const { logActivity } = require('../../../middleware/activityLogger');
const createActivityLog = dataStore.createActivityLog;

function mockReq({ method, originalUrl, path, body }) {
  return {
    method,
    originalUrl,
    path,
    body,
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    get: (header) => {
      if (header === 'Authorization') return 'Bearer some-token';
      if (header === 'User-Agent') return 'jest';
      return null;
    },
    user: null,
  };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.send = function send(data) { return data; };
  return res;
}

// Waits for the fire-and-forget createActivityLog() call (invoked inside
// res.send, not awaited by the middleware) to resolve before assertions run.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('activityLogger requestBody redaction', () => {
  beforeEach(() => {
    createActivityLog.mockClear();
  });

  it('redacts password fields on POST /auth/login but keeps non-sensitive fields visible', async () => {
    const req = mockReq({
      method: 'POST',
      originalUrl: '/auth/login',
      path: '/auth/login',
      body: { username: 'jane', password: 'hunter2' },
    });
    const res = mockRes();

    await new Promise((resolve) => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ user: { id: '1', username: 'jane' } }));
      resolve();
    });
    await flush();

    expect(createActivityLog).toHaveBeenCalledTimes(1);
    const logEntry = createActivityLog.mock.calls[0][0];
    expect(logEntry.requestBody.password).toBe('[REDACTED]');
    expect(logEntry.requestBody.username).toBe('jane');
  });

  it('redacts newPassword/currentPassword on a password-change request', async () => {
    const req = mockReq({
      method: 'PUT',
      originalUrl: '/auth/change-password',
      path: '/auth/change-password',
      body: { currentPassword: 'oldpass', newPassword: 'newpass' },
    });
    const res = mockRes();

    logActivity(req, res, () => {});
    res.send(JSON.stringify({ success: true }));
    await flush();

    const logEntry = createActivityLog.mock.calls[0][0];
    expect(logEntry.requestBody.currentPassword).toBe('[REDACTED]');
    expect(logEntry.requestBody.newPassword).toBe('[REDACTED]');
  });

  it('redacts password on register while leaving email visible', async () => {
    const req = mockReq({
      method: 'POST',
      originalUrl: '/auth/register',
      path: '/auth/register',
      body: { username: 'jane', email: 'jane@example.com', password: 'hunter2' },
    });
    const res = mockRes();

    logActivity(req, res, () => {});
    res.send(JSON.stringify({ success: true }));
    await flush();

    const logEntry = createActivityLog.mock.calls[0][0];
    expect(logEntry.requestBody.password).toBe('[REDACTED]');
    expect(logEntry.requestBody.email).toBe('jane@example.com');
    expect(logEntry.requestBody.username).toBe('jane');
  });
});
