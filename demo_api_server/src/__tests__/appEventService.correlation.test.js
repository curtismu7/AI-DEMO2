// demo_api_server/src/__tests__/appEventService.correlation.test.js
const appEventService = require('../../services/appEventService');

describe('appEventService correlationId', () => {
  beforeEach(() => {
    appEventService.clearEvents();
  });

  it('stores correlationId and aliases flowId', () => {
    const ev = appEventService.logEvent('oauth', 'info', 'hello', {
      correlationId: 'corr-1',
    });
    expect(ev.correlationId).toBe('corr-1');
    expect(ev.flowId).toBe('corr-1');
  });

  it('maps legacy flowId into correlationId', () => {
    const ev = appEventService.logEvent('mcp', 'info', 'tool', {
      flowId: 'flow-9',
    });
    expect(ev.correlationId).toBe('flow-9');
    expect(ev.flowId).toBe('flow-9');
  });

  it('redacts JWTs in message', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz012345';
    const ev = appEventService.logEvent('session', 'info', `tok=${jwt}`, {});
    expect(ev.message).toContain('[REDACTED_JWT]');
  });
});
