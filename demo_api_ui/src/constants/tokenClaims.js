/**
 * Token claims data for ClaimDetailsModal
 * Each claim includes: key (JWT parameter name), value (example), description (RFC explanation)
 */

export const TOKEN_CLAIMS = {
  user: [
    {
      key: 'sub',
      value: 'user-12345',
      description: 'Subject (RFC 7519 §4.1.2) — unique identifier of the authenticated user. The resource server uses sub to identify who the token represents.',
    },
    {
      key: 'iss',
      value: 'https://auth.example.com',
      description: 'Issuer (RFC 7519 §4.1.1) — the authorization server URL that signed and issued this token. Relying parties MUST verify iss.',
    },
    {
      key: 'aud',
      value: 'banking-api',
      description: 'Audience (RFC 7519 §4.1.3 · RFC 8707) — resource server(s) this token is scoped to. RFC 8707 Resource Indicators bind the token to a single audience, preventing reuse on other services.',
    },
    {
      key: 'exp',
      value: 1719331200,
      description: 'Expiration (RFC 7519 §4.1.4) — Unix epoch after which the token MUST be rejected. Short-lived tokens limit blast radius if intercepted.',
    },
    {
      key: 'iat',
      value: 1719327600,
      description: 'Issued At (RFC 7519 §4.1.6) — Unix epoch when the token was created by the authorization server.',
    },
    {
      key: 'scope',
      value: 'read write',
      description: 'Scope (RFC 6749 §3.3) — permissions granted to the bearer. Scope is space-delimited; resource servers MUST reject tokens missing a required scope. Token Exchange (RFC 8693) can only narrow scope, never expand it.',
    },
    {
      key: 'client_id',
      value: 'banking-web-app',
      description: 'Client ID — the OAuth 2.0 application (RFC 6749 §2.2) that originally requested this token.',
    },
    {
      key: 'acr',
      value: 'Multi_Factor',
      description: 'Authentication Context Class Reference (RFC 9470 · OpenID Core §2) — level of assurance. "Multi_Factor" means MFA was used. Resources that require step-up authentication reject tokens with a lower ACR.',
    },
    {
      key: 'amr',
      value: '["pwd","otp"]',
      description: 'Authentication Methods References (OpenID Core §2) — how the user authenticated (e.g. pwd, otp, fido).',
    },
    {
      key: 'auth_time',
      value: 1719327600,
      description: 'Authentication Time (OpenID Core §2) — when the user last authenticated. Used to enforce max_age and step-up policies.',
    },
  ],
  agent: [
    {
      key: 'sub',
      value: 'agent-client-id',
      description: 'Subject (RFC 7519 §4.1.2) — identifies the agent/service account requesting the token exchange.',
    },
    {
      key: 'iss',
      value: 'https://auth.example.com',
      description: 'Issuer (RFC 7519 §4.1.1) — the authorization server URL that signed and issued this token.',
    },
    {
      key: 'aud',
      value: 'mcp-server',
      description: 'Audience (RFC 7519 §4.1.3) — the MCP server this agent token is targeted to.',
    },
    {
      key: 'exp',
      value: 1719331200,
      description: 'Expiration (RFC 7519 §4.1.4) — Unix epoch after which the token MUST be rejected.',
    },
    {
      key: 'iat',
      value: 1719327600,
      description: 'Issued At (RFC 7519 §4.1.6) — Unix epoch when the token was created.',
    },
    {
      key: 'act',
      value: '{"sub":"user-12345"}',
      description: 'Actor (RFC 8693 §4.1) — identifies the party currently acting on behalf of the subject. Present on tokens issued via Token Exchange; proves delegation chain. Nested act = multi-hop delegation.',
    },
    {
      key: 'scope',
      value: 'mcp:read mcp:write',
      description: 'Scope (RFC 6749 §3.3) — permissions granted on this agent token. Token Exchange (RFC 8693) can only narrow scope, never expand it.',
    },
    {
      key: 'client_id',
      value: 'agent-service-account',
      description: 'Client ID — the OAuth 2.0 application that represents the agent.',
    },
    {
      key: 'cnf',
      value: '{"jkt":"fUHyO2r..."}',
      description: 'Confirmation (RFC 9449 §3 · RFC 7800) — JWK thumbprint (jkt) that binds this token to a DPoP key. The caller must sign a DPoP proof with the matching private key on every request.',
    },
  ],
  mcp: [
    {
      key: 'sub',
      value: 'mcp-client-id',
      description: 'Subject (RFC 7519 §4.1.2) — identifies the MCP client/tool making the request.',
    },
    {
      key: 'iss',
      value: 'https://auth.example.com',
      description: 'Issuer (RFC 7519 §4.1.1) — the authorization server URL that signed and issued this token.',
    },
    {
      key: 'aud',
      value: 'banking-api',
      description: 'Audience (RFC 7519 §4.1.3 · RFC 8707) — the resource server(s) this MCP token is scoped to.',
    },
    {
      key: 'exp',
      value: 1719330000,
      description: 'Expiration (RFC 7519 §4.1.4) — Unix epoch after which the token MUST be rejected.',
    },
    {
      key: 'iat',
      value: 1719327600,
      description: 'Issued At (RFC 7519 §4.1.6) — Unix epoch when the token was created by the token exchange.',
    },
    {
      key: 'act',
      value: '{"sub":"user-12345","client_id":"agent-service"}',
      description: 'Actor (RFC 8693 §4.1) — delegation chain showing the original user subject and agent client.',
    },
    {
      key: 'scope',
      value: 'read',
      description: 'Scope (RFC 6749 §3.3) — narrowed permissions for this MCP call. RFC 8693 Token Exchange requires scope narrowing.',
    },
    {
      key: 'client_id',
      value: 'mcp-tool-client',
      description: 'Client ID — the MCP tool/service account identifier.',
    },
    {
      key: 'authorization_details',
      value: '{"type":"banking_transaction","action":"read","resource":"accounts"}',
      description: 'Rich Authorization Request (RFC 9396) — structured, intent-bound grant (e.g. {type, action, amount, payee}) carried instead of (or alongside) a broad scope.',
    },
    {
      key: 'cnf',
      value: '{"jkt":"xyz123..."}',
      description: 'Confirmation (RFC 9449 §3 · RFC 7800) — JWK thumbprint binding this token to a DPoP proof key.',
    },
  ],
};
