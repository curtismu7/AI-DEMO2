// a2aArchitectureData.js — content for /a2a-architecture.
// DELEGATION_SOURCE is a copy of docs/a2a-delegation-sequence.mmd for FlowDiagram. The docs file writes "#" as "#35;"
// because real Mermaid cuts text at "#"; FlowDiagram does not decode it, so the test compares after decoding.
// The discovery figure mirrors docs/a2a-card-discovery.mmd (three boxes; the capabilities return is folded into the GET arrow's label) as hand-placed nodes.

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

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });

export const DISCOVERY_GROUPS = { ag: { label: "Agents", bg: "var(--th-status-info)" } };

export const DISCOVERY_NODES = [
  N("gen", "ag", "Generalist (Agent 1)", [], 0, 0),
  N("card", "ag", "Agent Card", ["capabilities"], 580, 0),
  N("spec", "ag", "Specialist (Agent 2)", [], 0, 200),
];

export const DISCOVERY_EDGES = [
  ["gen", "card", "GET /a2a/specialists/:vertical/.well-known/agent-card.json; capabilities return"], // 0
  ["gen", "spec", "POST /a2a/specialists/:vertical (JSON-RPC SendMessage)", { vertical: true }], // 1
];
