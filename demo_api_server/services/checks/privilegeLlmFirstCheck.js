'use strict';

/**
 * ff_privilege_llm_first posture: when the flag is ON, prove the Privilege
 * gateway lane actually answers (or denies by policy — a denial IS the gate
 * working). The sidecar agents' posture (AGENT_LLM_BASE_URL) is compose env the
 * BFF cannot see — scripts/check-privilege-first-env.test.js pins that side.
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
    try {
      await callPrivilegeGemini([{ role: 'user', content: 'reply READY' }]);
      return { status: 'pass', detail: 'Privilege Gemini lane answered' };
    } catch (err) {
      if (err.code !== 'llm_policy_denied') {
        return { status: 'fail', detail: `Privilege LLM lane unreachable: ${err.message}` };
      }
      return { status: 'pass', detail: 'Privilege denied by policy (gate is live)' };
    }
  },
};

register(check);
module.exports = { check };
