#!/usr/bin/env node
/**
 * gen-exchanger-jwt-key.js — generate an RSA keypair for private_key_jwt (RFC 7523)
 * client authentication for the dedicated RFC 8693 token-exchange application.
 *
 * One-off operator tool. Prints, to stdout only (never written to disk):
 *   1. The PKCS#8 PEM PRIVATE key  → store as configStore `pingone_private_key_jwt_exchanger_private_key`
 *      (or env PINGONE_PRIVATE_KEY_JWT_EXCHANGER_PRIVATE_KEY). It is encrypted at rest (SECRET_KEYS).
 *   2. The kid                     → store as `pingone_private_key_jwt_exchanger_kid`
 *      (PINGONE_PRIVATE_KEY_JWT_EXCHANGER_KID).
 *   3. The PUBLIC JWK Set          → register on the PingOne 'Private Key JWT Exchanger'
 *      application (Application → Configuration → tokenEndpointAuthMethod = PRIVATE_KEY_JWT, jwks).
 *   4. The Client ID               → from the PingOne app created, store as
 *      `pingone_private_key_jwt_exchanger_client_id` (PINGONE_PRIVATE_KEY_JWT_EXCHANGER_CLIENT_ID).
 *
 * Usage:  node demo_api_server/scripts/gen-exchanger-jwt-key.js
 *
 * The private key is intentionally NOT persisted by this script — paste it into
 * the secret store yourself so it never lands in source control or shell history files.
 *
 * Prerequisites:
 *   - A PingOne application named 'Private Key JWT Exchanger' (or similar) created manually
 *   - The app must have:
 *     • tokenEndpointAuthMethod = PRIVATE_KEY_JWT
 *     • Token-Exchange grant enabled (RFC 8693)
 *     • Scopes: mcp:invoke (at minimum)
 *     • Resource: MCP resource (api.ping.demo MCP gateway or similar)
 *
 * Steps:
 *   1. Run this script and save the output
 *   2. Create the PingOne app (if not already created)
 *   3. Register the PUBLIC JWK SET on the app (jwks field)
 *   4. Copy the Client ID from the PingOne app → PINGONE_PRIVATE_KEY_JWT_EXCHANGER_CLIENT_ID
 *   5. Store the PRIVATE KEY → configStore or env PINGONE_PRIVATE_KEY_JWT_EXCHANGER_PRIVATE_KEY
 *   6. Store the kid → configStore or env PINGONE_PRIVATE_KEY_JWT_EXCHANGER_KID
 *   7. Enable ff_private_key_jwt_token_exchange = true
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
  process.stdout.write('  private_key_jwt Dedicated Token-Exchange Exchanger (RFC 8693 + RFC 7523)\n');
  process.stdout.write(`${line}\n\n`);

  process.stdout.write(`kid: ${kid}\n`);
  process.stdout.write('  → configStore key  pingone_private_key_jwt_exchanger_kid\n');
  process.stdout.write('  → env              PINGONE_PRIVATE_KEY_JWT_EXCHANGER_KID\n\n');

  process.stdout.write('PRIVATE KEY (PKCS#8 PEM) — store as secret, never commit:\n');
  process.stdout.write('  → configStore key  pingone_private_key_jwt_exchanger_private_key  (encrypted at rest)\n');
  process.stdout.write('  → env              PINGONE_PRIVATE_KEY_JWT_EXCHANGER_PRIVATE_KEY\n\n');
  process.stdout.write(`${privatePem}\n`);

  process.stdout.write('PUBLIC JWK SET — register on the PingOne "Private Key JWT Exchanger" application\n');
  process.stdout.write('(Application → Configuration → jwks), and set tokenEndpointAuthMethod = PRIVATE_KEY_JWT:\n\n');
  process.stdout.write(`${JSON.stringify(jwks, null, 2)}\n\n`);

  process.stdout.write(`${line}\n`);
  process.stdout.write('  Steps:\n');
  process.stdout.write('  1. Create the PingOne app "Private Key JWT Exchanger" (or use existing)\n');
  process.stdout.write('     - tokenEndpointAuthMethod = PRIVATE_KEY_JWT\n');
  process.stdout.write('     - Token-Exchange grant enabled\n');
  process.stdout.write('     - Scopes: mcp:invoke\n');
  process.stdout.write('  2. Register PUBLIC JWK SET above on the app (jwks field)\n');
  process.stdout.write('  3. Copy Client ID from PingOne app → PINGONE_PRIVATE_KEY_JWT_EXCHANGER_CLIENT_ID\n');
  process.stdout.write('  4. Store PRIVATE KEY → configStore or env PINGONE_PRIVATE_KEY_JWT_EXCHANGER_PRIVATE_KEY\n');
  process.stdout.write('  5. Store kid → configStore or env PINGONE_PRIVATE_KEY_JWT_EXCHANGER_KID\n');
  process.stdout.write('  6. Enable ff_private_key_jwt_token_exchange = true\n');
  process.stdout.write(`${line}\n\n`);
}

main();
