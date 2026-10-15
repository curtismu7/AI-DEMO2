'use strict';
const configStore = require('./configStore');

// PingOne resource attribute that makes `act` an RFC 8693 OBJECT. A bare ${..client_id} yields a
// string; JSON text containing ${} is not evaluated; #{..} is emitted literally (proven 2026-10-14).
const OBO_ACT_SPEL = "${{'client_id': #root.context.requestData.actorToken.client_id}}";

function getOboConfig() {
  const envId = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const issuer = `https://auth.pingone.${region}/${envId}/as`;
  const inbound = process.env.OBO_INBOUND_AUDIENCES || process.env.MCP_GW_RESOURCE_URI || 'mcpgateway.ping.demo';
  return {
    audience: process.env.OBO_AUDIENCE || 'obo-demo.ping.demo',
    scope: process.env.OBO_SCOPE || 'obo:invoke',
    actorScope: 'agent:invoke',
    issuer,
    jwksUri: `${issuer}/jwks`,
    inboundAudiences: inbound.split(',').map((s) => s.trim()).filter(Boolean),
    exchanger: {
      id: configStore.getEffective('pingone_token_exchanger_client_id'),
      secret: configStore.getEffective('pingone_token_exchanger_client_secret'),
    },
    agent: {
      id: configStore.getEffective('pingone_ai_agent_actor_client_id'),
      secret: configStore.getEffective('pingone_ai_agent_actor_client_secret'),
    },
  };
}

module.exports = { getOboConfig, OBO_ACT_SPEL };
