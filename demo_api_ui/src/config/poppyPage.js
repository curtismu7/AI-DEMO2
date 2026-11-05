// /poppy: how AI-DEMO2 supports the Personal Agent Protocol (Poppy, Draft 0.3) as the Company side.
// Facts here were proven on a local PingFederate on 2026-10-29. The SE host is not deployed until the owner runs the SE rollout.

export const POPPY_HOST = 'poppy.ai-demo.ping-devops.com';
export const POPPY_SPEC = 'https://personalagentprotocol.org/docs/introduction';

export const POPPY_DOCS = [
  { path: '/.well-known/poppy.json', what: 'Spec 3.1: who we are, which scopes and which APIs an agent may use.' },
  { path: '/.well-known/oauth-protected-resource', what: 'Spec 3.2: resource is exactly https://{domain}, with PingFederate as the authorization server.' },
  { path: '/poppy/api/openapi.json', what: 'The OpenAPI description of the one Poppy API we serve.' },
  { path: '/poppy/api/v1/me', what: 'Needs a PingFederate bearer token and a Poppy-Session header. Returns who the agent acts for.' },
];

export const POPPY_SCOPES = [
  { scope: 'accounts:read', changes: 'none', note: 'Read account balances and details. The scope /poppy/api/v1/me requires.' },
  { scope: 'transactions:read', changes: 'none', note: 'Read transaction history.' },
  { scope: 'transactions:write', changes: 'irreversible', note: 'Move money between accounts. Marked irreversible so an agent asks the person first.' },
  { scope: 'mortgage:read', changes: 'none', note: 'Read mortgage details.' },
];

// What we checked, and what is not done. Each row is labelled so the page does not oversell.
export const POPPY_STATUS = [
  { label: 'Proven', text: 'A real PingFederate token issued to a CIMD agent URL, plus a signed Poppy-Session, got HTTP 200 from /poppy/api/v1/me. A replayed session and a session signed for another token were refused (400).' },
  { label: 'Proven', text: 'PingFederate can issue the token the spec needs: a separate token manager takes client_id from the request, so the token names the agent URL. The shared demo mapping hardcodes client_id, so it is left alone.' },
  { label: 'Not done', text: 'The issuer metadata does not list protected_resources (spec 3.3). We found no PingFederate setting for it.' },
  { label: 'Not done', text: 'Not yet deployed to the SE cluster. Until then the host below does not answer.' },
  { label: 'Not done', text: 'No agent is trusted by default. An operator lists the agent URLs in POPPY_ALLOWED_AGENTS.' },
];

export const POPPY_LANES = { A: 'agent', F: 'authz', C: 'api' };
export const POPPY_DETAILS = {
  A: 'The Personal Agent. It is identified by a client metadata URL (CIMD), not a registered client id, and holds a delegated key it signs each request with.',
  F: 'PingFederate: the authorization server. It resolves the agent URL, signs in the person and issues a token whose client_id is that URL.',
  C: `The Company: AI-DEMO2 on ${POPPY_HOST}. It checks the bearer token, then checks the Poppy-Session header the spec adds on top.`,
};

export const POPPY_SOURCE = [
  'sequenceDiagram',
  '    autonumber',
  '    participant A as Personal Agent\\nthe caller',
  '    participant F as PingFederate\\nauthorization server',
  `    participant C as Company\\n${POPPY_HOST}`,
  '    rect rgb(218,240,240)',
  '    Note over A,C: 1 Discover',
  '    A->>C: GET /.well-known/poppy.json',
  '    C-->>A: Scopes, APIs and the issuer',
  '    end',
  '    rect rgb(255,235,222)',
  '    Note over A,F: 2 Get a token',
  '    A->>F: Authorization request, client_id is the agent metadata URL, PKCE',
  '    F-->>A: Access token, client_id is the agent URL',
  '    end',
  '    rect rgb(225,229,238)',
  '    Note over A,C: 3 Call the API',
  '    A->>C: GET /poppy/api/v1/me with Bearer token and Poppy-Session',
  '    C->>F: Verify the token signature against the issuer JWKS',
  '    C-->>A: 200 who the agent acts for',
  '    end',
].join('\n');

export const POPPY_PAYLOADS = [
  `GET https://${POPPY_HOST}/.well-known/poppy.json`,
  '{\n  "protocol_version": "0.3",\n  "organization": { "domain": "' + POPPY_HOST + '" },\n  "auth": { "issuer": "<PingFederate issuer>", "scopes": { "accounts:read": "..." } },\n  "apis": [{ "type": "openapi", "url": "https://' + POPPY_HOST + '/poppy/api/openapi.json" }]\n}',
  'GET /as/authorization.oauth2\nclient_id=https://agent.example/client.json\ncode_challenge_method=S256\nscope=accounts:read',
  '{\n  "client_id": "https://agent.example/client.json",\n  "scope": "accounts:read",\n  "iss": "<PingFederate issuer>"\n}',
  `GET https://${POPPY_HOST}/poppy/api/v1/me\nAuthorization: Bearer <access token>\nPoppy-Session: <JWT, typ poppy-session+jwt, ES256>\n  iss = agent URL, aud = issuer, htm, htu, jti, iat,\n  ath = hash of the access token, pap_dlg = delegation JWT`,
  'Checked: signature, issuer, expiry, client_id present, scope accounts:read.\nThen the session: delegation signed by the agent JWKS (24h max), htm/htu match, jti unused, ath matches this token, session iss equals the token client_id.',
  'HTTP 200\n{ "user_id": "...", "session_id": "...", "agent_id": "https://agent.example/client.json", "scopes": ["accounts:read"] }',
];
