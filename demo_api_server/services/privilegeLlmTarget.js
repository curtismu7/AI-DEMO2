'use strict';

// Where the Privilege MCP client's own llama.cpp calls go: direct to the local proxy
// (today's default) or through the PingOne Agent Privilege custom lane. Asking for
// Privilege when it is not configured is an error, never a silent fall-back to
// direct — a governed path that quietly stops being governed is worse than a failure.
const { LANES, resolveRoute } = require('./privilegeLlmProxyService');

const configError = (message) => Object.assign(new Error(message), { code: 'llm_not_configured' });

function privilegeLlmConfigured(env = process.env) {
  return Boolean(env.PRIVILEGE_LLM_GATEWAY_URL && env[LANES.custom.keyEnv]);
}

function llamaCppTarget({ viaPrivilege = false, direct, route, model, env = process.env }) {
  if (!viaPrivilege) {
    return {
      via: 'direct',
      url: `${direct.base}${direct.route}`,
      headers: { 'Content-Type': 'application/json' },
      model: model || undefined,
    };
  }
  const base = (env.PRIVILEGE_LLM_GATEWAY_URL || '').replace(/\/+$/, '');
  const key = env[LANES.custom.keyEnv] || '';
  if (!base) throw configError('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw configError(`${LANES.custom.keyEnv} not configured`);
  return {
    via: 'privilege',
    url: `${base}${resolveRoute('custom', route)}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    model: model || LANES.custom.defaultModel,
  };
}

module.exports = { llamaCppTarget, privilegeLlmConfigured };
