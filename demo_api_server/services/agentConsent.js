'use strict';
// The user's "this agent may act for me" consent. Default: a server-side grant record
// (delegationStore), so the token carries only `act`. ff_may_act_seed ON (legacy) also honors
// the `may_act` claim from the user's token.
const configStore = require('./configStore');
const delegationStore = require('./lmdb/delegationStore.lmdb');

const legacyMayAct = () => String(configStore.getEffective('ff_may_act_seed') || 'false') === 'true';

function agentClientId() {
  return (
    configStore.getEffective('ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_actor_client_id') ||
    process.env.AI_AGENT_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID ||
    null
  );
}

const userIds = (req) => [req?.user?.id, req?.session?.user?.oauthId, req?.session?.user?.id].filter(Boolean);

function hasGrant(req) {
  const agent = agentClientId();
  return !!agent && userIds(req).some((id) => delegationStore.findActiveByActorAndGrantor(agent, id));
}

// Consented agent client id for this request's user: '' = none, undefined = no identified user (legacy callers).
function consentSub(req) {
  if (!req?.session || !userIds(req).length) return undefined;
  if (hasGrant(req)) return agentClientId();
  if (legacyMayAct()) return (req.session.mayAct && req.session.mayAct.sub) || '';
  return '';
}

module.exports = { agentClientId, consentSub, hasGrant, legacyMayAct };
