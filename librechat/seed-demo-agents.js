#!/usr/bin/env node
// Creates (or updates, by name) the LibreChat demo agents in AGENTS and makes
// each one public, so every LibreChat account sees them with clickable starter
// prompts on the new-chat screen. Each starter also becomes a public Prompts
// library entry (type / in any chat), and each agent's description lists them.
//
//   node librechat/seed-demo-agents.js
//
// Needs the librechat/ stack up and `interface.agents.public` and
// `interface.prompts.public` true in librechat.yaml (a regular account may not
// publish otherwise).
//
// Why agents and not modelSpecs with mcpServers: a spec can only attach a whole
// MCP server, and aidemo-mcp exposes 242 tools — OpenAI rejects more than 128
// per request (400 array_above_max_length, measured 2026-09-13 through the
// Privilege lane). librechat.yaml's modelSpecs only point at these agents.
'use strict';

const LC = process.env.LIBRECHAT_URL || 'http://localhost:3080';
const ACCOUNT = {
  name: 'LibreChat Demo Seed',
  username: 'librechat_demo_seed',
  email: process.env.LIBRECHAT_SEED_EMAIL || 'librechat-demo-seed@example.com',
  password: process.env.LIBRECHAT_SEED_PASSWORD || 'LibreChatDemoSeed!2026',
};
// LibreChat's agents router (uaParser) answers "Illegal request" to any
// User-Agent it does not recognise as a browser.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PROVIDER = 'PingOne Privilege (OpenAI)';
const MODEL = 'gpt-4o-mini';
const SERVER = 'aidemo-mcp';
const ACCOUNT_IDS = 'Call get_my_accounts first to find account IDs; the other account tools take IDs, not account numbers.';
const SS_IDS = 'Rental IDs are 3001-3006 and order IDs 2001-2006; pass IDs as strings.';
// With no tools loaded (e.g. an expired door sign-in) a bare "quote any denial"
// rule made gpt-4o-mini invent "You have been denied by Policy" (4/4 replays).
const POLICY_RULE = 'Always call the tool the user asks for, even if you expect a refusal. If a tool result says "You have been denied by Policy", quote that text word for word. Never say you were denied by policy unless a tool result in this conversation says so. If none of your tools fits the request, say you have no tool for it.';
// Prompts library category; matches the modelSpecs groups in librechat.yaml.
const category = (name) => (name.includes('Policy Guardrails') ? 'Policy Guardrails'
  : ['OpenSearch', 'Super Sports', 'CareConnect'].find((c) => name.startsWith(c)) || 'Banking');
// Prompt commands allow only [a-z0-9-], at most 56 characters.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const agentDescription = (def) => {
  const tools = def.tools.length ? def.tools.join(', ') : 'None (uses handoffs)';
  return `<strong>What it does:</strong> ${def.description}<br><strong>Tools (${def.tools.length}):</strong> ${tools}`;
};
const toolFooterInstruction = (def) => {
  const tools = def.tools.length ? def.tools.join(', ') : 'None — this agent uses handoffs';
  return `After every answer, add a compact footer on separate lines exactly like this:\nAvailable tools (${def.tools.length}): ${tools}\nYou can ask by sending "What tools can I use?"\nIf another instruction requires a trace link at the end, put this footer immediately before that final trace link.`;
};

const AGENTS = [
  {
    name: 'Everyday Banking',
    description: 'Accounts, balances and transactions for the demo customer.',
    instructions: `You are a banking demo assistant. ${ACCOUNT_IDS} Keep answers short.`,
    tools: ['get_my_accounts', 'get_account_balance', 'get_my_transactions', 'search_transactions'],
    conversation_starters: [
      'Show my accounts',
      'What is my balance?',
      'Show my recent transactions',
      'What are my biggest spending categories?',
    ],
  },
  {
    name: 'Money Movement',
    description: 'Transfers, deposits and withdrawals. Changes the demo balances.',
    instructions: `You are a banking demo assistant that moves money. ${ACCOUNT_IDS} Confirm the amount and accounts in your reply.`,
    tools: ['get_my_accounts', 'create_transfer', 'create_deposit', 'create_withdrawal'],
    conversation_starters: [
      'Transfer $300 from checking to savings',
      'Deposit $50 into checking',
      'Withdraw $20 from savings',
      'Show my accounts',
    ],
  },
  {
    name: 'Support and Fees',
    description: 'Fee schedule, fee waiver requests and branch hours.',
    instructions: `You are a banking support demo assistant. ${ACCOUNT_IDS} Keep answers short.`,
    tools: ['get_my_accounts', 'get_fee_schedule', 'request_fee_waiver', 'get_branch_hours'],
    conversation_starters: [
      'What fees do you charge?',
      'Request a fee waiver on my checking account',
      'What are the branch hours?',
      'Show my accounts',
    ],
  },
  {
    name: 'Super Sports',
    description: 'Gear orders and warranties for the Super Sports customer.',
    instructions: 'You are a Super Sports demo assistant. Use show_gear_order for orders and show_gear_warranty for warranties. Keep answers short.',
    tools: ['show_gear_order', 'show_gear_warranty'],
    conversation_starters: [
      'Show my latest gear order',
      'Is my watch still under warranty?',
      'How many warranty claims do I have left?',
      'When was my order delivered?',
    ],
  },
  // The three below read the demo user's seeded Super Sports store
  // (demo_api_server/config/verticals/sporting-goods/seed.json) through the BFF
  // vertical-tool relay. Every starter is read-only.
  {
    name: 'Super Sports Gear & Rentals',
    description: 'Equipment rentals, gear for sale, wishlist and coaching sessions.',
    instructions: `You are the Super Sports demo assistant. ${SS_IDS} Keep answers short.`,
    tools: ['list_rentals', 'browse_gear', 'list_wishlist', 'list_coaching_sessions'],
    conversation_starters: [
      'Show my active equipment rentals',
      'What gear can I buy right now?',
      "What's on my wishlist?",
      'Which coaching sessions do I have booked?',
    ],
  },
  {
    name: 'Super Sports Orders & Loyalty',
    description: 'Gear orders, order status, loyalty points and store credit.',
    instructions: `You are the Super Sports demo assistant. ${SS_IDS} Keep answers short.`,
    tools: ['list_gear', 'gear_order_status', 'loyalty_balance', 'list_store_credit'],
    conversation_starters: [
      'Show my gear orders',
      'Where is my Garmin Forerunner 265 order (2002)?',
      'How many loyalty points do I have?',
      'How much store credit do I have?',
    ],
  },
  {
    name: 'Super Sports Stores & Code',
    description: 'Public store locations and hours, plus a search of this demo\'s source code.',
    // Without the "never ask for a city" line, gpt-4o-mini answered "What Super
    // Sports stores are near me?" with "Please provide your city" and called
    // nothing (measured 2026-09-13).
    instructions: 'You are the Super Sports demo assistant. For any store question, call get_branch_hours right away with vertical "sporting-goods"; add city only when the user names one. If no city is given, list every store it returns — never ask the user for a city first. For code questions call code_search. Keep answers short.',
    tools: ['get_branch_hours', 'code_search'],
    conversation_starters: [
      'What Super Sports stores are near me?',
      "What are the Denver Outfitter's hours?",
      'Where is extend_rental implemented?',
      'Find where PingOne Authorize denies agent-mediated tools',
    ],
  },
  // The agents below use doors other than aidemo-mcp (librechat.yaml). The
  // gateway and Privilege doors need each LibreChat user to Connect once.
  {
    name: 'Super Sports Policy Guardrails',
    server: 'super-sports-gateway',
    description: 'Super Sports through the Agent Gateway: reads are permitted, risky calls are denied by policy.',
    instructions: `You are the Super Sports demo assistant. ${SS_IDS} ${POLICY_RULE}`,
    tools: ['list_rentals', 'loyalty_balance', 'extend_rental', 'sensitive_membership_details'],
    conversation_starters: [
      'Show my active equipment rentals',
      'What is my loyalty points balance?',
      'Extend my Trek Marlin 8 rental (3001) by 2 days',
      'Show my sensitive membership payment details',
    ],
  },
  // The direct and recording-facade lanes expose the full OpenSearch catalog.
  // The straight-to-Privilege opensearch22 lane deliberately demonstrates a
  // policy-restricted catalog with only three tools.
  ...[
    ['OpenSearch22 · Direct', 'OpenSearch · Direct', 'opensearch-direct', 'No Privilege in front: the OpenSearch MCP server over the Mac port-forward.', false, false],
    ['OpenSearch (all tools) · Privilege', 'OpenSearch · via Privilege', 'opensearch-privilege-gateway', 'All OpenSearch tools through the recording façade to the Privilege AI Gateway.', false, true],
    ['OpenSearch22 · Privilege', 'OpenSearch · Privilege opensearch22', 'privilege-opensearch22', 'Three policy-approved tools straight through the Privilege AI Gateway opensearch22 app.', true, false],
  ].map(([name, previousName, server, description, restricted, showFacadeTrace]) => ({
    name,
    previousNames: [previousName],
    server,
    description: `${description} You can ask by sending "What tools can I use?"`,
    includeStartersInDescription: false,
    instructions: `You are an OpenSearch demo assistant. Always call the tool named by the user. For tools that need an index or document ID, discover a real one with ListIndexTool and SearchIndexTool first; never invent one. Keep answers short.${showFacadeTrace ? ' After every tool call, find the reel_url in the tool result and end your reply with a Markdown link labeled "View façade trace". Never invent a trace URL when reel_url is absent.' : ''}`,
    tools: restricted ? ['ClusterHealthTool', 'ListIndexTool', 'CountTool'] : [
      'ListIndexTool',
      'IndexMappingTool',
      'SearchIndexTool',
      'GetShardsTool',
      'GenericOpenSearchApiTool',
      'ClusterHealthTool',
      'CountTool',
      'MsearchTool',
      'ExplainTool',
    ],
    conversation_starters: restricted ? [
      'What is the OpenSearch cluster health?',
      'List the OpenSearch indices',
      'How many documents are in the cluster?',
    ] : [
      'List the OpenSearch indices',
      'Show the mapping for the first non-system index',
      'Search the first non-system index and show 5 documents',
      'Show shard information for the first non-system index',
      'Use the generic OpenSearch API to show cluster stats',
      'What is the OpenSearch cluster health?',
      'How many documents are in the cluster?',
      'Run a multi-search with two count queries',
      'Explain why the first document matches a match-all query',
    ],
  })),
  // The Privilege `aggregate` app (MCP Aggregate): opensearch and banking-mcp
  // behind one URL, each tool prefixed `<server>__`. A few from each side, since
  // all 42 overflow the gpt-oss tier.
  {
    name: 'Privilege Aggregate',
    server: 'privilege-aggregate',
    description: 'One Privilege AI Gateway app aggregating the OpenSearch and banking MCP servers.',
    instructions: 'You are a demo assistant behind one aggregated MCP app. Call opensearch__ClusterHealthTool for cluster health, opensearch__ListIndexTool for indices, banking-mcp__list_banking_accounts for accounts and banking-mcp__get_banking_account for one account. Keep answers short.',
    tools: ['opensearch__ClusterHealthTool', 'opensearch__ListIndexTool', 'banking-mcp__list_banking_accounts', 'banking-mcp__get_banking_account'],
    conversation_starters: [
      'What is the OpenSearch cluster health?',
      'List the OpenSearch indices',
      'List my banking accounts',
    ],
  },
  // Banking and CareConnect (healthcare). The aidemo-mcp agents read the demo
  // user's seeded store; the gateway agents reuse super-sports-gateway, where
  // create_transfer, release_records and sensitive_patient_records are
  // agent-mediated and a signed-in user's token is denied (scope-topology.json).
  {
    name: 'Banking Account Details',
    description: 'Accounts, nicknames, transactions and transaction details.',
    instructions: `You are a banking demo assistant. ${ACCOUNT_IDS} For transaction details, call get_my_transactions first and pass the newest transaction id to get_transaction_detail. Keep answers short.`,
    tools: ['get_my_accounts', 'get_account_nickname', 'get_my_transactions', 'get_transaction_detail'],
    conversation_starters: [
      'Show my accounts',
      "What is my checking account's nickname?",
      'Show my recent transactions',
      'Show the details of my latest transaction',
    ],
  },
  {
    name: 'Banking Policy Guardrails',
    server: 'super-sports-gateway',
    description: 'Banking through the Agent Gateway: reads are permitted, transfers are denied by policy.',
    instructions: `You are a banking demo assistant. ${ACCOUNT_IDS} ${POLICY_RULE}`,
    tools: ['get_my_accounts', 'get_my_transactions', 'create_transfer'],
    conversation_starters: [
      'Show my accounts',
      'Show my recent transactions',
      'Transfer $50 from checking to savings',
    ],
  },
  {
    name: 'CareConnect Health Data',
    description: 'Appointments, medications, lab results and allergies for the CareConnect patient.',
    instructions: 'You are a CareConnect demo assistant. Call the matching tool for each question. Keep answers short.',
    tools: ['list_appointments', 'view_medications', 'view_lab_results', 'view_allergies'],
    conversation_starters: [
      'When is my next appointment?',
      'What medications am I taking?',
      'Show my latest lab results',
      'What am I allergic to?',
    ],
  },
  {
    name: 'CareConnect Coverage & Claims',
    description: 'Insurance coverage, claims, care team and referrals.',
    instructions: 'You are a CareConnect demo assistant. Call the matching tool for each question. Keep answers short.',
    tools: ['view_coverage', 'view_claims', 'view_care_team', 'view_referrals'],
    conversation_starters: [
      'What does my insurance plan cover?',
      'Show my recent claims',
      'Who is on my care team?',
      'Do I have any referrals?',
    ],
  },
  {
    name: 'CareConnect Actions',
    description: 'Refill a prescription or book an appointment. Changes the demo data until the BFF restarts.',
    instructions: 'You are a CareConnect demo assistant that takes actions. Get medication ids from view_medications (Lisinopril is 501) and pass ids as strings. Say exactly what you changed.',
    tools: ['refill_prescription', 'book_appointment', 'view_medications', 'list_appointments'],
    conversation_starters: [
      'Refill my Lisinopril prescription',
      'Book an annual physical with Dr. Sarah Mitchell',
      'What medications am I taking?',
      'When is my next appointment?',
    ],
  },
  {
    name: 'CareConnect Policy Guardrails',
    server: 'super-sports-gateway',
    description: 'CareConnect through the Agent Gateway: reads are permitted, record releases are denied by policy.',
    instructions: `You are a CareConnect demo assistant. ${POLICY_RULE}`,
    tools: ['list_appointments', 'view_medications', 'release_records', 'sensitive_patient_records'],
    conversation_starters: [
      'When is my next appointment?',
      'What medications am I taking?',
      'Release my medical records to Dr. Helen Park',
      'Show my sensitive patient records',
    ],
  },
];

// Same agent, two model paths: each copy keeps the original's tools, instructions
// and starters but runs on the Local LLM Proxy, with no Privilege in front. Stores
// & Code can show a Privilege control (its store answer is sometimes blocked as
// data exfiltration on the Privilege lane — 3/3 on 2026-09-13, passed on
// 2026-09-14); Everyday Banking answers on both.
// gpt-oss-20b is the only local tier that accepts tools (librechat.yaml).
for (const name of ['Everyday Banking', 'Super Sports Stores & Code']) {
  const base = AGENTS.find((a) => a.name === name);
  AGENTS.push({
    ...base,
    name: `${name} · Local model`,
    description: `${base.description} Local LLM Proxy (gpt-oss-20b), no Privilege in front — compare with ${name}.`,
    provider: 'Local LLM Proxy',
    model: 'gpt-oss-20b',
  });
}

// Agent-to-agent handoffs. `handoffs` names target agents; main() saves them as
// LibreChat edges (edgeType 'handoff') once every agent has an id. The handoff
// gives the source a transfer tool, so the target's tools join the conversation
// with no new sign-in or consent.
AGENTS.push({
  name: 'Handoff · Account Viewer',
  description: 'Read-only accounts and balances. Hands money movement to the Money Movement agent, whose write tools then join the chat.',
  instructions: `You are a read-only banking demo assistant. ${ACCOUNT_IDS} You can only look up accounts and balances. For any transfer, deposit or withdrawal, hand off to Money Movement right away. Keep answers short.`,
  tools: ['get_my_accounts', 'get_account_balance'],
  handoffs: [{ to: 'Money Movement', description: 'Transfers, deposits and withdrawals.' }],
  conversation_starters: [
    'Show my accounts',
    'What is my checking balance?',
    'Move $50 from checking to savings',
  ],
});
AGENTS.push({
  name: 'Handoff · Front Desk',
  description: 'No tools of its own: routes each question to Everyday Banking, Super Sports Gear & Rentals or CareConnect Health Data.',
  instructions: 'You are the demo front desk. You have no data tools and never answer from memory. Hand off right away: accounts, balances and transactions go to Everyday Banking; rentals, gear, wishlist and coaching go to Super Sports Gear & Rentals; appointments, medications, labs and allergies go to CareConnect Health Data.',
  tools: [],
  handoffs: [
    { to: 'Everyday Banking', description: 'Accounts, balances and transactions.' },
    { to: 'Super Sports Gear & Rentals', description: 'Equipment rentals, gear for sale, wishlist and coaching sessions.' },
    { to: 'CareConnect Health Data', description: 'Appointments, medications, lab results and allergies.' },
  ],
  conversation_starters: [
    'Show my accounts',
    'Show my active equipment rentals',
    'When is my next appointment?',
  ],
});
AGENTS.push({
  name: 'Handoff · Super Sports Checkout',
  description: 'Reads Super Sports gear orders, then hands payment to the Money Movement agent: one chat reaches two business units.',
  instructions: `You are the Super Sports checkout demo assistant. ${SS_IDS} Look up gear orders yourself. When the user wants to pay for an order, hand off to Money Movement with the order and its amount. Keep answers short.`,
  tools: ['list_gear', 'gear_order_status'],
  handoffs: [{ to: 'Money Movement', description: 'Pay from a bank account: withdrawals and transfers.' }],
  conversation_starters: [
    'Show my gear orders',
    'Where is my Garmin Forerunner 265 order (2002)?',
    // A bare "pay for my order" made Money Movement call create_transfer with an
    // invented payee account ("To account not found", 2/2 on 2026-09-14, even
    // with the handoff description saying withdrawal) — name the withdrawal.
    'Withdraw $449 from checking to pay for order 2002',
  ],
});

// Unattended runs: main() seeds these as schedules owned by this seed account.
// Each run acts as the owner with nobody present and reuses the owner's stored
// MCP sign-in; LibreChat checks the agent's MCP servers before every run.
const TIMEZONE = 'America/Chicago';
const SCHEDULES = [
  { name: 'Morning balance report', agent: 'Everyday Banking', prompt: 'Summarize my balances and my last 5 transactions.', cadence: { frequency: 'daily', hour: 8, minute: 0 } },
  // super-sports-gateway needs this seed account to Connect once (PingOne login)
  // before a run can pass the MCP check.
  { name: 'Daily rentals check', agent: 'Super Sports Policy Guardrails', prompt: 'Show my active equipment rentals.', cadence: { frequency: 'daily', hour: 9, minute: 0 } },
  // $750 is above the demo's consent and step-up thresholds, so the run should
  // stop at human consent (hitl_required) instead of moving money unattended.
  { name: 'Weekly savings sweep', agent: 'Money Movement', prompt: 'Transfer $750 from checking to savings.', cadence: { frequency: 'weekly', hour: 7, minute: 0, daysOfWeek: [1] } },
];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${LC}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

async function login() {
  // A 4xx here means the account already exists.
  await call('POST', '/api/auth/register', { body: { ...ACCOUNT, confirm_password: ACCOUNT.password } });
  const r = await call('POST', '/api/auth/login', { body: { email: ACCOUNT.email, password: ACCOUNT.password } });
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`login ${r.status} (429 = LibreChat login rate limit; wait 5 minutes): ${r.text.slice(0, 200)}`);
  }
  return r.json.token;
}

async function main() {
  const token = await login();
  // requiredPermission=2 (EDIT) lists only agents this account can change.
  const list = await call('GET', '/api/agents?requiredPermission=2', { token });
  if (list.status !== 200) throw new Error(`list agents ${list.status}: ${list.text.slice(0, 200)}`);
  const existing = new Map((list.json.data || []).map((a) => [a.name, a.id]));

  let failed = 0;
  const ids = new Map(); // agent name -> agent_… id, for handoff edges
  for (const def of AGENTS) {
    const server = def.server || SERVER;
    const body = {
      name: def.name,
      // Landing renders descriptions beginning with HTML as sanitized rich text.
      // Keep starters in their cards and use this space for a scannable purpose
      // plus the exact tools attached to the agent.
      description: agentDescription(def),
      instructions: `${def.instructions}\n\n${toolFooterInstruction(def)}`,
      provider: def.provider || PROVIDER,
      model: def.model || MODEL,
      // No server marker without tools: a tool-less agent (Handoff · Front Desk)
      // must not pick up a whole MCP server.
      tools: def.tools.length ? [`sys__server__sys_mcp_${server}`, ...def.tools.map((t) => `${t}_mcp_${server}`)] : [],
      conversation_starters: def.conversation_starters,
    };
    const id = existing.get(def.name)
      || def.previousNames?.map((name) => existing.get(name)).find(Boolean);
    const saved = id
      ? await call('PATCH', `/api/agents/${id}`, { token, body })
      : await call('POST', '/api/agents', { token, body });
    if (saved.status !== 200 && saved.status !== 201) {
      failed++;
      console.error(`FAIL ${def.name}: ${id ? 'update' : 'create'} ${saved.status} ${saved.text.slice(0, 200)}`);
      continue;
    }
    const agentId = saved.json.id;
    ids.set(def.name, agentId);
    // The permissions API keys agents by their Mongo _id, not the agent_… id;
    // the agent_… id there answers 403 "Insufficient permissions".
    const share = await call('PUT', `/api/permissions/agent/${saved.json._id}`, {
      token,
      body: { updated: [], removed: [], public: true, publicAccessRoleId: 'agent_viewer' },
    });
    if (share.status !== 200) {
      failed++;
      console.error(`FAIL ${def.name}: make public ${share.status} ${share.text.slice(0, 200)} (is interface.agents.public true in librechat.yaml, and LibreChat restarted?)`);
      continue;
    }
    console.log(`ok   ${def.name} (${agentId}) ${id ? 'updated' : 'created'}, public`);
  }
  // Edges name agents by id, so they are saved after every agent exists.
  for (const def of AGENTS.filter((a) => a.handoffs)) {
    const from = ids.get(def.name);
    const edges = def.handoffs.map(({ to, description }) => ({ from, to: ids.get(to), edgeType: 'handoff', description }));
    if (!from || edges.some((e) => !e.to)) {
      failed++;
      console.error(`FAIL ${def.name}: a handoff agent was not seeded`);
      continue;
    }
    const r = await call('PATCH', `/api/agents/${from}`, { token, body: { edges } });
    if (r.status !== 200) {
      failed++;
      console.error(`FAIL ${def.name}: edges ${r.status} ${r.text.slice(0, 200)}`);
      continue;
    }
    console.log(`ok   ${def.name} hands off to ${def.handoffs.map((h) => h.to).join(', ')}`);
  }
  // Schedules are created disabled so nothing fires by surprise. "Run now"
  // (POST /api/schedules/:id/run) still fires a disabled one; enabling it in the
  // UI makes it fire on its cadence as this seed account.
  const sched = await call('GET', '/api/schedules', { token });
  if (sched.status !== 200) throw new Error(`list schedules ${sched.status}: ${sched.text.slice(0, 200)}`);
  const haveSchedules = new Map((sched.json.schedules || []).map((s) => [s.name, s.id]));
  for (const s of SCHEDULES) {
    const agentId = ids.get(s.agent);
    if (!agentId) {
      failed++;
      console.error(`FAIL schedule ${s.name}: agent ${s.agent} was not seeded`);
      continue;
    }
    const body = { name: s.name, prompt: s.prompt, agent_id: agentId, cadence: s.cadence, timezone: TIMEZONE };
    const id = haveSchedules.get(s.name);
    // Updates leave `enabled` alone, so a schedule switched on in the UI stays on.
    const r = id
      ? await call('PATCH', `/api/schedules/${id}`, { token, body })
      : await call('POST', '/api/schedules', { token, body: { ...body, enabled: false, clientRequestId: `seed-${slug(s.name)}` } });
    if (r.status !== 200 && r.status !== 201) {
      failed++;
      console.error(`FAIL schedule ${s.name}: ${id ? 'update' : 'create'} ${r.status} ${r.text.slice(0, 200)}`);
      continue;
    }
    console.log(`ok   schedule ${s.name} (${r.json.id}) ${id ? 'updated' : 'created, disabled'}`);
  }
  failed += await seedPrompts(token);
  if (failed) process.exit(1);
}

// One public Prompts library entry per starter: starters only render on an
// empty new chat, while / lists prompts in any chat. Named "<agent> · <starter>"
// and updated by name; entries this account owns that match no starter any
// more are deleted.
async function seedPrompts(token) {
  const want = new Map();
  for (const def of AGENTS) {
    def.conversation_starters.forEach((text, i) => {
      want.set(`${def.name} · ${text}`, {
        text,
        group: { category: category(def.name), oneliner: `Use with the ${def.name} agent.`, command: `${slug(def.name)}-${i + 1}` },
      });
    });
  }
  const mine = new Map();
  for (let after = null, more = true; more;) {
    const r = await call('GET', `/api/prompts/groups?pageSize=100${after ? `&cursor=${after}` : ''}`, { token });
    if (r.status !== 200) throw new Error(`list prompts ${r.status}: ${r.text.slice(0, 200)}`);
    for (const g of r.json.promptGroups) if (g.authorName === ACCOUNT.name) mine.set(g.name, g._id);
    ({ has_more: more, after } = r.json);
  }

  let failed = 0;
  for (const [name, { text, group }] of want) {
    const id = mine.get(name);
    const saved = id
      ? await call('PATCH', `/api/prompts/groups/${id}`, { token, body: group })
      : await call('POST', '/api/prompts', { token, body: { prompt: { prompt: text, type: 'text' }, group: { name, ...group } } });
    if (saved.status !== 200) {
      failed++;
      console.error(`FAIL prompt ${name}: ${id ? 'update' : 'create'} ${saved.status} ${saved.text.slice(0, 200)}`);
      continue;
    }
    const share = await call('PUT', `/api/permissions/promptGroup/${id || saved.json.group._id}`, {
      token,
      body: { updated: [], removed: [], public: true, publicAccessRoleId: 'promptGroup_viewer' },
    });
    if (share.status !== 200) {
      failed++;
      console.error(`FAIL prompt ${name}: make public ${share.status} ${share.text.slice(0, 200)} (is interface.prompts.public true in librechat.yaml, and LibreChat restarted?)`);
    }
  }
  for (const [name, id] of mine) {
    if (want.has(name)) continue;
    const d = await call('DELETE', `/api/prompts/groups/${id}`, { token });
    if (d.status !== 200) failed++;
    console.log(`${d.status === 200 ? 'ok  ' : 'FAIL'} deleted stale prompt ${name}`);
  }
  console.log(`${failed ? 'FAIL' : 'ok  '} ${want.size} prompts in the Prompts library (${failed} failed)`);
  return failed;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
