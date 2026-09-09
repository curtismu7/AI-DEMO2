'use strict';

/**
 * ff_privilege_llm_first posture: when the flag is ON, prove the Privilege
 * gateway lane actually answers (or denies by policy — a denial IS the gate
 * working), and warn when the sidecar agents still point at the local proxy
 * while the BFF has gone Privilege-first. The two are configured in different
 * places (runtime flag vs compose env), so nothing else reports them together.
 */

const { register } = require('./registry');

const check = {
  id: 'llm.privilege_first',
  name: 'Privilege-first LLM lane answers',
  category: 'LLM',
  severity: 'advisory',
  appliesWhen: (flags) => flags.ff_privilege_llm_first === true,
  async run() {
    if (!process.env.PRIVILEGE_LLM_GATEWAY_URL) {
      return { status: 'fail', detail: 'ff_privilege_llm_first is ON but PRIVILEGE_LLM_GATEWAY_URL is unset — cloud LLM calls fall back to vendor-direct' };
    }
    const { callPrivilegeGemini } = require('../privilegeLlmProxyService');
    let detail;
    try {
      await callPrivilegeGemini([{ role: 'user', content: 'reply READY' }]);
      detail = 'Privilege Gemini lane answered';
    } catch (err) {
      if (err.code !== 'llm_policy_denied') {
        return { status: 'fail', detail: `Privilege LLM lane unreachable: ${err.message}` };
      }
      detail = 'Privilege denied by policy (gate is live)';
    }
    // Read-only mirror of the sidecars' AGENT_LLM_BASE_URL (docker-compose.yml).
    const sidecar = process.env.AGENT_LLM_BASE_URL || '';
    if (!sidecar || /:8090(\/|$)/.test(sidecar)) {
      return { status: 'warn', detail: `${detail}; sidecar agents still use the local proxy (AGENT_LLM_BASE_URL) — BFF and sidecars disagree` };
    }
    return { status: 'pass', detail };
  },
};

register(check);
module.exports = { check };
