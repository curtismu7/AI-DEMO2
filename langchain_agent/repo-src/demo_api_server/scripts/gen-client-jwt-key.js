#!/usr/bin/env node
/**
 * gen-client-jwt-key.js — generate an RSA keypair for private_key_jwt (RFC 7523)
 * client authentication (ff_token_auth_private_key_jwt).
 *
 * One-off operator tool. Prints, to stdout only (never written to disk):
 *   1. The PKCS#8 PEM PRIVATE key  → store as configStore `pingone_client_jwt_private_key`
 *      (or env PINGONE_CLIENT_JWT_PRIVATE_KEY). It is encrypted at rest (SECRET_KEYS).
 *   2. The kid                     → store as `pingone_client_jwt_kid` (PINGONE_CLIENT_JWT_KID).
 *   3. The PUBLIC JWK Set          → register on the PingOne BFF/admin application
 *      (Application → Configuration → tokenEndpointAuthMethod = PRIVATE_KEY_JWT, jwks).
 *
 * Usage:  node demo_api_server/scripts/gen-client-jwt-key.js
 *
 * The private key is intentionally NOT persisted by this script — paste it into
 * the secret store yourself so it never lands in source control or shell history files.
 */
const crypto = require('crypto');

function main() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // kid: short, deterministic from the public key so it can be regenerated.
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const kid = crypto.createHash('sha256').update(der).digest('base64url').slice(0, 16);

  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid };
  const jwks = { keys: [publicJwk] };

  const line = '─'.repeat(72);
  process.stdout.write(`\n${line}\n`);
  process.stdout.write('  private_key_jwt client-auth key (RFC 7523)\n');
  process.stdout.write(`${line}\n\n`);

  process.stdout.write(`kid: ${kid}\n`);
  process.stdout.write('  → configStore key  pingone_client_jwt_kid\n');
  process.stdout.write('  → env              PINGONE_CLIENT_JWT_KID\n\n');

  process.stdout.write('PRIVATE KEY (PKCS#8 PEM) — store as secret, never commit:\n');
  process.stdout.write('  → configStore key  pingone_client_jwt_private_key  (encrypted at rest)\n');
  process.stdout.write('  → env              PINGONE_CLIENT_JWT_PRIVATE_KEY\n\n');
  process.stdout.write(`${privatePem}\n`);

  process.stdout.write('PUBLIC JWK SET — register on the PingOne BFF/admin application (jwks),\n');
  process.stdout.write('and set tokenEndpointAuthMethod = PRIVATE_KEY_JWT:\n\n');
  process.stdout.write(`${JSON.stringify(jwks, null, 2)}\n\n`);

  process.stdout.write(`${line}\n`);
  process.stdout.write('  Then flip ff_token_auth_private_key_jwt ON to switch the BFF to JWKS auth.\n');
  process.stdout.write(`${line}\n\n`);
}

main();
