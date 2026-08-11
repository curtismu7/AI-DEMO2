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
});
