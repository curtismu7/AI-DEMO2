/**
 * Host-side: build the A2A/authorize SOT and write it into secrets.vault.
 * Reads live config from demo_api_server/.env + scope-topology.json.
 * Usage: node .claude/tmp/host-sot-write.js
 */
const { openVault } = require('/Users/cmuir/Development/AI-DEMO2/demo_api_server/lib/vault/index.js');
const fs = require('fs');

const REPO = '/Users/cmuir/Development/AI-DEMO2';

function envOf(name) {
  const m = fs.readFileSync(REPO + '/demo_api_server/.env', 'utf8').match(new RegExp('^' + name + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
}

(async () => {
  const topo = JSON.parse(fs.readFileSync(REPO + '/scope-topology.json', 'utf8'));
  const intermediates = {};
  for (const [name, r] of Object.entries(topo.resources)) {
    if (/^Super Banking A2A Intermediate - /.test(name) && r.uri) {
      const vertical = name.replace('Super Banking A2A Intermediate - ', '')
        .replace(' Specialist', '')
        .replace(' Investment Advisor', 'investment')
        .replace(' Passenger Records', 'airlines')
        .toLowerCase();
      intermediates[vertical] = r.uri;
    }
  }
  // canonical vertical names from the .env list (airlines = passenger resource)
  const envIntermediates = {};
  for (const line of fs.readFileSync(REPO + '/demo_api_server/.env', 'utf8').split('\n')) {
    const m = line.match(/^A2A_INTERMEDIATE_AUDIENCE_([A-Z]+)=(.*)$/);
    if (m) envIntermediates[m[1].toLowerCase()] = m[2].trim();
  }

  const sot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    provider: 'pingone',
    generalist: {
      name: 'PingOne AI Agent (generalist / agent1)',
      clientId: '0b412e8b-cfbc-4c7d-a773-0d46118de09d',
      actorScope: 'agent:invoke',
      ccAuthMethod: 'post',
      exchangeAuthMethod: 'post',
      secretVaultKey: 'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET',
    },
    exchange1: {
      summary: 'user token (subject) + generalist CC token (actor) -> generalist client mints hop bearer, act={sub: generalist}',
      exchanger: 'generalist',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      actorTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      expectedActDepth: 1,
      scopePrefix: 'agent:invoke:<appKey>',
    },
    exchange2: {
      summary: 'hop bearer (subject) + specialist CC token (actor) -> specialist client mints gateway bearer, act depth 2',
      exchanger: 'specialist',
      expectedActDepth: 2,
      audience: 'mcpgateway-a2a.ping.demo',
      scope: 'pnr:read',
    },
    bearerGate: {
      file: 'demo_api_server/middleware/a2aPingOneBearer.js verifyA2aBearer',
      checksInOrder: [
        '1 signature/issuer/exp via PingOne JWKS',
        '2 aud == specialist intermediate audience',
        '3 scope agent:invoke:<appKey>',
        '4 act chain depth exactly 1',
        '5 act.sub == generalist clientId',
        '6 a2aTenantId claim present',
      ],
      requiredActDepth: 1,
      actorMustBe: 'generalist',
      tenantClaim: 'a2aTenantId',
    },
    audiences: {
      agentGateway: 'agentgateway.ping.demo',
      mcpGateway: 'mcpgateway.ping.demo',
      a2aGateway: 'mcpgateway-a2a.ping.demo',
      mcpServer: 'mcpserver.ping.demo',
      intermediates: envIntermediates,
      topLevelology: intermediates,
    },
    gatewayResourceUriAllowlist: [
      'mcpgateway.ping.demo',
      'https://api.ping.demo:3036/mcp',
      'mcpgateway-a2a.ping.demo',
      'mcpserver.ping.demo',
    ],
    specialistAuth: {
      ccAuthMethodDefault: 'post',
      exchangeAuthMethodDefault: 'post',
      note: 'Per-specialist overrides: config keys pingone_<appKey>_agent_cc_auth_method / _agent_exchange_auth_method; secrets in vault: PINGONE_A2A_<APPKEY>_AGENT_CLIENT_SECRET',
    },
    issuer: 'https://auth.pingone.com/' + envOf('PINGONE_ENVIRONMENT_ID'),
    repair: {
      resourceAudienceScript: 'scripts/pingone/fix-a2a-resource-audience.js',
      criticalNote: 'PATCH /resources/{id} lies with a 403 on this entity — use PUT with the full object {name, description, type, audience}',
      providerFlipNote: 'oauth_provider=pingfederate breaks A2A (PF tokens carry no act claim -> bearer gate depth-0). Reset: configStore.setRaw({oauth_provider:"pingone"}) + BFF restart',
    },
  };

  const body = JSON.stringify(sot, null, 2);
  const vault = await openVault(REPO + '/secrets.vault', envOf('VAULT_PASSWORD'), { caller: 'host-sot-write' });
  vault.set('A2A_AUTHORIZE_SOT', body);
  await vault.save();
  const check = JSON.parse(vault.read('A2A_AUTHORIZE_SOT'));
  console.log('HWRITTEN bytes=' + body.length + ' ints=' + Object.keys(check.audiences.intermediates).length + ' ver=' + check.version);
  vault.close();
  process.exit(0);
})().catch(function (e) { console.log('HERR ' + e.message); process.exit(1); });
