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
    B<<->>IAM: User authenticates (redirect to IAM Core and back)
    IAM-->>App: User token: aud = API gateway, sub = user, all three scopes
    end
    rect rgb(218,240,240)
    Note over AG,IAM: Agent identity
    AG->>IAM: Agent authenticates as itself
    IAM-->>AG: Agent token: sub = agentID, aud = AI gateway
    end
    rect rgb(222,240,228)
    Note over AG,IAM: Token exchange (OBO)
    AG<<->>IAM: Token exchange with actor token (agent) and user token
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

// Per-step notes for the movie reel's details row (index = message order, 0-23): what happens, why it matters, and the open
// question when the design has one. Same content as the standalone diagram in docs/planning/scope-to-tool-poc/.
export const POC_FLOW_STEP_DETAILS = [
  {
    "what": "The user opens the application in a browser and starts logging in. Nothing agent-specific has happened yet.",
    "why": "Everything after this hangs off one login session. The user logs in once, not once per tool."
  },
  {
    "what": "The application sends an OIDC authorization request to IAM Core for the client agentClient, asking for all three scopes at once.",
    "why": "This is the only scope consent in the flow. It answers the \"does each scope swap need OIDC consent?\" question: the user consents once, up front, not per tool call.",
    "open": "Does the user see a consent screen for each scope, or is consent implied for this client?"
  },
  {
    "what": "The user authenticates with IAM Core. The arrow is two-way because the browser is redirected to IAM Core and returned afterwards.",
    "why": "This proves who the human is. The password, MFA and similar steps are whatever the customer's policy requires."
  },
  {
    "what": "IAM Core returns a user token to the application.",
    "why": "Note the audience is the API gateway, not the AI gateway. The exchange in step 7 changes the audience. The token already carries all three scopes."
  },
  {
    "what": "The agent authenticates to IAM Core as itself, using its own non-human identity.",
    "why": "The agent gets an identity separate from the user's. That separation lets the later OBO token say \"this user, acting through this agent\"."
  },
  {
    "what": "IAM Core returns an agent token.",
    "why": "It proves who the agent is, but it names no user. It is not used on its own to call tools. It becomes the actor token in step 7."
  },
  {
    "what": "Token exchange with the actor token (agent) and the user token (subject). The result is the OBO token. The arrow is two-way because the agent sends the request and gets the new token back.",
    "why": "This is the only token exchange in the whole flow. It answers \"do we swap scopes on every tool call?\": no. The OBO token carries the full scope set, so the token does not narrow per tool. Authorize does that.",
    "open": "The exchange changes the audience from the API gateway to the AI gateway. The TE policy must allow that."
  },
  {
    "what": "The application asks the agent to do something that needs a write, for example \"update this record\".",
    "why": "The agent, not the application, decides which tool to call."
  },
  {
    "what": "The agent calls the write tool through the MCP Gateway, carrying the OBO token.",
    "why": "The gateway sits in front of the MCP Server and intercepts the call before it reaches the tool."
  },
  {
    "what": "The gateway asks Authorize for a decision. The inputs are the user (sub), the agent (act), the tool and the action.",
    "why": "The decision is made on who the user and agent are and which tool is called, not on token scopes alone. Authorize can plug into any gateway, which is why the same flow should work for the Bedrock gateway and the Privilege gateway."
  },
  {
    "what": "Policy says write requires HITL. Authorize triggers CIBA and returns DENY with an identifier, as an HTTP 403.",
    "why": "The identifier is how the later replay (step 15) is tied to this approval. Because Authorize starts the CIBA request, it also holds the audit record.",
    "open": "Paul has CIBA both started and completed in PAZ. This diagram has the application prompt the user (steps 13-14). Which one do we use?"
  },
  {
    "what": "The gateway rewrites the 403 into a JSON-RPC 2.0 error that carries the identifier, and returns it to the agent.",
    "why": "Google ADK and AWS Strands treat a raw 403 as fatal and kill the session (CJ). A JSON-RPC error looks like an ordinary tool error, so the session survives.",
    "open": "Exact error fields are not defined yet. Can the Bedrock gateway do this rewrite, or only the Privilege gateway?"
  },
  {
    "what": "The agent sees the identifier and asks the application to prompt the user for CIBA acceptance.",
    "why": "The agent never calls CIBA endpoints itself. It only relays the request to the application. This is the one custom behaviour the customer's AI team has to write.",
    "open": "CIBA uses a magic link, so the approval channel is flexible (CJ). The application is only one option."
  },
  {
    "what": "The user accepts. The application tells the agent \"yes\".",
    "why": "This is the human-in-the-loop moment. Approval is recorded against the CIBA request, not trusted from the agent's word."
  },
  {
    "what": "The agent replays the same tool call with the same OBO token, adding a header that contains the identifier.",
    "why": "This is how the approval context gets back to Authorize across the gateway (CJ's question). The agent only echoes the identifier.",
    "open": "The header name is a placeholder."
  },
  {
    "what": "The gateway sends Authorize a second policy decision request, now including the identifier header."
  },
  {
    "what": "Authorize detects the header and checks the CIBA call. The human approved it, so Authorize returns PERMIT.",
    "why": "The agent is not asked to prove the approval. Authorize verifies it. If the request was denied or expired, Authorize denies again."
  },
  {
    "what": "The gateway forwards the tool request to the MCP Server with the OBO token.",
    "why": "The MCP Server sees the user in sub and the agent in act, so downstream audit shows both."
  },
  {
    "what": "The MCP Server calls the Resource Server to do the actual work."
  },
  {
    "what": "The Resource Server returns its result to the MCP Server."
  },
  {
    "what": "As drawn, the MCP Server's response goes to Authorize on its way back, not straight to the gateway.",
    "open": "The diagram does not say why. It is probably response inspection or audit. Confirm with CJ."
  },
  {
    "what": "Authorize passes the response to the gateway."
  },
  {
    "what": "The gateway returns the response to the agent."
  },
  {
    "what": "The agent returns the result to the application, and the user sees it. Done.",
    "open": "Does the next write need approval again, or does one approval cover a time window? This is the \"once versus per action\" question and it is a policy choice in Authorize."
  }
];
