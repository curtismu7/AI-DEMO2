// POC flow: agent token exchange + CIBA human-in-the-loop, as a Mermaid sequenceDiagram for SequenceFlowDiagram.
// Source: the customer POC sequence diagram (8 participants, 24 messages, in its order). The nine coloured boxes are
// the step groups from docs/planning/scope-to-tool-poc/scope-to-tool-poc-pattern.md (section 9): steps stay individual,
// the boxes only organise them. Proposed pattern, for review: error and header names are placeholders.
import { wrapMessages } from './sequenceWrap';

const SOURCE = `sequenceDiagram
    autonumber
    participant B as Browser
    participant App as Application
    participant IAM as IAM Core\\nPingFederate or PingOne
    participant AG as Agent
    participant GW as MCP Gateway
    participant AZ as Authorize\\npolicy decision + CIBA
    participant MS as MCP Server
    participant RS as Resource Server

    rect rgb(222,230,248)
    Note over B,IAM: User login and user token
    B->>App: User initiates login
    App->>IAM: GET /as/authorize?clientID=agentClient and scope=api:read api:write api:delete
    B->>IAM: User authenticates (redirect to IAM Core and back)
    IAM-->>App: User token: aud = API gateway, sub = user, all three scopes
    end
    rect rgb(218,240,240)
    Note over AG,IAM: Agent identity
    AG->>IAM: Agent authenticates as itself
    IAM-->>AG: Agent token: sub = agentID, aud = AI gateway
    end
    rect rgb(222,240,228)
    Note over AG,IAM: Token exchange (OBO)
    AG->>IAM: Token exchange with actor token (agent) and user token
    end
    rect rgb(236,240,214)
    Note over App,AZ: Write call reaches Authorize
    App->>AG: Write request
    AG->>GW: Write tool call with the OBO token
    GW->>AZ: Policy decision request
    end
    rect rgb(253,226,230)
    Note over AZ,GW: Authorize denies, starts CIBA
    AZ-->>GW: 403 with identifier: write requires HITL, CIBA started
    end
    rect rgb(255,235,214)
    Note over GW,AG: Gateway rewrites the 403
    GW-->>AG: JSON-RPC 2.0 error with the identifier (not a fatal 403)
    end
    rect rgb(246,226,236)
    Note over AG,App: User approves (CIBA)
    AG->>App: Prompt for CIBA acceptance
    App-->>AG: Accept / Yes
    end
    rect rgb(218,234,246)
    Note over AG,AZ: Replay and permit
    AG->>GW: Replay the tool call with a header containing the identifier
    GW->>AZ: Policy decision request
    AZ-->>GW: Permit: header detected, CIBA call checked
    end
    rect rgb(228,231,238)
    Note over GW,App: Tool runs, response returns
    GW->>MS: Tool request with the OBO token
    MS->>RS: MCP processing
    RS-->>MS: Response
    MS-->>AZ: Response
    AZ-->>GW: Response
    GW-->>AG: Response
    AG-->>App: Response
    end
`;

export const POC_FLOW_SOURCE = wrapMessages(SOURCE);

// Text for the movie reel's details row, per participant.
export const POC_FLOW_DETAILS = {
  B: 'The user, signing in from a browser.',
  App: 'The application the user works in. It asks IAM Core for the user token, hands requests to the agent, and shows the CIBA acceptance prompt.',
  IAM: 'PingFederate or PingOne. Authenticates the user and the agent separately, issues the user token and the agent token, and performs the one RFC 8693 token exchange that produces the OBO token (sub = user, act.sub = agent).',
  AG: 'The AI agent, with its own identity. Does one token exchange, sends tool calls through the gateway with the OBO token, and on a HITL error asks the application for CIBA acceptance and replays the call with the identifier. No per-tool scope handling and no sidecar.',
  GW: 'The MCP Gateway (the Bedrock gateway or the Ping Privilege gateway). Asks Authorize for a decision on every call, rewrites a 403 into a JSON-RPC 2.0 error so SDKs that treat a raw 403 as fatal keep the session, and forwards permitted calls with the OBO token.',
  AZ: 'Policy decision point. Decides on who the user and agent are and which tool is called, not on token scopes alone. Writes require HITL: it triggers CIBA and denies with an identifier. On replay it detects the header, checks the CIBA result and permits.',
  MS: 'The MCP server. Receives the tool request with the OBO token, so it sees the user in sub and the agent in act.',
  RS: 'The resource server behind the MCP server, where the write actually happens.',
};

// Wire forms and MOCK tokens under each message (index = message order, 0-23). Teaching values only.
const jwt = (title, claims) => `${title} (JWT, MOCK: teaching values only)\n${JSON.stringify(claims, null, 2)}`;

export const POC_FLOW_PAYLOADS = [
  null,
  'GET https://auth.pingonedemo.org/as/authorize\n  ?clientID=agentClient\n  &scope=api:read api:write api:delete\nThe only scope consent in the flow: the user\nconsents once, up front, not per tool.',
  null,
  jwt('User token', { aud: 'https://apigateway.com', sub: 'user', scopes: 'api:read, api:write, api:delete' }),
  'The agent authenticates to IAM Core as its own\nnon-human identity.',
  jwt('Agent token', { sub: 'agentID', aud: ['https://aigateway.com'] }),
  jwt('OBO token (after the one token exchange)', { sub: 'user', aud: ['https://aigateway.com'], act: { sub: 'agentID' }, scopes: 'api:read, api:write, api:delete' }),
  null,
  'Write tool call\nAuthorization: Bearer <obo_token>',
  'Inputs: user (sub), agent (act), tool, action.\nDecided on who and what, not on scopes alone.',
  'HTTP/1.1 403 Forbidden\nPolicy: write requires HITL. Authorize starts CIBA\nand returns DENY with an identifier.',
  '{ "jsonrpc": "2.0", "id": 1,\n  "error": { "code": -32001,\n    "message": "Approval required",\n    "data": { "identifier": "<ciba request id>" } } }\n(placeholder shape: the field names are not\n defined yet)',
  'The agent never calls CIBA endpoints. It relays the\nrequest to the application.',
  'The user accepts. Approval is recorded against the\nCIBA request, not taken on the agent\'s word.',
  'Same tool call, same OBO token, plus a header:\nX-HITL-Identifier: <identifier>   (placeholder name)',
  null,
  'Detects the header and checks the CIBA call.\nApproved: PERMIT. Denied or expired: DENY again.',
  'Tool request\nAuthorization: Bearer <obo_token>\nThe server sees sub = user and act = agent.',
  null,
  null,
  'Responses pass back through Authorize.',
  null,
  null,
  null,
];
