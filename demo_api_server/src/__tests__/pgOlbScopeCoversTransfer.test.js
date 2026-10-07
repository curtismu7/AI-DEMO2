'use strict';

// UC14b "PAR + RAR intent verified (PERMIT)" 403'd insufficient_scope: Exchange #3
// only narrows PG_OLB_SCOPE to the called tool's requiredScopes, so a scope missing
// from PG_OLB_SCOPE never reaches the MCP server. create_transfer needs
// [write, transfer]; PG_OLB_SCOPE lacked `transfer`, the token carried only `write`.
// Same for get_my_accounts ([accounts:read]) — the sim's account lookup was refused.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const topology = JSON.parse(fs.readFileSync(path.join(ROOT, 'scope-topology.json'), 'utf8'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const configured = {
  'ping-gateway/.env.example': read('ping-gateway/.env.example').match(/^PG_OLB_SCOPE=(.*)$/m)[1],
  'refresh-service-envs.js': read('demo_api_server/scripts/refresh-service-envs.js')
    .match(/PG_OLB_SCOPE:\s*'([^']*)'/)[1],
  // PF-issued subjects use the PF variant (olb-token-exchange.groovy); PF defines `transfer`.
  'ping-gateway/.env.example (PF)': read('ping-gateway/.env.example').match(/^PG_OLB_SCOPE_PF=(.*)$/m)[1],
  'refresh-service-envs.js (PF)': read('demo_api_server/scripts/refresh-service-envs.js')
    .match(/PG_OLB_SCOPE_PF:\s*'([^']*)'/)[1],
};

describe.each(Object.entries(configured))('PG_OLB_SCOPE in %s', (_name, value) => {
  const scopes = value.trim().split(/\s+/);
  test.each(['create_transfer', 'create_wire_transfer', 'get_my_accounts'])('covers every scope %s requires', (tool) => {
    const required = topology.tools[tool].requiredScopes;
    expect(scopes).toEqual(expect.arrayContaining(required));
  });
});
