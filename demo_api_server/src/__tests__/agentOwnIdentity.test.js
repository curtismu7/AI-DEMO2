'use strict';
/**
 * The acting identity must be the declared one — and where it is not, the run
 * must say so rather than display the name it wished were true.
 *
 * This exists because a live run showed the trace asserting "Super Banking
 * Fraud Watch Agent" as the token subject while PingOne had issued the token to
 * the shared MCP token-exchanger client. A CC token frequently carries no `sub`
 * at all, and the friendly-name fallback filled the hole.
 *
 * Mocks are required inside each test: setup.js resets modules per test.
 */

jest.mock('../../services/configStore', () => {
  const store = {};
  return { __store: store, getEffective: jest.fn((k) => store[k]) };
});

function load(config = {}) {
  const configStore = require('../../services/configStore');
  Object.keys(configStore.__store).forEach((k) => delete configStore.__store[k]);
  Object.assign(configStore.__store, config);
  return {
    configStore,
    identity: require('../../services/agentIdentity'),
    ctxFactory: require('../../services/unattendedRunContext'),
  };
}

const AGENT = 'Super Banking Fraud Watch Agent';

test('uses the agent\'s own client when it is configured', () => {
  const { identity } = load({
    pingone_fraud_watch_agent_client_id: 'fw-client',
    pingone_fraud_watch_agent_client_secret: 'shh',
  });

  const creds = identity.resolveAgentCredentials(AGENT);

  expect(creds).toMatchObject({ clientId: 'fw-client', clientSecret: 'shh', ownIdentity: true });
});

test('reports no own identity when the credentials are unconfigured', () => {
  const { identity } = load({});

  const creds = identity.resolveAgentCredentials(AGENT);

  expect(creds.ownIdentity).toBe(false);
  expect(creds.clientId).toBeNull();
  expect(creds.reason).toMatch(/not been provisioned|not configured/);
});

// Fail closed: an agent with no identity of its own must not borrow one. The
// run refuses BEFORE minting anything -- no token request is made at all.
test('an unprovisioned agent refuses to run and never mints a token', async () => {
  load({});
  const { runFraudWatch } = require('../../services/fraudWatchJob');
  const getToken = jest.fn();

  const run = await runFraudWatch({ getToken, readTransactions: () => [] });

  expect(run.status).toBe('failed');
  expect(run.error).toMatch(/agent_not_provisioned/);
  expect(getToken).not.toHaveBeenCalled();
  expect(run.tokenEvents).toEqual([]);
});

test('an agent with no credential mapping is also marked, not silently allowed', () => {
  const { identity } = load({});

  expect(identity.resolveAgentCredentials('Some Other Agent')).toMatchObject({ ownIdentity: false });
});

// The regression that matters. A CC token with no `sub` must NOT be displayed
// as the agent's name.
test('the token event never shows the agent name as the subject', () => {
  const { ctxFactory } = load({});
  const ctx = ctxFactory.createUnattendedContext({ agent: AGENT });

  // Exactly what PingOne returned in the live run: decoded claims, no sub.
  ctx.recordAgentToken(
    { claims: { aud: ['mcpgateway.ping.demo'], scope: 'read' }, scope: 'read', clientId: 'f4dd707d' },
  );

  const evt = ctx.tokenEvents.find((e) => e.id === 'agent-actor-token');
  expect(evt.claims.sub).toBe('f4dd707d');
  expect(evt.claims.sub).not.toBe(AGENT);
  expect(evt.claims.client_id).toBe('f4dd707d');
  // The intent is still visible — beside the claims, never inside them.
  expect(evt.declaredAgent).toBe(AGENT);
});

test('a token that does carry a sub shows that sub', () => {
  const { ctxFactory } = load({});
  const ctx = ctxFactory.createUnattendedContext({ agent: AGENT });

  ctx.recordAgentToken({ claims: { sub: 'agent-fw-sub' }, clientId: 'fw-client' }, { ownIdentity: true });

  const evt = ctx.tokenEvents.find((e) => e.id === 'agent-actor-token');
  expect(evt.claims.sub).toBe('agent-fw-sub');
  expect(evt.ownIdentity).toBe(true);
});

// Still autonomous either way: borrowing a client does not make it delegated.
test('a run with no sub still classifies as autonomous', () => {
  const { ctxFactory } = load({});
  const ctx = ctxFactory.createUnattendedContext({ agent: AGENT });

  ctx.recordAgentToken({ claims: {}, clientId: 'fw-client' });

  expect(ctx.tokenEvents.some((e) => e.claims && e.claims.act)).toBe(false);
  expect(ctx.tokenEvents.some((e) => e.id === 'user-token')).toBe(false);
});
