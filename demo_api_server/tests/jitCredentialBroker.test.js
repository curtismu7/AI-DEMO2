'use strict';

// JIT credential broker: mints short-TTL, tool-bound credentials so the static
// backend service key stops travelling on the wire. The backend verifies with
// the same secret it already holds, so nothing new has to be provisioned.
const jwt = require('jsonwebtoken');

jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
jest.mock('../services/killSwitchService', () => ({ isAgentRevoked: jest.fn() }));

const configStore = require('../services/configStore');
const killSwitchService = require('../services/killSwitchService');
const broker = require('../services/jitCredentialBroker');

const FAKE_BACKEND_KEY = 'not-a-secret-test-fixture';

describe('jitCredentialBroker.mintCredential', () => {
  beforeEach(() => {
    configStore.getEffective.mockReset();
    killSwitchService.isAgentRevoked.mockReset();
    configStore.getEffective.mockReturnValue(FAKE_BACKEND_KEY);
    killSwitchService.isAgentRevoked.mockResolvedValue(false);
  });

  test('mints a credential the backend can verify with the key it already holds', async () => {
    const minted = await broker.mintCredential({
      keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
      tool: 'show_mortgage',
      requester: 'ping-gateway',
    });

    // The whole point: the backend verifies with the secret it already has,
    // so no new secret is provisioned anywhere.
    const claims = jwt.verify(minted.value, FAKE_BACKEND_KEY, { algorithms: ['HS256'] });

    expect(claims.tool).toBe('show_mortgage');
    expect(claims.sub).toBe('ping-gateway');
    expect(claims.iss).toBe('bff-broker');
  });

  test('the credential expires — an already-expired one is rejected by verify', async () => {
    const minted = await broker.mintCredential({
      keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
      tool: 'show_mortgage',
      requester: 'ping-gateway',
    });

    const claims = jwt.decode(minted.value);
    const lifetime = claims.exp - claims.iat;
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(120);
    expect(minted.ttlMs).toBe(lifetime * 1000);
    expect(minted.expiresAt).toBeGreaterThan(Date.now());

    // The property that matters: expiry is enforced, not decorative.
    const expired = jwt.sign(
      { iss: 'bff-broker', sub: 'ping-gateway', tool: 'show_mortgage', exp: 1 },
      FAKE_BACKEND_KEY,
      { algorithm: 'HS256' },
    );
    expect(() => jwt.verify(expired, FAKE_BACKEND_KEY)).toThrow(/expired/i);
  });

  test('a credential signed with a different key does not verify', async () => {
    const minted = await broker.mintCredential({
      keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
      tool: 'show_mortgage',
      requester: 'ping-gateway',
    });

    expect(() => jwt.verify(minted.value, 'some-other-backend-key')).toThrow(/signature/i);
  });

  test('refuses to mint for a revoked agent', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValue(true);

    await expect(
      broker.mintCredential({
        keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
        tool: 'show_mortgage',
        requester: 'agent-42',
      }),
    ).rejects.toThrow(/revoked/i);

    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('agent-42');
  });

  // Asserts OUR guard, not jsonwebtoken's incidental "secretOrPrivateKey must
  // have a value" — an error-code assertion is what makes this test fail if the
  // guard is removed.
  test('refuses to mint when the signing secret is unset — never signs with empty', async () => {
    configStore.getEffective.mockReturnValue('');

    await expect(
      broker.mintCredential({
        keyName: 'DEMO_API_RESOURCE_SERVER_KEY',
        tool: 'show_mortgage',
        requester: 'ping-gateway',
      }),
    ).rejects.toMatchObject({ code: 'signing_secret_unset' });
  });
});
