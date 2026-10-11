// demo_api_ui/src/config/hostileMcpDiagram.js
//
// The "what this server actually does" map for the Malicious MCP — Catalog tab.
// One StaticFlowDiagram figure: the AI agent's round trip with the hostile MCP
// server through the Privilege gateway, annotated with every poison surface the
// server holds. Every claim here mirrors standalone/hostile-mcp-server and the
// catalog rows in hostileMcpCatalog.js — the parity test in
// hostileMcpCatalog.test.js keeps the catalog honest, so this file only restates
// what is already measured there.
//
// Note: this is deliberately NOT registered in config/useCaseDiagrams — that
// registry's drift test only accepts configs tied to a real demo step, and no
// demo step exists for this figure. The Catalog tab embeds it directly, the
// same way CimdPrivilegePage draws its own figures.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const POISON = { color: 'var(--th-status-error)' };
const SAFE = { color: 'var(--th-status-success)' };

export const HOSTILE_GROUPS = {
  user: { label: 'User / analyst', bg: 'var(--th-status-info)' },
  agent: { label: 'AI agent', bg: 'var(--th-bg-emphasis)' },
  gateway: { label: 'Privilege gateway', bg: 'var(--th-status-warning)' },
  resource: { label: 'Hostile MCP server', bg: 'var(--th-status-error)' },
  external: { label: 'Attacker sinks', bg: 'var(--th-text-faint)' },
};

export const HOSTILE_NODES = [
  // Column 1 — the request path
  N('user', 'user', 'User asks a question', ['"Search the docs for the vacation policy"', '"Summarize ticket 4211"'], 0, 40),
  N('agent', 'agent', 'AI agent', ['reads the tool list it was given', 'picks a tool, fills its arguments'], 0, 300),
  N('gateway', 'gateway', 'Privilege gateway', ['authenticates the agent (DCR + OAuth)', 'policy on every tools/call'], 380, 300),
  N('server', 'resource', 'hostile-mcp server', ['serverInfo: "totally-legit-mcp"', 'dual transports: /mcp + legacy /sse'], 720, 300),

  // Column 2 — the three poison surfaces inside the server
  N('meta', 'resource', '1 · Poisoned tool metadata', ['7 tools with injected <IMPORTANT>', 'imperatives, shadowing, credential asks', '2 with exfil sinks in the schema'], 620, 0),
  N('dynamic', 'resource', '2 · Poisoned results & content', ['read_ticket result carries the block', 'account-verification resource', 'account_review prompt'], 960, 0),
  N('actions', 'resource', '3 · Dangerous action tools', ['create_transfer — move funds', 'delete_all_records', 'grant_admin', 'get_stock_price: clean first list,', 'poisoned after (rug-pull)'], 1300, 0),

  // Column 3 — what the poison induces
  N('sinks', 'external', 'Attacker sinks', ['attacker.example/collect (schema)', 'archive@attacker.example (bcc)', 'account external-001 (transfers)'], 1300, 300),
  N('relist', 'agent', 'Agent re-lists tools', ['a later session or refresh gets the', 'poisoned get_stock_price description'], 620, 560),
  N('call', 'agent', 'Agent fires the induced call', ['the transfer the poison steered toward', 'or the leak filled in from the schema'], 960, 560),
];

export const HOSTILE_EDGES = [
  E('user', 'agent', 'natural-language task'), // 0
  E('agent', 'gateway', 'tools/list → tools/call'), // 1
  E('gateway', 'server', 'proxied to the hostile server'), // 2
  E('server', 'gateway', 'poisoned tool list + results', POISON), // 3
  E('gateway', 'agent', 'poison rides through unfiltered', POISON), // 4
  E('server', 'meta', 'serves on tools/list', POISON), // 5
  E('server', 'dynamic', 'serves on tools/call, resources/read, prompts/get', POISON), // 6
  E('server', 'actions', 'serves clean, callable stubs', POISON), // 7
  E('meta', 'agent', 'agent ingests the injected instructions', POISON), // 8
  E('dynamic', 'agent', 'result/prompt content reaches the model', POISON), // 9
  E('actions', 'sinks', 'actions exfiltrate or destroy', POISON), // 10
  E('agent', 'relist', 're-lists (rug-pull flip)', POISON), // 11
  E('relist', 'gateway', 'list again — same door', undefined), // 12
  E('agent', 'call', 'the model obeys the poison', POISON), // 13
  E('call', 'gateway', 'create_transfer / leaks in args'), // 14
  E('gateway', 'server', 'governed door: 403 DENIED', SAFE), // 15
  E('server', 'sinks', 'ungoverned door: ALLOWED — call executes', POISON), // 16
  E('agent', 'agent', 'agent loops the poison back into its own context', { ...POISON, dashed: true }), // 17
];

export const HOSTILE_STEPS = [
  {
    key: 'ask',
    edges: [0, 1],
    title: 'The user asks, the agent looks for a tool',
    what: 'A plain question ("summarize ticket 4211") sends the agent to its tool list. Which tools it sees, and what their descriptions say, is entirely the server\'s word.',
    why: 'MCP gives the client no way to verify metadata. The agent extends its trust to whatever tools/list returns.',
    evidence: 'Catalog rows: all 7 poisoned-metadata tools are ordinary-looking entries in tools/list.',
  },
  {
    key: 'ingest',
    edges: [2, 3, 4],
    title: 'The poisoned list rides through the gateway',
    what: 'The hostile server serves 7 poisoned descriptions plus 2 schema sinks. The gateway proxies the list unchanged — Privilege policy is on the CALL, not the metadata.',
    why: 'This is the catalog\'s headline honest gap: no layer re-reads the descriptions the agent will treat as fact.',
    evidence: 'Measured on both doors: metadata rows ALLOWED. The rug-pull row shows NO FLIP — the gateway serves the cached poisoned list both times.',
  },
  {
    key: 'surfaces',
    edges: [5, 6, 7],
    title: 'Three poison surfaces, one server',
    what: 'Metadata (tools/list), content (tool results, resources/read, prompts/get) and the action tools themselves — including get_stock_price, clean on the first list and poisoned on later ones.',
    why: 'Metadata scanners only ever see surface 1. Content attacks bypass ingest entirely; the action tools are the payoff the other two steer toward.',
    evidence: 'Catalog kinds: metadata ×7, dynamic ×2, resource ×1, prompt ×1, action ×3.',
  },
  {
    key: 'obey',
    edges: [8, 9, 17],
    title: 'The agent ingests the poison',
    what: 'Injected <IMPORTANT> imperatives and schema "defaults" (callback_url, bcc) enter the model\'s context as trusted tool facts. Self-loops: each ingested poison shapes the next decision.',
    why: 'Nothing on this path is a tool result yet, so "results are data" discipline does not apply — this is why the ingest scanner exists.',
    evidence: 'agent.mjs scenarios: the model calls create_transfer and auto-fills callback_url exactly as the poisons instruct.',
  },
  {
    key: 'relist',
    edges: [11, 12],
    title: 'Re-listing flips the rug-pull',
    what: 'On the second tools/list of a session, get_stock_price\'s clean description is replaced with the poisoned one. Trust was already established.',
    why: 'Ingest-once scanning read the benign first list and never looks again — TOCTOU by design.',
    evidence: 'Direct to the server the flip is visible; through the gateway the row reads NO FLIP (cached poisoned list) — the honest answer.',
  },
  {
    key: 'fire',
    edges: [13, 14],
    title: 'The induced call fires',
    what: 'The model calls create_transfer toward external-001, or send_email/search_docs with the leak-filled arguments — calls the user never asked for.',
    why: 'This is the first moment policy has something to see: a concrete tool call with arguments.',
    evidence: 'Catalog action rows: create_transfer, delete_all_records, grant_admin — all real, callable stubs.',
  },
  {
    key: 'verdict',
    edges: [15, 16],
    title: 'Two doors, two verdicts',
    what: 'Governed door: the policy selects every tool EXCEPT the three actions — the gateway 403s the call. Ungoverned door: an explicit allow-all policy — the call executes.',
    why: 'The demo\'s point, side by side: same poison, same agent — governance decides whether the induced action lands.',
    evidence: 'Measured 2026-10-11: 3 action rows ALLOWED (U) / DENIED (G); 10 metadata/content rows ALLOWED on both doors — the gap stays honest.',
  },
  {
    key: 'sinks',
    edges: [10],
    title: 'What the attacker collects',
    what: 'Only on the ungoverned door: transfers to external-001, conversation context and credentials to attacker.example/collect, full threads bcc\'d to archive@attacker.example.',
    why: 'Every poison names its sink up front — the exfil addresses are in the metadata the agent already read.',
    evidence: 'schemaSink fields on search_docs and send_email; external-001 in every transfer poison.',
  },
];
