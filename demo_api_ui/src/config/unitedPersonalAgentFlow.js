// A member's own AI agent meets United's MCP door, as a Mermaid sequenceDiagram for SequenceFlowDiagram.
// Source: docs/personal-agent/On-Users-Personal-Agent-Design.md ("Hop by hop", steps 1-9, revised after the 1 October
// joint architecture review). The nine hops are the phase bands; the messages inside each band are the arrows.
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant M as Member\\nUnited MileagePlus member
    participant A as Member's own agent\\nChatGPT, mobile assistant, CLI
    participant G as United MCP door\\nPingGateway • public URL
    participant P as PingOne\\nauth server • token service • Agreement
    participant Z as PingOne Authorize + Protect\\npermit • deny • step-up
    participant U as United app\\nmember's phone or united.com
    participant L as Loyalty MCP + Facade\\nholds the DataPower credentials
    participant S as Audit + SIEM\\nthe agent has no write path

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
    Note over L: The Facade does the DataPower exchange and builds the united.com session in Redis, keyed by a hash of the Ping token
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
  M: 'A MileagePlus member. Authenticates United from the agent, but United never sees the member credentials and the agent never sees the member session.',
  A: 'Whatever the member brought: ChatGPT in a browser, a mobile assistant, a coding CLI. United controls none of it and trusts none of it. It holds no standing United credential; it mints a token per call.',
  G: 'The only internet-facing hop. PingGateway MCP module: validates aud and scope, tool allowlist, audit per call. No direct agent-to-resource path exists on the network.',
  P: 'PingOne: sign-in with passkey or MFA, consent through the Agreement step, CIMD or direct-API client registration, and RFC 8693 token exchange. Issues bearer tokens only (no DPoP, no mTLS binding).',
  Z: 'PingOne Authorize evaluates member, agent, tool and amount. PingOne Protect scores the session for agentic automation. Verdicts: permit, deny, step-up.',
  U: 'United\'s own surface, in United\'s branding. One approval, one action; the approval receipt is single-use. The human approves a transaction, never a session.',
  L: 'Accepts only its own audience. Behind it the Facade is the only component holding DataPower credentials; the united.com member session lives in Redis keyed by a hash of the Ping token and is never returned to the client.',
  S: 'Gateway and authorization server write sub, act.client_id, jti and the verdict. Disabling the agent\'s client registration revokes its access within one token lifetime; the member\'s own session is unaffected.',
};
