'use strict';

// The Demo arch slides live feed rides on /api/arch-events. A signed-in
// non-admin must learn only that a hop happened (category / tag / severity);
// the message — which can name tools, amounts and other users' activity — is
// admin-only, the same line the admin app-events stream draws.
const { liveTracePayload } = require('../routes/archEvents');

const event = {
  id: 'e1',
  timestamp: '2026-10-06T14:00:00.000Z',
  category: 'token_exchange',
  severity: 'info',
  message: 'RFC 8693 exchange OK for user demoUser → aud mcp-gw',
  tag: 'token_exchange/rfc8693-success',
  metadata: { sub: 'demoUser' },
  sessionId: 'sess-1',
  username: 'demoUser',
};

describe('arch-events live-trace payload', () => {
  test('non-admin gets category, tag and severity only', () => {
    expect(liveTracePayload(event, false)).toEqual({
      ts: '2026-10-06T14:00:00.000Z',
      category: 'token_exchange',
      tag: 'token_exchange/rfc8693-success',
      severity: 'info',
    });
  });

  test('admin also gets the message, never metadata or session ids', () => {
    const out = liveTracePayload(event, true);
    expect(out.message).toBe(event.message);
    expect(out).not.toHaveProperty('metadata');
    expect(out).not.toHaveProperty('sessionId');
    expect(out).not.toHaveProperty('username');
  });
});
