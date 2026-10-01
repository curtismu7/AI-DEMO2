'use strict';

jest.mock('../../services/pingoneTestSseHub', () => ({ publishApiCall: jest.fn() }));
const tracker = require('../../services/apiCallTrackerService');
const fields = ['api_key', 'api_secret', 'apiKey', 'apiSecret', 'current_password', 'currentPassword'];

describe('API tracker Privilege credential redaction', () => {
  beforeEach(() => tracker._resetForTests());

  test.each(fields)('redacts %s in formatted request and response JSON, including nested arrays', async (field) => {
    const key = field.toUpperCase();
    const body = { [key]: 'synthetic', nested: [{ [field]: 'synthetic', label: 'safe' }], count: 2 };
    const original = JSON.parse(JSON.stringify(body));
    await tracker.trackApiCall({ method: 'POST', url: '/synthetic', sessionId: 'test-session', requestBody: JSON.stringify(body), responseBody: body, responseStatus: 200 });
    const expected = { [key]: '***REDACTED***', nested: [{ [field]: '***REDACTED***', label: 'safe' }], count: 2 };
    for (const session of ['test-session', tracker.GLOBAL_SESSION_ID]) {
      const [call] = tracker.getApiCalls(session);
      expect(JSON.parse(call.request.body)).toEqual(expected);
      expect(JSON.parse(call.response.body)).toEqual(expected);
    }
    expect(body).toEqual(original);
  });
});
