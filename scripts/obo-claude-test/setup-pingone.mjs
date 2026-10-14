// Creates the temporary "OBO Test" PingOne resource and grants its scope to the Token Exchanger app.
// Run: node setup-pingone.mjs            (create)
//      node setup-pingone.mjs --delete   (remove the resource again)
// Reads worker creds from demo_api_server/.env (override with OBO_ENV_FILE).
import fs from 'node:fs';

const ENV_FILE = process.env.OBO_ENV_FILE || '/Users/cmuir/Development/AI-DEMO2/demo_api_server/.env';
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const E = env.PINGONE_ENVIRONMENT_ID, R = env.PINGONE_REGION;
const ACT_SPEL = process.env.OBO_ACT_SPEL || '${#root.context.requestData.actorToken.client_id}';

const t = await (await fetch(`https://auth.pingone.${R}/${E}/as/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${env.PINGONE_WORKER_CLIENT_ID}:${env.PINGONE_WORKER_CLIENT_SECRET}`).toString('base64') },
  body: 'grant_type=client_credentials',
})).json();
const h = { authorization: 'Bearer ' + t.access_token, 'content-type': 'application/json' };
const api = `https://api.pingone.${R}/v1/environments/${E}`;
const call = async (method, p, b) => {
  const r = await fetch(api + p, { method, headers: h, body: b && JSON.stringify(b) });
  const j = r.status === 204 ? {} : await r.json();
  console.log(method, p, r.status, r.ok ? '' : JSON.stringify(j).slice(0, 300));
  if (!r.ok) process.exit(1);
  return j;
};

const existing = (await call('GET', '/resources')) ._embedded.resources.find((x) => x.name === 'OBO Test');
if (process.argv.includes('--delete')) {
  if (existing) await call('DELETE', `/resources/${existing.id}`);
  process.exit(0);
}
if (existing) await call('DELETE', `/resources/${existing.id}`); // leftover from an earlier run; this script owns it

const res = await call('POST', '/resources', { name: 'OBO Test', description: 'Temporary OBO delegation test (scripts/obo-claude-test). Safe to delete.', type: 'CUSTOM', audience: 'obo-test.ping.demo', accessTokenValiditySeconds: 900 });
const sc = await call('POST', `/resources/${res.id}/scopes`, { name: 'obo:invoke', description: 'OBO test' });
await call('POST', `/resources/${res.id}/attributes`, { name: 'act', value: ACT_SPEL, type: 'CUSTOM' });
await call('POST', `/applications/${env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID}/grants`, { resource: { id: res.id }, scopes: [{ id: sc.id }] });
console.log('created resource', res.id);
