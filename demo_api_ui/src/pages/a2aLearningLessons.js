'use strict';

/**
 * Lessons derived from the current A2A documentation, kept separate from the
 * page component so the learning contract can be tested without rendering.
 */
export const A2A_LATEST_LESSONS = [
  {
    id: 'tasks-and-artifacts',
    title: 'Tasks are the durable unit of work',
    body: 'A quick answer can be a Message, but long-running work should become a Task with a contextId, taskId, lifecycle states, and versioned Artifacts. Our walkthrough is intentionally one-shot today.',
    href: 'https://a2a-protocol.org/latest/topics/life-of-a-task/',
  },
  {
    id: 'streaming-and-reconnect',
    title: 'Design for progress and reconnects',
    body: 'Use SendStreamingMessage for incremental status and artifact updates, and SubscribeToTask when an SSE connection breaks. Push notifications are the fit for clients that cannot stay connected.',
    href: 'https://a2a-protocol.org/latest/topics/streaming-and-async/',
  },
  {
    id: 'discovery-and-card-security',
    title: 'An Agent Card is capability metadata',
    body: 'Cards describe interfaces, skills, and authentication requirements. They are capability metadata, not delegated authority: identity, runtime, and authorization stay in their own controls. Keep secrets out of cards, protect sensitive cards, verify signatures, and cache them with normal HTTP validators such as ETag.',
    href: 'https://a2a-protocol.org/latest/topics/agent-discovery/',
  },
  {
    id: 'multi-tenant-routing',
    title: 'Make routing explicit when agents are shared',
    body: 'Our vertical is in the URL today. If several tenants share an Agent Card or endpoint, the selected supportedInterfaces entry can advertise an opaque tenant value that the client must echo on every request.',
    href: 'https://a2a-protocol.org/latest/topics/multi-tenancy/',
  },
];

/**
 * Step-by-step explanations for the live/replayed A2A chain shown above.
 * References are intentionally named here and rendered as direct source links.
 */
export const A2A_STEP_EXPLANATIONS = [
  {
    id: 'separate-protocol-and-authority',
    title: 'Separate the protocol from delegated authority',
    body: 'A2A defines how independent agents discover capabilities and exchange messages or tasks. It does not, by itself, decide what a user may access. This demo layers OAuth token exchange and policy authorization alongside the A2A wire protocol; an Agent Card advertises capabilities, not permission.',
    references: ['a2a-spec', 'rfc-8693'],
  },
  {
    id: 'discover-agent-card',
    title: 'Discover the specialist before calling it',
    body: 'The Agent Card describes the specialist name, skills, interface, protocol version, and accepted security schemes. The caller uses that metadata to route and prepare a request. Treat cards as untrusted input, verify their origin/signature according to your trust model, and never put credentials in a card.',
    references: ['a2a-discovery', 'a2a-enterprise'],
  },
  {
    id: 'authenticate-wire-request',
    title: 'Authenticate the A2A request at the transport layer',
    body: 'The caller obtains credentials out of band and sends them using the Agent Card’s declared scheme, typically an Authorization: Bearer header. The message payload is not proof of identity. The specialist validates the bearer and then checks authorization; missing or invalid credentials and valid-but-forbidden requests are different outcomes.',
    references: ['a2a-enterprise', 'pf-token-endpoint'],
  },
  {
    id: 'exchange-generalist-actor',
    title: 'Exchange the user subject for a generalist actor',
    body: 'In Exchange #1, the BFF presents the signed-in user token as the subject and the generalist’s client-credentials token as the actor. The result keeps the user as sub, records the generalist in act, and is narrowed to the specialist-specific audience and invoke scope. The BFF keeps raw tokens out of the browser and model.',
    references: ['rfc-8693', 'pf-browser-login', 'pf-token-exchange', 'pf-client-exchange'],
  },
  {
    id: 'handoff-to-specialist',
    title: 'Hand off only the token intended for the specialist',
    body: 'The generalist sends the specialist an A2A message with the Exchange #1 bearer, not the later tool token. The specialist verifies issuer, signature, expiry, its own audience, invoke scope, and the expected actor chain, then checks that the requested skill/tool is on its allowlist. A public card does not make the message endpoint public.',
    references: ['a2a-spec', 'a2a-enterprise'],
  },
  {
    id: 'exchange-specialist-actor',
    title: 'Exchange again for the specialist and its narrow permission',
    body: 'In Exchange #2, the specialist uses its own client identity as actor and the first delegated token as subject. The resulting act chain records specialist → generalist while sub remains the user. Its audience targets the downstream gateway and its scope is limited to the requested tool; policy must still return PERMIT before dispatch.',
    references: ['rfc-8693', 'pf-token-exchange', 'pf-client-exchange'],
  },
  {
    id: 'authorize-dispatch-and-return',
    title: 'Authorize, dispatch, and return evidence—not credentials',
    body: 'The gateway and resource enforce the final audience, scope, delegation context, and policy decision before the allowlisted tool runs. The specialist returns a result or an explicit error through the A2A response; it must not return or log bearer tokens. For production work that outlives one request, use task status/artifacts and streaming or reconnect patterns, and make retries and failures visible to the caller.',
    references: ['a2a-spec', 'a2a-enterprise', 'aaif-production'],
  },
];

export const A2A_TRAINING_REFERENCES = {
  'a2a-spec': {
    label: 'A2A v1.0 specification',
    href: 'https://a2a-protocol.org/v1.0.0/specification/',
  },
  'a2a-discovery': {
    label: 'A2A Agent discovery',
    href: 'https://a2a-protocol.org/latest/topics/agent-discovery/',
  },
  'a2a-enterprise': {
    label: 'A2A enterprise security guidance',
    href: 'https://github.com/a2aproject/A2A/blob/main/docs/topics/enterprise-ready.md',
  },
  'rfc-8693': {
    label: 'RFC 8693 token exchange',
    href: 'https://www.rfc-editor.org/rfc/rfc8693',
  },
  'aaif-production': {
    label: 'AAIF production lessons',
    href: 'https://aaif.io/blog/what-we-learned-putting-a2a-into-production',
  },
  'pf-token-endpoint': {
    label: 'PingFederate token endpoint and client authentication',
    href: 'https://docs.pingidentity.com/pingfederate/13.1/developers_reference_guide/pf_token_endpoint.html',
  },
  'pf-browser-login': {
    label: 'PingFederate authorization-code login flow',
    href: 'https://docs.pingidentity.com/developer-resources/oauth_20_developer_guide/authorization-code-grant-types.html',
  },
  'pf-token-exchange': {
    label: 'PingFederate OAuth token-exchange guide',
    href: 'https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_config_oauth_token_exchange.html',
  },
  'pf-client-exchange': {
    label: 'PingFederate enable token exchange for OAuth clients',
    href: 'https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_enabl_token_exchang_oauth_client.html',
  },
};

export const A2A_IMPLEMENTATION_STATUS = [
  {
    id: 'one-shot-message',
    label: 'One-shot JSON-RPC message/send',
    state: 'supported',
    detail: 'Live in this walkthrough; the wire bearer and provenance are shown.',
  },
  {
    id: 'signed-agent-cards',
    label: 'Signed Agent Cards',
    state: 'supported',
    detail: 'Live with a local JWKS trust boundary and explicit supportedInterfaces.',
  },
  {
    id: 'stateful-tasks',
    label: 'Stateful tasks, artifacts, and follow-ups',
    state: 'supported',
    detail: 'Opt-in on the specialists: send metadata.task and the reply is a Task whose artifact holds the tool result, stored durably for 24 hours and visible only to the user who made it. A follow-up in the same contextId is a new task in that context. A plain message/send still returns a single Message.',
  },
  {
    id: 'streaming',
    label: 'Streaming',
    state: 'supported',
    detail: 'SendStreamingMessage streams the task, its artifact and the terminal status as server-sent events; the Agent Card advertises streaming.',
  },
  {
    id: 'push-notifications',
    label: 'Push notifications',
    state: 'supported',
    detail: 'A callback is accepted only for an https host on the A2A_PUSH_ALLOWED_HOSTS allowlist that resolves to a public address, and is checked again before every send. With no allowlist the card does not advertise it.',
  },
  {
    id: 'reconnect',
    label: 'Reconnect to a running task',
    state: 'supported',
    detail: 'SubscribeToTask (specialists) and tasks/resubscribe (langchainagent) attach to a task that is still running and send the rest of its events. A caller that drops its stream no longer stops the task or loses its result. Held in memory on one instance, so a task cannot be rejoined after a restart; a finished task cannot be subscribed to.',
  },
];
