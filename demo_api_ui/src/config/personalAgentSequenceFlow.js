// How ChatGPT accesses member benefits through an MCP gateway: CIMD discovery, IdP consent, P1AZ authorization and
// permitted MCP access, as a Mermaid sequenceDiagram for SequenceFlowDiagram. Source: the owner's "How ChatGPT accesses
// Optum benefits" workflow (12 steps, messages 1a-12b in the document's order and wording). Illustrative proposed
// architecture, not a claim of production deployment. P1AZ = policy decision point; MCP gateway = enforcement point.
// The four catalog messages at the top (publish, list, add, available) are the pattern every personal-agent flow shares;
// they are not in the owner's document, so its step 1 starts at message 5.
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant U as User / Browser
    participant K as AI assistant catalog\\ne.g. ChatGPT's app directory
    participant C as ChatGPT\\nMCP client
    participant G as Optum MCP Gateway\\nenforcement point
    participant I as Ping IdP / OAuth AS\\nauthorize • token • JWKS
    participant Z as PingOne Authorize\\npolicy decision point
    participant B as Optum Benefits API
    participant O as OpenAI Metadata\\nclient.json • jwks.json

    rect rgb(225,229,238)
    Note over K,G: Before step 1 — The company publishes once, members add it free
    G->>K: The company publishes its MCP gateway to the catalog: URL, auth metadata, branding and privacy policy
    K-->>G: Reviews it and lists it, so any member of the assistant can find it
    U->>K: Browses the catalog and adds the connector: free, nothing to install
    K-->>C: The connector appears in the member's ChatGPT, not signed in yet
    end
    rect rgb(225,229,238)
    Note over U,C: Step 1 — Protected tool request
    U->>C: Show my Optum benefits
    C->>G: POST /mcp — no token
    G-->>C: 401 Unauthorized + WWW-Authenticate
    end
    rect rgb(226,228,236)
    Note over C,I: Steps 2-3 — Discover the resource and OAuth configuration
    C->>G: GET protected-resource metadata
    G-->>C: 200 OK
    C->>I: GET OAuth AS metadata
    I-->>C: 200 OK
    end
    rect rgb(222,230,248)
    Note over U,O: Steps 4-5 — Browser authorization and CIMD lookup
    C->>U: Sign in to Optum
    U->>I: GET /oauth/authorize (browser request)
    I->>O: GET /oauth/client.json — CIMD lookup
    O-->>I: 200 OK
    end
    rect rgb(255,235,222)
    Note over U,I: Step 6 — IdP sign-in and consent
    I->>U: Login + resource-specific consent prompt
    U->>I: Member approves or denies
    I->>U: 302 redirect
    U->>C: OAuth callback
    end
    rect rgb(255,240,225)
    Note over C,O: Steps 7-8 — Code exchange, client verification, token
    C->>I: POST /oauth/token
    I->>O: GET /oauth/jwks.json
    O-->>I: Public JWKS
    I-->>C: 200 OK — access token
    end
    rect rgb(218,240,240)
    Note over C,Z: Steps 9-10 — Gateway validation and fine-grained P1AZ decision
    C->>G: POST /mcp
    G->>Z: P1AZ PDP evaluation
    Z-->>G: Permit / Deny
    end
    rect rgb(225,229,238)
    Note over G,U: Steps 11-12 — Downstream call and authorized result
    G->>B: Call benefits API
    B-->>G: Permitted benefits
    G-->>C: Tool result
    C->>U: Explain benefits
    end
`;

export const PERSONAL_AGENT_SEQUENCE_SOURCE = wrapMessages(SOURCE);

export const PERSONAL_AGENT_SEQUENCE_DETAILS = {
  K: "The AI assistant vendor's catalog (for example ChatGPT's app directory). The company submits its connector once; the vendor reviews and lists it; members add it from the catalog at no cost. The catalog holds no member credentials: sign-in and consent still happen at the company's identity provider on first use.",
  U: 'The member, in a ChatGPT session. The browser, not ChatGPT, sends the authorization request to Ping and shows the consent prompt.',
  C: 'The AI client. Identified by a published client metadata document (CIMD), proves itself with a signed client assertion (private_key_jwt) and PKCE S256. Holds the access token.',
  G: 'Protected resource and enforcement point. Challenges with 401 + resource metadata, validates the token (signature, issuer, audience, expiry, scope, member, consent), asks P1AZ, and only on Permit calls the benefits API.',
  I: 'OAuth 2.1 authorization server and identity provider. Fetches the client CIMD, authenticates the member, records explicit resource-specific consent, verifies the client assertion against its JWKS and issues an audience-bound access token.',
  Z: 'Policy decision point. Evaluates user, client or agent, tool, target resource, action, entitlements and recorded consent. Consent is necessary where required, but never overrides policy.',
  B: 'Downstream resource. Only reached on a Permit; returns only the authorized member data.',
  O: 'Where the client publishes its CIMD (client.json) and public keys (jwks.json). Illustrative host.',
};

// Wire forms shown under each message and in the reel's details row (index = message order, 0-29). Hosts end in
// .example; every token value is a teaching placeholder, not a real credential. Messages 0-3 are the catalog pattern.
// Token and decision payloads are full JSON, decoded, with placeholders. Every value is a teaching placeholder.
const json = (title, obj) => `${title} (MOCK: teaching values, not a credential)\n${JSON.stringify(obj, null, 2)}`;
export const PERSONAL_AGENT_SEQUENCE_PAYLOADS = [
  'Connector listing (illustrative)\nname: Optum benefits\nmcp_url: https://mcp.optum.example/mcp\nauth: OAuth, found through the 401 and\n  the protected-resource metadata\nscopes asked: benefits:read\nbranding + privacy policy URL',
  'status: listed\nvisible to: members of the assistant\nprice to the member: free',
  'Add "Optum benefits"\nprice: free\nnothing to install; sign-in and consent\n  happen on first use (steps 4-6)',
  'connector: optum-benefits\nstate: added, not signed in yet\nfirst use starts the protected tool request',
  null,
  'POST https://mcp.optum.example/mcp\n(no Authorization header)\ntool: get_my_benefits',
  'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer\n  resource_metadata="https://mcp.optum.example/\n  .well-known/oauth-protected-resource"\n  scope="benefits:read"',
  'GET https://mcp.optum.example/\n  .well-known/oauth-protected-resource',
  'resource: https://mcp.optum.example/mcp\nauthorization_servers: [https://login.optum.example]\nscopes_supported: [benefits:read]',
  'GET https://login.optum.example/\n  .well-known/oauth-authorization-server',
  'issuer: https://login.optum.example\nauthorization_endpoint: /oauth/authorize\ntoken_endpoint: /oauth/token\ngrant_types_supported: [authorization_code]\nPKCE: S256 | CIMD: true | client auth: private_key_jwt',
  null,
  'client_id: https://chatgpt.example/oauth/client.json\nredirect_uri: https://chatgpt.example/connector_platform_oauth_redirect\nscope: benefits:read\nresource: https://mcp.optum.example/mcp\nresponse_type: code; state: <RANDOM_STATE>; PKCE: S256',
  'GET https://chatgpt.example/oauth/client.json\nPing validates the callback and the client acceptance policy',
  'client_id: https://chatgpt.example/oauth/client.json\nredirect_uris: [https://chatgpt.example/connector_platform_oauth_redirect]\ntoken_endpoint_auth_method: private_key_jwt\njwks_uri: https://chatgpt.example/oauth/jwks.json',
  'PING IDP CONSENT SCREEN (example)\nClient: ChatGPT | Member: signed-in Optum user\nAllow: /members/{me}/benefits (read)\nDownstream: Optum Benefits API | Purpose: current coverage\n[ Deny ]  [ Allow benefits:read ]  (consent id + version persisted)',
  json('Consent record (stored on approve)', { consent_id: '<CONSENT_ID>', version: 1, member: '<member id>', client: 'https://chatgpt.example/oauth/client.json', scope: 'benefits:read', resource: 'https://mcp.optum.example/mcp' }),
  'HTTP/1.1 302 Found\nLocation: https://chatgpt.example/\n  connector_platform_oauth_redirect\n  ?code=<AUTHORIZATION_CODE>&state=<RANDOM_STATE>',
  'GET /connector_platform_oauth_redirect?code=<AUTHORIZATION_CODE>&state=<RANDOM_STATE>',
  `grant_type: authorization_code\ncode: <AUTHORIZATION_CODE>\nredirect_uri: https://chatgpt.example/connector_platform_oauth_redirect\nresource: https://mcp.optum.example/mcp\ncode_verifier: <ORIGINAL_PKCE_VERIFIER>\n` + json('client_assertion, decoded (signed by ChatGPT)', { header: { alg: 'RS256', kid: '<KEY_ID>', typ: 'JWT' }, payload: { iss: 'https://chatgpt.example/oauth/client.json', sub: 'https://chatgpt.example/oauth/client.json', aud: 'https://login.optum.example/oauth/token', iat: '<now>', exp: '<now + 5 min>', jti: '<unique id>' }, signature: '<RS256 signature>' }),
  'GET https://chatgpt.example/oauth/jwks.json',
  'keys: [{ kty: RSA, kid: <KEY_ID>,\n  use: sig, n: <PUBLIC_MODULUS>, e: AQAB }]',
  `HTTP/1.1 200 OK\n` + json('Token response body', { token_type: 'Bearer', expires_in: 300, scope: 'benefits:read', access_token: '<JWT, decoded below>' }) + '\n' + json('access_token, decoded', { header: { alg: 'RS256', kid: '<KEY_ID>', typ: 'JWT' }, payload: { iss: 'https://login.optum.example', aud: 'https://mcp.optum.example/mcp', sub: '<member id>', client_id: 'https://chatgpt.example/oauth/client.json', scope: 'benefits:read', iat: '<now>', exp: '<now + 300>', jti: '<unique id>' }, signature: '<RS256 signature>' }),
  `POST https://mcp.optum.example/mcp\nAuthorization: Bearer <access_token>\n` + json('Checks at the gateway', { iss: 'matches the AS', aud: 'matches mcp.optum.example/mcp', exp: 'not passed', scope: 'includes benefits:read', member: 'matches the token sub', consent: 'consent_id active' }),
  json('P1AZ input', { subject: { member: '<member id>' }, client: { id: 'https://chatgpt.example/oauth/client.json', name: 'ChatGPT' }, tool: 'get_my_benefits', action: 'benefits.read', resource: 'member/{me}/benefits', context: { consent_id: '<CONSENT_ID>', scope: 'benefits:read', risk: 'low' } }),
  json('P1AZ decision', { decision: 'Permit', policy: 'member owns target; consent active; no expanded access', obligations: [] }) + '\nDeny: the downstream tool and API are not called',
  'GET /members/{me}/benefits\n(only after a Permit)',
  json('Benefits API response (only after a Permit)', { member: '<member id>', coverage: { plan: 'Example PPO', status: 'active' } }),
  json('Tool result returned to ChatGPT', { content: 'Your Example PPO coverage is active.', scope: 'benefits:read', fields_returned: ['plan', 'status'] }),
  'Example: Your Example PPO coverage is active.',
];

// Movie-reel card (token-chain step id) -> the message to walk the diagram to (0-based, message order above).
const REEL_STEP_MESSAGE = {
  prompt: 4, agent: 5, llm: 5, signin: 15, 'agent-token': 19, exchange: 19,
  gateway: 23, authorize: 24, mcp: 26, reply: 29,
};
export function personalAgentMessageForReelStep(stepId) {
  const i = REEL_STEP_MESSAGE[String(stepId || '').split(':')[0]];
  return i === undefined ? -1 : i;
}
