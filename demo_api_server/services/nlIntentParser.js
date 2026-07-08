// banking_api_server/services/nlIntentParser.js
/**
 * Heuristic NL → education panel or banking action (no external LLM).
 * Keeps the Banking Agent useful without API keys (MasterFlow-style UX, zero-cost path).
 */
"use strict";

const verticalDispatch = require("./verticalDispatch");

const VERTICAL_FEATURE_RE =
  /\b(show|view|see|get|my)\s*(large\s*purchase|big\s*purchase|recent\s*purchase|health\s*records?|medical\s*records?|gear\s*order|equipment\s*order|sports?\s*order|expense\s*report|expenses?\s*report)\b|^(large|big)\s*purchase$|^health\s*record$|^gear\s*order$|^expense\s*report$|\bshow\s+vertical\s+feature\b/;

// Per-vertical feature-demo triggers. The pre-plugin feature check (parseHeuristic)
// runs ONLY the active vertical's trigger — never another vertical's phrases — so a
// global feature regex can't leak across verticals. healthcare is verb-anchored
// (show/view/see/get) on purpose so "share/release my medical records" falls through
// to the release_records heuristic instead of the feature demo. A vertical absent
// from this map (no feature page) skips the feature check entirely.
const PURCHASE_FEATURE_RE =
  /\b(show|view|see|get|my)\s*(large|big|recent)\s*purchases?\b|^(large|big)\s*purchase$/;
const FEATURE_TRIGGERS = {
  banking: PURCHASE_FEATURE_RE,
  retail: PURCHASE_FEATURE_RE,
  healthcare:
    /\b(show|view|see|get)\s+(my\s+)?(health|medical)\s+records?\b|^health\s*records?$/,
  "sporting-goods":
    /\b(show|view|see|get|my)\s*(gear|equipment|sports?)\s*orders?\b|^gear\s*order$/,
  workforce:
    /\b(show|view|see|get|my)\s*expenses?\s*reports?\b|^expense\s*report$/,
};

const EDU = {
  // existing — keep exactly as-is
  LOGIN_FLOW: "login-flow",
  TOKEN_EXCHANGE: "token-exchange",
  MAY_ACT: "may-act",
  MCP_PROTOCOL: "mcp-protocol",
  INTROSPECTION: "introspection",
  AGENT_GATEWAY: "agent-gateway",
  RFC_INDEX: "rfc-index",
  STEP_UP: "step-up",
  PINGONE_AUTHORIZE: "pingone-authorize",
  CIMD: "cimd",
  CUA: "cua",
  HUMAN_IN_LOOP: "human-in-loop",
  // new for Phase 231 — values verified against educationIds.js
  BEST_PRACTICES: "best-practices",
  PAR: "par",
  RAR: "rar",
  JWT_CLIENT_AUTH: "jwt-client-auth",
  AGENTIC_MATURITY: "agentic-maturity",
  OIDC_21: "oidc-21",
  LANGCHAIN: "langchain",
  AGENT_BUILDER_LANDSCAPE: "agent-builder-landscape",
  LLM_LANDSCAPE: "llm-landscape",
  SENSITIVE_DATA: "sensitive-data",
  AI_PLATFORM_LANDSCAPE: "ai-platform-landscape",
  PINGGATEWAY_MCP: "pinggateway-mcp",
  ARCHITECTURE_DIAGRAM: "architecture-diagram",
  TOKEN_CHAIN: "token-chain",
  RFC_8693: "rfc-8693",
  FLOW_DIAGRAMS: "flow-diagrams",
  IETF_STANDARDS: "ietf-standards",
  TOKEN_FLOW: "token-flow",
  AI_PRIMER: "ai-primer",
  ID_JAG: "id-jag",
};

// Single source for the deterministic capability list. The Mode-1
// (Heuristics-only) no-match reply derives from THIS — no second
// hand-maintained list.
const CAPABILITY_CATALOG = [
  'balance — "show my checking balance" / "what\'s my savings balance"',
  'accounts — "show my accounts" / "account details" / "routing number"',
  'transactions — "recent transactions" / "account history" / "activity"',
  'transfer — "transfer $100 from checking to savings"',
  'deposit — "deposit $50 into savings"',
  'withdraw — "withdraw $200 from checking"',
  'spending summary — "spending summary" / "how much did I spend" / "biggest purchase"',
  'mortgage — "show my mortgage" / "home loan details"',
  'branches — "what branches are near me?" / "branch hours in Austin"',
  'MCP tools — "list available tools" / "show mcp tools"',
  'education — "explain token exchange" / "what is CIBA" / "how does step-up work"',
];

/**
 * Build the heuristics-only capability catalog.
 *
 * Banking (no verticalCtx) returns the original hand-authored list verbatim —
 * regression-safe default. For any non-banking vertical, the catalog is derived
 * from the active manifest so heuristics speaks the vertical's own language
 * (e.g. "My Gear", "Reward Points") instead of banking terms. This satisfies
 * the absolute rule that every agent path works with every vertical.
 *
 * @param {{ terminology?: object, chips?: Array<{key:string,label:string}> }} [verticalCtx]
 *   Active vertical's terminology + chips. Omit/null for banking.
 */
function buildCatalogMessage(verticalCtx) {
  const items = buildCatalogItems(verticalCtx);
  return (
    `I can help with:\n` +
    items.map((c) => `  • ${c}`).join("\n") +
    `\n\n(Heuristics-only mode — no LLM. Pick a different agent mode for ` +
    `full natural-language understanding.)`
  );
}

/**
 * The catalog item list. Banking (no terminology) returns the original
 * hand-authored CAPABILITY_CATALOG verbatim. For non-banking verticals the
 * items are derived from manifest terminology + chip labels.
 */
function buildCatalogItems(verticalCtx) {
  const term = verticalCtx?.terminology;
  if (!term) return CAPABILITY_CATALOG;

  // Prefer chip labels (already domain phrased) for the example text; fall back
  // to terminology nouns. Education + MCP tools are cross-vertical infra.
  const chipByKey = new Map(
    (verticalCtx?.chips || []).map((c) => [c?.key, c?.label]),
  );
  const chipLabel = (key, fallback) => chipByKey.get(key) || fallback;
  const accounts = term.accounts || "accounts";
  const balance = term.balance || "balance";
  const transactions = term.transactions || "transactions";
  const highValue = term.highValueAction || chipLabel("transfer", "transfer");

  return [
    `${balance} — "${chipLabel("balance", `show my ${balance}`)}"`,
    `${accounts} — "${chipLabel("accounts", `show my ${accounts}`)}"`,
    `${transactions} — "${chipLabel("transactions", `recent ${transactions}`)}"`,
    `${highValue} — "${chipLabel("transfer", highValue)}"`,
    `MCP tools — "list available tools" / "show mcp tools"`,
    `education — "explain token exchange" / "what is CIBA" / "how does step-up work"`,
  ];
}

function buildAdminCatalogMessage() {
  return (
    `I can help with:\n` +
    `  • Look up customer — "find user by email" / "search customer"\n` +
    `  • Customer profile — "show customer profile" / "view account details"\n` +
    `  • Freeze/unfreeze account — "freeze user account" / "unlock account"\n` +
    `  • Reset password — "reset customer password"\n` +
    `  • Transactions — "view transactions" / "recent activity"\n` +
    `  • Accounts — "show my accounts" / "check balance"\n` +
    `  • MCP tools — "list available tools" / "show mcp tools"\n` +
    `  • education — "explain token exchange" / "what is CIBA" / "how does step-up work"\n\n` +
    `(Admin mode — Heuristics-only. Pick a different agent mode for full natural-language understanding.)`
  );
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shared dollar-amount matcher: "$999", "79 dollars", or a bare "79".
// Group 1 = "$N" form, group 2 = bare/units form. Used by the expense and
// checkout extractors (non-global, so a single shared instance is stateless).
const AMOUNT_RE =
  /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)?/i;

/**
 * Extract intent and confidence score from user prompt using heuristic pattern matching.
 * Returns { intent, confidence, toolName } where confidence is 0–1 based on match quality.
 *
 * Confidence scoring:
 *   - Exact phrase match (e.g., "transfer $100 from checking to savings"): 0.95
 *   - Keyword match with partial params (e.g., "transfer from checking"): 0.75
 *   - Single keyword match (e.g., just "transfer"): 0.65
 *   - Ambiguous/unknown: 0.3
 */
function extractIntentAndConfidence(message) {
  const t = norm(message);

  // Exact/high-confidence banking actions: verb + full params or high-signal phrases
  const transferMatch = /\b(transfer|send|move)\s+\$?[\d,]+\s+(from|to)\b/.test(
    t,
  );
  if (transferMatch)
    return {
      intent: "transfer",
      toolName: "create_transfer",
      confidence: 0.95,
    };

  const depositMatch = /\b(deposit|add|put)\s+\$?[\d,]+/.test(t);
  if (depositMatch)
    return { intent: "deposit", toolName: "create_deposit", confidence: 0.95 };

  const withdrawMatch = /\b(withdraw|pull|take)\s+\$?[\d,]+/.test(t);
  if (withdrawMatch)
    return {
      intent: "withdraw",
      toolName: "create_withdrawal",
      confidence: 0.95,
    };

  // Balance/accounts: "show my X balance" or "check my X"
  const balanceMatch = /\b(balance|how much|what.*balance)\b/.test(t);
  if (balanceMatch)
    return {
      intent: "view_balance",
      toolName: "get_balance",
      confidence: 0.85,
    };

  const accountsMatch = /\b(accounts?|account.*details?|routing)\b/.test(t);
  if (accountsMatch)
    return {
      intent: "view_accounts",
      toolName: "get_accounts",
      confidence: 0.85,
    };

  const transactionsMatch = /\b(transaction|activity|history|recent)\b/.test(t);
  if (transactionsMatch)
    return {
      intent: "view_transactions",
      toolName: "get_transactions",
      confidence: 0.8,
    };

  // Partial matches: keyword present but params missing (lower confidence)
  if (/\btransfer\b/.test(t))
    return { intent: "transfer", toolName: "create_transfer", confidence: 0.6 };
  if (/\bdeposit\b/.test(t))
    return { intent: "deposit", toolName: "create_deposit", confidence: 0.6 };
  if (/\bwithdraw\b/.test(t))
    return {
      intent: "withdraw",
      toolName: "create_withdrawal",
      confidence: 0.6,
    };

  // Unknown/ambiguous intent
  return { intent: "unknown", toolName: null, confidence: 0.3 };
}

/**
 * @returns {{ source: 'heuristic', result: object }}
 */
function parseEducation(t) {
  if (/\b(ciba|backchannel|push auth|out of band|oob)\b/.test(t)) {
    return { kind: "education", ciba: true, tab: "what" };
  }
  if (
    /\b(human[- ]in[- ]the[- ]loop|human[- ]in[- ]the[- ]middle|hitl|high[- ]value consent|agent consent|consent.*\bagent\b)\b/.test(
      t,
    )
  ) {
    return {
      kind: "education",
      education: { panel: EDU.HUMAN_IN_LOOP, tab: "what" },
    };
  }
  if (
    /\b(token exchange|rfc\s*8693|8693|delegate.*token|user token.*mcp token|transaction token)\b/.test(
      t,
    )
  ) {
    return {
      kind: "education",
      education: { panel: EDU.TOKEN_EXCHANGE, tab: "why" },
    };
  }
  if (/\b(may_act|may act|act claim|delegation claim)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.MAY_ACT, tab: "what" },
    };
  }
  if (/\b(pkce|code verifier|code challenge)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.LOGIN_FLOW, tab: "pkce" },
    };
  }
  if (/\b(login flow|authorization code|sign in flow|oauth flow)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.LOGIN_FLOW, tab: "what" },
    };
  }
  if (
    /\b(mcp|model context|tools\/list|json-rpc)\b/.test(t) &&
    !/\b(list|show|get)\b/.test(t)
  ) {
    return {
      kind: "education",
      education: { panel: EDU.MCP_PROTOCOL, tab: "what" },
    };
  }
  if (/\b(introspect|7662|rfc 7662)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.INTROSPECTION, tab: "why" },
    };
  }
  if (/\b(agent gateway|resource indicator|8707|9728|rfc 8707)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.AGENT_GATEWAY, tab: "overview" },
    };
  }
  if (/\b(step[- ]?up|mfa threshold|acr)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.STEP_UP, tab: "what" },
    };
  }
  if (/\b(pingone authorize|authorize policy|pdp)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.PINGONE_AUTHORIZE, tab: "what" },
    };
  }
  if (
    /\b(cimd|client.?id.?metadata|client metadata document|self.?register|register client|dynamic client|dcr|rfc.?7591)\b/.test(
      t,
    )
  ) {
    return { kind: "education", education: { panel: EDU.CIMD, tab: "what" } };
  }
  if (/\b(cua|computer use agent|computer use)\b/.test(t)) {
    return { kind: "education", education: { panel: EDU.CUA, tab: "what" } };
  }
  if (
    /\b(langchain|lang chain|lcel|llm orchestrat|multi.?provider.*llm|model.?agnostic.*llm)\b/.test(
      t,
    )
  ) {
    return {
      kind: "education",
      education: { panel: EDU.LANGCHAIN, tab: "overview" },
    };
  }
  // Token Chain (covers: "🔗 Token Chain", "🔗 Token Chain: JWT Claims", "🔗 Token Chain: Exchange Paths")
  if (/\b(token[- ]chain)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.TOKEN_CHAIN, tab: "overview" },
    };
  }
  // AI Best Practices (covers: "⭐ AI Agent Best Practices")
  if (/\b(best[- ]practices|ai[- ]agent[- ]best)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.BEST_PRACTICES, tab: "overview" },
    };
  }
  // Agentic Maturity Model (covers: "⭐ Agentic Maturity Model")
  if (/\b(agentic[- ]maturity|maturity[- ]model)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.AGENTIC_MATURITY, tab: "overview" },
    };
  }
  // PAR — Pushed Authorization Requests (covers: "PAR (RFC 9126)")
  if (/\b(par\b|rfc[- ]?9126|pushed[- ]authorization)/.test(t)) {
    return { kind: "education", education: { panel: EDU.PAR, tab: "what" } };
  }
  // RAR — Rich Authorization Requests (covers: "RAR (RFC 9396)", "🔒 Selective Disclosure: RAR / RFC 9396")
  if (/\b(rar\b|rfc[- ]?9396|rich[- ]authorization)/.test(t)) {
    return { kind: "education", education: { panel: EDU.RAR, tab: "what" } };
  }
  // JWT Client Authentication (covers: "JWT client auth (RFC 7523)")
  if (/\b(jwt[- ]client[- ]auth|rfc[- ]?7523)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.JWT_CLIENT_AUTH, tab: "what" },
    };
  }
  // LLM Landscape / Comparison / How LLMs Work
  if (/\b(llm[- ]landscape|llm[- ]comparison|how[- ]llms?[- ]work)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.LLM_LANDSCAPE, tab: "commercial" },
    };
  }
  // Agent Builder Landscape / Comparison
  if (/\b(agent[- ]builder|agent[- ]framework[- ]landscape)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.AGENT_BUILDER_LANDSCAPE, tab: "langchain" },
    };
  }
  // AI Platform Landscape / Comparison
  if (
    /\b(ai[- ]platform[- ]landscape|ai[- ]platform[- ]comparison)\b/.test(t)
  ) {
    return {
      kind: "education",
      education: { panel: EDU.AI_PLATFORM_LANDSCAPE, tab: "overview" },
    };
  }
  // Sensitive Data & Selective Disclosure
  if (/\b(sensitive[- ]data|selective[- ]disclosure)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.SENSITIVE_DATA, tab: "overview" },
    };
  }
  // PingGateway MCP Security
  if (/\b(pinggateway|ping[- ]gateway)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.PINGGATEWAY_MCP, tab: "overview" },
    };
  }
  // Architecture Diagrams (covers: "🏗️ C4 Architecture Diagram", "🏗️ BFF Component Diagram")
  if (
    /\b(c4[- ]architecture|architecture[- ]diagram|bff[- ]component)\b/.test(t)
  ) {
    return {
      kind: "education",
      education: { panel: EDU.ARCHITECTURE_DIAGRAM, tab: "context" },
    };
  }
  // IETF Standards for Agentic Identity
  if (/\b(ietf[- ]standards|agentic[- ]identity|rfc7523bis)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.IETF_STANDARDS, tab: "overview" },
    };
  }
  // AI Primer
  if (/\b(ai[- ]primer)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.AI_PRIMER, tab: "overview" },
    };
  }
  // ID-JAG / Cross-App Access (XAA)
  if (/\b(id[- ]jag|cross[- ]app[- ]access|xaa)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.ID_JAG, tab: "overview" },
    };
  }
  // Step-up: deviceAuthentications API sub-topic
  if (/\b(device[- ]authentications?|deviceauthentications)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.STEP_UP, tab: "device" },
    };
  }
  // Authorize sub-topics: policy & AI/MCP security, MCP PingOne & env
  if (/\b(authorize[- ]policy|ai.?mcp[- ]security|mcp[- ]pingone)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.PINGONE_AUTHORIZE, tab: "policy" },
    };
  }
  // Agent request flow diagram
  if (/\b(agent[- ]request[- ]flow|agent[- ]flow[- ]diagram)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.FLOW_DIAGRAMS, tab: "agent-flow" },
    };
  }
  // OIDC 2.1 (norm() strips the dot so "oidc 2.1" → "oidc 2 1")
  if (/\b(oidc[- ]?2[\s.]?1|oidc 2 1|openid[- ]connect[- ]2)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.OIDC_21, tab: "overview" },
    };
  }
  // RFC 8693 Token Exchange (explicit RFC reference)
  if (/\b(rfc[- ]?8693)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.TOKEN_EXCHANGE, tab: "overview" },
    };
  }
  // Token Flow — end-to-end 2-exchange delegation
  if (/\b(token[- ]flow|2[- ]exchange[- ]flow)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.TOKEN_FLOW, tab: "overview" },
    };
  }
  // Broad RFC / standards fallback — must come after all specific RFC rules above
  if (/\b(rfc|spec index|standards)\b/.test(t)) {
    return {
      kind: "education",
      education: { panel: EDU.RFC_INDEX, tab: "index" },
    };
  }
  return null;
}

/**
 * @returns {{ kind: 'banking', banking: { action: string, params?: object } } | null}
 */
function parseBanking(t) {
  if (
    /\b(list|show|get|what).*(mcp.*tools?|tools?.*available|available.*tools?)\b|\btools?\s*(list|available)\b/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "mcp_tools" } };
  }
  // Sensitive details first — must precede general accounts check
  if (
    /\b(sensitive account details|full account|routing number|account number|account details)\b/.test(
      t,
    )
  ) {
    return {
      kind: "banking",
      banking: { action: "sensitive_account_details" },
    };
  }
  // Phase 266/267 — Path A demo: vertical feature data via api-key-gated backend.
  // mortgage_demo kept for backward compat; all vertical feature chips route through
  // vertical_feature_demo in the client. NL phrases for non-banking verticals also
  // map to vertical_feature_demo so the client can dispatch the right tool.
  // MUST precede the balance check so "home loan balance" doesn't fall to generic balance.
  if (
    /\b(show|view|see|get|my|whats?|what is)\s*(mortgage|home\s*loan)\b|\b(mortgage|home\s*loan)\s*(data|info|details|balance|summary|payment)\b|^mortgage$|^home\s*loan$/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "mortgage_demo" } };
  }
  // Vertical feature phrases (retail/healthcare/sporting-goods/workforce) plus the generic chip message
  if (VERTICAL_FEATURE_RE.test(t)) {
    return { kind: "banking", banking: { action: "vertical_feature_demo" } };
  }
  // Public branch catalog (progressive trust Act 1 / UC24) — before balance/accounts
  if (
    /\b(branch|branches|atm|atms)\b/.test(t) &&
    /\b(branch|branches|atm|atms|hours|near|location|find|where|what|open)\b/.test(t)
  ) {
    const cityMatch = t.match(/\b(?:in|near)\s+(?!me\b)([a-z][a-z\s-]{1,30}?)(?:\?|$)/i);
    const params = cityMatch?.[1] ? { city: cityMatch[1].trim() } : undefined;
    return {
      kind: "banking",
      banking: { action: "branch_hours", ...(params ? { params } : {}) },
    };
  }
  // Balance: explicit account id, or phrases like "my balance", "current balance", "check balance" — MUST precede accounts check
  if (/\bbalances?\b/.test(t)) {
    const m = t.match(/acc[_a-z0-9-]{6,}/i);
    if (m)
      return {
        kind: "banking",
        banking: { action: "balance", params: { accountId: m[0] } },
      };
    const accountTypeMatch = t.match(/\b(checking|savings|chk|sav)\b/i);
    if (accountTypeMatch) {
      const raw = accountTypeMatch[1].toLowerCase();
      const accountType =
        raw === "chk" ? "checking" : raw === "sav" ? "savings" : raw;
      return {
        kind: "banking",
        banking: { action: "balance", params: { accountType } },
      };
    }
    // Broadened: any mention of "balance" / "balances" alone — even single
    // word — is treated as a balance lookup. The previous regex required a
    // helper word ("my", "current", "show", etc.) which made bare "balance"
    // fall through to LLM, only to land on the generic fallback message
    // when no LLM was configured. Demo audiences type "balance" with no
    // ceremony; we should answer.
    return { kind: "banking", banking: { action: "balance" } };
  }
  // Accounts: show/list/get/what accounts
  if (
    /\b(what|show|list|get|see|view|pull|display).*(accounts?)\b|\bmy accounts?\b(?!\s+balance)|\ball\b.*\baccounts?\b|\bcustomer accounts?\b|^accounts?$/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "accounts" } };
  }
  if (
    /\b(biggest|largest|highest|top)\b.*(purchase|spend|transaction|payment)\b|\b(purchase|spend|transaction|payment).*(biggest|largest|highest)\b|\bmost expensive\b|\bspent the most\b|\bbiggest spend\b/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "biggest_purchase" } };
  }
  if (
    /\b(spending summary|total spend|how much.*(spend|spent)|where.*money|breakdown.*spend\w*|spend\w*.*breakdown)\b/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "spending_summary" } };
  }
  if (/\b(transactions?|history|activity|recent)\b/.test(t)) {
    return { kind: "banking", banking: { action: "transactions" } };
  }
  if (/\btransfer\b/.test(t)) {
    const amountMatch = t.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const fromMatch = t.match(
      /\bfrom\s+((?:my\s+|the\s+|primary\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
    );
    const toMatch = t.match(
      /\bto\s+((?:my\s+|the\s+|primary\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
    );
    const clean = (s) =>
      s &&
      s
        .replace(/^(my|the|primary)\s+/i, "")
        .replace(/\s+account$/i, "")
        .trim();
    const params = {
      ...(amountMatch && { amount: parseFloat(amountMatch[1]) }),
      ...(fromMatch && { fromId: clean(fromMatch[1]) }),
      ...(toMatch && { toId: clean(toMatch[1]) }),
    };
    return { kind: "banking", banking: { action: "transfer", params } };
  }
  if (/\bdeposit\b/.test(t)) {
    const amountMatch = t.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const toMatch = t.match(
      /\b(?:to|into)\s+((?:my\s+|the\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
    );
    const clean = (s) =>
      s &&
      s
        .replace(/^(my|the)\s+/i, "")
        .replace(/\s+account$/i, "")
        .trim();
    const params = {
      ...(amountMatch && { amount: parseFloat(amountMatch[1]) }),
      ...(toMatch && { toId: clean(toMatch[1]) }),
    };
    return { kind: "banking", banking: { action: "deposit", params } };
  }
  if (/\b(withdraw|withdrawal)\b/.test(t)) {
    const amountMatch = t.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const fromMatch = t.match(
      /\b(?:from)\s+((?:my\s+|the\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
    );
    const clean = (s) =>
      s &&
      s
        .replace(/^(my|the)\s+/i, "")
        .replace(/\s+account$/i, "")
        .trim();
    const params = {
      ...(amountMatch && { amount: parseFloat(amountMatch[1]) }),
      ...(fromMatch && { fromId: clean(fromMatch[1]) }),
    };
    return { kind: "banking", banking: { action: "withdraw", params } };
  }
  if (/\b(logout|log out|sign out|signout)\b/.test(t)) {
    return { kind: "banking", banking: { action: "logout" } };
  }

  // Phase 266 — API-key path demo (Path A)
  // Trigger: "special offers", "use the api-key path", "promotions"
  if (
    /(?:show|get|use)?\s*(?:special\s+)?offers?|\bpromotions?\b|\bapi[- ]?key\s+path\b/i.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "api_key_demo" } };
  }

  // Phase 266 — Access + ID-Token path demo (Path B)
  // Trigger: "show my profile card", "use the access-and-id-token path", "dual token path"
  if (
    /(?:show|view|my)?\s*profile\s*card|\baccess[- ]?(?:and[- ]?)?id[- ]?token\s+path\b|\bdual[- ]?token\s+path\b/i.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "dual_token_demo" } };
  }

  // Web search: general queries not related to banking or OAuth education
  if (
    /\b(search|find info|look up|look up|what is|tell me about|who is)\b/i.test(
      t,
    ) &&
    !/\b(account|balance|transaction|transfer|deposit|withdraw|mcp|rfc|oauth|token|ciba|pkce|scope|login|oidc)\b/i.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "web_search", query: t } };
  }
  return null;
}

// Theme-aware vocabulary maps — keyed by vertical id.
// Each entry maps a regex to the banking action it should route to.

/** Valid vertical IDs — same rule as routes/thresholds.js */
const VALID_VERTICAL_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Returns a validated vertical id string, or null if absent/invalid.
 * @param {unknown} vertical
 * @returns {string|null}
 */
function parseVerticalParam(vertical) {
  if (vertical == null || vertical === "") return null;
  if (typeof vertical !== "string" || !VALID_VERTICAL_RE.test(vertical))
    return null;
  return vertical;
}

/**
 * Build `{ terminology, chips }` for a known vertical id, or null for banking / unresolved.
 * @param {string|null|undefined} verticalId
 * @returns {{ terminology: object, chips: Array }|null}
 */
function resolveVerticalCtx(verticalId) {
  if (!verticalId || verticalId === "banking") return null;
  try {
    const { verticalManifest } = require("./verticalManifest");
    const m = verticalManifest.resolver.resolve(verticalId);
    if (m?.terminology) {
      return {
        terminology: m.terminology,
        chips: m.dashboard?.chips10 || m.dashboard?.chips || m.chips || [],
      };
    }
  } catch (_e) {
    /* best-effort; fall back to banking wording */
  }
  return null;
}

/**
 * Resolve vertical id + heuristic context for an HTTP request.
 * Request `vertical` wins over the server-global active vertical when valid.
 * @param {unknown} requestVertical
 * @returns {{ verticalId: string, verticalCtx: { terminology: object, chips: Array }|null }}
 */
function resolveVerticalRouting(requestVertical) {
  const explicit = parseVerticalParam(requestVertical);
  let verticalId = "banking";
  try {
    const { verticalManifest } = require("./verticalManifest");
    verticalId = explicit || verticalManifest.resolver.activeId() || "banking";
  } catch (_e) {
    verticalId = explicit || "banking";
  }
  const verticalCtx =
    explicit != null
      ? resolveVerticalCtx(explicit)
      : resolveActiveVerticalCtx();
  return { verticalId, verticalCtx };
}

/**
 * Resolve the active vertical's heuristic context — `{ terminology, chips }` —
 * from the manifest, or null for banking / unresolved. Single source shared by
 * every heuristic entry point (NL endpoint, agent message path) so the
 * `{ terminology, chips }` shape and its chip-location fallback can't drift.
 * Lazy-requires verticalManifest to avoid a require cycle (verticalManifest →
 * scope → … → nlIntentParser). Best-effort: never throws into the request path.
 * @returns {{ terminology: object, chips: Array }|null}
 */
function resolveActiveVerticalCtx() {
  try {
    const { verticalManifest } = require("./verticalManifest");
    return resolveVerticalCtx(verticalManifest.resolver.activeId());
  } catch (_e) {
    /* best-effort; fall back to banking wording */
  }
  return null;
}

function parseHeuristic(
  message,
  vertical = "banking",
  verticalCtx = null,
  options = {},
) {
  const t = norm(message);
  const isAdmin = options.isAdmin === true || verticalCtx?.isAdmin === true;
  if (!t) {
    return {
      kind: "none",
      message: "Say what you want to do or which topic to learn.",
    };
  }

  // Hard fast-path: "list/show/get mcp tools" and the bare chip label "mcp tools" are
  // ALWAYS a banking action, never education. Runs before the what-is/explain guard and
  // before parseEducation so that phrases like "list of mcp tools" or the bare chip label
  // "MCP Tools" are never swallowed by the broad \bmcp\b education regex.
  if (
    /\b(list|show|get|what).*(mcp.*tools?|tools?.*available|available.*tools?)\b|\btools?\s*(list|available)\b|\bmcp\s+tools?\b/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "mcp_tools" } };
  }

  // Vertical feature chip phrase — must precede heuristic matching because some
  // verticals have broad rules (e.g. healthcare "records?" → accounts) that would
  // swallow the more specific vertical-feature intent first. Scoped to the ACTIVE
  // vertical's own trigger only, so one vertical's feature phrase can never fire in
  // another vertical's context.
  const featureTrigger = FEATURE_TRIGGERS[vertical];
  if (featureTrigger?.test(t) || /\bshow\s+vertical\s+feature\b/.test(t)) {
    return { kind: "banking", banking: { action: "vertical_feature_demo" } };
  }

  // Plugin-first: a vertical with a plugin matches its OWN heuristics/actions.
  // No banking fallback — a non-match returns kind:'none', never a banking action.
  if (verticalDispatch.hasPlugin(vertical)) {
    // Guard: if this message is the exact text of a mode=llm chip, skip heuristic
    // matching entirely. Heuristics must not capture LLM-only chips — they would
    // route to a wrong action instead of returning kind:'none' and letting the LLM path run.
    const llmOnlyChipMessages = new Set(
      (verticalCtx?.chips || [])
        .filter((c) => c.mode === "llm")
        .map((c) => norm(c.message)),
    );
    if (llmOnlyChipMessages.size > 0 && llmOnlyChipMessages.has(t)) {
      return { kind: "none", message: buildCatalogMessage(verticalCtx) };
    }

    const heuristics = verticalDispatch.heuristicsFor(vertical, () => [], {
      isAdmin,
    });
    for (const h of heuristics) {
      if (h.re.test(t)) {
        let params = {};
        if (h.extractsAmount) {
          const amountMatch = t.match(/\b(\d+(?:\.\d+)?)\b/);
          if (amountMatch)
            params = { ...params, amount: parseFloat(amountMatch[1]) };
        }
        if (h.extractsAccountType) {
          const atMatch = t.match(/\b(checking|savings|chk|sav)\b/i);
          if (atMatch) {
            const raw = atMatch[1].toLowerCase();
            params = {
              ...params,
              accountType:
                raw === "chk" ? "checking" : raw === "sav" ? "savings" : raw,
            };
          }
        }
        if (h.extractsFromId) {
          const fromMatch = t.match(
            /\bfrom\s+((?:my\s+|the\s+|primary\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
          );
          if (fromMatch) {
            const raw = fromMatch[1]
              .replace(/^(my|the|primary)\s+/i, "")
              .replace(/\s+account$/i, "")
              .trim()
              .toLowerCase();
            params = {
              ...params,
              fromId:
                raw === "chk" ? "checking" : raw === "sav" ? "savings" : raw,
            };
          }
        }
        if (h.extractsToId) {
          const toMatch = t.match(
            /\b(?:to|into)\s+((?:my\s+|the\s+|primary\s+)?(?:checking|savings|chk|sav)(?:\s+account)?)/i,
          );
          if (toMatch) {
            const raw = toMatch[1]
              .replace(/^(my|the|primary)\s+/i, "")
              .replace(/\s+account$/i, "")
              .trim()
              .toLowerCase();
            params = {
              ...params,
              toId:
                raw === "chk" ? "checking" : raw === "sav" ? "savings" : raw,
            };
          }
        }
        if (h.extractsOrderId) {
          // Match numeric IDs (1003, 2001) or short alphanumeric codes (o1, o2)
          const orderIdMatch = t.match(/\b([a-z]?\d+)\b/i);
          if (orderIdMatch) params = { ...params, orderId: orderIdMatch[1] };
        }
        if (h.extractsRentalId) {
          // Match alphanumeric rental IDs (r1, r2) or plain numbers
          const rentalIdMatch = t.match(/\b([a-z]\d+|\d+)\b/i);
          if (rentalIdMatch) params = { ...params, rentalId: rentalIdMatch[1] };
        }
        if (h.extractsExpenseParams) {
          // Extract amount: "$45", "45.50"
          const amountMatch = t.match(AMOUNT_RE);
          if (amountMatch)
            params = {
              ...params,
              amount: parseFloat(amountMatch[1] || amountMatch[2]),
            };
          // Extract category: first substantive word after stripping trigger verbs and the amount
          const stripped = t
            .replace(
              /\b(submit|file|add|an?|my|the|for|a|expenses?)\b\s*|\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:dollars?|bucks?)?/gi,
              "",
            )
            .trim();
          const categoryMatch = stripped.match(/\b([a-z][a-z-]*)\b/i);
          if (categoryMatch) {
            params = { ...params, category: categoryMatch[1].toLowerCase() };
          }
        }
        // NB: agent clarification follow-ups are re-dispatched as a flattened
        // string and re-parsed here, so EVERY required-param action must opt into
        // a server-side extractor below — otherwise its params come back empty and
        // the clarify prompt loops. (See REGRESSION_PLAN §4, 2026-06-09.)
        if (h.extractsAppointmentParams) {
          // Extract "when": a relative date ("next week"), day of week ("on friday"),
          // or a clock time ("2pm"). Strip a leading "on " so the stored value reads
          // cleanly ("friday", not "on friday").
          const whenMatch = t.match(
            /\b((?:next|this)\s+\w+|tomorrow|today|tonight|(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/,
          );
          let rest = t;
          if (whenMatch) {
            params = {
              ...params,
              when: whenMatch[1].replace(/^on\s+/, "").trim(),
            };
            rest = rest.replace(whenMatch[0], " ");
          }
          // Extract "provider": prefer an explicit "with <name>" (handles "Dr. Smith"),
          // otherwise fall back to a department named after the trigger verb
          // ("schedule cardiology" -> cardiology).
          const withMatch = rest.match(
            /\bwith\s+(dr\s+[a-z]+|[a-z]+(?:\s+[a-z]+)?)/,
          );
          if (withMatch) {
            params = {
              ...params,
              provider: withMatch[1].replace(/\s+/g, " ").trim(),
            };
          } else {
            const deptMatch = rest.match(
              /\b(?:book|schedule|make)\s+(?:an?\s+|my\s+)?(?:appointment\s+(?:with\s+|for\s+)?)?([a-z]+)/,
            );
            const candidate = deptMatch?.[1];
            if (
              candidate &&
              !/^(an?|appointment|with|for|the|my|on|at)$/.test(candidate)
            ) {
              params = { ...params, provider: candidate };
            }
          }
        }
        if (h.extractsCheckoutParams) {
          // Extract amount ("$999", "79 dollars", "79") and product (the words left
          // after stripping the trigger verbs and the amount). Mirrors extractsExpenseParams.
          const amountMatch = t.match(AMOUNT_RE);
          if (amountMatch)
            params = {
              ...params,
              amount: parseFloat(amountMatch[1] || amountMatch[2]),
            };
          const product = t
            .replace(
              /\b(check\s*out|checkout|buy|purchase|place|order|now|an?|my|the|for)\b/gi,
              " ",
            )
            .replace(
              /\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:dollars?|bucks?)?/gi,
              " ",
            )
            .replace(/\s+/g, " ")
            .trim();
          if (product) params = { ...params, product };
        }
        if (h.extractsRecordId) {
          // Record IDs are numeric ("101"). Accept an optional "record"/"rec" prefix.
          const recMatch = t.match(/\b(?:rec(?:ord)?[\s-]*)?(\d{2,})\b/);
          if (recMatch) params = { ...params, recordId: recMatch[1] };
        }
        if (h.extractsDays) {
          // Number of days off ("request 3 days off" -> 3).
          const daysMatch = t.match(/\b(\d+)\b/);
          if (daysMatch)
            params = { ...params, days: parseInt(daysMatch[1], 10) };
        }
        if (h.extractsTopic) {
          // Pass the full normalized message as the topic so explainConcept
          // can match it against its CONCEPTS regexes.
          params = { ...params, topic: t };
        }
        // Banking vertical uses the kind:'banking' contract expected by all consumers.
        // Only include params when non-empty so callers can test params === undefined.
        // Admin overlay heuristics are appended when isAdmin:true — those actions must
        // return kind:'vertical',vertical:'admin' even when the active vertical is
        // 'banking'. Derive the admin tool name set from the plugin's own getTools()
        // (the authoritative list) rather than relying on a per-heuristic marker field.
        // delegate_to_specialist is an A2A overlay action — always kind:'vertical'.
        const _adminPlugin = verticalDispatch.resolvePlugin("admin");
        const _adminToolNames = _adminPlugin
          ? new Set(_adminPlugin.getTools().map((t) => t.name))
          : new Set();
        const _isAdminAction = _adminToolNames.has(h.action);
        if (
          vertical === "banking" &&
          h.action !== "delegate_to_specialist" &&
          !_isAdminAction
        ) {
          const banking = { action: h.action };
          if (Object.keys(params).length > 0) banking.params = params;
          return { kind: "banking", banking };
        }
        const _returnVertical = _isAdminAction ? "admin" : vertical;
        return {
          kind: "vertical",
          vertical: _returnVertical,
          action: h.action,
          params,
        };
      }
    }
    // Education (OAuth/MCP teaching topics — "explain ciba", "what is token
    // exchange") is cross-vertical, not a banking action. Check it before the
    // no-match catch so the plugin-dispatch short-circuit doesn't swallow it.
    const eduV = parseEducation(t);
    if (eduV) return eduV;
    // Admin is a banking overlay — fall through to banking heuristics on no admin match
    // so standard phrases like "view transactions" still work for admin users.
    if (vertical === "admin") {
      const bankFallback = parseBanking(t);
      if (bankFallback) return bankFallback;
      return { kind: "none", message: buildAdminCatalogMessage() };
    }
    return { kind: "none", message: buildCatalogMessage(verticalCtx) };
  }

  // Prefer education if user explicitly asks to explain / learn
  if (
    /\b(what is|how does|explain|learn about|show me (the )?(doc|guide|topic))\b/.test(
      t,
    )
  ) {
    const edu = parseEducation(t);
    if (edu) return edu;
  }

  const bank = parseBanking(t);
  if (bank) return bank;

  const edu2 = parseEducation(t);
  if (edu2) return edu2;

  return { kind: "none", message: buildCatalogMessage(verticalCtx) };
}

module.exports = {
  parseHeuristic,
  extractIntentAndConfidence,
  EDU,
  CAPABILITY_CATALOG,
  buildCatalogMessage,
  resolveActiveVerticalCtx,
  resolveVerticalCtx,
  resolveVerticalRouting,
  parseVerticalParam,
  VALID_VERTICAL_RE,
};
