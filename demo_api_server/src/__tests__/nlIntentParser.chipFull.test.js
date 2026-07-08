/**
 * Full chip-heuristic contract tests for nlIntentParser.
 *
 * Covers every chip label and suggestion text that appears in BankingAgent.js
 * and asserts the heuristic produces the expected kind + action/panel.
 *
 * Also covers the two non-banking vertical themes: healthcare and sporting-goods.
 * Admin and retail themes have their own describe blocks at the bottom.
 */
const { parseHeuristic } = require('../../services/nlIntentParser');

// ── helpers ───────────────────────────────────────────────────────────────────

function bank(msg, vertical = 'banking') {
  const r = parseHeuristic(msg, vertical);
  expect(r.kind).toBe('banking');
  return r;
}

function edu(msg, vertical = 'banking') {
  const r = parseHeuristic(msg, vertical);
  expect(r.kind).toBe('education');
  return r;
}

function none(msg, vertical = 'banking') {
  const r = parseHeuristic(msg, vertical);
  expect(r.kind).toBe('none');
  return r;
}

// ── Action chip labels (from BankingAgent.js ACTION_GROUPS) ─────────────────
// Each chip label is the exact string shown in the UI. The heuristic must map
// it to the correct banking action so the chip works in heuristic-only mode.

describe('nlIntentParser — banking action chips (heuristic)', () => {
  // Account group
  it('"My Accounts" chip → accounts', () => {
    expect(bank('My Accounts').banking.action).toBe('accounts');
  });

  it('"Check Balance" chip → balance', () => {
    expect(bank('Check Balance').banking.action).toBe('balance');
  });

  it('"View Sensitive Account Details" chip → sensitive_account_details', () => {
    expect(bank('View Sensitive Account Details').banking.action).toBe('sensitive_account_details');
  });

  // Transaction group
  it('"Recent Transactions" chip → transactions', () => {
    expect(bank('Recent Transactions').banking.action).toBe('transactions');
  });

  it('"Deposit" chip → deposit', () => {
    expect(bank('Deposit').banking.action).toBe('deposit');
  });

  it('"Withdraw" chip → withdraw', () => {
    expect(bank('Withdraw').banking.action).toBe('withdraw');
  });

  it('"Transfer" chip → transfer', () => {
    expect(bank('Transfer').banking.action).toBe('transfer');
  });

  // Admin / tools group
  it('"MCP Tools" chip → mcp_tools', () => {
    expect(bank('MCP Tools').banking.action).toBe('mcp_tools');
  });

  it('"Log Out" chip → logout', () => {
    expect(bank('Log Out').banking.action).toBe('logout');
  });

  // Phase 266 chips
  it('"API-Key Path Demo" chip → api_key_demo', () => {
    expect(bank('API-Key Path Demo').banking.action).toBe('api_key_demo');
  });

  it('"Access + ID-Token Path Demo" chip → dual_token_demo', () => {
    expect(bank('Access + ID-Token Path Demo').banking.action).toBe('dual_token_demo');
  });
});

// ── Suggestion chip texts (customer) ─────────────────────────────────────────
// These are the pre-written prompts shown as clickable suggestion buttons.

describe('nlIntentParser — customer suggestion chips (heuristic)', () => {
  it('"Show me my accounts" → accounts', () => {
    expect(bank('Show me my accounts').banking.action).toBe('accounts');
  });

  it('"Show me my full account details" → sensitive_account_details', () => {
    expect(bank('Show me my full account details').banking.action).toBe('sensitive_account_details');
  });

  it('"Transfer $100 from checking to savings" → transfer with params', () => {
    const r = bank('Transfer $100 from checking to savings');
    expect(r.banking.action).toBe('transfer');
    expect(r.banking.params.amount).toBe(100);
    expect(r.banking.params.fromId).toBe('checking');
    expect(r.banking.params.toId).toBe('savings');
  });

  it('"Deposit $50 into checking" → deposit with params', () => {
    const r = bank('Deposit $50 into checking');
    expect(r.banking.action).toBe('deposit');
    expect(r.banking.params.amount).toBe(50);
  });

  it('"What is my current balance?" → balance', () => {
    expect(bank('What is my current balance?').banking.action).toBe('balance');
  });

  it('"What are my recent transactions?" → transactions', () => {
    expect(bank('What are my recent transactions?').banking.action).toBe('transactions');
  });
});

// ── Suggestion chip texts (admin) ─────────────────────────────────────────────

describe('nlIntentParser — admin suggestion chips (heuristic)', () => {
  it('"Show all customer accounts" → accounts', () => {
    expect(bank('Show all customer accounts').banking.action).toBe('accounts');
  });

  it('"View customer transactions" → transactions', () => {
    expect(bank('View customer transactions').banking.action).toBe('transactions');
  });
});

// ── Education chip labels (from EDUCATION_LABELS in BankingAgent.chips.test.js) ──

describe('nlIntentParser — education chips (heuristic)', () => {
  it('"OAuth: Authorization Code + PKCE" label → login-flow panel', () => {
    const r = edu('what is pkce');
    expect(r.education.panel).toBe('login-flow');
  });

  it('"OAuth: Token exchange (RFC 8693)" → token-exchange panel', () => {
    const r = edu('what is token exchange');
    expect(r.education.panel).toBe('token-exchange');
  });

  it('"MCP protocol" chip text → mcp-protocol panel', () => {
    const r = edu('what is mcp');
    expect(r.education.panel).toBe('mcp-protocol');
  });

  it('"Token introspection (RFC 7662)" → introspection panel', () => {
    const r = edu('explain introspect');
    expect(r.education.panel).toBe('introspection');
  });

  it('"may_act / act claims" → may-act panel', () => {
    const r = edu('explain may_act claim');
    expect(r.education.panel).toBe('may-act');
  });

  it('"AI Agent Best Practices" chip → best-practices panel', () => {
    const r = edu('ai agent best practices');
    expect(r.education.panel).toBe('best-practices');
  });

  it('"CIBA" suggestion → ciba: true (not a panel)', () => {
    const r = parseHeuristic('What is CIBA?');
    expect(r.kind).toBe('education');
    expect(r.ciba).toBe(true);
  });

  it('"Human in the loop" chip → human-in-loop panel', () => {
    const r = edu('what is hitl');
    expect(r.education.panel).toBe('human-in-loop');
  });

  it('"Step-up auth" → step-up panel', () => {
    const r = edu('what is step up auth');
    expect(r.education.panel).toBe('step-up');
  });

  it('"Token Chain" → token-chain panel', () => {
    const r = edu('explain token-chain');
    expect(r.education.panel).toBe('token-chain');
  });

  it('"PAR (RFC 9126)" → par panel', () => {
    const r = edu('what is par');
    expect(r.education.panel).toBe('par');
  });

  it('"RAR (RFC 9396)" → rar panel', () => {
    const r = edu('what is rar');
    expect(r.education.panel).toBe('rar');
  });

  it('"Agentic Maturity Model" → agentic-maturity panel', () => {
    const r = edu('agentic maturity model');
    expect(r.education.panel).toBe('agentic-maturity');
  });

  it('"LangChain" → langchain panel', () => {
    const r = edu('what is langchain');
    expect(r.education.panel).toBe('langchain');
  });

  it('"Agent Gateway / RFC 8707" → agent-gateway panel', () => {
    const r = edu('what is agent gateway');
    expect(r.education.panel).toBe('agent-gateway');
  });

  it('"PingOne Authorize" → pingone-authorize panel', () => {
    const r = edu('what is pingone authorize');
    expect(r.education.panel).toBe('pingone-authorize');
  });

  it('"CIMD / DCR (RFC 7591)" → cimd panel', () => {
    const r = edu('what is cimd');
    expect(r.education.panel).toBe('cimd');
  });
});

// ── Balance variants (chip sends "Check Balance", NL forms vary) ──────────────

describe('nlIntentParser — balance heuristic variants', () => {
  it('"balance" bare word → balance', () => {
    expect(bank('balance').banking.action).toBe('balance');
  });

  it('"show my savings balance" → balance accountType=savings', () => {
    const r = bank('show my savings balance');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params.accountType).toBe('savings');
  });

  it('"checking balance" → balance accountType=checking', () => {
    const r = bank('checking balance');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params.accountType).toBe('checking');
  });

  it('"my current balance" → balance (no account type)', () => {
    const r = bank('my current balance');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params).toBeUndefined();
  });
});

// ── Transfer / deposit / withdraw with amounts ────────────────────────────────

describe('nlIntentParser — amount parsing chips', () => {
  it('"Transfer $250 from savings to checking" → transfer with correct params', () => {
    const r = bank('Transfer $250 from savings to checking');
    expect(r.banking.action).toBe('transfer');
    expect(r.banking.params.amount).toBe(250);
    expect(r.banking.params.fromId).toBe('savings');
    expect(r.banking.params.toId).toBe('checking');
  });

  it('"Withdraw $200 from checking" → withdraw amount=200', () => {
    const r = bank('Withdraw $200 from checking');
    expect(r.banking.action).toBe('withdraw');
    expect(r.banking.params.amount).toBe(200);
    expect(r.banking.params.fromId).toBe('checking');
  });

  it('"Deposit $1000 into savings" → deposit amount=1000 toId=savings', () => {
    const r = bank('Deposit $1000 into savings');
    expect(r.banking.action).toBe('deposit');
    expect(r.banking.params.amount).toBe(1000);
    expect(r.banking.params.toId).toBe('savings');
  });
});

// ── MCP tools chip — never hijacked by education regex ────────────────────────

describe('nlIntentParser — mcp_tools chip immunity to edu regex', () => {
  it('"list mcp tools" → mcp_tools (not education)', () => {
    const r = parseHeuristic('list mcp tools');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('mcp_tools');
  });

  it('"show mcp tools" → mcp_tools', () => {
    expect(bank('show mcp tools').banking.action).toBe('mcp_tools');
  });

  it('"show available tools" → mcp_tools', () => {
    expect(bank('show available tools').banking.action).toBe('mcp_tools');
  });

  it('"get mcp tools" → mcp_tools', () => {
    expect(bank('get mcp tools').banking.action).toBe('mcp_tools');
  });

  it('"what mcp tools are available" → mcp_tools', () => {
    expect(bank('what mcp tools are available').banking.action).toBe('mcp_tools');
  });

  it('"what is mcp" → education (not mcp_tools)', () => {
    const r = parseHeuristic('what is mcp');
    expect(r.kind).toBe('education');
    expect(r.education.panel).toBe('mcp-protocol');
  });
});

// ── Mortgage chip ──────────────────────────────────────────────────────────────

describe('nlIntentParser — mortgage chip', () => {
  it('"show my mortgage" → mortgage_demo', () => {
    expect(bank('show my mortgage').banking.action).toBe('mortgage_demo');
  });

  it('"mortgage balance" → mortgage_demo (NOT generic balance)', () => {
    expect(bank('mortgage balance').banking.action).toBe('mortgage_demo');
  });

  it('"home loan details" → mortgage_demo', () => {
    expect(bank('home loan details').banking.action).toBe('mortgage_demo');
  });

  it('"mortgage" bare word → mortgage_demo', () => {
    expect(bank('mortgage').banking.action).toBe('mortgage_demo');
  });
});

// ── Spending / biggest purchase chips ─────────────────────────────────────────

describe('nlIntentParser — spending_summary and biggest_purchase chips', () => {
  it('"spending summary" → spending_summary', () => {
    expect(bank('spending summary').banking.action).toBe('spending_summary');
  });

  it('"how much did I spend this month" → spending_summary', () => {
    expect(bank('how much did I spend this month').banking.action).toBe('spending_summary');
  });

  it('"biggest purchase" → biggest_purchase', () => {
    expect(bank('biggest purchase').banking.action).toBe('biggest_purchase');
  });

  it('"largest transaction" → biggest_purchase', () => {
    expect(bank('largest transaction').banking.action).toBe('biggest_purchase');
  });

  it('"most expensive purchase" → biggest_purchase', () => {
    expect(bank('most expensive purchase').banking.action).toBe('biggest_purchase');
  });
});

describe('nlIntentParser — unusual_patterns and afford_check chips', () => {
  it('"Check for unusual patterns" → unusual_patterns', () => {
    expect(bank('Check for unusual patterns').banking.action).toBe('unusual_patterns');
  });

  it('"Check for unusual patterns in my recent activity" → unusual_patterns', () => {
    expect(bank('Check for unusual patterns in my recent activity').banking.action).toBe(
      'unusual_patterns',
    );
  });

  it('"Any unusual transactions?" → unusual_patterns', () => {
    expect(bank('Any unusual transactions?').banking.action).toBe('unusual_patterns');
  });

  it('"Could my savings cover a big upcoming expense?" → afford_check', () => {
    expect(bank('Could my savings cover a big upcoming expense?').banking.action).toBe(
      'afford_check',
    );
  });

  it('"can I afford a big expense" → afford_check', () => {
    expect(bank('can I afford a big expense').banking.action).toBe('afford_check');
  });
});

// ── Fallback / none ───────────────────────────────────────────────────────────

describe('nlIntentParser — heuristic none fallback', () => {
  it('empty string → none with message', () => {
    const r = none('');
    expect(typeof r.message).toBe('string');
  });

  it('whitespace → none', () => {
    none('   ');
  });

  it('unrelated phrase → none with catalog message', () => {
    const r = none('the weather is sunny today');
    expect(r.message).toMatch(/can help/i);
    expect(r.message).toMatch(/balance/);
  });
});

// ── Healthcare is now a FIRST-CLASS PLUGIN (not THEME_VOCAB translation) ────────
// Healthcare ships config/verticals/healthcare/index.js, so parseHeuristic routes
// its phrases through the plugin's OWN heuristics → { kind:'vertical', action:<healthcare action> },
// NOT the legacy THEME_VOCAB banking translation. These tests assert the
// post-migration behavior: healthcare phrases resolve to healthcare actions, with
// no banking fallback. (Helper: assert kind:'vertical' + the healthcare action name.)
describe('nlIntentParser — healthcare plugin routing (first-class, not translated)', () => {
  const V = 'healthcare';
  function vertical(msg) {
    const r = parseHeuristic(msg, V);
    expect(r.kind).toBe('vertical');
    expect(r.vertical).toBe('healthcare');
    return r;
  }

  it('"my records" → view_records (its own action, not banking accounts)', () => {
    expect(vertical('my records').action).toBe('view_records');
  });

  it('"patient records" → view_records', () => {
    expect(vertical('patient records').action).toBe('view_records');
  });

  it('"check coverage" → view_coverage (not banking balance)', () => {
    expect(vertical('check coverage').action).toBe('view_coverage');
  });

  it('"my coverage" → view_coverage', () => {
    expect(vertical('my coverage').action).toBe('view_coverage');
  });

  it('"my appointments" → list_appointments (not banking transactions)', () => {
    expect(vertical('my appointments').action).toBe('list_appointments');
  });

  it('"upcoming visits" → list_appointments', () => {
    expect(vertical('upcoming visits').action).toBe('list_appointments');
  });

  it('"book an appointment" → book_appointment (NOVEL action, no banking analog)', () => {
    expect(vertical('book an appointment').action).toBe('book_appointment');
  });

  it('"schedule an appointment" → book_appointment', () => {
    expect(vertical('schedule an appointment').action).toBe('book_appointment');
  });

  it('"release my records" → release_records (not banking transfer)', () => {
    expect(vertical('release my records').action).toBe('release_records');
  });

  it('"share my records" → release_records', () => {
    expect(vertical('share my records').action).toBe('release_records');
  });

  it('a non-matching phrase returns kind:none — NEVER a banking fallback', () => {
    const r = parseHeuristic('the weather is nice', V);
    expect(r.kind).toBe('none');
  });
});

// ── Sporting-goods plugin routing (first-class, not THEME_VOCAB) ──────────────
// sporting-goods ships index.js, so parseHeuristic routes its phrases to
// { kind:'vertical', action:<sporting-goods action> }, not banking translation.
describe('nlIntentParser — sporting-goods plugin routing (first-class)', () => {
  const V = 'sporting-goods';
  function vertical(msg) {
    const r = parseHeuristic(msg, V);
    expect(r.kind).toBe('vertical');
    expect(r.vertical).toBe('sporting-goods');
    return r;
  }

  it('"my gear" → list_gear', () => { expect(vertical('my gear').action).toBe('list_gear'); });
  it('"order history" → list_gear', () => { expect(vertical('order history').action).toBe('list_gear'); });
  it('"my rentals" → list_rentals (novel domain)', () => { expect(vertical('my rentals').action).toBe('list_rentals'); });
  it('"what is due back" → list_rentals', () => { expect(vertical('what is due back').action).toBe('list_rentals'); });
  it('"extend my rental" → extend_rental (novel write)', () => { expect(vertical('extend my rental').action).toBe('extend_rental'); });
  it('"order status" → gear_order_status', () => { expect(vertical('order status').action).toBe('gear_order_status'); });
  it('"my loyalty points" → loyalty_balance', () => { expect(vertical('my loyalty points').action).toBe('loyalty_balance'); });
  it('a non-matching phrase → kind:none (no banking fallback)', () => {
    expect(parseHeuristic('the weather is nice', V).kind).toBe('none');
  });
});

// ── Admin theme chips ─────────────────────────────────────────────────────────

describe('nlIntentParser — admin theme chips', () => {
  const V = 'admin';

  // Admin-specific actions return kind:'vertical' so the UI can route to the
  // correct MCP tool name (lookup_customer, freeze_account, etc.).
  function adminTool(msg) {
    const r = parseHeuristic(msg, V);
    expect(r.kind).toBe('vertical');
    expect(r.vertical).toBe('admin');
    return r;
  }

  it('"look up customer" → lookup_customer', () => {
    expect(adminTool('look up customer').action).toBe('lookup_customer');
  });

  it('"find user" → lookup_customer', () => {
    expect(adminTool('find user').action).toBe('lookup_customer');
  });

  it('"lookup customer" → lookup_customer', () => {
    expect(adminTool('lookup customer').action).toBe('lookup_customer');
  });

  // Admin vertical natively handles these (first-class admin tools).
  it('"view transactions" → get_customer_transactions (admin vertical)', () => {
    expect(adminTool('view transactions').action).toBe('get_customer_transactions');
  });

  it('"customer activity" → transactions (banking fallback)', () => {
    expect(bank('customer activity', V).banking.action).toBe('transactions');
  });

  it('"view profile" → get_customer_profile', () => {
    expect(adminTool('view profile').action).toBe('get_customer_profile');
  });

  it('"customer profile" → get_customer_profile', () => {
    expect(adminTool('customer profile').action).toBe('get_customer_profile');
  });

  it('"account details" (admin) → get_customer_profile', () => {
    expect(adminTool('account details').action).toBe('get_customer_profile');
  });

  it('"get customer accounts" → get_customer_accounts (admin vertical)', () => {
    expect(adminTool('get customer accounts').action).toBe('get_customer_accounts');
  });

  it('"view accounts" → get_customer_accounts (admin vertical)', () => {
    expect(adminTool('view accounts').action).toBe('get_customer_accounts');
  });

  it('"freeze account" → freeze_account', () => {
    expect(adminTool('freeze account').action).toBe('freeze_account');
  });

  it('"suspend the user" → freeze_account', () => {
    expect(adminTool('suspend the user').action).toBe('freeze_account');
  });

  it('"adjust balance" → adjust_balance', () => {
    expect(adminTool('adjust balance').action).toBe('adjust_balance');
  });
});

// ── Retail plugin routing (first-class, not THEME_VOCAB) ──────────────────────
describe('nlIntentParser — retail plugin routing (first-class)', () => {
  const V = 'retail';
  function vertical(msg) {
    const r = parseHeuristic(msg, V);
    expect(r.kind).toBe('vertical');
    expect(r.vertical).toBe('retail');
    return r;
  }

  it('"my orders" → list_orders', () => { expect(vertical('my orders').action).toBe('list_orders'); });
  it('"order history" → list_orders', () => { expect(vertical('order history').action).toBe('list_orders'); });
  it('"order status" → order_status', () => { expect(vertical('order status').action).toBe('order_status'); });
  it('"track my order" → order_status', () => { expect(vertical('track my order').action).toBe('order_status'); });
  it('"my reward points" → rewards_balance', () => { expect(vertical('my reward points').action).toBe('rewards_balance'); });
  it('"store credit" → rewards_balance', () => { expect(vertical('store credit').action).toBe('rewards_balance'); });
  it('"checkout" → checkout', () => { expect(vertical('checkout').action).toBe('checkout'); });
  it('"place an order" → checkout', () => { expect(vertical('place an order').action).toBe('checkout'); });
  it('a non-matching phrase → kind:none (no banking fallback)', () => {
    expect(parseHeuristic('the weather is nice', V).kind).toBe('none');
  });
});
