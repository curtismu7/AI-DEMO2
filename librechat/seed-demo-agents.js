#!/usr/bin/env node
// Creates (or updates, by name) the four LibreChat demo agents and makes each
// one public, so every LibreChat account sees them with clickable starter
// prompts on the new-chat screen.
//
//   node librechat/seed-demo-agents.js
//
// Needs the librechat/ stack up and `interface.agents.public: true` in
// librechat.yaml (a regular account may not publish otherwise).
//
// Why agents and not modelSpecs: a spec can only attach a whole MCP server,
// and aidemo-mcp exposes 242 tools — OpenAI rejects more than 128 per request
// (400 array_above_max_length, measured 2026-09-13 through the Privilege lane).
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
  for (const def of AGENTS) {
    const body = {
      name: def.name,
      description: def.description,
      instructions: def.instructions,
      provider: PROVIDER,
      model: MODEL,
      tools: [`sys__server__sys_mcp_${SERVER}`, ...def.tools.map((t) => `${t}_mcp_${SERVER}`)],
      conversation_starters: def.conversation_starters,
    };
    const id = existing.get(def.name);
    const saved = id
      ? await call('PATCH', `/api/agents/${id}`, { token, body })
      : await call('POST', '/api/agents', { token, body });
    if (saved.status !== 200 && saved.status !== 201) {
      failed++;
      console.error(`FAIL ${def.name}: ${id ? 'update' : 'create'} ${saved.status} ${saved.text.slice(0, 200)}`);
      continue;
    }
    const agentId = saved.json.id;
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
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
