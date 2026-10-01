'use strict';

const { createDemoReadinessProviderLoginClient } = require('../services/demoReadinessProviderLoginClient');

const BFF = 'https://dedicated.example.test';
const CALLBACK = `${BFF}/api/auth/oauth/user/callback?code=private-code&state=private-state`;
const STATUS = `${BFF}/api/auth/oauth/user/status`;
const BASE = {
  dedicatedBffUrl: BFF, identityRef: 'identity-one', username: 'private-user', password: 'private-password',
  expectedIssuer: 'https://issuer.example.test', expectedSubject: 'private-subject',
};

function pingOneTransport({ callback = CALLBACK, status = {}, responseUrl } = {}) {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/login')) return { status: 302, headers: { location: 'https://auth.example.test/env/as/authorize', 'set-cookie': ['connect.sid=pre; Path=/'] } };
    if (url.pathname.endsWith('/authorize')) return { status: 302, headers: { location: 'https://auth.example.test/env/flows/start?flowId=flow-one', 'set-cookie': ['flow=one; Path=/'] } };
    if (url.pathname.endsWith('/flows/flow-one')) return { status: 200, body: { status: 'COMPLETED' } };
    if (url.pathname.endsWith('/resume')) return { status: 302, headers: { location: callback } };
    if (url.pathname.endsWith('/callback')) return { status: 302, headers: { location: `${BFF}/dashboard`, 'set-cookie': ['connect.sid=post; Path=/'] } };
    if (url.pathname.endsWith('/status')) return { status: 200, url: responseUrl || request.url, body: {
      authenticated: true, loginProvider: 'pingone_sso', oauthProvider: 'pingone', oauthIssuer: BASE.expectedIssuer,
      user: { providerSubject: BASE.expectedSubject }, ...status,
    } };
    if (url.pathname === '/api/accounts/my') return { status: 200, body: { accounts: [] } };
    throw new Error('Unexpected protocol step');
  };
  return { calls, transport };
}

test('fresh PingOne flow verifies provider, issuer and subject and retains only private session access', async () => {
  const { calls, transport } = pingOneTransport();
  const handle = await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport });
  expect(handle).toMatchObject({ authenticated: true, provider: 'pingone' });
  expect(JSON.stringify(handle)).not.toMatch(/private-(?:code|state|user|password|subject)|connect\.sid/);
  expect(calls.map(call => new URL(call.url).pathname)).toEqual([
    '/api/auth/oauth/user/login', '/env/as/authorize', '/env/flows/flow-one', '/env/as/resume',
    '/api/auth/oauth/user/callback', '/api/auth/oauth/user/status',
  ]);
  expect(calls[2].headers.Cookie).toBe('flow=one');
  expect(calls[4].headers.Cookie).toBe('connect.sid=pre');
  expect(calls[5].headers.Cookie).toBe('connect.sid=post');
  const reply = await handle.request('/api/accounts/my');
  expect(reply.status).toBe(200);
  handle.dispose();
  await expect(handle.request('/api/accounts/my')).rejects.toThrow('disposed');
});

test.each([
  ['provider', { oauthProvider: 'pingfederate' }],
  ['issuer', { oauthIssuer: 'https://other.example.test' }],
  ['subject', { user: { providerSubject: 'other-subject' } }],
  ['authentication', { authenticated: false }],
])('rejects mismatched %s without returning a handle', async (_label, status) => {
  const { transport } = pingOneTransport({ status });
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport })).rejects.toThrow('verification');
});

test('rejects a callback on another origin before sending a code', async () => {
  const { calls, transport } = pingOneTransport({ callback: 'https://other.example.test/api/auth/oauth/user/callback?code=private-code' });
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport })).rejects.toThrow('origin');
  expect(calls.some(call => new URL(call.url).pathname.endsWith('/callback'))).toBe(false);
});

test('accepts the PingOne sign-on page on another host and still posts credentials only to the authorize origin', async () => {
  const { calls, transport: inner } = pingOneTransport();
  // Real PingOne: auth.pingone.com/<env>/as/authorize -> apps.pingone.com/<env>/signon/?flowId=…
  const transport = async (request) => (new URL(request.url).pathname.endsWith('/authorize')
    ? { status: 302, headers: { location: 'https://apps.example.test/env/signon/?flowId=flow-one' } }
    : inner(request));
  const handle = await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport });
  expect(handle.authenticated).toBe(true);
  const hosts = calls.map(call => new URL(call.url).host);
  expect(hosts).not.toContain('apps.example.test');
  expect(calls.find(call => call.body?.password).url).toBe('https://auth.example.test/env/flows/flow-one');
});

test('accepts a required agreement once on the flow URL, then completes', async () => {
  const { calls, transport: inner } = pingOneTransport();
  const flow = 'https://auth.example.test/env/flows/flow-one';
  const transport = async (request) => {
    if (request.url !== flow) return inner(request);
    calls.push(request);
    return request.body?.accept === true
      ? { status: 200, body: { status: 'COMPLETED' } }
      : { status: 200, body: { status: 'AGREEMENT_CONSENT_REQUIRED', _links: { 'agreement.accept': { href: flow } } } };
  };
  const handle = await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport });
  expect(handle.authenticated).toBe(true);
  const consent = calls.find(call => call.body?.accept === true);
  expect(consent.headers['Content-Type']).toBe('application/vnd.pingidentity.user.consent+json');
});

test('does not accept an agreement whose accept link is on another URL', async () => {
  const { transport: inner } = pingOneTransport();
  const transport = async (request) => (request.url === 'https://auth.example.test/env/flows/flow-one'
    ? { status: 200, body: { status: 'AGREEMENT_CONSENT_REQUIRED', _links: { 'agreement.accept': { href: 'https://other.example.test/env/flows/flow-one' } } } }
    : inner(request));
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport })).rejects.toThrow('protocol');
});

test('drops the BFF login_hint so the provider signs in the lane identity, not the demo user', async () => {
  const { calls, transport: inner } = pingOneTransport();
  const transport = async (request) => (new URL(request.url).pathname.endsWith('/login')
    ? { status: 302, headers: { location: 'https://auth.example.test/env/as/authorize?client_id=c&login_hint=demouser&state=s', 'set-cookie': ['connect.sid=pre; Path=/'] } }
    : inner(request));
  await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport });
  const authorize = new URL(calls.find(call => new URL(call.url).pathname.endsWith('/authorize')).url);
  expect(authorize.searchParams.has('login_hint')).toBe(false);
  expect(authorize.searchParams.get('client_id')).toBe('c');
  expect(authorize.searchParams.get('state')).toBe('s');
});

test('rejects a non-HTTPS sign-on redirect', async () => {
  const { transport: inner } = pingOneTransport();
  const transport = async (request) => (new URL(request.url).pathname.endsWith('/authorize')
    ? { status: 302, headers: { location: 'http://apps.example.test/env/signon/?flowId=flow-one' } }
    : inner(request));
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport })).rejects.toThrow('origin');
});

test('rejects a redirected status response from another origin', async () => {
  const { transport } = pingOneTransport({ responseUrl: 'https://other.example.test/status' });
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport })).rejects.toThrow('origin');
});

test('new sessions start without cookies and cannot fall back to a cached login', async () => {
  const first = pingOneTransport();
  const handle = await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport: first.transport });
  const second = pingOneTransport({ status: { authenticated: false } });
  await expect(createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingone', transport: second.transport })).rejects.toThrow('verification');
  expect(first.calls[0].headers.Cookie).toBeUndefined();
  expect(second.calls[0].headers.Cookie).toBeUndefined();
  handle.dispose();
});

test.each(['identityRef', 'username', 'password', 'expectedIssuer', 'expectedSubject'])(
  'rejects non-string %s before starting HTTP', async field => {
    const { calls, transport } = pingOneTransport();
    await expect(createDemoReadinessProviderLoginClient({ ...BASE, [field]: { value: 'wrong-type' }, provider: 'pingone', transport }))
      .rejects.toThrow('configuration');
    expect(calls).toHaveLength(0);
  }
);

test.each([false, true])('PingFederate hosted form completes with consent=%s', async consent => {
  const calls = [];
  const transport = async request => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/login')) return { status: 302, headers: { location: 'https://pf.example.test/as/authorization.oauth2', 'set-cookie': ['connect.sid=pre; Path=/'] } };
    if (path.endsWith('/authorization.oauth2')) return { status: 200, headers: { 'set-cookie': ['pf=one; Path=/'] }, body: '<form action="/as/login/resume"><input name="pf.username"><input name="pf.pass"><input name="cSRFToken" value="csrf-private"></form>' };
    if (path.endsWith('/login/resume')) return consent
      ? { status: 200, body: '<form action="/as/consent/resume"><input name="scope" value="openid"><input name="cSRFToken" value="csrf-private"><input name="pf.oauth.authz.consent"></form>' }
      : { status: 302, headers: { location: CALLBACK } };
    if (path.endsWith('/consent/resume')) return { status: 302, headers: { location: CALLBACK } };
    if (path.endsWith('/callback')) return { status: 302, headers: { location: `${BFF}/dashboard`, 'set-cookie': ['connect.sid=post; Path=/'] } };
    if (path.endsWith('/status')) return { status: 200, body: { authenticated: true, loginProvider: 'pingfederate', oauthProvider: 'pingfederate', oauthIssuer: BASE.expectedIssuer, user: { providerSubject: BASE.expectedSubject } } };
    throw new Error('Unexpected protocol step');
  };
  const handle = await createDemoReadinessProviderLoginClient({ ...BASE, provider: 'pingfederate', transport });
  expect(handle.provider).toBe('pingfederate');
  expect(calls.find(call => call.url.endsWith('/as/login/resume')).body).toContain('pf.username=private-user');
  expect(calls.find(call => call.url.endsWith('/as/login/resume')).headers.Cookie).toBe('pf=one');
  expect(calls.some(call => call.url.endsWith('/as/consent/resume'))).toBe(consent);
  handle.dispose();
});
