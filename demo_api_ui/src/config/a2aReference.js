// A2A reference for presenters: the spec, the interfaces agents can use with
// each other, and which of those this demo implements. Spec facts were read
// from the official specification; repo facts cite the file they came from.
// Items marked "confirm" were not verified.
export const A2A_REFERENCE = {
  specVersion: "v1.0.0 (earlier releases: 0.3.0, 0.2.6, 0.1.0)",
  sources: [
    "a2a-protocol.org/latest/specification",
    "github.com/a2aproject/A2A",
    "a2a-protocol.org/latest/topics/agent-discovery",
    "a2a-protocol.org/latest/topics/a2a-and-mcp",
  ],
  sections: [
    {
      heading: "What A2A is",
      points: [
        "A2A (Agent2Agent) is an open standard for communication and interoperability between independent, opaque agent systems. Agents built on different frameworks can discover each other, negotiate how to interact, and collaborate without sharing internal state, memory or tools.",
        "It is an open-source project under Apache 2.0 that the project README describes as a Linux Foundation project, with Google as the main contributor. The spec site also announces the project joining the Agentic AI Foundation, so confirm the foundation name before quoting it.",
        "SDKs exist for Python, Go, JavaScript, Java, .NET and Rust. The JavaScript one, @a2a-js/sdk, is what this demo uses.",
      ],
    },
    {
      heading: "Interfaces between agents (transports)",
      points: [
        "v1.0 defines three protocol bindings: JSON-RPC 2.0 over HTTP(S), gRPC, and HTTP+JSON/REST. Custom bindings are allowed if they meet the spec's interoperability requirements.",
        "An agent advertises its interfaces in the Agent Card field supportedInterfaces. Each entry gives a url, a protocolBinding (JSONRPC, GRPC or HTTP+JSON), a protocolVersion and an optional tenant, and the client picks one it supports.",
        "Every request carries an A2A-Version header (Major.Minor, for example 1.0). A server that cannot handle the version returns VersionNotSupportedError, and an empty header is read as 0.3.",
        "v0.3 described interfaces with url, preferredTransport and additionalInterfaces; v1.0 replaced them with supportedInterfaces.",
      ],
    },
    {
      heading: "Agent Card",
      points: [
        "The Agent Card is the JSON document an agent publishes for discovery, normally at https://{host}/.well-known/agent-card.json. Cards can also come from curated registries or direct configuration.",
        "Key v1.0 fields: name, description, version, provider, documentationUrl, supportedInterfaces, capabilities (streaming, pushNotifications, extensions, extendedAgentCard), securitySchemes and security requirements, defaultInputModes and defaultOutputModes, skills (id, name, description, tags, examples), and signatures.",
        "Cards can be signed with a JWS over a canonicalized body, and servers should send Cache-Control and an ETag derived from the card version.",
        "An authenticated extended card holds more detail for authorized clients. It is fetched with GetExtendedAgentCard, and only when capabilities.extendedAgentCard is true (in v0.3 the flag was supportsAuthenticatedExtendedCard).",
      ],
    },
    {
      heading: "Messages, tasks and artifacts",
      points: [
        "A Message is one turn of communication. It has a messageId, a role (user or agent), parts, and optional contextId, taskId, metadata and extensions.",
        "A Part carries one piece of content through exactly one of text, raw bytes, a url file reference, or structured data, plus a media type and filename. v1.0 removed the 'kind' discriminator that v0.3 used on parts.",
        "A Task is the stateful unit of work, with an id, a contextId, a status, artifacts and history. An Artifact is a task output made of parts.",
        "v1.0 task states: SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED, COMPLETED, FAILED, CANCELED and REJECTED. Older versions used lower-case names such as 'submitted'.",
        "A reply to a send can be a Message (a quick answer) or a Task (long-running work).",
      ],
    },
    {
      heading: "Operations",
      points: [
        "v1.0 operation names: SendMessage, SendStreamingMessage, GetTask, ListTasks, CancelTask, SubscribeToTask, the four push-notification-config operations (create, get, list, delete) and GetExtendedAgentCard.",
        "These were renamed from v0.3, so say which version you are quoting: message/send became SendMessage, message/stream became SendStreamingMessage, tasks/get became GetTask and tasks/resubscribe became SubscribeToTask.",
        "On the HTTP+JSON binding the same operations map to REST paths. The sources disagreed on exact spellings, so check the spec before quoting a path verbatim.",
      ],
    },
    {
      heading: "Streaming and push notifications",
      points: [
        "Streaming is available only if the card sets capabilities.streaming. SendStreamingMessage and SubscribeToTask return a stream (server-sent events on the HTTP bindings) of Task, Message, status-update and artifact-update objects, and SubscribeToTask reattaches after a dropped connection.",
        "Push notifications are webhooks, available only if capabilities.pushNotifications is true. The client registers a webhook URL and optional credentials for a task, and the agent POSTs status or artifact updates to it. They suit clients that cannot hold a connection open.",
      ],
    },
    {
      heading: "Authentication and authorization",
      points: [
        "A2A treats agents as ordinary enterprise web applications. Identity is handled at the protocol layer (HTTP headers and TLS), not inside the message semantics, and production use must be over HTTPS (TLS for gRPC).",
        "The flow: the client reads securitySchemes from the Agent Card, obtains credentials out-of-band (for example an OAuth 2.0 flow), and sends them on every request. The server authenticates every request and then authorizes it by its own policy (skills, actions, data, scopes).",
        "Scheme types the card can declare: API key, HTTP auth (Bearer and others), OAuth2, OpenID Connect and mutual TLS.",
        "An agent can move a task to AUTH_REQUIRED to ask the client for a credential mid-task; the credential is normally supplied out-of-band.",
        "Extensions are declared in the card as URIs and requested by the client with the A2A-Extensions header. A required extension the client does not support fails with ExtensionSupportRequiredError.",
      ],
    },
    {
      heading: "A2A and MCP",
      points: [
        "They are complementary. MCP connects an agent to tools and resources (vertical, agent-to-tool, stateless structured functions). A2A connects agents to each other (horizontal, autonomous peers in multi-turn dialogue).",
        "The official docs use an auto repair shop as the example: the mechanics use MCP for scanners and manuals, and the shop manager uses A2A to coordinate with customers and supplier agents.",
      ],
    },
    {
      heading: "What this demo implements",
      points: [
        "UC2 and UC2.5 run a real A2A v1.0 JSON-RPC server per vertical specialist at POST /a2a/specialists/:vertical, built with @a2a-js/sdk (demo_api_server/services/a2aProtocolServer.js).",
        "Each specialist publishes an Agent Card at /a2a/specialists/:vertical/.well-known/agent-card.json (a2aAgentCardService.js) with one skill per allowed tool, a JSONRPC supportedInterfaces entry, an HTTP Bearer security scheme, and a JWS signature (a2aCardSigningService.js, keys at /a2a/specialists/.well-known/jwks.json). A /registry endpoint lists the specialists.",
        "The only operation used is SendMessage, and the reply is a single Message with a text part. By default the client calls the SDK in-process, so no HTTP request crosses the wire; setting A2A_PROTOCOL_HTTP=1 sends a real HTTP call with an A2A-Version: 1.0 header (a2aProtocolClient.js).",
        "The hop is authenticated with Authorization: Bearer set to the PingOne Exchange #1 delegated token, validated by middleware/a2aPingOneBearer.js, and the specialist enforces a skill allowlist and a tenant match.",
        "Tasks are stored in LMDB (a2aTaskStore.lmdb.js). A plain SendMessage returns a Message; with metadata.task set the reply is a Task whose artifact holds the tool result, and GetTask returns it to the user who made it. SendStreamingMessage streams the same task, artifact and terminal status.",
      ],
    },
    {
      heading: "What this demo does not implement",
      points: [
        "Push notifications unless configured: the card sets capabilities.pushNotifications only when A2A_PUSH_ALLOWED_HOSTS names a callback host. A callback must be https, on that list and resolve to a public address, and is checked again before every send.",
        "Long-running tasks: reconnecting to a running task is tested with a deliberately slow fake, but the real specialist and agent calls finish in seconds, so a live demo has little time to reconnect. ListTasks and CancelTask are not exercised, and the INPUT_REQUIRED and AUTH_REQUIRED states are not used.",
        "The authenticated extended card (extendedAgentCard is false) and protocol extensions (none declared).",
        "gRPC and HTTP+JSON/REST: the card advertises only the JSON-RPC binding.",
        "Other security scheme types: the card advertises only Bearer, plus an optional signed-credential scheme when ff_verified_trust_a2a is on.",
      ],
    },
    {
      heading: "Other agent-to-agent paths in this demo",
      points: [
        "Identity, not wire protocol: the BFF does RFC 8693 Exchange #1 (sub is the user, act is the generalist) and the specialist does its own Exchange #2 to mint the nested-act token for the MCP call, which never leaves the specialist (a2aDelegationService.js). The Exchange #1 token also serves as the A2A wire bearer.",
        "Orchestrator: POST /init and POST /message in routes/a2aAgentRoutes.js, backed by a2aOrchestratorService.js, is session-based and is not the A2A wire protocol.",
        "UC46 and UC47 go through the PingOne Agent Privilege. Each agent calls with its own Agent Access key, and the gateway checks the key's a2a scope, the policy for the remote agent and the guardrail before forwarding. This is not RFC 8693 delegation, and the BFF relays these runs as server-sent events using a server-held secret, forwarding no browser token (routes/privilegeA2aClient.js).",
        "The LangChain agent exposes its own A2A endpoint (GET /a2a/.well-known/agent-card.json and POST /a2a/jsonrpc) and calls other agents with the message/send method (langchain_agent/src/agent/a2a_delegation.py, a2a_handler.py). That is the v0.3 wire format, not v1.0; whether the live gateway forwards v0.3 or v1.0 was not verified.",
        "Version note: the teaching panes in demo_api_ui/src/pages/a2aTeachingPanes.js are titled 'JSON-RPC message/send', which is the v0.3 method name, while the BFF server code runs v1.0 SendMessage.",
      ],
    },
  ],
};
