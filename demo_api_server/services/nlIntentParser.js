// banking_api_server/services/nlIntentParser.js
/**
 * Heuristic NL → education panel or banking action (no external LLM).
 * Keeps the Banking Agent useful without API keys (MasterFlow-style UX, zero-cost path).
 */
"use strict";

const verticalDispatch = require("./verticalDispatch");
const {
  matchesAccountNickname,
} = require("../config/verticals/shared/bankingChipHeuristics");

const VERTICAL_FEATURE_RE =
  /\b(show|view|see|get|my)\s*(large\s*purchase|big\s*purchase|health\s*records?|medical\s*records?|gear\s*order|equipment\s*order|sports?\s*order|expense\s*report|expenses?\s*report|permit\s*status|enrollment\s*status|work\s*order\s*status)\b|^(large|big)\s*purchase$|^health\s*record$|^gear\s*order$|^expense\s*report$|^permit\s*status$|^enrollment\s*status$|^work\s*order\s*status$|\bshow\s+vertical\s+feature\b/;

// Cross-vertical invest / portfolio chip — always routes to invest_demo (show_investment).
const INVEST_FEATURE_RE =
  /\b(show|view|see|get|my)\s*(portfolio\s*status|investment\s*portfolio|investments?|portfolio)\b|\bportfolio\s*status\b|^investments?$|^portfolio$/;

// Per-vertical feature-demo triggers. The pre-plugin feature check (parseHeuristic)
// runs ONLY the active vertical's trigger — never another vertical's phrases — so a
// global feature regex can't leak across verticals. healthcare is verb-anchored
// (show/view/see/get) on purpose so "share/release my medical records" falls through
// to the release_records heuristic instead of the feature demo. A vertical absent
// from this map (no feature page) skips the feature check entirely.
const PURCHASE_FEATURE_RE =
  /\b(show|view|see|get|my)\s*(large|big)\s*purchases?\b|^(large|big)\s*purchase$/;
const FEATURE_TRIGGERS = {
  // Banking Path A feature is mortgage_demo (handled above); purchase phrases stay retail-only.
  retail: PURCHASE_FEATURE_RE,
  healthcare:
    /\b(show|view|see|get)\s+(my\s+)?(health|medical)\s+records?\b|^health\s*records?$/,
  "sporting-goods":
    /\b(show|view|see|get|my)\s*(gear|equipment|sports?)\s*orders?\b|^gear\s*order$/,
  workforce:
    /\b(show|view|see|get|my)\s*expenses?\s*reports?\b|^expense\s*report$/,
  investment: INVEST_FEATURE_RE,
  government:
    /\b(show|view|see|get|my)\s*permit\s*status\b|^permit\s*status$/,
  university:
    /\b(show|view|see|get|my)\s*enrollment\s*status\b|^enrollment\s*status$/,
  manufacturing:
    /\b(show|view|see|get|my)\s*work\s*order\s*status\b|^work\s*order\s*status$/,
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
  'unusual patterns — "check for unusual patterns" / "any unusual transactions"',
  'afford check — "can I afford a big expense" / "could my savings cover a big expense"',
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
 * items are derived from real `both`-mode chip messages (so every quoted
 * example is guaranteed to parse) — never invented "show my {term}" phrases.
 */
function buildCatalogItems(verticalCtx) {
  const term = verticalCtx?.terminology;
  if (!term) return CAPABILITY_CATALOG;

  const chips = verticalCtx?.chips || [];
  // chips10 carry message + mode; prefer those so catalog quotes match heuristics.
  const bothWithMsg = chips.filter(
    (c) => (c.mode || "both") === "both" && typeof c.message === "string" && c.message.trim(),
  );
  if (bothWithMsg.length > 0) {
    // Strip leading non-alphanumeric (HITL lock / MCP plug glyphs) for catalog labels.
    const stripPrefix = (s) => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    // Include every both-chip so the catalog never advertises fewer actions
    // than Heuristics-only can actually run.
    const items = bothWithMsg.map((c) => {
      const label = stripPrefix(c.label) || c.id || "action";
      return `${label} — "${c.message.trim()}"`;
    });
    return [
      ...items,
      `MCP tools — "list available tools" / "show mcp tools"`,
      `education — "explain token exchange" / "what is CIBA" / "how does step-up work"`,
    ];
  }

  // Legacy key/label chips (unit tests + older manifests without chips10 messages).
  const chipByKey = new Map(chips.map((c) => [c?.key, c?.label]));
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

  // Retail checkout — UC22 demo step ("checkout headphones for $150") and
  // similar buy/purchase prompts. Without this, intent stays "unknown" →
  // permitted_tools is read-only → PingGateway P1AZ DENYs checkout with
  // intent_mismatch after CIBA approval (BFF gate already PERMITted).
  //
  // "check out" (two words) is too broad — it's natural English for
  // "look at my balance/account/transactions", which map to banking read
  // intents. Only match the single-word "checkout" or "check out" when
  // explicitly followed by a shopping noun (cart, basket, item, order).
  // norm() strips "$", so \$? in the buy/purchase branch was a no-op — removed.
  const checkoutMatch =
    /\bcheckout\b/.test(t) ||
    /\bcheck\s+out\s+(?:my\s+)?(?:cart|basket|item|order)\b/.test(t) ||
    /\b(buy|purchase)\b.*\d/.test(t);
  if (checkoutMatch)
    return { intent: "checkout", toolName: "checkout", confidence: 0.9 };

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

  // Investment intents
  if (/\b(portfolio|portfolios|investments?|wealth)\b/.test(t))
    return { intent: "view_portfolios", toolName: "view_portfolios", confidence: 0.85 };
  if (/\b(holdings?|positions?|securities)\b/.test(t))
    return { intent: "view_holdings", toolName: "view_holdings", confidence: 0.85 };
  if (/\b(trades?|trade history|trading)\b/.test(t))
    return { intent: "view_trades", toolName: "view_trades", confidence: 0.8 };

  // Government intents
  if (/\b(permits?|building permit|zoning permit)\b/.test(t))
    return { intent: "view_permits", toolName: "view_permits", confidence: 0.85 };
  if (/\b(filings?|filed)\b/.test(t))
    return { intent: "view_filings", toolName: "view_filings", confidence: 0.8 };
  if (/\b(complaints?|reported issue)\b/.test(t))
    return { intent: "view_complaints", toolName: "view_complaints", confidence: 0.8 };
  if (/\b(tax assess|property tax)\b/.test(t))
    return { intent: "view_tax_assessments", toolName: "view_tax_assessments", confidence: 0.8 };
  if (/\b(violations?|code violation)\b/.test(t))
    return { intent: "view_permits", toolName: "view_permits", confidence: 0.8 };
  if (/\b(fees?|pay fee)\b/.test(t))
    return { intent: "view_fees", toolName: "view_fees", confidence: 0.8 };

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
  // MCP protocol education — exclude PingOne Admin chip text that only names
  // demo apps ("Demo MCP Server") and product lists, not the protocol itself.
  if (
    /\b(mcp protocol|model context|tools\/list|json-rpc)\b/.test(t) ||
    (/\bmcp\b/.test(t) &&
      !/\b(list|show|get)\b/.test(t) &&
      !/\bpingone\b/.test(t) &&
      !/\bmcp\s+(server|gateway|exchanger|proxy|demo)\b/.test(t) &&
      !/\bdemo\s+apps?\b/.test(t))
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

// UC34 / bk9 "Spot unusual patterns" — LLM-analysis intent with no deterministic
// tool. The sec_llm_analyze chip ships this exact text in EVERY vertical manifest,
// so the same phrases must resolve to unusual_patterns regardless of vertical.
const UNUSUAL_PATTERNS_RE =
  /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|charge|spend)|check for unusual|flag any unusual|spot unusual/;

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
  // Cross-vertical invest chip — must precede balance so "portfolio" does not fall through.
  if (INVEST_FEATURE_RE.test(t)) {
    return { kind: "banking", banking: { action: "invest_demo" } };
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
  // Fee waiver — the agent can only REQUEST a waiver (logged for human review);
  // no tool exists that can grant one (the Air Canada tool-boundary demo, UC28).
  // Must precede every account-flavored pattern: "waive the fee on my checking
  // account" otherwise matches the accounts-list heuristic and the chip demos
  // the wrong thing.
  if (/\bwaiv\w*\b.*\b(fee|charge)s?\b|\b(fee|charge)s?\b.*\bwaiv\w*\b/.test(t)) {
    return { kind: "banking", banking: { action: "request_fee_waiver" } };
  }
  // Account nickname — narrow read; must precede generic accounts list
  if (matchesAccountNickname(t)) {
    return { kind: "banking", banking: { action: "account_nickname" } };
  }
  // Accounts: show/list/get/what accounts — but not "account history" (transactions)
  if (
    /\b(what|show|list|get|see|view|pull|display).*(accounts?)\b|\bmy accounts?\b(?!\s+balance)|\ball\b.*\baccounts?\b|\bcustomer accounts?\b|^accounts?$/.test(
      t,
    ) &&
    !/\baccount\s+history\b/.test(t)
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
  // Unusual / anomaly scan — must precede bare "transactions"/"activity"
  if (UNUSUAL_PATTERNS_RE.test(t)) {
    return { kind: "banking", banking: { action: "unusual_patterns" } };
  }
  // Affordability — chip "Could my savings cover a big upcoming expense?"
  if (
    /\b(afford|cover)\b.*\b(expense|purchase|cost)|savings?\s+cover|big\s+upcoming\s+expense|can i afford/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "afford_check" } };
  }
  // Catalog lists "account history" under transactions
  if (/\b(transactions?|history|activity|recent|account\s+history)\b/.test(t)) {
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
 * Session-pinned vertical for this request, if any. Does NOT fall back to the
 * process-global — that global is still mutated by any session's
 * POST /verticals/active and must not steal NL/heuristics from a pinned (or
 * banking) demo.
 * @param {import('express').Request|null|undefined} req
 * @returns {string|null}
 */
function sessionVerticalId(req) {
  const id = req && req.session && req.session.active_vertical;
  return typeof id === "string" && id ? parseVerticalParam(id) : null;
}

/**
 * Resolve vertical id + heuristic context for an HTTP request.
 * Precedence (demo-safe — process-global must never yank heuristics):
 *   1. Valid request `vertical` body/query (SPA page context)
 *   2. This session's pinned `active_vertical`
 *   3. `banking` (safe default)
 * The process-global `activeId()` is intentionally unused here — it remains
 * the first-load default / SSE hydration source only.
 * @param {unknown} requestVertical
 * @param {import('express').Request|null|undefined} [req]
 * @returns {{ verticalId: string, verticalCtx: { terminology: object, chips: Array }|null }}
 */
function resolveVerticalRouting(requestVertical, req = null) {
  const explicit = parseVerticalParam(requestVertical);
  const verticalId = explicit || sessionVerticalId(req) || "banking";
  return { verticalId, verticalCtx: resolveVerticalCtx(verticalId) };
}

/**
 * Resolve heuristic context for the session-or-banking vertical (never the
 * process-global). Shared by heuristic entry points so chip-location fallback
 * can't drift. Lazy-requires verticalManifest to avoid a require cycle.
 * @param {import('express').Request|null|undefined} [req]
 * @returns {{ terminology: object, chips: Array }|null}
 */
function resolveActiveVerticalCtx(req = null) {
  return resolveVerticalCtx(sessionVerticalId(req) || "banking");
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

  // JWT decode diagnostic chip — cross-vertical (not tied to any vertical's
  // data), so this fast-path runs unconditionally like mcp_tools above.
  if (/\bdecode\s+my\s+(jwt|token)\b/.test(t)) {
    return { kind: "banking", banking: { action: "jwt_decode_demo" } };
  }

  // Account nickname — cross-vertical banking MCP chip; must precede plugin heuristics
  // that match bare "account" (banking accounts list, admin customer accounts, etc.).
  if (matchesAccountNickname(t)) {
    return { kind: "banking", banking: { action: "account_nickname" } };
  }

  // Vertical feature chip phrase — must precede heuristic matching because some
  // verticals have broad rules (e.g. healthcare "records?" → accounts) that would
  // swallow the more specific vertical-feature intent first. Scoped to the ACTIVE
  // vertical's own trigger only, so one vertical's feature phrase can never fire in
  // another vertical's context.
  // Invest / portfolio chip is available on every customer vertical.
  if (INVEST_FEATURE_RE.test(t)) {
    return { kind: "banking", banking: { action: "invest_demo" } };
  }
  // hasOwnProperty: `vertical` is request-supplied and VALID_VERTICAL_RE accepts
  // `constructor`, so a bare lookup returned the INHERITED Object constructor.
  // `?.` only guards nullish, so `.test(t)` was then called on a function that has
  // none — POST /api/demo-agent/nl {vertical:"constructor"} 500'd with
  // "featureTrigger?.test is not a function".
  const featureTrigger = Object.prototype.hasOwnProperty.call(FEATURE_TRIGGERS, vertical)
    ? FEATURE_TRIGGERS[vertical]
    : null;
  if (featureTrigger?.test(t) || /\bshow\s+vertical\s+feature\b/.test(t)) {
    return { kind: "banking", banking: { action: "vertical_feature_demo" } };
  }

  // Progressive-trust Act 1 / UC24 — public catalog (cross-vertical). Must run
  // before plugin heuristics so non-banking verticals still reach get_branch_hours
  // instead of falling through to the capability catalog.
  if (
    /\b(branch|branches|atm|atms|clinic|clinics|store|stores|office|offices|campus|plant|plants|airport|airports|terminal|terminals|location|locations)\b/.test(
      t,
    ) &&
    /\b(near|hours|location|locations|find|where|what|open)\b/.test(t)
  ) {
    const cityMatch = t.match(
      /\b(?:in|near)\s+(?!me\b)([a-z][a-z\s-]{1,30}?)(?:\?|$)/i,
    );
    const params = cityMatch?.[1]
      ? { city: cityMatch[1].trim() }
      : undefined;
    return {
      kind: "banking",
      banking: { action: "branch_hours", ...(params ? { params } : {}) },
    };
  }

  // weather-mcp showcase (cross-vertical) — real third-party MCP server fronted
  // by the Agent Gateway, Texas-scoped at the edge (ping-gateway/scripts/groovy/
  // tx-weather-scope.groovy). Runs before plugin heuristics like branch_hours
  // above, since it isn't tied to any vertical's own data. Requires an actual
  // "in <city>" clause — "the weather is nice today" (no location) is the
  // idiomatic off-topic control phrase used across this suite's kind:'none'
  // tests and must keep falling through, not be swallowed by a bare "weather".
  // Capture city from the ORIGINAL message: norm() replaces commas with spaces
  // ("Austin, TX" → "austin tx"), which breaks tx-weather-scope.groovy's
  // ", TX" / ", Texas" qualifier check and falsely DENYs in-scope cities.
  const weatherCityMatch = String(message || "").match(
    /\bweather\b.*?\bin\s+(.+)$/i,
  );
  if (weatherCityMatch?.[1]) {
    return {
      kind: "banking",
      banking: {
        action: "weather",
        params: { city_name: weatherCityMatch[1].trim() },
      },
    };
  }

  // UC34 "Spot unusual patterns" chip (sec_llm_analyze) — cross-vertical like
  // mcp_tools above: every vertical manifest ships the same text. Must precede
  // plugin heuristics, whose broad read intents ("recent activity" →
  // view_records / list_orders / list_expenses …) would swallow it and answer
  // with a data listing instead of the LLM-analysis path (heuristics mode says
  // "needs an LLM", LLM modes reason via sequential_think — AIAgent.js case
  // unusual_patterns, same contract as banking).
  if (UNUSUAL_PATTERNS_RE.test(t)) {
    return { kind: "banking", banking: { action: "unusual_patterns" } };
  }

  // Plugin-first: a vertical with a plugin matches its OWN heuristics/actions.
  // No banking fallback — a non-match returns kind:'none', never a banking action.
  if (verticalDispatch.hasPlugin(vertical)) {
    // Guard: if this message is the exact text of a mode=llm or mode=direct chip,
    // skip heuristic matching entirely. Heuristics must not capture these chips:
    // 'llm' needs a real LLM provider, and 'direct' dispatches straight to its own
    // tool/denyTool without ever going through the NL parser (extractChips.js
    // documents both as non-heuristic-resolvable) — either would otherwise risk
    // routing to a wrong banking action instead of returning kind:'none'.
    // Exception: heuristics-only mode has no LLM fallthrough, so allow matching
    // (education / analysis chips that have a deterministic action still answer).
    const heuristicsOnly = options.heuristicsOnly === true;
    if (!heuristicsOnly) {
      const chips = verticalCtx?.chips || [];
      // A message text can be shared by more than one chip (e.g. a vertical's
      // "Direct MCP" demo chip often reuses a real both-mode chip's exact
      // wording). If ANY chip with this text is heuristic-resolvable, the
      // guard below must not block it — only exclude text that belongs
      // EXCLUSIVELY to llm/direct chips.
      const heuristicMessages = new Set(
        chips
          .filter((c) => (c.mode || "both") === "both")
          .map((c) => norm(c.message)),
      );
      const nonHeuristicChipMessages = new Set(
        chips
          .filter(
            (c) =>
              (c.mode === "llm" || c.mode === "direct") &&
              !heuristicMessages.has(norm(c.message)),
          )
          .map((c) => norm(c.message)),
      );
      if (nonHeuristicChipMessages.size > 0 && nonHeuristicChipMessages.has(t)) {
        return { kind: "none", message: buildCatalogMessage(verticalCtx) };
      }
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
          //
          // …unless this heuristic ALSO extracts an amount. norm() strips "$"
          // before we get here, so "pay my $300 bill" arrives as "pay my 300
          // bill" and a bare-number id pattern matches the AMOUNT — emitting
          // { amount: 300, recordId: "300" }. That broke the chip: pay_bill's
          // handler does `params.billId || params.recordId` and only falls back
          // to the first outstanding bill when neither is set (its comment says
          // amount-driven chips "don't carry a bill id" — they did), so it paid
          // bill "300". Real bill ids are 401+ → "bill not found".
          //
          // When both are extracted, require the id to be introduced by its noun
          // ("pay bill 402", "approve purchase order 5001"), which is exactly the
          // phrasing every paramHint documents. A leading figure is then the
          // amount and the handler's fallback works as intended.
          const recRe = h.extractsAmount
            ? /\b(?:rec(?:ord)?|bill|invoice|po|(?:purchase\s+)?order)[\s-]*(\d{2,})\b/
            : /\b(?:rec(?:ord)?[\s-]*)?(\d{2,})\b/;
          const recMatch = t.match(recRe);
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
        if (h.defaultParams) {
          // Static params a heuristic resolves to regardless of message text (e.g. the
          // pingone-admin operation heuristics each fix their OAS operationId). Extracted
          // params still win — defaults only fill keys the message didn't provide.
          params = { ...h.defaultParams, ...params };
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
        const _isCrossVerticalBanking = h.action === "account_nickname";
        if (
          (vertical === "banking" || _isCrossVerticalBanking) &&
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

/*
 * Actions parseBanking recognises that belong to NO vertical. Every one is
 * cross-vertical by its own definition at the point it is declared, not by
 * accident:
 *   web_search             the trailing catch-all — dispatches brave_search and
 *                          appears in no manifest (#1232).
 *   unusual_patterns       UNUSUAL_PATTERNS_RE's own comment: the sec_llm_analyze
 *                          chip "ships this exact text in EVERY vertical
 *                          manifest" (9 of them) and must resolve the same way
 *                          "regardless of vertical".
 *   vertical_feature_demo  VERTICAL_FEATURE_RE exists precisely so "NL phrases
 *                          for non-banking verticals also map to
 *                          vertical_feature_demo so the client can dispatch the
 *                          right tool" — the right tool being the ACTIVE
 *                          vertical's, never banking's.
 *   invest_demo            INVEST_FEATURE_RE is labelled "Cross-vertical invest /
 *                          portfolio chip" at its declaration.
 *   mcp_tools              lists whichever MCP tools the active vertical exposes;
 *                          the phrasing ships in 10 manifests.
 * None of them reads banking data. Returning one WITHOUT a vertical lets the
 * caller keep the active one, or reach buildNoMatch when there is none.
 *
 * The early return still matters, and #1228 is the reason: deleting it does not
 * make the prompt neutral, it hands the prompt to the keyword sweep below, which
 * claims "equipment" / "schedule" / "inventory" / "orders" for a different wrong
 * vertical instead. Dropping the tag and returning are one change, not two.
 */
const VERTICAL_AGNOSTIC_BANKING_ACTIONS = new Set([
  'web_search',
  'unusual_patterns',
  'vertical_feature_demo',
  'invest_demo',
  'mcp_tools',
]);

/*
 * Literal-vertical keyword branches, in their original cascade order. A Map, not
 * an object literal: the key is a request-supplied vertical id, and a bare
 * `obj[id]` lookup would resolve 'constructor' / 'toString' through the
 * prototype chain and hand back a non-regex — the same missing-guard shape
 * already found in FEATURE_TRIGGERS and INTENT_TO_PERMITTED_TOOLS. Map.get
 * returns undefined for those by construction. Order is preserved, so the
 * no-active-vertical sweep below still resolves exactly as it always did.
 */
const VERTICAL_KEYWORD_RE = new Map([
  ['retail', /\b(order|orders?|purchase|return|refund|cart|checkout)\b/],
  ['sporting-goods', /\b(points?|redeem|rewards?|gear|equipment|membership)\b/],
  ['government', /\b(permit|benefit|document|application|claim)\b/],
  ['workforce', /\b(schedule|time\s*off|timeoff|paycheck|coworker|directory|timesheet|expense|leave|payroll|attendance)\b/],
  ['university', /\b(grades?|courses?|transcript|enrollment|semester|schedule|tuition)\b/],
  ['manufacturing', /\b(manufacturing|factory|production|machine|inventory|equipment)\b/],
]);

/**
 * Parse intent from text specifically for fallback resolution
 * Returns minimal intent object with vertical hint
 */
function parseForFallback(text, verticalCtx = {}) {
  const t = norm(text);

  // The vertical the user is demonstrably already in. Read once, up front,
  // because every branch below is now ranked against it rather than against its
  // own position in the cascade. Same normalisation the trailing context branch
  // has always used — the literal string 'undefined' arrives from query params.
  const activeVertical =
    verticalCtx.verticalId && verticalCtx.verticalId !== 'undefined'
      ? verticalCtx.verticalId
      : null;

  // Use existing parseEducation and parseBanking for quick vertical detection
  const bankingIntent = parseBanking(t);
  if (bankingIntent && bankingIntent.kind !== 'none') {
    if (
      bankingIntent.banking &&
      VERTICAL_AGNOSTIC_BANKING_ACTIONS.has(bankingIntent.banking.action)
    ) {
      return { ...bankingIntent };
    }
    // A genuine banking action (transfer, balance, transactions, accounts …) is
    // BANKING'S OWN pattern, so it may only win where banking is the active
    // vertical — or where none is, the context-free case the cascade exists
    // for. Typed inside another vertical it is a FOREIGN vertical's pattern and
    // must not resolve, exactly as retail's \borders?\b must not resolve inside
    // manufacturing: only the active vertical's own patterns may.
    //
    // This one deliberately does NOT early-return. #1228 established the early
    // return because falling through handed the prompt to the keyword sweep,
    // which coerced it to a DIFFERENT wrong vertical. #1261 then confined that
    // sweep to `!activeVertical`, and this branch falls through only when
    // activeVertical is set — so the sweep is unreachable from here. Every
    // branch still below keeps the active vertical: parseEducation returns
    // without a vertical, the own-keyword branch returns the active one, and
    // the trailing branch returns kind:'unknown' on it, which the resolver
    // renders as the no-match naming that vertical.
    if (!activeVertical || activeVertical === 'banking') {
      return { ...bankingIntent, vertical: 'banking' };
    }
  }

  // Protocol/AI teaching intents ("what is PAR", "explain step-up") open an
  // education panel; they carry no tool and belong to no vertical. Returning
  // one WITHOUT a vertical lets the caller keep the active vertical — tagging
  // them 'banking' pulled account and transfer chips into healthcare and every
  // other vertical. The early return still matters: falling through would let
  // the keyword cascade below claim them ("equipment", "schedule", "inventory")
  // and coerce them to a different wrong vertical instead.
  const educationIntent = parseEducation(t);
  if (educationIntent && educationIntent.kind !== 'none') {
    return { ...educationIntent };
  }

  // The ACTIVE vertical's own keywords are consulted before any other
  // vertical's, so cascade position can no longer decide the outcome. This is
  // the whole fix: retail's \borders?\b sat above manufacturing and took
  // manufacturing's own "show my work orders" while manufacturing was active.
  const ownRe = activeVertical ? VERTICAL_KEYWORD_RE.get(activeVertical) : undefined;
  if (ownRe && ownRe.test(t)) {
    return { kind: activeVertical, vertical: activeVertical };
  }

  // With a vertical already active, another vertical's keywords are only ever a
  // GUESS, and a guess must not overrule the vertical the user is actually in.
  // So the sweep runs only when nothing is active — which is the case it exists
  // for. When something IS active and its own branch did not match above,
  // control falls to the context branch below and the active vertical stands.
  if (!activeVertical) {
    for (const [vertical, re] of VERTICAL_KEYWORD_RE) {
      if (re.test(t)) return { kind: vertical, vertical };
    }
  }

  // For other verticals, check if verticalCtx hints at a specific one
  if (activeVertical) {
    return { kind: 'unknown', vertical: activeVertical };
  }

  // Default: unknown, no vertical hint
  return { kind: 'none' };
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
  parseForFallback,
};
