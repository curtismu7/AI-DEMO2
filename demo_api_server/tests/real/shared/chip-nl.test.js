'use strict';

const axios = require('axios');
const { httpsAgent, BFF_BASE } = require('../helpers/constants');

// NL route is unauthenticated-capable — no session required
const client = axios.create({ baseURL: BFF_BASE, httpsAgent, validateStatus: () => true });

describe('Chip NL routing (real)', () => {

  it('routes "My Accounts" chip message to accounts action via heuristic', async () => {
    const r = await client.post('/api/demo-agent/nl', {
      message: 'show my accounts',
      provider: 'heuristic',
      vertical: 'banking',
    });

    expect(r.status).toBe(200);
    expect(r.data.source).toBe('heuristic');
    // banking vertical plugin returns kind:'vertical'; legacy path returns kind:'banking'
    expect(['banking', 'vertical']).toContain(r.data.result.kind);
    const action = r.data.result.banking?.action || r.data.result.action;
    expect(action).toBe('accounts');
  });

  it('routes "what did I spend money on recently" to a banking action via Helix', async () => {
    const r = await client.post('/api/demo-agent/nl', {
      message: 'what did I spend money on recently',
      provider: 'auto',
      vertical: 'banking',
    });

    expect(r.status).toBe(200);
    // Helix must answer — heuristic returns none for this phrase
    expect(['helix', 'helix_fallback']).toContain(r.data.source);
    expect(r.data.result.kind).toBe('banking');
    // LLM may return transactions or spending_summary — both are correct for this query
    expect(['transactions', 'spending_summary']).toContain(r.data.result.banking.action);
  });
});
