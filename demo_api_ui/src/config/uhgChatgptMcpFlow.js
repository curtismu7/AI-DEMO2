// ChatGPT -> UHG Digital Front Door MCP authorization, as a Mermaid sequenceDiagram for SequenceFlowDiagram.
// Source: "ChatGPT to the UHG Digital Front Door" (proposed architecture, for review), slide 2 — the 16 numbered
// messages are in the slide's order and wording. Phase colours follow the slide legend: discovery (grey),
// authentication + PKCE challenge (navy), code redemption + token minting (orange), OBO exchange + downstream
// authorization (teal), member experience (blue). The four catalog messages at the top (publish, list, add, available) are
// the pattern every personal-agent flow shares and are NOT on the slide, so the slide's step 1 is message 5 here.
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant M as Member\\nin ChatGPT
    participant K as AI assistant catalog\\ne.g. ChatGPT's app directory
    participant C as ChatGPT plugin\\nMCP client • OAuth public client
    participant PF as PingFederate\\nOAuth 2.1 AS • NHI store • STS
    participant H as HSID\\nOIDC IdP • authentication only
    participant G as Public MCP gateway\\nprotected resource • OBO exchange
    participant S as MCP server • tools • API GW\\nUHG private network

    rect rgb(225,229,238)
    Note over K,G: Before the first question: the company publishes once, members add it free
    G->>K: UHG publishes its MCP gateway to the catalog: URL, auth metadata, branding and privacy policy
    K-->>G: Reviews it and lists it, so any member of the assistant can find it
    M->>K: Browses the catalog and adds the connector: free, nothing to install
    K-->>C: The connector appears in the member's ChatGPT, not signed in yet
    end
    rect rgb(225,229,238)
    Note over M,S: Member experience
    M->>C: Asks a benefits or drug-price question
    end
    rect rgb(226,228,236)
    Note over C,G: Discovery — RFC 9728 / RFC 8414
    C->>G: Calls protected MCP tool (no token) → 401 + WWW-Authenticate: resource_metadata
    C->>G: GET /.well-known/oauth-protected-resource → authorization_servers: PingFederate
    C->>PF: GET /.well-known/oauth-authorization-server → endpoints, S256, CIMD/DCR (NHI)
    end
    rect rgb(222,230,248)
    Note over M,H: Authentication + PKCE challenge
    C->>PF: GET /as/authorization.oauth2 — code_challenge + method=S256 + resource + scopes
    PF->>H: Front-channel redirect: PingFederate owns no user directory
    M->>H: Authenticates at HSID (password • passkey • MFA) and consents to scopes
    H->>PF: Signed ID token (JWT): sub, acr, amr, email_verified
    end
    rect rgb(255,235,222)
    Note over C,PF: Code redemption + token minting
    PF->>C: authorization_code + iss (RFC 9207) to allowlisted redirect URI
    C->>PF: POST /as/token.oauth2 — code + plaintext code_verifier (PKCE interlock)
    PF->>C: access_token: aud = https://mcp.uhg.com, scope = rx.price.read, short TTL
    end
    rect rgb(218,240,240)
    Note over C,S: OBO exchange + downstream authorization
    C->>G: MCP request — Authorization: Bearer access_token
    PF->>G: RFC 8693 exchange → OBO token (act = gateway NHI, narrowed scopes)
    G->>S: Routes to domain MCP server; tool + API GW enforce OBO scope
    end
    rect rgb(225,229,238)
    Note over C,M: Member experience
    S->>C: Structured result returns up the egress chain
    C->>M: Trusted answer + UHG-branded UI component
    end
`;

export const UHG_MCP_FLOW_SOURCE = wrapMessages(SOURCE);

// Text for the movie reel's details row, per participant (from slides 3 and 6).
export const UHG_MCP_FLOW_DETAILS = {
  K: "The AI assistant vendor's catalog (for example ChatGPT's app directory). UHG submits its connector once; the vendor reviews and lists it; members add it from the catalog at no cost. The catalog holds no member credentials: HSID sign-in and PingFederate consent still happen on first use.",
  M: 'The member, in a ChatGPT session on the public internet.',
  C: 'OAuth 2.1 public client. CIMD or DCR identity. Generates the code_verifier and holds the member access token. No client secret: PKCE S256 is the only client proof.',
  PF: 'OAuth 2.1 authorization server and RFC 8693 security token service. Caches and verifies the PKCE challenge, mints the access token (aud = mcp.uhg.com). Client records live in its XML / configuration datastore, with no open DCR endpoint.',
  H: 'OIDC identity provider. Password, passkey and MFA produce a signed ID token. Authentication only: it makes no authorization decision.',
  G: 'Protected resource at the UHG edge. Serves oauth-protected-resource metadata, answers 401 with a WWW-Authenticate challenge, validates iss, aud, exp and scope, triggers the RFC 8693 OBO exchange, then routes to the domain MCP servers.',
  S: 'Domain MCP servers, tools and internal API gateways. Each re-validates the OBO token (iss, aud, exp, scope) and enforces per-API scope against the systems of record.',
};

// Wire forms and MOCK tokens shown under each message (index = message order, 0-15). Hosts end in .example and every
// token value is a teaching value, not a real credential. Claims follow slides 3, 5 and 6 of the proposal.
const jwt = (title, claims) => `${title} (JWT, MOCK: teaching values only)\n${JSON.stringify(claims, null, 2)}`;

export const UHG_MCP_FLOW_PAYLOADS = [
  'Connector listing (illustrative)\nname: UHG benefits and Rx\nmcp_url: https://mcp.uhg.com/mcp\nauth: OAuth, found through the 401 and\n  the protected-resource metadata\nscopes asked: rx.price.read, benefits.read, ...\nbranding + privacy policy URL',
  'status: listed\nvisible to: members of the assistant\nprice to the member: free',
  'Add "UHG benefits and Rx"\nprice: free\nnothing to install; sign-in and consent\n  happen on first use',
  'connector: uhg-benefits-rx\nstate: added, not signed in yet\nfirst use starts discovery',
  null,
  'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer\n  resource_metadata="https://mcp.uhg.com/.well-known/\n  oauth-protected-resource"',
  'resource: https://mcp.uhg.com\nauthorization_servers: [https://auth.uhg.example]\nscopes_supported: [rx.price.read, rx.claims.read,\n  benefits.read, claims.read, idcard.read,\n  provider.search, payments.read]',
  'issuer: https://auth.uhg.example\nauthorization_endpoint: /as/authorization.oauth2\ntoken_endpoint: /as/token.oauth2\ncode_challenge_methods_supported: [S256]\nclient identity: CIMD document URL (DCR only if\n  CIMD is unavailable); no client secret',
  'client_id: <CIMD document URL of the plugin>\nresponse_type: code\nredirect_uri: <exact allowlisted callback>\nscope: rx.price.read\nresource: https://mcp.uhg.com\ncode_challenge: BASE64URL(SHA256(code_verifier))\ncode_challenge_method: S256',
  null,
  'Consent screen (PingFederate + HSID)\nClient: ChatGPT plugin\nWants: rx.price.read (drug pricing and coverage)\nMember: Approve or Deny',
  jwt('ID token from HSID', { iss: 'https://hsid.uhg.example', aud: 'PingFederate client', sub: '<member id>', acr: 'mfa', amr: ['pwd', 'otp'], email_verified: true }),
  'GET <redirect_uri>?code=<AUTHORIZATION_CODE>\n  &state=<STATE>&iss=https://auth.uhg.example',
  'grant_type: authorization_code\ncode: <AUTHORIZATION_CODE>\nredirect_uri: <same callback>\ncode_verifier: <ORIGINAL_PKCE_VERIFIER>\nresource: https://mcp.uhg.com',
  jwt('Access token', { iss: 'https://auth.uhg.example', aud: 'https://mcp.uhg.com', sub: '<member id>', scope: 'rx.price.read', client_id: '<plugin>', exp: 'iat + a few minutes', jti: '<unique id>' }),
  'POST https://mcp.uhg.com/mcp\nAuthorization: Bearer <access_token>\nThe gateway validates iss, aud, exp and scope',
  'grant_type: urn:ietf:params:oauth:grant-type:\n  token-exchange   (RFC 8693)\nsubject_token: <access_token>\nactor: gateway NHI\n' + jwt('OBO token', { iss: 'https://auth.uhg.example', aud: 'rx-member-services MCP', sub: '<member id>', act: { sub: '<gateway NHI>' }, scope: 'rx.price.read:member pharmacy.network.read' }),
  'Authorization: Bearer <obo_token>\nMCP server, tool and API GW each re-validate\niss, aud, exp and scope, then audit the decision',
  null,
  null,
];
