'use strict';
/**
 * Durable guard: a sim's tool arguments must satisfy the gateway's own arg schema.
 *
 * ROOT CAUSE this guards (2026-07-28): UC16 (`impersonation-no-act`) called
 * `create_transfer` with only `{amount, to_account_id}`. `from_account_id` is
 * required by mcp-tool-schemas.json, so the gateway rejected the call at schema
 * validation:
 *
 *   HTTP 400  {"code":-32602,"message":"Invalid arguments for tool create_transfer",
 *              "validationErrors":[{"path":"/from_account_id","message":"required property"}]}
 *   x-gw-audit-trail: (none)      <- PingOne Authorize never saw the call
 *
 * `_denyFromGateway` then overwrote that 400 with the sim's canonical
 * `401 missing_act` and a "PingOne Authorize DENY —" reason, so the card showed a
 * convincing policy denial for a run that never reached policy. With the arg
 * present the same call returns 403 carrying a real
 * `authorize: {decision: 'DENY', backend: 'real'}` audit trail.
 *
 * Schema-invalid args are indistinguishable from a policy denial once the
 * canonical relabeling runs, so this asserts the contract statically instead.
 */

const fs = require('fs');
const path = require('path');

const { IMPERSONATION_TRANSFER_ARGS } = require('../services/attackSimulatorService').__test;

/** Locate mcp-tool-schemas.json from the repo root (worktree-safe). */
function loadToolSchemas() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'mcp-tool-schemas.json');
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    dir = path.dirname(dir);
  }
  throw new Error('mcp-tool-schemas.json not found walking up from ' + __dirname);
}

describe('attack-sim tool args conform to the gateway arg schema', () => {
  const schemas = loadToolSchemas();
  const createTransfer = schemas.tools?.create_transfer?.inputSchema;

  test('the schema still requires from_account_id (fixture sanity)', () => {
    expect(createTransfer).toBeDefined();
    expect(createTransfer.required).toEqual(
      expect.arrayContaining(['from_account_id', 'to_account_id', 'amount']),
    );
  });

  test('UC16 impersonation args satisfy every required create_transfer property', () => {
    for (const key of createTransfer.required) {
      expect(IMPERSONATION_TRANSFER_ARGS).toHaveProperty(key);
      expect(IMPERSONATION_TRANSFER_ARGS[key]).not.toBe('');
      expect(IMPERSONATION_TRANSFER_ARGS[key]).not.toBeUndefined();
    }
  });

  test('UC16 args respect the schema types and minimum', () => {
    expect(typeof IMPERSONATION_TRANSFER_ARGS.amount).toBe('number');
    expect(IMPERSONATION_TRANSFER_ARGS.amount).toBeGreaterThanOrEqual(
      createTransfer.properties.amount.minimum,
    );
    expect(typeof IMPERSONATION_TRANSFER_ARGS.from_account_id).toBe('string');
    expect(typeof IMPERSONATION_TRANSFER_ARGS.to_account_id).toBe('string');
  });

  test('the transfer moves BETWEEN accounts — a self-transfer would not exercise the control', () => {
    expect(IMPERSONATION_TRANSFER_ARGS.from_account_id)
      .not.toBe(IMPERSONATION_TRANSFER_ARGS.to_account_id);
  });
});
