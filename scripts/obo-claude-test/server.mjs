// OBO test MCP server. Claude is the OAuth client; this server receives the user's token,
// exchanges it (RFC 8693, subject=user + actor=agent) and calls a downstream API with ONLY
// the exchanged token. Everything the model can see (tool results) is audited and scanned.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV_FILE = process.env.OBO_ENV_FILE || new URL('../../../AI-DEMO2/demo_api_server/.env', import.meta.url).pathname;
const env = { ...Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })), ...process.env };

const PORT = Number(env.OBO_PORT || 3099);
const SELF = `http://localhost:${PORT}`;
const BASE = `https://auth.pingone.${env.PINGONE_REGION}/${env.PINGONE_ENVIRONMENT_ID}/as`;
const TARGET_AUD = env.OBO_TARGET_AUDIENCE || env.OBO_AUDIENCE || 'mcpserver.ping.demo';
const TARGET_SCOPE = env.OBO_TARGET_SCOPE || env.OBO_SCOPE || 'server:mcp:invoke';
const INBOUND_AUDS = [`${SELF}/mcp`, 'mcpgateway.ping.demo'];
const EXCHANGER = { id: env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID, secret: env.PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET };
const AGENT = { id: env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID, secret: env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET };
const AUDIT = env.OBO_AUDIT || new URL('./audit.jsonl', import.meta.url).pathname;

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));
const audit = (e) => fs.appendFileSync(AUDIT, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');

let jwks;
async function verify(token, audiences) {
  const [h, p, s] = token.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url'));
  if (head.alg !== 'RS256') throw new Error(`alg ${head.alg}`);
  jwks ||= (await (await fetch(`${BASE}/jwks`)).json()).keys;
  const jwk = jwks.find((k) => k.kid === head.kid);
  if (!jwk || !crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  const c = claims(token);
  if (c.iss !== BASE) throw new Error(`iss ${c.iss}`);
  if (c.exp * 1000 < Date.now()) throw new Error('expired');
  if (!audiences.some((a) => [].concat(c.aud).includes(a))) throw new Error(`aud ${JSON.stringify(c.aud)}`);
  return c;
}

const form = (o) => new URLSearchParams(o);
async function tokenCall(body) {
  const r = await fetch(`${BASE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`token endpoint ${r.status}: ${j.error_description || j.error}`);
  return j.access_token;
}

// Downstream API: accepts only a delegated token (aud=TARGET_AUD with an act claim).
async function downstream(authHeader) {
  const token = (authHeader || '').replace(/^Bearer /, '');
  try {
    const c = await verify(token, [TARGET_AUD]);
    if (!c.act) throw new Error('no act claim (not a delegation token)');
    return { status: 200, body: { acting_for: c.sub, acted_by: c.act } };
  } catch (e) { return { status: 401, body: { error: e.message } }; }
}
const callDownstream = async (token) => {
  const r = await fetch(`${SELF}/downstream`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json() };
};

async function actOnMyBehalf(userToken) {
  const actor = await tokenCall({ grant_type: 'client_credentials', client_id: AGENT.id, client_secret: AGENT.secret, scope: 'agent:invoke' });
  const obo = await tokenCall({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: EXCHANGER.id, client_secret: EXCHANGER.secret,
    subject_token: userToken, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    actor_token: actor, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: TARGET_AUD, scope: TARGET_SCOPE,
  });
  const withObo = await callDownstream(obo);
  const withUser = await callDownstream(userToken); // replay of the user token must be refused
  const inC = claims(userToken), oboC = claims(obo);
  const result = { downstream_with_delegated_token: withObo, downstream_with_user_token: withUser.status, delegated_claims: { sub: oboC.sub, act: oboC.act, aud: oboC.aud, scope: oboC.scope, exp: oboC.exp } };
  const text = JSON.stringify(result, null, 2);
  const leak = /eyJ[\w-]+\.[\w-]+\.[\w-]*/.test(text) || text.includes(userToken) || text.includes(obo);
  audit({ event: 'tool_call', agent_client_id: AGENT.id,
    inbound: { sha: sha(userToken), sub: inC.sub, aud: inC.aud, client_id: inC.client_id },
    exchanged: { sha: sha(obo), sub: oboC.sub, act: oboC.act, aud: oboC.aud, scope: oboC.scope },
    downstream: { with_exchanged: withObo.status, with_user_token: withUser.status },
    tool_result_sha: sha(text), tool_result_leaks_token: leak });
  return leak ? 'withheld: result contained a token' : text;
}

const TOOLS = [{ name: 'act_on_my_behalf', description: 'Calls a downstream API on behalf of the signed-in user using a delegated (RFC 8693) token and reports who acted for whom.', inputSchema: { type: 'object', properties: {} } }];

async function rpc(msg, userToken) {
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'obo-test', version: '0.0.1' } });
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      try { return ok({ content: [{ type: 'text', text: await actOnMyBehalf(userToken) }] }); }
      catch (e) { audit({ event: 'tool_error', error: e.message }); return ok({ isError: true, content: [{ type: 'text', text: `error: ${e.message}` }] }); }
    }
    case 'ping': return ok({});
    default: return msg.id === undefined ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
  }
}

const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
    return send(res, 200, { resource: `${SELF}/mcp`, authorization_servers: [BASE], scopes_supported: ['mcp:invoke', 'read'], bearer_methods_supported: ['header'] });
  if (url.pathname === '/downstream') { const d = await downstream(req.headers.authorization); return send(res, d.status, d.body); }
  if (url.pathname !== '/mcp') return send(res, 404, { error: 'not found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const userToken = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { await verify(userToken, INBOUND_AUDS); } catch (e) {
    audit({ event: 'inbound_rejected', reason: e.message });
    return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${SELF}/.well-known/oauth-protected-resource"` });
  }
  const out = await rpc(JSON.parse(await readBody(req)), userToken);
  return out ? send(res, 200, out) : send(res, 202);
}).listen(PORT, () => console.log(`obo-test MCP listening on ${SELF}/mcp (audit: ${AUDIT})`));
