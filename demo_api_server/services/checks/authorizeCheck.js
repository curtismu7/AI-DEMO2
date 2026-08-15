'use strict';
const p1az = require('../../services/pingOneAuthorizeService');
const configStore = require('../../services/configStore');
const { register } = require('./registry');

const SMALL = { amount: 500,   type: 'transfer' };   // expect PERMIT (live policy denies anything >= $2,000)
const LARGE = { amount: 75000, type: 'transfer' };   // expect DENY / step-up
const TEST_USER = 'check-preflight-user';

const mode = {
  id: 'authorize.mode', name: 'Authorize mode', category: 'PingOne Authorize',
  severity: 'advisory',
  async run({ flags }) {
    const simulated = flags.ff_authorize_real === false;
    return {
      status: 'pass',
      detail: simulated ? 'Demo / simulated mode active' : 'Real PingOne Authorize',
      meta: { mode: simulated ? 'demo' : 'real' },
    };
  },
};

const realDecision = {
  id: 'authorize.real_decision', name: 'Real decision (force-live)', category: 'PingOne Authorize',
  severity: 'advisory',
  async run({ flags }) {
    if (!p1az.isConfigured()) {
      return { status: 'fail', detail: 'PingOne Authorize worker credentials + decision endpoint are not configured' };
    }
    const decisionEndpointId = configStore.getEffective('authorize_decision_endpoint_id') || undefined;
    const evalOne = (t) => p1az.evaluateTransaction({ decisionEndpointId, userId: TEST_USER, amount: t.amount, type: t.type });
    let decisions;
    try {
      decisions = await Promise.all([evalOne(SMALL), evalOne(LARGE)]);
    } catch (err) {
      return { status: 'fail', detail: err.message };
    }
    // decisionId isn't required — PingOne's decisionEndpoints evaluate
    // response doesn't always include one (only correlationId), and every
    // other consumer in this codebase already treats decisionId as optional
    // (`|| null`). A live decision effect is the only thing this check
    // needs to prove the real PingOne Authorize path is working.
    if (decisions.some((d) => !d || !d.decision)) {
      return { status: 'fail', detail: 'PingOne returned no decision', meta: { decisions } };
    }
    const discriminates = decisions[0].decision !== decisions[1].decision;
    const note = flags.ff_authorize_real === false ? ' (mock outage fallback active; real path verified)' : '';
    return {
      status: discriminates ? 'pass' : 'warn',
      detail: discriminates
        ? `${decisions[0].decision} / ${decisions[1].decision}${note}`
        : `Both inputs returned ${decisions[0].decision} — policy may not discriminate${note}`,
      meta: { decisions: decisions.map((d) => ({ decision: d.decision, decisionId: d.decisionId })) },
    };
  },
};

const failOpen = {
  id: 'authorize.fail_open', name: 'Fail-open awareness', category: 'PingOne Authorize',
  severity: 'advisory',
  async run({ flags }) {
    return flags.ff_authorize_fail_open === false
      ? { status: 'warn', detail: 'Fail-open is OFF — Authorize errors will hard-deny mid-demo' }
      : { status: 'pass', detail: 'Fail-open is on' };
  },
};

register(mode, realDecision, failOpen);
module.exports = { mode, realDecision, failOpen };
