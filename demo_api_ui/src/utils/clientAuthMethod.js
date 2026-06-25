/**
 * Human label for how the BFF authenticated as an OAuth client to the PingOne
 * token endpoint for a token-chain step.
 *   private_key_jwt → "private_key_jwt · JWKS"  (RFC 7523, asymmetric, no secret)
 *   basic / post    → "client_secret_basic" / "client_secret_post"
 */
export function clientAuthMethodLabel(method) {
  switch (method) {
    case 'private_key_jwt':
      return 'private_key_jwt · JWKS';
    case 'basic':
      return 'client_secret_basic';
    case 'post':
      return 'client_secret_post';
    default:
      return method || '';
  }
}
