// demo_api_ui/src/components/a2aArchitectureWalkthrough.js
//
// Static walkthrough steps for the /architecture/a2a React Flow token canvas.
// Shape-compatible with the tokenEvents A2ATokenFlowDiagram consumes
// (id / label / explanation / claims / exchangeRequest / protocolRequest /
// protocolResponse) so the same stepper, animated edges, and inspector work.
//
// These are TEACHING values — realistic shapes from docs/ACT_CLAIM_VERIFICATION.md
// and the recorded run — not live data. The learning page
// (/a2a-protocol-learning) shows the live/recorded run instead.

export const A2A_ARCH_WALKTHROUGH_EVENTS = [
  {
    id: 'user-token',
    label: '1 · User signs in — subject token',
    explanation:
      'The browser holds only a session cookie. The user token (sub: the customer) is the SUBJECT that Exchange #1 will delegate from; it never leaves the BFF.',
    claims: {
      sub: 'user-1aee74ae (customer)',
      aud: ['enduser.ping.demo'],
      scope: 'ai:agent:read read transfer openid profile',
      acr: 'Agent-Consent-Login',
      may_act: { sub: 'banking-agent-client' },
    },
  },
  {
    id: 'a2a-agent1-actor',
    label: '2 · Generalist authenticates as itself',
    explanation:
      'The Banking Agent (generalist) obtains its own actor token via client_credentials, scoped to agent:invoke. This token names the generalist as the ACTOR for Exchange #1.',
    claims: {
      client_id: 'banking-agent-client',
      aud: ['agentgateway.ping.demo'],
      scope: 'agent:invoke',
    },
  },
  {
    id: 'a2a-exchange1',
    label: '3 · Exchange #1 — RFC 8693 delegation',
    explanation:
      'PingOne mints a DELEGATED token: sub stays the user, act:{sub:generalist} records who is acting. This is the token the A2A wire hop will carry.',
    exchangeRequest: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: 'a2a-intermediate-<vertical>.ping.demo',
      scope: 'agent:invoke:<vertical>',
    },
    claims: {
      sub: 'user-1aee74ae (unchanged)',
      aud: ['a2a-intermediate-<vertical>.ping.demo'],
      scope: 'agent:invoke:<vertical>',
      act: { sub: 'banking-agent-client' },
    },
  },
  {
    id: 'a2a-agent-card',
    label: '4 · Agent Card discovery (wire, public)',
    explanation:
      'The generalist fetches the specialist Agent Card — unauthenticated by design. It advertises skills, JSONRPC binding, and the pingoneBearer security scheme. Cards are capability metadata; they grant nothing.',
    protocolRequest: {
      method: 'GET',
      url: '/a2a/specialists/:vertical/.well-known/agent-card.json',
    },
    protocolResponse: {
      name: '<Vertical> Specialist',
      protocolVersion: '1.0',
      protocolBinding: 'JSONRPC',
      securitySchemes: ['pingoneBearer (Bearer JWT)'],
      skills: ['sensitive_<vertical>_read'],
    },
  },
  {
    id: 'a2a-protocol-bearer',
    label: '5 · A2A wire hop — SendMessage + bearer',
    explanation:
      'JSON-RPC message/send crosses to the specialist carrying the EXCHANGE #1 delegated token as its bearer (sub: user, act: generalist) — not a client_credentials token, which would prove no user. Header A2A-Version: 1.0.',
    protocolRequest: {
      method: 'message/send',
      headers: {
        Authorization: 'Bearer <Exchange #1 delegated token>',
        'A2A-Version': '1.0',
      },
      message: {
        role: 'user',
        text: 'hand off to a specialist to review the sensitive <vertical> details',
      },
    },
  },
  {
    id: 'a2a-agent2-actor',
    label: '6 · Specialist authenticates as itself',
    explanation:
      'After the hop arrives, the SPECIALIST (in its own process) obtains its own actor token scoped to the A2A intermediate resource — for one sensitive tool only.',
    claims: {
      client_id: '<vertical>-specialist-client',
      aud: ['a2a-intermediate-<vertical>.ping.demo'],
      scope: 'agent:invoke:<vertical>',
    },
  },
  {
    id: 'a2a-exchange2',
    label: '7 · Exchange #2 — nested act chain',
    explanation:
      'The specialist exchanges for the MCP token. PingOne NESTS the chain: act:{sub:specialist, act:{sub:generalist}}, subject still the user. PingOne Authorize decides PERMIT/DENY over this full chain.',
    exchangeRequest: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: 'mcpgateway-a2a.ping.demo',
      scope: '<vertical>:read',
    },
    claims: {
      sub: 'user-1aee74ae (still the user)',
      aud: ['mcpgateway-a2a.ping.demo'],
      scope: '<vertical>:read',
      act: { sub: '<vertical>-specialist-client', act: { sub: 'banking-agent-client' } },
    },
  },
  {
    id: 'a2a-mcp-tool',
    label: '8 · MCP tool call through the gateway',
    explanation:
      'The specialist calls the sensitive MCP tool with the nested-act token. The gateway re-validates audience, scope, and the act chain before the tool runs. No access token ever crosses back over the A2A response boundary — only the result.',
    claims: {
      tool: 'sensitive_<vertical>_read',
      aud: ['mcpgateway-a2a.ping.demo'],
      act: { sub: '<vertical>-specialist-client', act: { sub: 'banking-agent-client' } },
    },
  },
];

export const A2A_ARCH_WALKTHROUGH_LABELS = {
  user: 'User',
  generalist: 'Generalist Agent 1',
  pingone: 'PingOne',
  specialist: 'Specialist Agent 2',
  gateway: 'MCP Gateway',
};
