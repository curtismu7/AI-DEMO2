#!/usr/bin/env node
'use strict';
/**
 * Configure a fresh PingFederate as "Acme Corp", an OUTSIDE company's IdP that issues
 * ID-JAGs to our resource authorization servers. Used to test the bring-your-own-IdP
 * path with an IdP that shares nothing with ours. Idempotent: existing objects are kept.
 *
 *   kubectl -n ping-devops-cmuir port-forward svc/pingfederate-admin 29999:9999 &
 *   node scripts/pingfederate/configure-acme-idp.js
 *
 * Options: --ns=ping-devops-cmuir --port=29999 --host=cmuir-pf-acme.ping-devops.com
 *          --oauth-mcp=https://cmuir-mcp.ping-devops.com   (our oauth-mcp issuer = ID-JAG aud)
 *          --pf=https://cmuir-pf.ping-devops.com            (our SE PingFederate issuer = ID-JAG aud)
 * Secrets (env, else demo_api_server/.env; never printed):
 *   OUTSIDE_IDP_USER_PASSWORD  password of the test user acme-user
 *   OUTSIDE_IDP_CLIENT_SECRET  secret of the acme-agent client
 * The admin password comes from the pingfederate-admin secret in --ns.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const NS = args.ns || 'ping-devops-cmuir';
const PORT = args.port || '29999';
const HOST = args.host || 'cmuir-pf-acme.ping-devops.com';
const OAUTH_MCP = args['oauth-mcp'] || 'https://cmuir-mcp.ping-devops.com';
const OUR_PF = args.pf || 'https://cmuir-pf.ping-devops.com';
const SCOPE = 'mcp:invoke accounts:read read';

function secret(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(__dirname, '../../demo_api_server/.env');
  const line = fs.existsSync(envFile) && fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) { console.error(`set ${name} (env or demo_api_server/.env)`); process.exit(2); }
  return line.slice(name.length + 1).trim();
}

const adminPw = Buffer.from(execFileSync('kubectl', ['-n', NS, 'get', 'secret', 'pingfederate-admin', '-o', 'jsonpath={.data.password}']).toString(), 'base64').toString();
const agent = new https.Agent({ rejectUnauthorized: false }); // port-forwarded admin API, self-signed

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(`https://localhost:${PORT}/pf-admin-api/v1${p}`, {
      method, agent,
      headers: { Authorization: `Basic ${Buffer.from(`administrator:${adminPw}`).toString('base64')}`, 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json' },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { let j = null; try { j = out ? JSON.parse(out) : null; } catch { j = out; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let failed = false;
function report(what, r) {
  const ok = r.status >= 200 && r.status < 300;
  if (!ok) failed = true;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: HTTP ${r.status} ${JSON.stringify(r.body?.validationErrors || r.body?.message || r.body)}`}`);
}
/** Create unless GET finds it. */
async function ensure(what, getPath, postPath, body) {
  const have = await api('GET', getPath);
  if (have.status === 200) { console.log(`  keep ${what}`); return; }
  report(`create ${what}`, await api('POST', postPath, body));
}

const acceptAll = (m) => ({ attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, ...m });

(async () => {
  console.log(`[acme] configuring https://${HOST} (admin via localhost:${PORT}, ns ${NS})`);

  const lic = await api('GET', '/license/agreement');
  if (lic.body?.accepted === false) report('accept license agreement', await api('PUT', '/license/agreement', { accepted: true }));

  const ss = await api('GET', '/serverSettings');
  if (ss.body?.federationInfo?.baseUrl !== `https://${HOST}`) {
    ss.body.federationInfo.baseUrl = `https://${HOST}`;
    ss.body.federationInfo.saml2EntityId = ss.body.federationInfo.saml2EntityId || 'acme-pf';
    report('base URL (issuer)', await api('PUT', '/serverSettings', ss.body));
  } else console.log('  keep base URL');

  const as = await api('GET', '/oauth/authServerSettings');
  const have = new Set((as.body.scopes || []).map((s) => s.name));
  const want = ['offline_access', 'mcp:invoke', 'accounts:read', 'read', 'write', 'transfer'].filter((s) => !have.has(s));
  if (want.length) {
    as.body.scopes = [...(as.body.scopes || []), ...want.map((name) => ({ name, description: name, dynamic: false }))];
    report(`scopes ${want.join(' ')}`, await api('PUT', '/oauth/authServerSettings', as.body));
  } else console.log('  keep scopes');

  const pw = secret('OUTSIDE_IDP_USER_PASSWORD');
  await ensure('user store acmeUsers (acme-user)', '/passwordCredentialValidators/acmeUsers', '/passwordCredentialValidators', {
    id: 'acmeUsers', name: 'Acme users', pluginDescriptorRef: { id: 'org.sourceid.saml20.domain.SimpleUsernamePasswordCredentialValidator' },
    configuration: { fields: [], tables: [{ name: 'Users', rows: [{ defaultRow: false, fields: [
      { name: 'Username', value: 'acme-user' }, { name: 'Password', value: pw }, { name: 'Confirm Password', value: pw },
      { name: 'Relax Password Requirements', value: 'false' }] }] }] },
  });

  await ensure('access token manager acmeAtm', '/oauth/accessTokenManagers/acmeAtm', '/oauth/accessTokenManagers', {
    id: 'acmeAtm', name: 'Acme access tokens',
    pluginDescriptorRef: { id: 'org.sourceid.oauth20.token.plugin.impl.ReferenceBearerAccessTokenManagementPlugin' },
    configuration: { fields: [], tables: [] }, attributeContract: { extendedAttributes: [{ name: 'username' }] },
  });

  await ensure('password-grant mapping', '/oauth/resourceOwnerCredentialsMappings/acmeUsers', '/oauth/resourceOwnerCredentialsMappings', acceptAll({
    id: 'acmeUsers', passwordValidatorRef: { id: 'acmeUsers' },
    attributeContractFulfillment: { USER_KEY: { source: { type: 'PASSWORD_CREDENTIAL_VALIDATOR' }, value: 'username' } },
  }));

  await ensure('default access token mapping', '/oauth/accessTokenMappings/default%7CacmeAtm', '/oauth/accessTokenMappings', acceptAll({
    context: { type: 'DEFAULT' }, accessTokenManagerRef: { id: 'acmeAtm' },
    attributeContractFulfillment: { username: { source: { type: 'OAUTH_PERSISTENT_GRANT' }, value: 'USER_KEY' } },
  }));

  await ensure('refresh token processor acmeRefreshToken', '/idp/tokenProcessors/acmeRefreshToken', '/idp/tokenProcessors', {
    id: 'acmeRefreshToken', name: 'Acme refresh token processor',
    pluginDescriptorRef: { id: 'org.sourceid.wstrust.processor.oauth.RefreshTokenTokenProcessor' },
    configuration: { fields: [], tables: [] },
    attributeContract: { coreAttributes: ['expires_at', 'scope', 'TOKEN_SUBJECT', 'client_id'].map((name) => ({ name, masked: true })), extendedAttributes: [] },
  });

  const fromSubject = (v) => ({ source: { type: 'SUBJECT_TOKEN' }, value: v });
  await ensure('ID-JAG exchange policy acmeIdJagPolicy', '/oauth/tokenExchange/processor/policies/acmeIdJagPolicy', '/oauth/tokenExchange/processor/policies', {
    id: 'acmeIdJagPolicy', name: 'Acme ID-JAG refresh exchange', actorTokenRequired: false,
    attributeContract: { coreAttributes: [{ name: 'subject' }], extendedAttributes: ['expires_at', 'scope', 'TOKEN_SUBJECT', 'client_id'].map((name) => ({ name })) },
    processorMappings: [acceptAll({
      subjectTokenType: 'urn:ietf:params:oauth:token-type:refresh_token', subjectTokenProcessor: { id: 'acmeRefreshToken' },
      actorTokenType: '', actorTokenProcessor: {},
      attributeContractFulfillment: { subject: fromSubject('TOKEN_SUBJECT'), TOKEN_SUBJECT: fromSubject('TOKEN_SUBJECT'),
        expires_at: fromSubject('expires_at'), scope: fromSubject('scope'), client_id: fromSubject('client_id') },
    })],
  });
  const tes = await api('GET', '/oauth/tokenExchange/processor/settings');
  if (tes.body?.defaultProcessorPolicyRef?.id !== 'acmeIdJagPolicy') {
    report('default exchange policy', await api('PUT', '/oauth/tokenExchange/processor/settings', { defaultProcessorPolicyRef: { id: 'acmeIdJagPolicy' } }));
  }

  await ensure('client acme-agent', '/oauth/clients/acme-agent', '/oauth/clients', {
    clientId: 'acme-agent', name: 'Acme agent (outside company)', enabled: true,
    grantTypes: ['RESOURCE_OWNER_CREDENTIALS', 'REFRESH_TOKEN', 'TOKEN_EXCHANGE'],
    clientAuth: { type: 'SECRET', secret: secret('OUTSIDE_IDP_CLIENT_SECRET') },
    defaultAccessTokenManagerRef: { id: 'acmeAtm' }, tokenExchangeProcessorPolicyRef: { id: 'acmeIdJagPolicy' },
    restrictScopes: false, bypassApprovalPage: true,
  });

  // Acme's own ID-JAG signing key (published in its /pf/JWKS).
  const keys = await api('GET', '/keyPairs/signing');
  if (!(keys.body?.items || []).some((k) => k.id === 'acmeIdJagSigning')) {
    report('signing key acmeIdJagSigning', await api('POST', '/keyPairs/signing/generate', {
      id: 'acmeIdJagSigning', commonName: 'Acme ID-JAG signing', organization: 'Acme Corp (demo)', country: 'US',
      validDays: 730, keyAlgorithm: 'RSA', keySize: 2048, signatureAlgorithm: 'SHA256withRSA',
    }));
  } else console.log('  keep signing key');

  // One ID-JAG SP connection per resource AS we trust Acme towards. resource selects the
  // connection; the entity id becomes the ID-JAG aud; client_id is the client at THAT AS.
  const spConnection = (id, name, entityId, resource, clientId) => ({
    type: 'SP', id, name, entityId, active: true, loggingMode: 'STANDARD', virtualEntityIds: [], connectionTargetType: 'STANDARD',
    credentials: { certs: [], signingSettings: { signingKeyPairRef: { id: 'acmeIdJagSigning' }, algorithm: 'SHA256withRSA', includeCertInSignature: false, includeRawKeyInSignature: false } },
    oauthTokenExchangeSettings: {
      resourceUris: [resource], minutesBefore: 5, minutesAfter: 30, idJagEnabled: true,
      attributeContract: { coreAttributes: [{ name: 'TOKEN_SUBJECT' }], extendedAttributes: [{ name: 'client_id' }, { name: 'scope' }] },
      processorPolicyMappings: [acceptAll({
        processorPolicyRef: { id: 'acmeIdJagPolicy' },
        attributeContractFulfillment: {
          TOKEN_SUBJECT: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'TOKEN_SUBJECT' },
          client_id: { source: { type: 'TEXT' }, value: clientId },
          scope: { source: { type: 'TEXT' }, value: SCOPE },
        },
      })],
    },
  });
  await ensure(`SP connection to our oauth-mcp (aud ${OAUTH_MCP})`, '/idp/spConnections/acmeToOauthMcp', '/idp/spConnections',
    spConnection('acmeToOauthMcp', 'ID-JAG to Ping demo oauth-mcp', OAUTH_MCP, `${OAUTH_MCP}/mcp`, 'acme-agent'));
  await ensure(`SP connection to our PingFederate (aud ${OUR_PF})`, '/idp/spConnections/acmeToPingFed', '/idp/spConnections',
    spConnection('acmeToPingFed', 'ID-JAG to Ping demo PingFederate', OUR_PF, 'https://api.ping.demo:3036/mcp', 'ai-demo-pf-idjag-redeemer'));

  console.log(failed ? '[acme] finished with failures' : `[acme] done. Issuer https://${HOST}, JWKS https://${HOST}/pf/JWKS`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(`[acme] ${err.message}`); process.exit(1); });
