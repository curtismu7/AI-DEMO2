'use strict';

/**
 * elicitationStore.test.ts — shared pending-elicitation record store.
 *
 * Extracted from index.ts's WS-only handleMessage so the HTTP path
 * (authorizeMcpRequest.ts) can validate elicitation re-calls too — both
 * transports must consume the same session-bound, one-time-use record.
 */

import {
  createPendingElicitation,
  consumePendingElicitation,
  _resetElicitationStoreForTest,
} from '../src/elicitationStore';

beforeEach(() => _resetElicitationStoreForTest());

describe('createPendingElicitation', () => {
  it('returns a record with a generated id, the given fields, and a future expiry', () => {
    const rec = createPendingElicitation('create_withdrawal', 'sess-1', 'Confirm create_withdrawal?');
    expect(rec.elicitation_id).toEqual(expect.any(String));
    expect(rec.toolName).toBe('create_withdrawal');
    expect(rec.sessionId).toBe('sess-1');
    expect(rec.prompt).toBe('Confirm create_withdrawal?');
    expect(rec.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('consumePendingElicitation', () => {
  it('returns and deletes the record on a valid re-call (matching id/tool/session)', () => {
    const rec = createPendingElicitation('create_withdrawal', 'sess-1', 'Confirm?');
    const consumed = consumePendingElicitation(rec.elicitation_id, 'create_withdrawal', 'sess-1');
    expect(consumed).toEqual(rec);
    // One-time use — a second consume of the same id fails.
    expect(consumePendingElicitation(rec.elicitation_id, 'create_withdrawal', 'sess-1')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(consumePendingElicitation('no-such-id', 'create_withdrawal', 'sess-1')).toBeNull();
  });

  it('returns null when the tool name does not match the record', () => {
    const rec = createPendingElicitation('create_withdrawal', 'sess-1', 'Confirm?');
    expect(consumePendingElicitation(rec.elicitation_id, 'create_transfer', 'sess-1')).toBeNull();
  });

  it('returns null when the session id does not match the record', () => {
    const rec = createPendingElicitation('create_withdrawal', 'sess-1', 'Confirm?');
    expect(consumePendingElicitation(rec.elicitation_id, 'create_withdrawal', 'sess-2')).toBeNull();
  });

  it('returns null for an expired record', () => {
    const rec = createPendingElicitation('create_withdrawal', 'sess-1', 'Confirm?');
    rec.expiresAt = Date.now() - 1;
    expect(consumePendingElicitation(rec.elicitation_id, 'create_withdrawal', 'sess-1')).toBeNull();
  });
});
