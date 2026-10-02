#!/usr/bin/env node
'use strict';

/**
 * Provision the PingOne resource a customer's WORKLOAD agent exchanges against
 * (UC38 / UC44), so the exchanged token names the agent that actually acted.
 *
 * On the shared Agent Gateway resource `act` is `${subjectToken.may_act}` — the
 * user's authorized agent, which is the built-in AI Agent. A workload agent's
 * run was therefore recorded under the built-in agent. This resource mints
 * `act` from the actor token instead, and leaves the shared resource alone.
 *
 * Dry run by default; `--apply` writes. Run inside the BFF container, which has
 * the management credentials:
 *   docker exec ai-demo-api-server node scripts/provision-workload-agent-gateway.js [--apply] [--agent <appId>]...
 *
 * It creates or updates only:
 *   - the resource (audience WORKLOAD_AGENT_GATEWAY_AUDIENCE, default below)
 *   - its scopes, copied by name from the Agent Gateway resource
 *   - its `act` and `may_act` attributes
 *   - for each `--agent <appId>` that Agent Builder created: that app's grant,
 *     moved from the Agent Gateway resource to this one (PingOne allows a scope
 *     name on only one of an app's grants)
 * Prints no secrets.
 */

const axios = require('axios');
const configStore = require('../services/configStore');
const { getManagementToken } = require('../services/pingOneClientService');

const RESOURCE_NAME = 'Demo Workload Agent Gateway';
const DEFAULT_AUDIENCE = 'workloadgateway.ping.demo';
// The actor of this hop, taken from the actor token. Same inline-map SpEL form
// the A2A MCP Gateway composer uses (pingoneProvisionService.js).
const ACT_FROM_ACTOR = "${{'sub': #root.context.requestData.actorToken.client_id}}";
const BUILDER_MARKER = 'Created by Agent Builder for ';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const agents = args.flatMap((arg, index) => (arg === '--agent' ? [args[index + 1]] : [])).filter(Boolean);

(async () => {
  if (typeof configStore.ensureInitialized === 'function') await configStore.ensureInitialized();
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const audience = configStore.getEffective('workload_agent_gateway_audience') || DEFAULT_AUDIENCE;
  const agentGatewayAudience = configStore.getEffective('pingone_resource_agent_gateway_uri') || 'agentgateway.ping.demo';
  const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
  if (!envId || !exchangerClientId) throw new Error('PINGONE_ENVIRONMENT_ID and pingone_mcp_token_exchanger_client_id are required');

  const base = `https://api.pingone.${region}/v1/environments/${envId}`;
  const opts = { headers: { Authorization: `Bearer ${await getManagementToken()}`, 'Content-Type': 'application/json' }, timeout: 20000 };
  const get = async (path) => (await axios.get(`${base}${path}`, opts)).data;
  const write = async (method, path, body) => {
    console.log(`${apply ? 'APPLY' : 'WOULD'} ${method} ${path}${body?.name ? ` (${body.name})` : ''}`);
    return apply ? (await axios({ method, url: `${base}${path}`, data: body, ...opts })).data : null;
  };
  const embedded = (data, key) => data?._embedded?.[key] || [];

  const resources = embedded(await get('/resources?limit=200'), 'resources');
  const agentGateway = resources.find((item) => item.audience === agentGatewayAudience);
  if (!agentGateway) throw new Error(`Agent Gateway resource (${agentGatewayAudience}) not found`);
  let resource = resources.find((item) => item.audience === audience);
  if (!resource) resource = await write('POST', '/resources', { name: RESOURCE_NAME, audience, description: 'Exchange #1 audience for a customer workload agent. act names the agent that presented the actor token.', accessTokenValiditySeconds: 3600 });
  else console.log(`resource exists: ${resource.name} (${audience})`);

  const sourceScopes = embedded(await get(`/resources/${agentGateway.id}/scopes`), 'scopes');
  const haveScopes = resource ? embedded(await get(`/resources/${resource.id}/scopes`), 'scopes') : [];
  for (const scope of sourceScopes.filter((item) => !haveScopes.some((have) => have.name === item.name))) {
    if (resource) await write('POST', `/resources/${resource.id}/scopes`, { name: scope.name, description: scope.description || scope.name });
    else console.log(`WOULD POST scope ${scope.name}`);
  }

  const wanted = { act: ACT_FROM_ACTOR, may_act: JSON.stringify({ sub: exchangerClientId }) };
  const haveAttributes = resource ? embedded(await get(`/resources/${resource.id}/attributes`), 'attributes') : [];
  for (const [name, value] of Object.entries(wanted)) {
    const existing = haveAttributes.find((item) => item.name === name);
    if (existing?.value === value) { console.log(`attribute ${name} already set`); continue; }
    if (existing && resource) await write('PUT', `/resources/${resource.id}/attributes/${existing.id}`, { name, value });
    else if (resource) await write('POST', `/resources/${resource.id}/attributes`, { name, value, type: 'CUSTOM' });
    else console.log(`WOULD POST attribute ${name}`);
  }

  const targetScopes = resource ? embedded(await get(`/resources/${resource.id}/scopes`), 'scopes') : [];
  for (const appId of agents) {
    const app = await get(`/applications/${appId}`);
    if (!String(app.description || '').startsWith(BUILDER_MARKER)) throw new Error(`${appId} is not an Agent Builder app; refusing`);
    const grants = embedded(await get(`/applications/${appId}/grants`), 'grants');
    const old = grants.find((grant) => grant.resource?.id === agentGateway.id);
    const names = old ? old.scopes.map((scope) => sourceScopes.find((item) => item.id === scope.id)?.name).filter(Boolean) : ['agent:invoke', 'read'];
    const scopes = names.map((name) => targetScopes.find((item) => item.name === name)).filter(Boolean).map((item) => ({ id: item.id }));
    console.log(`${app.name}: ${names.length} scope(s) -> ${audience}`);
    if (old) await write('DELETE', `/applications/${appId}/grants/${old.id}`);
    const existing = resource && grants.find((grant) => grant.resource?.id === resource.id);
    if (resource && existing) await write('PUT', `/applications/${appId}/grants/${existing.id}`, { resource: { id: resource.id }, scopes });
    else if (resource) await write('POST', `/applications/${appId}/grants`, { resource: { id: resource.id }, scopes });
    else console.log(`WOULD grant ${names.join(' ')}`);
  }
  console.log(apply ? `done. Set WORKLOAD_AGENT_GATEWAY_AUDIENCE=${audience} on the BFF to use it.` : 'dry run: nothing was changed. Re-run with --apply.');
  process.exit(0);
})().catch((error) => { console.error('FAILED:', error.response?.status || '', error.response?.data?.message || error.message); process.exit(1); });
