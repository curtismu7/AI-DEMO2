'use strict';

const { runReadiness, targets } = require('../services/cimdReadinessService');

const BASE = 'https://app.example.test';
const DOC_URL = `${BASE}/api/cimd/privilege/privilege-mcp-client/client-metadata.json`;
const CALLBACK = `${BASE}/api/privilege-mcp/auth/callback`;
const AS_URL = 'https://gw.example.test/app/.well-known/oauth-authorization-server';
const ENV = { PUBLIC_APP_URL: BASE, PRIVILEGE_CIMD_AS_METADATA_URL: AS_URL };

const goodAs = { client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['client_secret_post', 'none'] };
const goodDoc = {
  client_id: DOC_URL,
  client_name: 'AI Demo Privilege MCP Client',
  redirect_uris: [CALLBACK],
  grant_types: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_method: 'none'
};

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const fetchFor = (map) => jest.fn(async (url) => {
  const hit = map[url];
  if (hit instanceof Error) throw hit;
  return hit || reply({}, 404);
});
const byId = (result, id) => result.checks.find((c) => c.id === id);

describe('cimdReadinessService', () => {
  test('targets come from config only, and are empty without PUBLIC_APP_URL', () => {
    expect(targets(ENV)).toEqual({ asMetadataUrl: AS_URL, documentUrl: DOC_URL, callbackUrl: CALLBACK });
    expect(targets({}).documentUrl).toBeNull();
  });

  test('everything correct passes', async () => {
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply(goodDoc) }) });
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.pass)).toBe(true);
  });

  test('a gateway that does not advertise support fails that check only', async () => {
    const as = { ...goodAs, client_id_metadata_document_supported: undefined };
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(as), [DOC_URL]: reply(goodDoc) }) });
    expect(result.ok).toBe(false);
    expect(byId(result, 'as_supports_cimd').pass).toBe(false);
    expect(byId(result, 'doc_client_id').pass).toBe(true);
  });

  test('a document whose client_id is not its own URL fails', async () => {
    const doc = { ...goodDoc, client_id: 'https://elsewhere.example.test/doc.json' };
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply(doc) }) });
    expect(byId(result, 'doc_client_id').pass).toBe(false);
  });

  test('a document that omits this client\'s callback fails: the redirect Privilege would refuse', async () => {
    const doc = { ...goodDoc, redirect_uris: [`${BASE}/api/external-agents/callback`] };
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply(doc) }) });
    expect(byId(result, 'doc_redirect').pass).toBe(false);
    expect(byId(result, 'doc_redirect').detail).toContain(CALLBACK);
  });

  test('a document that claims a client secret method is not a public client', async () => {
    const doc = { ...goodDoc, token_endpoint_auth_method: 'client_secret_basic' };
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply(doc) }) });
    expect(byId(result, 'doc_public_client').pass).toBe(false);
  });

  test('a sign-in redirect (302) on the document is reported as such, not followed', async () => {
    const result = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply('', 302) }) });
    expect(byId(result, 'doc_fetch')).toMatchObject({ pass: false, detail: 'HTTP 302' });
  });

  test('unreachable, non-JSON and oversized responses fail with a reason', async () => {
    const down = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: new Error('ECONNREFUSED'), [DOC_URL]: reply(goodDoc) }) });
    expect(byId(down, 'as_metadata')).toMatchObject({ pass: false, detail: 'could not connect' });
    const html = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply(goodAs), [DOC_URL]: reply('<html></html>') }) });
    expect(byId(html, 'doc_fetch')).toMatchObject({ pass: false, detail: 'response is not JSON' });
    const big = await runReadiness({ env: ENV, fetchImpl: fetchFor({ [AS_URL]: reply('x'.repeat(70 * 1024)), [DOC_URL]: reply(goodDoc) }) });
    expect(byId(big, 'as_metadata')).toMatchObject({ pass: false, detail: 'response larger than 64 KB' });
  });

  test('without PUBLIC_APP_URL the document check says so and no document fetch is attempted', async () => {
    const fetchImpl = fetchFor({ [AS_URL]: reply(goodAs) });
    const result = await runReadiness({ env: { PRIVILEGE_CIMD_AS_METADATA_URL: AS_URL }, fetchImpl });
    expect(byId(result, 'doc_fetch').detail).toMatch(/PUBLIC_APP_URL/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
