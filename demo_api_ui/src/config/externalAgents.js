// Single source of truth for the external-agent lesson pages. Content mirrors
// docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md (Agent families,
// coverage matrix, runbook setup) and docs/MUSE_RUNBOOK.md. The drift-guard
// test keeps the three in sync.
//
// path: 'directory' = a consumer assistant. The customer connects only from the
//   assistant's app directory, so `setup` never holds a URL or a paste step.
//   The URL lives in `rehearsal`, which the page shows as "Presenter only".
// path: 'developer' = a CLI or self-hosted client with no directory. Its setup
//   keeps the URL steps and the page labels it "Developer path".
export const STANDARD_DOOR = 'https://cmuir-mcp.ping-devops.com/mcp';
export const AI_GATEWAY_DOOR = '/mcp-facade/privilege-gateway/mcp';

export const EXTERNAL_AGENTS = [
  {
    id: 'muse-app',
    verification: 'expected', // The connection flow below is EXPECTED, not yet app-verified — the verification matrix's app-side cells are all open. Rehearse with the runbook's pre-minted-Bearer fallback before presenting.
    name: 'Muse (consumer app)',
    vendor: 'Meta',
    runsWhere: "Meta's cloud — iOS, Android, web, iPad. Cannot reach the local stack; demos against the SE host.",
    path: 'directory',
    assistant: 'Muse',
    setup: [
      {
        title: 'The bank lists its connector once',
        body: "The bank publishes its connector once in Muse's app directory. Every customer finds the same listing.",
      },
      {
        title: 'Find the bank and click Connect',
        body: "The customer opens Muse's apps directory, finds the bank, and clicks Connect. The customer never types a server address.",
      },
      {
        title: 'Sign in at PingOne',
        body: "The browser opens on the phone or web. The customer signs in at PingOne and approves the consent. Muse's Sentinel holds the credentials, so Muse never sees raw secrets.",
      },
      {
        title: 'Run the read',
        body: '"Show my checking account balance." Watch the token chain on the dashboard: sub=user, act=agent.',
      },
    ],
    rehearsal: 'The bank is not really listed in the Muse directory. To rehearse, the presenter adds it by URL. Prompt Muse: "Build a custom integration. Its MCP server is https://cmuir-mcp.ping-devops.com/mcp, transport streamable HTTP. Connect, inspect the tools, request credentials through the secure credential flow, and keep approval required for anything that writes or spends."',
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only (the phone demo is read-path).',
    failurePlaybook: [
      ['Connector cannot reach the URL', 'Meta cloud cannot resolve private DNS', 'Use the SE host — never localhost or api.ping.demo'],
      ['OAuth step stalls', 'Discovery/PKCE compatibility is the open matrix cell', 'Fallback: pre-minted Bearer via the credential flow (governance intact; login shown out-of-band)'],
    ],
  },
  {
    id: 'muse-code',
    path: 'developer',
    verification: 'expected', // The connection flow below is EXPECTED, not yet app-verified — rehearse it before presenting and paste observed behavior into the verification matrix.
    name: 'Muse Code (CLI)',
    vendor: 'Meta',
    runsWhere: 'Your machine — macOS/Linux/Windows. Install: curl -fsSL https://dev.meta.ai/install.sh | sh. The full two-lane agent.',
    setup: [
      {
        title: 'Install',
        body: 'curl -fsSL https://dev.meta.ai/install.sh | sh, then muse --version.',
      },
      {
        title: 'Point at the standard door',
        body: 'Settings → mcp_servers: {"mcp_servers": {"demo-bank": {"transport": "streamable_http", "url": "https://cmuir-mcp.ping-devops.com/mcp", "mode": "optional"}}}. First tool use triggers OAuth: browser opens, PingOne login, callback to 127.0.0.1.',
      },
      {
        title: 'Governed write',
        body: 'Keep the dashboard open. "Transfer $500 to savings" → P1AZ evaluates → HITL pending on the dashboard → approve → tool runs.',
      },
      {
        title: 'Lane 2 (local BFF)',
        body: 'Add a second server entry with url https://localhost:3001/mcp-facade/privilege-gateway/mcp (the BFF serves TLS on 3001) to walk the Agent Privilege lane.',
      },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['demo-bank not connected', 'Stack down or TLS not trusted', 'Start the stack; trust the mkcert root CA'],
      ['Browser login loops', 'Callback port blocked', 'Re-run the client connect'],
      ['Tool call 401s mid-demo', 'Token expired', 'Muse auto-refreshes; if not, reconnect via /mcp'],
    ],
  },
  {
    id: 'grok-app',
    verification: 'expected', // The connector flow below is EXPECTED, not yet app-verified; DCR compatibility is undocumented by xAI. Rehearse with the pre-registered-client/Bearer fallback before presenting.
    name: 'Grok (custom connector)',
    vendor: 'xAI',
    runsWhere: 'xAI cloud — Grok web/desktop/mobile. Public URL required; demos against the SE host.',
    path: 'directory',
    assistant: 'Grok',
    setup: [
      {
        title: 'The bank lists its connector once',
        body: "The bank publishes its connector once in Grok's connector directory. Every customer finds the same listing.",
      },
      {
        title: 'Find the bank and click Connect',
        body: "The customer opens Grok's connectors directory, finds the bank, and clicks Connect. The customer never types a server address.",
      },
      {
        title: 'Sign in at PingOne',
        body: 'The browser opens the PingOne sign-in. The customer signs in and approves the consent.',
      },
      {
        title: 'Run the read',
        body: '"Show my checking account balance." Watch the token chain on the dashboard: sub=user, act=agent.',
      },
    ],
    rehearsal: "The bank is not really listed in the Grok directory. To rehearse, the presenter adds it by URL: Grok → Connectors → New Connector → Custom, with https://cmuir-mcp.ping-devops.com/mcp. xAI does not document RFC 7591 DCR. If registration fails, pre-register a client (curl -X POST https://cmuir-mcp.ping-devops.com/register ...) and use its fixed credentials, or mint a Bearer from that client and use xAI's Remote MCP API shape (authorization: \"Bearer ...\").",
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only.',
    failurePlaybook: [
      ['Connector rejected the URL', 'Not publicly reachable', 'SE host only — the local stack is unreachable from xAI cloud'],
      ['Registration fails', 'DCR unsupported', 'Pre-registered client or static Bearer fallback'],
    ],
  },
  {
    id: 'grok-cli',
    path: 'developer',
    verification: 'expected', // The connection flow below is EXPECTED, not yet app-verified — rehearse it before presenting.
    name: 'Grok CLI',
    vendor: 'xAI',
    runsWhere: 'Your machine — terminal. Remote HTTP MCP with browser OAuth on first use; credentials persist in ~/.grok/mcp_credentials.json.',
    setup: [
      {
        title: 'Add the remote server',
        body: 'Configure the remote MCP server with the standard-door URL. First use opens the browser for the PingOne login.',
      },
      {
        title: 'Governed write',
        body: 'Same as Muse Code: dashboard open, transfer prompt, approve in the HITL panel.',
      },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['Stale credentials', 'Cached token expired', 'Delete ~/.grok/mcp_credentials.json and reconnect'],
    ],
  },
  {
    id: 'lm-studio',
    path: 'developer',
    verification: 'expected', // The facade-door path has a 2026-09-11 precedent, but this flow is not yet re-verified on the current build — rehearse before presenting.
    name: 'LM Studio',
    vendor: 'Local app',
    runsWhere: 'Your machine. The proven precedent: connected to the facade privilege-gateway door 2026-09-11.',
    setup: [
      {
        title: 'Add the connector',
        body: 'Connectors → Add MCP → remote URL. Standard lane: https://cmuir-mcp.ping-devops.com/mcp. Lane 2 (local): /mcp-facade/privilege-gateway/mcp on the local BFF (https://localhost:3001).',
      },
      {
        title: 'Known quirk',
        body: 'LM Studio falls back to SSE on any non-UnauthorizedError — the doors answer GET deliberately, so use POST-based connect.',
      },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['SSE fallback error', 'Non-401 on GET', 'Use POST-based connect; do not rely on GET /mcp'],
    ],
  },
  {
    id: 'librechat',
    path: 'developer',
    verification: 'expected', // The connection flow below is EXPECTED, not yet app-verified — rehearse it before presenting.
    name: 'LibreChat',
    vendor: 'Open source (in-repo)',
    runsWhere: 'Your machine or docker (librechat/ in this repo).',
    setup: [
      {
        title: 'Configure mcpServers',
        body: 'librechat.yaml: mcpServers: { demo-bank: { type: streamable_http, url: https://cmuir-mcp.ping-devops.com/mcp } }. Lane 2: add a second entry pointing at the facade door (https://localhost:3001/mcp-facade/privilege-gateway/mcp).',
      },
      {
        title: 'Run the flows',
        body: 'Same demo script as Muse Code — read, governed write, lane 2.',
      },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['Server not listed', 'YAML syntax or transport type wrong', 'type: streamable_http exactly; check librechat logs'],
    ],
  },
  {
    id: 'chatgpt',
    verification: 'expected', // The connector flow below is EXPECTED, not yet app-verified — rehearse it before presenting.
    name: 'ChatGPT (connectors)',
    vendor: 'OpenAI',
    runsWhere: 'OpenAI cloud — connector dev mode. Publicly reachable URL required; the local stack needs the SE host or a tunnel.',
    path: 'directory',
    assistant: 'ChatGPT',
    setup: [
      {
        title: 'The bank lists its connector once',
        body: "The bank publishes its connector once in ChatGPT's app directory. Every customer finds the same listing.",
      },
      {
        title: 'Find the bank and click Connect',
        body: "The customer opens ChatGPT's apps directory, finds the bank, and clicks Connect. The customer never types a server address.",
      },
      {
        title: 'Sign in at PingOne',
        body: 'The browser opens the PingOne sign-in. The customer signs in and approves the consent.',
      },
      {
        title: 'Run the read',
        body: '"Show my checking account balance." Watch the token chain on the dashboard: sub=user, act=agent.',
      },
    ],
    rehearsal: 'The bank is not really listed in the ChatGPT directory. To rehearse, the presenter adds it by URL in connector developer mode: Settings → Connectors → add https://cmuir-mcp.ping-devops.com/mcp (the SE host), then complete OAuth in the browser.',
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only.',
    failurePlaybook: [
      ['Connector cannot validate the URL', 'Host not publicly reachable', 'SE host or tunnel; record what works in the verification matrix'],
    ],
  },
];

export function getExternalAgent(id) {
  return EXTERNAL_AGENTS.find((a) => a.id === id) || null;
}
