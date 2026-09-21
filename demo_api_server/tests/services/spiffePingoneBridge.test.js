'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bridge = require('../../services/spiffePingoneBridge');

describe('spiffePingoneBridge', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const configStore = {
    getEffective: jest.fn((key) => ({
      spiffe_pingone_client_map: JSON.stringify({ 'spiffe://demo.local/service/bff': 'ping-client-1' }),
      spiffe_bridge_private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      spiffe_bridge_kid: 'bridge-1',
    }[key] || '')),
  };
  const verifier = { verifySvid: jest.fn(() => ({ valid: true, claims: { sub: 'spiffe://demo.local/service/bff' } })) };

  test('maps a verified SVID and creates a PingOne-compatible assertion', () => {
    const result = bridge.buildClientAssertion({ svid: 'svid', audience: 'https://auth.example/token', expectedClientId: 'ping-client-1', configStore, verifier });
    expect(result).toMatchObject({ clientId: 'ping-client-1', spiffeId: 'spiffe://demo.local/service/bff' });
    expect(jwt.verify(result.assertion, publicKey, { algorithms: ['RS256'], audience: 'https://auth.example/token' })).toMatchObject({ iss: 'ping-client-1', sub: 'ping-client-1' });
  });

  test('fails closed for an unmapped SVID', () => {
    verifier.verifySvid.mockReturnValueOnce({ valid: true, claims: { sub: 'spiffe://demo.local/service/unknown' } });
    expect(() => bridge.buildClientAssertion({ svid: 'svid', audience: 'https://auth.example/token', configStore, verifier })).toThrow('no PingOne client is mapped');
  });
});
