'use strict';

jest.mock('../../data/store', () => ({ createActivityLog: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/transactionHop', () => ({ emitHop: jest.fn() }));
const store = require('../../data/store');
const { emitHop } = require('../../services/transactionHop');
const { logActivity } = require('../../middleware/activityLogger');

const fields = ['api_key', 'api_secret', 'apiKey', 'apiSecret', 'current_password', 'currentPassword'];

describe('activityLogger Privilege credential redaction', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(fields)('redacts %s case-insensitively in nested objects and arrays without mutating the request', (field) => {
    const key = field.toUpperCase();
    const body = { [key]: 'synthetic', nested: { [field]: 'synthetic' }, rows: [{ [key]: 'synthetic', label: 'safe' }], count: 2 };
    const original = JSON.parse(JSON.stringify(body));
    const req = {
      path: '/api/admin/privilege-user-api/credentials', originalUrl: '/api/admin/privilege-user-api/credentials',
      method: 'POST', headers: { 'x-request-id': 'test-correlation' }, body,
      ip: '127.0.0.1', connection: {}, get: () => null,
    };
    const res = { statusCode: 200, send: jest.fn() };
    logActivity(req, res, jest.fn());
    res.send({ ok: true });
    const entry = store.createActivityLog.mock.calls[0][0];
    const expected = { [key]: '[REDACTED]', nested: { [field]: '[REDACTED]' }, rows: [{ [key]: '[REDACTED]', label: 'safe' }], count: 2 };
    expect(entry.requestBody).toEqual(expected);
    expect(emitHop.mock.calls[0][0].details.requestBody).toEqual(expected);
    expect(entry.responseBody).toBeNull();
    expect(body).toEqual(original);
  });
});
