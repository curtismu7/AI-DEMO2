// a2aArchitectureData.js — DELEGATION_SOURCE is a copy of docs/a2a-delegation-sequence.mmd (the text people paste into Lucid).
// The docs file writes "#" as "#35;" because real Mermaid cuts text at "#", so the test compares after decoding.
// The page draws the same flow as boxes and numbered arrows from config/a2aArchitectureDiagram.js.

export const DELEGATION_SOURCE = `sequenceDiagram
    autonumber
    participant U as Browser (demo_api_ui)
    participant G as Generalist Agent 1 (BFF)
    participant P as PingOne Authorize
    participant S as Specialist Agent 2
    participant M as A2A MCP Gateway

    U->>G: UC2 request (session cookie)
    G->>P: Exchange #1 — RFC 8693 token exchange
    Note over G,P: Delegated token: sub=user, act={sub:generalist}
    G->>S: A2A wire hop — JSON-RPC SendMessage<br/>Bearer = Exchange #1 token, A2A-Version: 1.0
    S->>P: Exchange #2 — nested-act token exchange<br/>act={sub:specialist, act:{sub:generalist}}
    P->>P: Authorize approves nested act chain
    S->>M: MCP tool call (nested-act token)
    M-->>S: Tool result
    S-->>G: JSON-RPC response
    G-->>U: Result + token-chain events<br/>(a2a-protocol-bearer → a2a-agent-card → a2a-protocol-message)
`;
