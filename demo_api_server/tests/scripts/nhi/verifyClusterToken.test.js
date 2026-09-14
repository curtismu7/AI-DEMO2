const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { verifyToken } = require('../../../scripts/nhi/verifyClusterToken');

function makeKeyPairAndJwks(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256', kty: 'RSA' }] },
  };
}

test('verifies a token signed by a key present in the JWKS', () => {
  const { privateKey, jwks } = makeKeyPairAndJwks('test-kid-1');
  const token = jwt.sign(
    { sub: 'system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor' },
    privateKey,
    { algorithm: 'RS256', keyid: 'test-kid-1', issuer: 'https://example-issuer.test', expiresIn: '5m' },
  );

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(true);
  expect(result.claims.sub).toBe('system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor');
});

test('rejects a token whose kid is not in the JWKS', () => {
  const { jwks } = makeKeyPairAndJwks('key-in-jwks');
  const { privateKey: otherKey } = makeKeyPairAndJwks('unused');
  const token = jwt.sign({ sub: 'x' }, otherKey, { algorithm: 'RS256', keyid: 'key-not-in-jwks' });

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(false);
  expect(result.error).toMatch(/kid/i);
});

test('rejects a token signed by a different key than the one matching its kid', () => {
  const { jwks } = makeKeyPairAndJwks('shared-kid');
  const { privateKey: wrongKey } = makeKeyPairAndJwks('shared-kid');
  const token = jwt.sign({ sub: 'x' }, wrongKey, { algorithm: 'RS256', keyid: 'shared-kid' });

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(false);
  expect(result.error).toBeTruthy();
});
