const { deriveAgentKey } = require('../services/sessionKeyService');

describe('deriveAgentKey', () => {
  test('a real explicit id is returned as-is', () => {
    expect(deriveAgentKey({ sessionID: 's1' }, 'ai-banking-agent-client-id'))
      .toBe('ai-banking-agent-client-id');
  });

  test('the "default-agent" UI placeholder falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'default-agent');
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('the "demo-agent" UI placeholder falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'demo-agent');
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('no explicit id falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, null);
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('same session id always derives the same key', () => {
    const a = deriveAgentKey({ sessionID: 'sess-xyz' }, undefined);
    const b = deriveAgentKey({ sessionID: 'sess-xyz' }, '');
    expect(a).toBe(b);
  });

  test('different session ids derive different keys', () => {
    const a = deriveAgentKey({ sessionID: 'sess-1' }, null);
    const b = deriveAgentKey({ sessionID: 'sess-2' }, null);
    expect(a).not.toBe(b);
  });

  test('no session at all resolves to a stable anonymous label, never throws', () => {
    expect(deriveAgentKey({}, null)).toBe('session:anonymous');
    expect(deriveAgentKey(null, null)).toBe('session:anonymous');
  });

  test('a userId third argument is used ahead of the session fallback', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, null, 'pingone-user-123');
    expect(key).toBe('user:pingone-user-123');
  });

  test('the "default-agent" placeholder still falls through to userId when both are given', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'default-agent', 'pingone-user-123');
    expect(key).toBe('user:pingone-user-123');
  });

  test('a real explicit id still wins over userId', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'real-agent-client-id', 'pingone-user-123');
    expect(key).toBe('real-agent-client-id');
  });

  test('same userId always derives the same key, independent of session', () => {
    const a = deriveAgentKey({ sessionID: 'sess-1' }, null, 'user-x');
    const b = deriveAgentKey({ sessionID: 'sess-2' }, null, 'user-x');
    expect(a).toBe(b);
  });

  test('omitting userId (2-arg call) still falls back to the session hash — no regression', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, null);
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });
});
