/**
 * Never-silent contract for /api/agent/invoke: ensureNonEmptyReply is the server-
 * side net at the route's single exit. An empty reply once reached the UI as a
 * blank bubble (or the SPA's "I didn't catch that" parser apology) — the user
 * could not tell a model failure from a broken page.
 *
 * Card envelopes (requiresConsent / requiresCustomerLogin) render their own UI
 * and are exempt; everything else must say something.
 */
const { ensureNonEmptyReply } = require('../routes/agentInvokeRoute');

describe('ensureNonEmptyReply — the reply invariant', () => {
  test('empty reply is substituted, flagged, and non-empty', () => {
    const out = ensureNonEmptyReply({ reply: '', success: true, agentPath: 'llm' });
    expect(out.empty_reply).toBe(true);
    expect(typeof out.reply).toBe('string');
    expect(out.reply.trim().length).toBeGreaterThan(0);
  });

  test('whitespace-only reply is treated as empty', () => {
    const out = ensureNonEmptyReply({ reply: '   \n\t ', success: true });
    expect(out.empty_reply).toBe(true);
    expect(out.reply.trim().length).toBeGreaterThan(0);
  });

  test('missing reply field is treated as empty', () => {
    const out = ensureNonEmptyReply({ success: false, error: 'boom' });
    expect(out.empty_reply).toBe(true);
    expect(out.reply.trim().length).toBeGreaterThan(0);
  });

  test('a real reply is untouched — no flag, byte-identical text', () => {
    const out = ensureNonEmptyReply({ reply: 'Your balance is $2,668.42.', success: true });
    expect(out.empty_reply).toBeUndefined();
    expect(out.reply).toBe('Your balance is $2,668.42.');
  });

  test('consent card envelope is exempt', () => {
    const out = ensureNonEmptyReply({ reply: '', requiresConsent: true });
    expect(out.empty_reply).toBeUndefined();
    expect(out.reply).toBe('');
  });

  test('customer-login card envelope is exempt', () => {
    const out = ensureNonEmptyReply({ reply: '', requiresCustomerLogin: true });
    expect(out.empty_reply).toBeUndefined();
  });

  test('never throws on junk input', () => {
    expect(ensureNonEmptyReply(null)).toBeNull();
    expect(ensureNonEmptyReply(undefined)).toBeUndefined();
    expect(ensureNonEmptyReply('nope')).toBe('nope');
  });
});
