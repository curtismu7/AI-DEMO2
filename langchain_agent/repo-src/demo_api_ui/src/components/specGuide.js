// banking_api_ui/src/components/specGuide.js
// Phase 266 R3 — static spec catalogue for the educational tooltips.
// Source of truth: .planning/phases/266-.../266-SPECS.md §5
// All entries include title, url, and a 1-3 sentence summary.
// Demo MUST run offline — no fetch calls here.

export const SPEC_GUIDE = {
  'RFC 6749': {
    title: 'OAuth 2.0 Authorization Framework',
    url: 'https://datatracker.ietf.org/doc/html/rfc6749',
    summary:
      'Defines the AS/RS/client roles, the grant types, and the access-token concept. The whole banking demo runs on top of this.',
  },
  'RFC 6750': {
    title: 'OAuth 2.0 Bearer Token Usage',
    url: 'https://datatracker.ietf.org/doc/html/rfc6750',
    summary:
      "Specifies the Authorization: Bearer <token> header and the RS's obligation to validate aud, exp, and signature on every request.",
  },
  'RFC 6750 §3': {
    title: 'RFC 6750 §3 — RS validation',
    url: 'https://datatracker.ietf.org/doc/html/rfc6750#section-3',
    summary:
      "The RS rejects tokens that don't match its expected audience or scope. This is why the gateway must exchange before forwarding to banking_resource_server.",
  },
  'RFC 7515': {
    title: 'JSON Web Signature (JWS)',
    url: 'https://datatracker.ietf.org/doc/html/rfc7515',
    summary:
      "The cryptographic signature on a JWT. The RS verifies it against the AS's JWKS to know the token is authentic and unmodified.",
  },
  'RFC 7517': {
    title: 'JSON Web Key Set (JWKS)',
    url: 'https://datatracker.ietf.org/doc/html/rfc7517',
    summary:
      'How an AS publishes its signing keys. The RS fetches and caches the JWKS to validate token signatures locally without round-tripping the AS.',
  },
  'RFC 7519': {
    title: 'JSON Web Token (JWT)',
    url: 'https://datatracker.ietf.org/doc/html/rfc7519',
    summary:
      'The canonical claim names: iss, sub, aud, exp, iat, nbf, jti. Used everywhere in the OAuth flow.',
  },
  'RFC 7662': {
    title: 'OAuth 2.0 Token Introspection',
    url: 'https://datatracker.ietf.org/doc/html/rfc7662',
    summary:
      'The AS endpoint /introspect: an RS sends a token + its own credentials, gets back {active, scope, sub, aud, ...}. Used for real-time revocation. Phase 266 layers this on top of JWKS validation when ff_introspection_required is enabled.',
  },
  'RFC 8414': {
    title: 'OAuth 2.0 Authorization Server Metadata',
    url: 'https://datatracker.ietf.org/doc/html/rfc8414',
    summary:
      "The /.well-known/oauth-authorization-server discovery doc. Clients + RSs find the AS's token endpoint, JWKS URI, introspection URL automatically.",
  },
  'RFC 7515/7517/8414': {
    title: 'JWS + JWKS + AS discovery (composite)',
    url: 'https://datatracker.ietf.org/doc/html/rfc8414',
    summary:
      'The three specs that together let an RS validate a token locally: discover the JWKS URI from AS metadata (8414), fetch the keys (7517), verify the signature (7515).',
  },
  'RFC 7515/7517/8414/7662': {
    title: 'Local JWKS validation + RFC 7662 introspection (layered)',
    url: 'https://datatracker.ietf.org/doc/html/rfc7662',
    summary:
      'The fast path (JWKS, local) handles signature/exp/aud. The optional introspection layer (RFC 7662) adds revocation freshness. Phase 266 uses both.',
  },
  'RFC 8693': {
    title: 'OAuth 2.0 Token Exchange',
    url: 'https://datatracker.ietf.org/doc/html/rfc8693',
    summary:
      "The grant type urn:ietf:params:oauth:grant-type:token-exchange. The gateway swaps the user's MCP-side bearer for one whose aud matches banking_resource_server. This is THE step that makes the dual_token + bankingdata paths work.",
  },
  'RFC 8693 + draft-ietf-oauth-identity-chaining': {
    title: 'Token Exchange + Identity Chaining (JAG)',
    url: 'https://datatracker.ietf.org/doc/html/draft-ietf-oauth-identity-chaining',
    summary:
      'When an agent exchanges on behalf of a user, the resulting token carries act:{sub, client_id} — the audit trail proving "this gateway, acting as the user, made this call." Phase 266\'s dual_token path produces this chain.',
  },
  'RFC 8707': {
    title: 'Resource Indicators for OAuth 2.0',
    url: 'https://datatracker.ietf.org/doc/html/rfc8707',
    summary:
      "The audience (or resource) parameter on token requests. Tells the AS which RS the token is for. The exchanged token's aud claim is governed by this spec.",
  },
  'RFC 8707 audience binding': {
    title: 'RFC 8707 — Audience Binding',
    url: 'https://datatracker.ietf.org/doc/html/rfc8707#section-2',
    summary:
      "The RS rejects tokens whose aud doesn't name it. This is why the inbound user bearer (aud=AI-agent-resource) can't reach banking_resource_server without RFC 8693 exchange.",
  },
  'RFC 9068': {
    title: 'JWT Profile for OAuth 2.0 Access Tokens',
    url: 'https://datatracker.ietf.org/doc/html/rfc9068',
    summary:
      'Standardizes how OAuth access tokens are encoded as JWTs (typ: at+jwt header). PingOne follows this profile.',
  },
  'RFC 9728': {
    title: 'OAuth 2.0 Protected Resource Metadata',
    url: 'https://datatracker.ietf.org/doc/html/rfc9728',
    summary:
      "The /.well-known/oauth-protected-resource discovery doc that an RS publishes — tells clients which AS issuer + audience to request. The MCP gateway already serves this.",
  },
  'OIDC Core §3.1.3.7': {
    title: 'OIDC Core 1.0 §3.1.3.7 — ID Token validation',
    url: 'https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation',
    summary:
      "How a client validates an id_token (signature, iss, aud, exp). Phase 266 returns id_token CLAIMS only; the raw JWT never leaves the BFF.",
  },
  'JSON-RPC 2.0 + RFC 6750 §3.1': {
    title: 'JSON-RPC 2.0 envelope over HTTP POST',
    url: 'https://www.jsonrpc.org/specification',
    summary:
      'The gateway POSTs a JSON-RPC envelope to banking_resource_server with the id_token in params and the exchanged bearer in the Authorization header. Standard wire format for MCP tool calls.',
  },
  'MCP 2025-11-25': {
    title: 'Model Context Protocol — Authorization (2025-11-25)',
    url: 'https://modelcontextprotocol.io/specification/',
    summary:
      'The current MCP spec. Requires the MCP server to exchange tokens before forwarding to downstream resources with different aud — exactly what the gateway does on dual_token + bankingdata paths.',
  },
};
