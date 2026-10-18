'use strict';
const { redactBodyKeys } = require('../services/apiCallTrackerService');

test('agentToken (MCP initialize frame) is redacted from tracked bodies', () => {
  const out = redactBodyKeys({ frames: { initializeRequest: { params: { agentToken: 'eyJhbGciOi.x.y', userSub: 'u1' } } } });
  expect(out.frames.initializeRequest.params.agentToken).toBe('***REDACTED***');
  expect(out.frames.initializeRequest.params.userSub).toBe('u1');
});
