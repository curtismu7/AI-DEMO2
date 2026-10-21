// ChatGPT -> UHG Digital Front Door MCP authorization, as a Mermaid sequenceDiagram for SequenceFlowDiagram.
// Source: "ChatGPT to the UHG Digital Front Door" (proposed architecture, for review), slide 2 — the 16 numbered
// messages are in the slide's order and wording. Phase colours follow the slide legend: discovery (grey),
// authentication + PKCE challenge (navy), code redemption + token minting (orange), OBO exchange + downstream
// authorization (teal), member experience (blue).
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant M as Member\\nin ChatGPT
    participant C as ChatGPT plugin\\nMCP client • OAuth public client
    participant PF as PingFederate\\nOAuth 2.1 AS • NHI store • STS
    participant H as HSID\\nOIDC IdP • authentication only
    participant G as Public MCP gateway\\nprotected resource • OBO exchange
    participant S as MCP server • tools • API GW\\nUHG private network

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
  M: 'The member, in a ChatGPT session on the public internet.',
  C: 'OAuth 2.1 public client. CIMD or DCR identity. Generates the code_verifier and holds the member access token. No client secret: PKCE S256 is the only client proof.',
  PF: 'OAuth 2.1 authorization server and RFC 8693 security token service. Caches and verifies the PKCE challenge, mints the access token (aud = mcp.uhg.com). Client records live in its XML / configuration datastore, with no open DCR endpoint.',
  H: 'OIDC identity provider. Password, passkey and MFA produce a signed ID token. Authentication only: it makes no authorization decision.',
  G: 'Protected resource at the UHG edge. Serves oauth-protected-resource metadata, answers 401 with a WWW-Authenticate challenge, validates iss, aud, exp and scope, triggers the RFC 8693 OBO exchange, then routes to the domain MCP servers.',
  S: 'Domain MCP servers, tools and internal API gateways. Each re-validates the OBO token (iss, aud, exp, scope) and enforces per-API scope against the systems of record.',
};
