const { parseHeuristic } = require('../../services/nlIntentParser');

// ── Helpers ───────────────────────────────────────────────────────────────────

function edu(msg) {
  const r = parseHeuristic(msg);
  expect(r.kind).toBe('education');
  return r;
}

function bank(msg) {
  const r = parseHeuristic(msg);
  // 0faf46e6 routed most heuristic banking intents through plugin dispatch:
  // the shape is now { kind:'vertical', vertical:'banking', action, params }.
  // A few pre-dispatch special cases (mcp_tools, vertical_feature_demo) still
  // return the legacy { kind:'banking', banking:{ action } } shape. Accept
  // either, and expose a uniform .banking.action shim so the individual action
  // assertions below verify the SAME routing behaviour (action values unchanged).
  expect(['vertical', 'banking']).toContain(r.kind);
  if (r.kind === 'vertical') {
    expect(r.vertical).toBe('banking');
    return { ...r, banking: { action: r.action, params: r.params } };
  }
  return r;
}

// ── Banking intent ────────────────────────────────────────────────────────────

describe('nlIntentParser — banking intents', () => {
  it('routes "show my accounts" → accounts', () => {
    expect(bank('show my accounts').banking.action).toBe('accounts');
  });

  it('routes "list all accounts" → accounts', () => {
    expect(bank('list all accounts').banking.action).toBe('accounts');
  });

  it('routes "transaction history" → transactions', () => {
    expect(bank('transaction history').banking.action).toBe('transactions');
  });

  it('routes "recent activity" → transactions', () => {
    expect(bank('recent activity').banking.action).toBe('transactions');
  });

  it('routes "transfer money" → transfer', () => {
    expect(bank('transfer money to savings').banking.action).toBe('transfer');
  });

  it('routes "deposit funds" → deposit', () => {
    expect(bank('deposit funds').banking.action).toBe('deposit');
  });

  it('routes "withdraw cash" → withdraw', () => {
    expect(bank('withdraw cash').banking.action).toBe('withdraw');
  });

  it('routes "decode my jwt token" → jwt_decode_demo', () => {
    expect(bank('decode my jwt token').banking.action).toBe('jwt_decode_demo');
  });

  it('routes "decode my token" → jwt_decode_demo', () => {
    expect(bank('decode my token').banking.action).toBe('jwt_decode_demo');
  });
});

// ── Education intents: CIBA ───────────────────────────────────────────────────

describe('nlIntentParser — CIBA education', () => {
  it('routes "explain ciba" → ciba: true', () => {
    const r = edu('explain ciba');
    expect(r.ciba).toBe(true);
  });

  it('routes "backchannel authentication" → ciba: true', () => {
    const r = edu('backchannel authentication');
    expect(r.ciba).toBe(true);
  });

  it('routes "out of band approval" → ciba: true', () => {
    const r = edu('out of band approval');
    expect(r.ciba).toBe(true);
  });

  it('routes "push auth" → ciba: true', () => {
    const r = edu('push auth example');
    expect(r.ciba).toBe(true);
  });
});

// ── Education intents: Token Exchange ─────────────────────────────────────────

describe('nlIntentParser — token exchange education', () => {
  it('routes "what is token exchange" → token-exchange panel', () => {
    expect(edu('what is token exchange').education.panel).toBe('token-exchange');
  });

  it('routes "rfc 8693" keyword → token-exchange panel', () => {
    expect(edu('explain rfc 8693').education.panel).toBe('token-exchange');
  });

  it('routes "delegate token" → token-exchange panel', () => {
    expect(edu('delegate token to agent').education.panel).toBe('token-exchange');
  });
});

// ── Education intents: CIMD (new) ─────────────────────────────────────────────

describe('nlIntentParser — CIMD education', () => {
  it('routes "cimd" → cimd panel', () => {
    expect(edu('what is cimd').education.panel).toBe('cimd');
    expect(edu('what is cimd').education.tab).toBe('what');
  });

  it('routes "client id metadata" → cimd panel', () => {
    expect(edu('client id metadata document').education.panel).toBe('cimd');
  });

  it('routes "client metadata document" → cimd panel', () => {
    expect(edu('explain the client metadata document').education.panel).toBe('cimd');
  });

  it('routes "dynamic client" → cimd panel', () => {
    expect(edu('what is dynamic client registration').education.panel).toBe('cimd');
  });

  it('routes "dcr" keyword → cimd panel', () => {
    expect(edu('how does dcr work').education.panel).toBe('cimd');
  });

  it('routes "rfc 7591" → cimd panel (specific cimd rule now fires before broad rfc fallback)', () => {
    // rfc-index broad rule moved to end of parseEducation(); cimd's rfc.?7591 pattern fires first
    expect(edu('what is rfc 7591').education.panel).toBe('cimd');
  });

  it('routes "register client" → cimd panel', () => {
    expect(edu('how do I register client').education.panel).toBe('cimd');
  });

  it('routes "self register" → cimd panel', () => {
    expect(edu('self register a client').education.panel).toBe('cimd');
  });
});

// ── Education intents: may_act ────────────────────────────────────────────────

describe('nlIntentParser — may_act education', () => {
  it('routes "may_act claim" → may-act panel', () => {
    expect(edu('explain may_act claim').education.panel).toBe('may-act');
  });

  it('routes "act claim" → may-act panel', () => {
    expect(edu('what is the act claim').education.panel).toBe('may-act');
  });

  it('routes "delegation claim" → may-act panel', () => {
    expect(edu('delegation claim in JWT').education.panel).toBe('may-act');
  });
});

// ── Education intents: PKCE / Login Flow ──────────────────────────────────────

describe('nlIntentParser — PKCE / login flow education', () => {
  it('routes "pkce" → login-flow panel, tab pkce', () => {
    const r = edu('what is pkce');
    expect(r.education.panel).toBe('login-flow');
    expect(r.education.tab).toBe('pkce');
  });

  it('routes "code verifier" → login-flow panel, tab pkce', () => {
    const r = edu('code verifier and code challenge');
    expect(r.education.panel).toBe('login-flow');
    expect(r.education.tab).toBe('pkce');
  });

  it('routes "login flow" → login-flow panel', () => {
    expect(edu('explain the login flow').education.panel).toBe('login-flow');
  });

  it('routes "authorization code" → login-flow panel', () => {
    expect(edu('how does authorization code flow work').education.panel).toBe('login-flow');
  });
});

// ── Education intents: step-up ────────────────────────────────────────────────

describe('nlIntentParser — human-in-the-loop education', () => {
  it('routes "human in the loop" → human-in-loop panel', () => {
    expect(edu('what is human in the loop').education.panel).toBe('human-in-loop');
  });

  it('routes "human in the middle" → human-in-loop panel (same demo topic)', () => {
    expect(edu('explain human in the middle for the agent').education.panel).toBe('human-in-loop');
  });

  it('routes HITL → human-in-loop panel', () => {
    expect(edu('what is hitl').education.panel).toBe('human-in-loop');
  });
});

describe('nlIntentParser — step-up education', () => {
  it('routes "step-up" → step-up panel', () => {
    expect(edu('what is step up auth').education.panel).toBe('step-up');
  });

  it('routes "step up" (space) → step-up panel', () => {
    expect(edu('explain step up mfa').education.panel).toBe('step-up');
  });

  it('routes "acr" → step-up panel', () => {
    expect(edu('what does acr value do').education.panel).toBe('step-up');
  });
});

// ── Education intents: introspection ─────────────────────────────────────────

describe('nlIntentParser — introspection education', () => {
  it('routes "introspect" → introspection panel', () => {
    // regex matches `introspect` at word boundary; `introspection` would not match
    expect(edu('explain introspect endpoint').education.panel).toBe('introspection');
  });

  it('routes "7662" → introspection panel', () => {
    expect(edu('rfc 7662').education.panel).toBe('introspection');
  });
});

// ── Education intents: MCP protocol ──────────────────────────────────────────

describe('nlIntentParser — MCP protocol education', () => {
  it('routes "mcp" → mcp-protocol panel', () => {
    expect(edu('what is mcp').education.panel).toBe('mcp-protocol');
  });

  it('routes "model context" → mcp-protocol panel', () => {
    expect(edu('explain model context protocol').education.panel).toBe('mcp-protocol');
  });

  it('routes "json-rpc" → mcp-protocol panel', () => {
    expect(edu('how does json-rpc work in mcp').education.panel).toBe('mcp-protocol');
  });
});

// ── Education intents: agent gateway ─────────────────────────────────────────

describe('nlIntentParser — agent gateway education', () => {
  it('routes "agent gateway" → agent-gateway panel', () => {
    expect(edu('what is the agent gateway').education.panel).toBe('agent-gateway');
  });

  it('routes "resource indicator" → agent-gateway panel', () => {
    expect(edu('resource indicator rfc').education.panel).toBe('agent-gateway');
  });

  it('routes "rfc 8707" → agent-gateway panel', () => {
    expect(edu('explain rfc 8707').education.panel).toBe('agent-gateway');
  });
});

// ── Education intents: PingOne Authorize ─────────────────────────────────────

describe('nlIntentParser — PingOne Authorize education', () => {
  it('routes "pingone authorize" → pingone-authorize panel', () => {
    expect(edu('what is pingone authorize').education.panel).toBe('pingone-authorize');
  });

  it('routes "pdp" → pingone-authorize panel', () => {
    expect(edu('how does the pdp work').education.panel).toBe('pingone-authorize');
  });
});

// ── Agent chip commands — all ACTIONS from BankingAgent.js ───────────────────
// These cover every chip/button in the left-column action list and the
// suggested prompts shown to customers and admins. If a chip label stops
// routing to the expected MCP action this suite will catch it first.

describe('nlIntentParser — agent chip / suggestion commands', () => {
  // Direct action chips
  it('"my accounts" chip → accounts', () => {
    expect(bank('My Accounts').banking.action).toBe('accounts');
  });

  it('"recent transactions" chip → transactions', () => {
    expect(bank('Recent Transactions').banking.action).toBe('transactions');
  });

  it('"check balance" chip → balance', () => {
    expect(bank('Check my account balance').banking.action).toBe('balance');
  });

  it('"account nickname" chip → account_nickname', () => {
    expect(bank('Account nickname').banking.action).toBe('account_nickname');
  });

  it('"show my account nickname" → account_nickname', () => {
    expect(bank('show my account nickname').banking.action).toBe('account_nickname');
  });

  it('suggestion "What is my current balance?" → balance', () => {
    expect(bank('What is my current balance?').banking.action).toBe('balance');
  });

  it('"check balance on checking" → balance with accountType=checking', () => {
    const r = bank('check balance on checking');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params && r.banking.params.accountType).toBe('checking');
  });

  it('"savings balance" → balance with accountType=savings', () => {
    const r = bank('savings balance');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params && r.banking.params.accountType).toBe('savings');
  });

  it('"chk balance" → balance with accountType=checking (alias)', () => {
    const r = bank('chk balance');
    expect(r.banking.action).toBe('balance');
    expect(r.banking.params && r.banking.params.accountType).toBe('checking');
  });

  it('"deposit" chip → deposit', () => {
    expect(bank('Deposit').banking.action).toBe('deposit');
  });

  it('"withdraw" chip → withdraw', () => {
    expect(bank('Withdraw').banking.action).toBe('withdraw');
  });

  it('"transfer" chip → transfer', () => {
    expect(bank('Transfer').banking.action).toBe('transfer');
  });

  it('"list mcp tools" chip → mcp_tools', () => {
    expect(bank('List MCP tools').banking.action).toBe('mcp_tools');
  });

  it('"show available tools" → mcp_tools', () => {
    expect(bank('show available tools').banking.action).toBe('mcp_tools');
  });

  // Suggested prompt chips — customer
  it('suggestion "Transfer $100 to savings" → transfer', () => {
    expect(bank('Transfer $100 to savings').banking.action).toBe('transfer');
  });

  it('suggestion "What are my recent transactions?" → transactions', () => {
    expect(bank('What are my recent transactions?').banking.action).toBe('transactions');
  });

  // Education chips triggered from suggestions
  it('suggestion "What is CIBA?" → ciba education', () => {
    const r = parseHeuristic('What is CIBA?');
    expect(r.kind).toBe('education');
    expect(r.ciba).toBe(true);
  });

  it('suggestion "How does token exchange work?" → token-exchange education', () => {
    const r = parseHeuristic('How does token exchange work?');
    expect(r.kind).toBe('education');
    expect(r.education && r.education.panel).toBe('token-exchange');
  });

  it('suggestion "What is MCP?" → mcp-protocol education', () => {
    const r = parseHeuristic('What is MCP?');
    expect(r.kind).toBe('education');
    expect(r.education && r.education.panel).toBe('mcp-protocol');
  });
});

// ── Fallback / no match ───────────────────────────────────────────────────────

describe('nlIntentParser — fallback', () => {
  it('returns kind none for unrecognised input', () => {
    const r = parseHeuristic('the weather is nice today');
    expect(r.kind).toBe('none');
  });

  it('returns kind none for empty string', () => {
    const r = parseHeuristic('');
    expect(r.kind).toBe('none');
  });

  it('returns kind none for whitespace only', () => {
    const r = parseHeuristic('   ');
    expect(r.kind).toBe('none');
  });

  it('includes a prompt message in fallback', () => {
    const r = parseHeuristic('random unrelated text xyz');
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

// ── biggest_purchase heuristic ────────────────────────────────────────────────

describe('nlIntentParser — biggest_purchase', () => {
  const cases = [
    "what's my biggest purchase",
    "what was my largest transaction",
    "show my largest spend",
    "most expensive purchase",
    "what have i spent the most on",
    "biggest spend this month",
    "highest transaction",
  ];

  cases.forEach((phrase) => {
    it(`routes "${phrase}" → biggest_purchase`, () => {
      expect(bank(phrase).banking.action).toBe('biggest_purchase');
    });
  });

  it('does NOT route plain "transaction history" → biggest_purchase', () => {
    expect(bank('show my transaction history').banking.action).toBe('transactions');
  });
});

// ── spending_summary heuristic ────────────────────────────────────────────────

describe('nlIntentParser — spending_summary', () => {
  const cases = [
    'show me a spending summary',
    'give me a total spend breakdown',
    'how much did i spend this month',
    'where is my money going',
    'breakdown of my spending',
    'spending breakdown',
  ];

  cases.forEach((phrase) => {
    it(`routes "${phrase}" → spending_summary`, () => {
      expect(bank(phrase).banking.action).toBe('spending_summary');
    });
  });
});

// ── Phase 266 — API-key path demo ─────────────────────────────────────────────

describe('nlIntentParser — Phase 266 API-key path demo (api_key_demo)', () => {
  // Test 6: "show special offers" → api_key_demo
  it('Test 6: routes "show special offers" → api_key_demo', () => {
    expect(bank('show special offers').banking.action).toBe('api_key_demo');
  });

  // Test 7: "use the api-key path" → api_key_demo
  it('Test 7: routes "use the api-key path" → api_key_demo', () => {
    expect(bank('use the api-key path').banking.action).toBe('api_key_demo');
  });

  // Test 8: "show me promotions" → api_key_demo
  it('Test 8: routes "show me promotions" → api_key_demo', () => {
    expect(bank('show me promotions').banking.action).toBe('api_key_demo');
  });
});

// ── Phase 266 — Dual-token path demo ─────────────────────────────────────────

describe('nlIntentParser — Phase 266 Dual-token path demo (dual_token_demo)', () => {
  // Test 9: "show my profile card" → dual_token_demo
  it('Test 9: routes "show my profile card" → dual_token_demo', () => {
    expect(bank('show my profile card').banking.action).toBe('dual_token_demo');
  });

  // Test 10: "use the access-and-id-token path" → dual_token_demo
  it('Test 10: routes "use the access-and-id-token path" → dual_token_demo', () => {
    const r = parseHeuristic('use the access-and-id-token path');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('dual_token_demo');
  });
});

// ── Phase 266 — Regression guard (existing actions still work with plugin routing) ────────────────

describe('nlIntentParser — Phase 266 regression guard (existing actions unaffected)', () => {
  // Test 11: "show my balance" still routes to balance action via banking plugin
  it('Test 11: "show my balance" still routes → balance via banking plugin', () => {
    const r = parseHeuristic('show my balance');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('balance');
  });

  // Test 12: "show my accounts" still routes to accounts action via banking plugin
  it('Test 12: "show my accounts" still routes → accounts via banking plugin', () => {
    const r = parseHeuristic('show my accounts');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('accounts');
  });
});

describe('nlIntentParser — account nickname (cross-vertical)', () => {
  const VERTICALS = ['healthcare', 'retail', 'sporting-goods', 'workforce', 'government', 'university', 'manufacturing'];

  for (const vertical of VERTICALS) {
    it(`routes "Account nickname" on ${vertical} → account_nickname (not accounts)`, () => {
      const r = parseHeuristic('Account nickname', vertical);
      expect(r.kind).toBe('banking');
      expect(r.banking.action).toBe('account_nickname');
    });
  }

  it('routes "show my account nickname" on healthcare before view_records', () => {
    const r = parseHeuristic('show my account nickname', 'healthcare');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('account_nickname');
  });
});

