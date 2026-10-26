// A member's own AI agent meets United's MCP door, as a Mermaid sequenceDiagram for SequenceFlowDiagram.
// Source: docs/personal-agent/On-Users-Personal-Agent-Design.md ("Hop by hop", steps 1-9, revised after the 1 October
// joint architecture review). The nine hops are the phase bands; the messages inside each band are the arrows.
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant M as Member\\nUnited MileagePlus member
    participant K as AI assistant catalog\\ne.g. ChatGPT's app directory
    participant A as Member's own agent\\nChatGPT, mobile assistant, CLI
    participant G as United MCP door\\nPingGateway • public URL
    participant P as PingOne\\nauth server • token service • Agreement
    participant Z as PingOne Authorize + Protect\\npermit • deny • step-up
    participant U as United app\\nmember's phone or united.com
    participant L as Loyalty MCP + Facade\\nholds the DataPower credentials
    participant S as Audit + SIEM\\nthe agent has no write path

    rect rgb(225,229,238)
    Note over K,G: Before hop 1: the company publishes once, members add it free
    G->>K: The company publishes its MCP door to the catalog: URL, auth metadata, branding and privacy policy
    K-->>G: Reviews it and lists it, so any member of the assistant can find it
    M->>K: Browses the catalog and adds the connector: free, nothing to install, no account to create
    K-->>A: The connector appears in the member's own agent, not signed in yet
    end
    rect rgb(226,228,236)
    Note over A,G: 1 Discover
    A->>G: Calls the MCP tool with no token → 401 + resource_metadata
    G-->>A: RFC 9728 protected-resource metadata: the authorization server is PingOne
    end
    rect rgb(226,228,236)
    Note over A,P: 2 Register
    A->>P: Self-registers with a CIMD client document (or DCR, RFC 7591) and gets its own client identity
    end
    rect rgb(222,230,248)
    Note over M,P: 3 Consent
    A->>M: Opens the member's browser to PingOne (authorization code + PKCE)
    M->>P: Passkey or MFA, then consents on a screen that names this agent: read miles, redeem with approval
    P-->>A: Authorization code; the agent redeems it with private_key_jwt client authentication
    end
    rect rgb(255,235,222)
    Note over A,P: 4 Exchange, per call
    A->>P: RFC 8693 exchange for one tool call (private_key_jwt)
    P-->>A: Token: sub = member, act.client_id = agent, aud = one tool, minutes-long lifetime
    end
    rect rgb(218,240,240)
    Note over A,Z: 5 Call through the gateway, 6 Decide
    A->>G: Tool call with the bearer token (no DPoP on PingOne)
    G->>Z: Validates aud and scope against the allowlist, then asks for a verdict on member, agent, tool and amount
    Z-->>G: Permit, deny or step-up; redeeming miles is spending, so approval is required
    end
    rect rgb(255,235,222)
    Note over G,U: 7 Approve what is consequential
    G->>U: Pending approval that names the exact redemption (timeout is denial)
    M->>U: Reviews and approves in United's own app, never in the agent chat
    U-->>G: Single-use approval receipt, spendable only for this transaction
    end
    rect rgb(218,240,240)
    Note over G,L: 8 Permit
    G->>L: Only allowed calls get through; reads ride the delegated token, the redemption carries the approval
    L-->>A: Result returns through the gateway
    end
    rect rgb(225,229,238)
    Note over G,S: 9 Log and revoke
    G->>S: Writes sub, act.client_id, jti, tool and verdict
    P->>S: Authorization server writes the same fields for every exchange
    end
`;

export const UNITED_FLOW_SOURCE = wrapMessages(SOURCE);

// Text for the movie reel's details row, per participant (from the design doc).
export const UNITED_FLOW_DETAILS = {
  K: "The AI assistant vendor's catalog (for example ChatGPT's app directory). The company submits its connector once; the vendor reviews and lists it; members add it from the catalog at no cost. The catalog never holds member credentials: sign-in and consent still happen at the company's own identity provider on first use.",
  M: 'A MileagePlus member. Authenticates United from the agent, but United never sees the member credentials and the agent never sees the member session.',
  A: 'Whatever the member brought: ChatGPT in a browser, a mobile assistant, a coding CLI. United controls none of it and trusts none of it. It holds no standing United credential; it mints a token per call.',
  G: 'The only internet-facing hop. PingGateway MCP module: validates aud and scope, tool allowlist, audit per call. No direct agent-to-resource path exists on the network.',
  P: 'PingOne: sign-in with passkey or MFA, consent through the Agreement step, CIMD or direct-API client registration, and RFC 8693 token exchange. Issues bearer tokens only (no DPoP, no mTLS binding).',
  Z: 'PingOne Authorize evaluates member, agent, tool and amount. PingOne Protect scores the session for agentic automation. Verdicts: permit, deny, step-up.',
  U: 'United\'s own surface, in United\'s branding. One approval, one action; the approval receipt is single-use. The human approves a transaction, never a session.',
  L: 'Accepts only its own audience. Behind it the Facade is the only component holding DataPower credentials; the united.com member session lives in Redis keyed by a hash of the Ping token and is never returned to the client.',
  S: 'Gateway and authorization server write sub, act.client_id, jti and the verdict. Disabling the agent\'s client registration revokes its access within one token lifetime; the member\'s own session is unaffected.',
};

// Wire forms and MOCK tokens shown under each message (index = message order, 0-17). Hosts end in .example and every
// token value is a teaching value, not a real credential. Claims follow the design doc (sub = member,
// act.client_id = agent, one aud, minutes-long lifetime).
const jwt = (title, claims) => `${title} (JWT, MOCK: teaching values only)\n${JSON.stringify(claims, null, 2)}`;

export const UNITED_FLOW_PAYLOADS = [
  'Connector listing (illustrative)\nname: United rewards\nmcp_url: https://mcp.united.example/mcp\nauth: OAuth, found through the 401 and\n  the metadata (hop 1)\nscopes asked: miles:read, miles:redeem\nbranding + privacy policy URL',
  'status: listed\nvisible to: members of the assistant\nprice to the member: free',
  'Add "United rewards"\nprice: free\nnothing to install; sign-in and consent\n  happen on first use (hop 3)',
  'connector: united-rewards\nstate: added, not signed in yet\nfirst use starts discovery (hop 1)',
  'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer\n  resource_metadata="https://mcp.united.example/\n  .well-known/oauth-protected-resource"',
  'resource: https://mcp.united.example/mcp\nauthorization_servers: [PingOne]\nscopes_supported: [miles:read, miles:redeem]',
  'CIMD client document (fetched by URL)\nclient_id: https://agent.example/oauth/client.json\nredirect_uris: [https://agent.example/callback]\ntoken_endpoint_auth_method: private_key_jwt\njwks_uri: https://agent.example/jwks.json',
  null,
  'Consent (recorded through the Agreement step)\nAgent: <named agent> may\n  read miles\n  redeem miles, with approval\nMember: passkey or MFA, then Approve',
  'grant_type: authorization_code\ncode: <AUTHORIZATION_CODE>\ncode_verifier: <PKCE_VERIFIER>\nclient_assertion_type: ...jwt-bearer\nclient_assertion: <JWT signed with the agent\'s key>',
  'grant_type: urn:ietf:params:oauth:grant-type:\n  token-exchange   (RFC 8693)\nsubject_token: <member token>\naudience: <one tool>\nclient_assertion: <private_key_jwt>',
  jwt('Per-call token', { iss: 'https://auth.pingone.example', sub: '<member id>', act: { client_id: 'https://agent.example/oauth/client.json' }, aud: 'https://mcp.united.example/loyalty', scope: 'miles:read', exp: 'iat + a few minutes', jti: '<unique id>' }),
  'POST https://mcp.united.example/mcp\nAuthorization: Bearer <per-call token>\n(no DPoP on PingOne: a bearer, so the short TTL\n and single aud carry the load)',
  'Authorize input: member, agent, tool, amount\nProtect: agentic-automation score on the session',
  'verdict: PERMIT | DENY | STEP-UP\nredeem_miles is spending: approval required',
  'Approval request (illustrative)\nRedeem miles for the SFO-HNL trip in March\nOne approval, one action. Timeout = denial',
  null,
  'approval receipt (single use)\nbound to this transaction only\nspendable once, then void',
  'Loyalty MCP accepts only its own audience\nreads: the delegated token\nwrites: the token + the approval receipt\nFacade: does the DataPower exchange, builds the\n  united.com session in Redis keyed by a hash\n  of the Ping token (never returned to the client)',
  null,
  'audit record\nsub, act.client_id, jti, tool, verdict,\napproval reference',
  'audit record (authorization server)\nsub, act.client_id, jti for every exchange',
];

// Dashboard lane colour per participant (lane keys from SequenceFlowDiagram.css, same families as the dashboard's
// Sequence view): browser/chat = blue, agent = orange, gateway = green, PingOne/Authorize = amber, app/Facade/audit = pink.
export const UNITED_FLOW_LANES = { M: 'browser', K: 'chat', A: 'agent', G: 'gateway', P: 'pingone', Z: 'authz', U: 'bff', L: 'api', S: 'data' };

// The issue overlay: for the first message of each hop, the problem that hop exists to solve (problem), what the hop
// does about it (answer), and where the design is still open (gap, only when the design doc says so). Index = message
// order, 0-21. Every line comes from docs/personal-agent/On-Users-Personal-Agent-Design.md.
export const UNITED_FLOW_ISSUES = (() => {
  const out = new Array(22).fill(null);
  out[0] = {
    title: 'Before hop 1',
    problem: "United cannot know or pre-register a member's own agent. It arrives from outside, unknown.",
    answer: 'The company publishes the connector to the catalog once. Members add it free; the catalog never holds member credentials.',
  };
  out[4] = {
    title: 'Hop 1 · Discover',
    problem: 'An agent with no United relationship has no way to learn how to authenticate, and United must not hand out anything before it knows who is asking.',
    answer: 'The tool call with no token gets a 401 and the RFC 9728 metadata: only where to authenticate, nothing else.',
  };
  out[6] = {
    title: 'Hop 2 · Register',
    problem: "Without its own identity the agent would borrow the member's. Consent, scope and a kill switch would have nothing to name.",
    answer: 'The agent self-registers and gets its own client identity, which United can name in consent, scope and disable.',
    gap: 'On PingOne today: CIMD behind a feature flag, or direct API registration. DCR is not yet available.',
  };
  out[7] = {
    title: 'Hop 3 · Consent',
    problem: 'The member must sign in and consent without their credentials or session ever entering the agent.',
    answer: 'Sign-in and consent happen in the browser at PingOne (code + PKCE). The consent screen names this agent and what it may do.',
  };
  out[10] = {
    title: 'Hop 4 · Exchange, per call',
    problem: 'A standing sign-in token (about an hour, unbound) works on every tool. One stolen bearer is worth an hour of everything.',
    answer: 'A fresh RFC 8693 exchange per call: sub = member, act.client_id = agent, one aud, a lifetime of minutes. private_key_jwt means a stolen token cannot mint more.',
    gap: 'PingOne issues bearer tokens only: no DPoP, no mTLS binding. The short life and single audience replace key binding. PingOne transaction tokens are coming.',
  };
  out[12] = {
    title: 'Hop 5 · Call through the gateway',
    problem: 'Any direct path from the agent to the resource would skip every control behind the door.',
    answer: 'Only PingGateway is reachable. It validates aud and scope against the tool allowlist; no agent-to-resource path exists on the network.',
    gap: 'Because the token is a bearer, validation, the minutes-long TTL and the single-audience binding carry the whole load at this hop.',
  };
  out[13] = {
    title: 'Hop 6 · Decide',
    problem: 'Authorization written as code means every threshold change is a deploy, with no step-up verdicts, and agentic automation looks like a normal session.',
    answer: 'PingOne Authorize decides on member, agent, tool and amount (permit, deny, step-up). Protect scores the session for machine-speed behaviour.',
    gap: "A member's own agent launched outside United's pipeline rides the public door, so the door and Protect's identity-level protections carry that traffic.",
  };
  out[15] = {
    title: 'Hop 7 · Approve what is consequential',
    problem: 'A model can be talked into spending miles, and an approval in the agent chat or a generic push could be forged or auto-accepted.',
    answer: "The member approves the exact redemption in United's own app. One approval, one action; the receipt is single-use and timeout is denial.",
  };
  out[18] = {
    title: 'Hop 8 · Permit',
    problem: 'The united.com credentials must sit where nothing on the agent path can reach them.',
    answer: 'Only the Facade holds the DataPower credentials. The member session lives in Redis keyed by a hash of the Ping token and is never returned to the client.',
    gap: 'Roadmap: a separate clone of the .com API layer for the agentic channel, so nothing on the agent path can affect united.com.',
  };
  out[20] = {
    title: 'Hop 9 · Log and revoke',
    problem: 'Afterwards nobody can say which agent did what for which member, or switch off one agent without signing the member out.',
    answer: "Gateway and authorization server both write sub, act.client_id, jti, tool and verdict. Disabling the agent's client registration revokes it; the member session is untouched.",
    gap: 'Revocation takes effect within one token lifetime (minutes), not instantly.',
  };
  return out;
})();
