'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ getRecord: jest.fn() }));
jest.mock('../../services/tokenChainService', () => ({ getTokenChain: jest.fn() }));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const tokenChainService = require('../../services/tokenChainService');
const { assemble } = require('../../services/transactionAssembler');

const LEDGER_RECORD = {
  correlationId: 'c1',
  startedAt: '2026-07-18T00:00:00.000Z',
  endedAt: '2026-07-18T00:00:10.000Z',
  principal: 'demoUser',
  hops: [
    { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'demo-api-server', phase: 'ui.request' },
    { seq: 2, ts: '2026-07-18T00:00:09.000Z', service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
  ],
};

describe('transactionAssembler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenChainService.getTokenChain.mockResolvedValue([]);
  });

  test('returns null when the ledger has no record', async () => {
    ledger.getRecord.mockReturnValue(null);
    expect(await assemble('nope')).toBeNull();
  });

  test('passes ledger hops through, marked source=emit', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    const out = await assemble('c1');
    expect(out.hops).toHaveLength(2);
    expect(out.hops.every((h) => h.source === 'emit')).toBe(true);
  });

  test('derives a token.exchange hop from a matching token-chain event', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      {
        id: 'evt-1',
        correlationId: 'c1',
        eventType: 'exchange',
        tokenType: 'exchanged_token',
        timestamp: '2026-07-18T00:00:05.000Z',
        tokenSub: 'demoUser',
        tokenAct: { client_id: 'agent-gw' },
        scopes: ['banking:read'],
        audience: 'mcp-server',
        expiry: '2026-07-18T01:00:00.000Z',
      },
    ]);
    const out = await assemble('c1');
    const derived = out.hops.filter((h) => h.phase === 'token.exchange');
    expect(derived).toHaveLength(1);
    expect(derived[0].source).toBe('derived');
    expect(derived[0].identity).toMatchObject({
      sub: 'demoUser',
      act: ['agent-gw'],
      aud: 'mcp-server',
      scopes: ['banking:read'],
      tokenType: 'exchanged_token',
    });
  });

  test('ignores token-chain events for a different correlation id', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'e', correlationId: 'other', eventType: 'exchange', timestamp: '2026-07-18T00:00:05.000Z' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.filter((h) => h.phase === 'token.exchange')).toHaveLength(0);
  });

  test('skips jest fixture records that carry a `type` key', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'token-event-1', userId: 'persist-test-user', type: 'TOKEN_EXCHANGE', timestamp: 1783949866168, correlationId: 'c1' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.filter((h) => h.phase === 'token.exchange')).toHaveLength(0);
  });

  test('merges derived hops in timestamp order and re-sequences', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'e', correlationId: 'c1', eventType: 'exchange', timestamp: '2026-07-18T00:00:05.000Z', tokenSub: 'u' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.map((h) => h.phase)).toEqual(['ui.request', 'token.exchange', 'mcp.tool']);
    expect(out.hops.map((h) => h.seq)).toEqual([1, 2, 3]);
  });

  test('degrades to ledger-only hops when the token chain read throws', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockRejectedValue(new Error('boom'));
    const out = await assemble('c1');
    expect(out.hops).toHaveLength(2);
  });

  test('passes the record principal to getTokenChain, scoping the read', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    await assemble('c1');
    expect(tokenChainService.getTokenChain).toHaveBeenCalledWith('demoUser');
    expect(tokenChainService.getTokenChain).toHaveBeenCalledTimes(1);
  });

  test('returns no derived hops, and never calls getTokenChain, when the principal is unknown', async () => {
    const record = JSON.parse(JSON.stringify(LEDGER_RECORD));
    record.principal = null; // no hop ever carried an identity.sub
    ledger.getRecord.mockReturnValue(record);
    const out = await assemble('c1');
    // The unscoped all-users call (getTokenChain with no args) must never
    // happen — that fallback is exactly the confidentiality leak being closed.
    expect(tokenChainService.getTokenChain).not.toHaveBeenCalled();
    expect(out.hops.filter((h) => h.phase === 'token.exchange')).toHaveLength(0);
    expect(out.hops).toHaveLength(2); // ledger-only hops still surface
  });

  test('assemble surfaces the record principal on the returned trace', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    const out = await assemble('c1');
    expect(out.principal).toBe('demoUser');
  });
});
