'use strict';

/**
 * Mint side of the JIT credential contract.
 *
 * Three independent implementations produce or consume this shape: this broker
 * mints it, demo_api_resource_server verifies it, and demo_mcp_gateway carries
 * it. Every per-service suite stays green if one side renames a claim, because
 * nothing compares them — that is the drift this guards.
 *
 * Both sides assert against schemas/jit-credential.contract.json rather than
 * against each other, so neither service has to require the other. The file is
 * read by tests only, never at runtime.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
jest.mock('../services/killSwitchService', () => ({ isAgentRevoked: jest.fn() }));
jest.mock('../services/lmdb/mcpAuditStore.lmdb', () => ({ append: jest.fn() }));

const configStore = require('../services/configStore');
const killSwitchService = require('../services/killSwitchService');
const broker = require('../services/jitCredentialBroker');

const CONTRACT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'schemas', 'jit-credential.contract.json'), 'utf8',
));

const FAKE_KEY = 'not-a-secret-test-fixture';

describe('jitCredentialBroker honours the shared credential contract', () => {
  let minted;

  beforeEach(async () => {
    jest.clearAllMocks();
    configStore.getEffective.mockReturnValue(FAKE_KEY);
    killSwitchService.isAgentRevoked.mockResolvedValue(false);
    minted = await broker.mintCredential({
      keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
      tool: 'show_mortgage',
      aud: 'mortgage',
      requester: 'mcp-gateway',
    });
  });

  test('mints exactly the claims the contract declares — no more, no fewer', () => {
    const claims = jwt.decode(minted.value);
    // Exact set, both directions: an ADDED claim is drift the verifier has not
    // been told about, and a REMOVED one breaks a verifier that requires it.
    expect(Object.keys(claims).sort()).toEqual(Object.keys(CONTRACT.claims).sort());
  });

  test('uses the algorithm the contract declares', () => {
    const header = JSON.parse(Buffer.from(minted.value.split('.')[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe(CONTRACT.algorithm);
  });

  test('uses the issuer the contract declares', () => {
    expect(jwt.decode(minted.value).iss).toBe(CONTRACT.issuer);
  });

  test('uses the TTL the contract declares', () => {
    const { iat, exp } = jwt.decode(minted.value);
    expect(exp - iat).toBe(CONTRACT.ttlSeconds);
  });

  test('signs with the backend key, so the backend can verify with what it already holds', () => {
    // If this ever needed a separate key, the whole "nothing new to provision"
    // property would be gone — worth failing loudly rather than quietly.
    expect(() => jwt.verify(minted.value, FAKE_KEY, { algorithms: [CONTRACT.algorithm] })).not.toThrow();
  });
});
