'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launcher = fs.readFileSync(path.join(__dirname, '..', 'run-docker.sh'), 'utf8');
const { checkCredentialParity, describeFailure } = require('./check-mcp-gateway-credential-parity');

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture({ apiId = 'api-client', gatewayId = apiId, apiSecret = 'api-secret', gatewaySecret = apiSecret } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gateway-credential-parity-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'demo_api_server'));
  fs.mkdirSync(path.join(root, 'demo_mcp_gateway'));
  fs.writeFileSync(path.join(root, 'demo_api_server/.env'), [
    `PINGONE_TOKEN_EXCHANGER_CLIENT_ID=${apiId}`,
    `PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET=${apiSecret}`,
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'demo_mcp_gateway/.env'), [
    `PINGONE_TOKEN_EXCHANGER_CLIENT_ID=${gatewayId}`,
    `PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET=${gatewaySecret}`,
  ].join('\n'));
  return root;
}

describe('MCP gateway token-exchanger credential parity', () => {
  it('accepts matching BFF and gateway credentials', () => {
    const result = checkCredentialParity(fixture());
    assert.deepEqual(result, { ok: true, code: 'ok' });
  });

  it('rejects a stale gateway client ID without disclosing either value', () => {
    const root = fixture({ gatewayId: 'stale-gateway-client' });
    const result = checkCredentialParity(root);
    assert.deepEqual(result, { ok: false, code: 'client_id_mismatch' });
    assert.doesNotMatch(describeFailure(result), /api-client|stale-gateway-client/);
  });

  it('rejects a stale gateway secret without disclosing either value', () => {
    const root = fixture({ gatewaySecret: 'stale-secret-value' });
    const result = checkCredentialParity(root);
    assert.deepEqual(result, { ok: false, code: 'secret_mismatch' });
    assert.doesNotMatch(describeFailure(result), /api-secret|stale-secret-value/);
  });

  it('fails closed when either service is missing an exchanger credential', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'demo_mcp_gateway/.env'), 'PINGONE_TOKEN_EXCHANGER_CLIENT_ID=api-client\n');
    assert.deepEqual(checkCredentialParity(root), { ok: false, code: 'missing_credential' });
  });

  it('guards every run-docker path that can start the demo-auth gateway', () => {
    const guardedFunctions = [
      ['cmd_demo_sync()', '\ncmd_optional_start()'],
      ['cmd_optional_start()', '\ncmd_optional_stop()'],
      ['cmd_start()', '\ncmd_status()'],
      ['cmd_restart_one()', '\n# Every `up --build`'],
      ['cmd_build_one()', '\n# ── Host port-conflict preflight'],
    ];
    for (const [startMarker, endMarker] of guardedFunctions) {
      const start = launcher.indexOf(startMarker);
      const end = launcher.indexOf(endMarker, start);
      assert.notEqual(start, -1, `${startMarker} exists`);
      assert.notEqual(end, -1, `${endMarker} exists`);
      const body = launcher.slice(start, end);
      assert.match(body, /_check_demo_auth_credentials/);
      const checkIndex = body.indexOf('_check_demo_auth_credentials');
      const composeIndex = body.indexOf('docker compose');
      assert.ok(composeIndex === -1 || checkIndex < composeIndex, `${startMarker} checks before Compose`);
    }
  });
});
