'use strict';
/**
 * The unattended run's contract: it authenticates as itself, its token events
 * classify as autonomous, and the scan window/threshold actually bound what it
 * reports. Collaborators are injected, so nothing here reaches PingOne.
 */
const { runFraudWatch } = require('../../services/fraudWatchJob');

const NOW = new Date('2026-08-26T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);

const okToken = { access_token: 'x', scope: 'read', claims: { sub: 'agent:fraud-watch', aud: 'banking.ping.demo' } };
const getToken = async () => okToken;

test('flags only transactions over the threshold, inside the window', async () => {
  const readTransactions = () => [
    { id: 'in-over', amount: 5000, createdAt: hoursAgo(2), type: 'transfer', description: 'Big' },
    { id: 'in-under', amount: 10, createdAt: hoursAgo(2), type: 'purchase' },
    { id: 'old-over', amount: 9000, createdAt: hoursAgo(72), type: 'transfer' },
  ];

  const res = await runFraudWatch({ now: NOW, getToken, readTransactions });

  expect(res.status).toBe('completed');
  expect(res.findings.map((f) => f.transactionId)).toEqual(['in-over']);
  // The out-of-window transaction is not merely unflagged, it is not scanned.
  expect(res.scanned).toBe(2);
});

test('the run authenticates as the agent and classifies as autonomous', async () => {
  const res = await runFraudWatch({ now: NOW, getToken, readTransactions: () => [] });

  const agentEvent = res.tokenEvents.find((e) => e.id === 'agent-actor-token');
  expect(agentEvent).toBeTruthy();
  expect(agentEvent.claims.sub).toBe('agent:fraud-watch');
  // No delegation happened, so nothing may carry an act claim and no user
  // token may appear -- this is what the UI badge reads.
  expect(res.tokenEvents.some((e) => e.claims && e.claims.act)).toBe(false);
  expect(res.tokenEvents.some((e) => e.id === 'user-token')).toBe(false);
  // The classification itself is asserted against the real deriveAgentClass()
  // in demo_api_ui/src/services/tokenChainTrace/__tests__/deriveAgentClass.test.js,
  // which feeds it exactly this shape. Re-deriving it here would be a second
  // implementation free to drift from the one the UI actually renders.
});

test('a token failure is recorded as a failed run, not a silent no-op', async () => {
  const getBadToken = async () => { throw new Error('agent_not_configured'); };

  const res = await runFraudWatch({
    now: NOW,
    getToken: getBadToken,
    readTransactions: () => [{ id: 'over', amount: 5000, createdAt: hoursAgo(1) }],
  });

  expect(res.status).toBe('failed');
  expect(res.error).toBe('agent_not_configured');
  // It must not have scanned anything: no token, no work.
  expect(res.findings).toEqual([]);
  expect(res.scanned).toBe(0);
});
