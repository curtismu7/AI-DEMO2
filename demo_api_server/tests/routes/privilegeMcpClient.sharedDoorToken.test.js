'use strict';

// One credential, one sign-in. Every door on this app's own public origin —
// the Direct and Façade doors — advertises the same authorization server (the
// Agent Gateway broker) and verifies against the same audience, so a token
// minted at any of them is accepted by all of them.
//
// Keying the token slot per door URL made the page demand a fresh interactive
// sign-in for each one: opensearch, brave, banking, pingone-admin and the
// façade doors were seven logins for a single credential, and each switch
// nulled the slot and bounced the user through PingOne again.
//
// What must NOT collapse: a door on a DIFFERENT origin. Privilege doors live on
// the gateway origin where each Agentic App is its own authorization server,
// and the scope-narrowed `audit` door is served off the plain-HTTP façade port.
// Sharing a slot with either would hand over a token their upstream never
// issued — and for `audit`, an mcp:invoke token would quietly widen it from
// three tools to the full banking surface.

const express = require('express');
const request = require('supertest');

const PUBLIC_ORIGIN = 'https://local.ping-devops.com:4000';
const DOOR_A = `${PUBLIC_ORIGIN}/mcp-facade/opensearch/mcp`;
const DOOR_B = `${PUBLIC_ORIGIN}/mcp-facade/brave/mcp`;
const FACADE_DOOR = `${PUBLIC_ORIGIN}/mcp-facade/privilege-gateway/opensearch22/mcp`;
const GATEWAY_DOOR = 'https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp';

function buildApp() {
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  const sess = {};
  app.use((req, _res, next) => {
    req.sessionID = 'shared-door-token-test';
    req.session = sess;
    req.session.save = (cb) => cb && cb(null);
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

const setDoor = (app, mcpUrl, gatewayMode) => request(app)
  .post('/api/privilege-mcp/config')
  .send({ mcpUrl, gatewayMode })
  .expect(200);

describe('one sign-in covers every door on our own origin', () => {
  const saved = {};
  let app;

  beforeEach(() => {
    saved.pub = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = PUBLIC_ORIGIN;
    app = buildApp();
  });

  afterEach(() => {
    if (saved.pub === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = saved.pub;
  });

  // A Bearer on the request is how this route accepts a credential without an
  // interactive flow (getClientSession copies it into session.oauth).
  const signIn = (mcpUrl) => request(app)
    .post('/api/privilege-mcp/config')
    .set('Authorization', 'Bearer door-token')
    .send({ mcpUrl, gatewayMode: 'direct' })
    .expect(200);

  test('switching between two Direct doors keeps the token — no second sign-in', async () => {
    await signIn(DOOR_A);

    const res = await setDoor(app, DOOR_B, 'direct');
    expect(res.body.oauth.authenticated).toBe(true);
    expect(res.body.config.mcpUrl).toBe(DOOR_B);
  });

  test('a Façade door on the same origin reuses it too', async () => {
    await signIn(DOOR_A);

    const res = await setDoor(app, FACADE_DOOR, 'facade');
    expect(res.body.oauth.authenticated).toBe(true);
  });

  test('a door on the GATEWAY origin does not inherit it', async () => {
    await signIn(DOOR_A);

    const res = await setDoor(app, GATEWAY_DOOR, 'privilege');
    expect(res.body.oauth.authenticated).toBe(false);
  });

  // The banking door fronts no authorization server of its own: it FORWARDS the
  // caller's bearer to an upstream that was never issued our audience. Handing
  // it the shared token produced a live 401 "D-05 violation: gateway-audience
  // token cannot be used at upstream" — which the page renders as "Not signed
  // in", so a working door started demanding a login the user had just done.
  // It relays fine with NO bearer.
  test('an ungated pure-proxy door is NOT given the shared token', async () => {
    await signIn(DOOR_A);

    const res = await setDoor(app, `${PUBLIC_ORIGIN}/mcp-facade/banking/mcp`, 'direct');
    expect(res.body.oauth.authenticated).toBe(false);
  });

  test('and the gated doors still share it after visiting the ungated one', async () => {
    await signIn(DOOR_A);
    await setDoor(app, `${PUBLIC_ORIGIN}/mcp-facade/banking/mcp`, 'direct');

    const res = await setDoor(app, DOOR_B, 'direct');
    expect(res.body.oauth.authenticated).toBe(true);
  });

  test('and coming back to our own origin still has it', async () => {
    await signIn(DOOR_A);
    await setDoor(app, GATEWAY_DOOR, 'privilege');

    const res = await setDoor(app, DOOR_B, 'direct');
    expect(res.body.oauth.authenticated).toBe(true);
  });
});
