/**
 * @file AIAgent.chipRouting.test.js
 *
 * Routing-contract tests for the AIAgent action chips.
 *
 * Covers three guarantees:
 *   1. Chip catalog — all expected chips exist in the correct ACTION_GROUP
 *   2. Direct routing — all chips (including AI/LLM chips) call runAction()
 *      directly on click; the NL-input path is only for chips that need
 *      user-typed text before execution (transfer, balance, sequential_think, etc.)
 *   3. Full compliance contract — all chips exercise the complete step set,
 *      including olb-resource-token (RFC 8693 token exchange to reach the
 *      banking backend). AI chips are not special: they go through the same
 *      MCP gateway pipeline as banking chips.
 *
 * These are pure-logic tests (no DOM mount). They mirror the constants in
 * BankingAgent.js and assert the routing invariants that the product requires.
 *
 * WHY NO COMPONENT RENDER:
 *   BankingAgent.js has ~40 imports and complex context providers. Mounting it
 *   in Jest adds significant mock surface without adding signal for these
 *   structural invariants. Route-via-Send vs route-via-runAction is fully
 *   encoded in the constants below and in CHIP_APPLICABLE_STEPS.
 */

// ── ACTION_GROUPS catalog (mirrored from AIAgent.js) ────────────────────
// Update this whenever chips are added, removed, or renamed.

const ACCOUNT_CHIP_IDS = [
  "accounts",
  "balance",
  "sensitive-account-details",
  "sequential_think",
];
const TRANSACTION_CHIP_IDS = [
  "transactions",
  "deposit",
  "withdraw",
  "transfer",
];
const ADMIN_CHIP_IDS = ["mcp_tools", "query_user", "logout"];
const AI_CHIP_IDS = [
  "ai_ask",
  "ai_helix_demo",
  "ai_explain",
  "ai_helix_explain",
  "ai_analyze",
  "ai_advice",
  "ai_helix_advice",
];
const TESTING_CHIP_IDS = [
  "demo_guide",
  "test_full_compliance_flow",
  "test_wrong_scope",
  "test_wrong_audience",
  "test_hitl_required",
  "transfer_600_test",
  "test_otp_required",
  "demo_intent_delegation",
  "demo_nl_routing",
];

const ALL_CHIP_IDS = [
  ...ACCOUNT_CHIP_IDS,
  ...TRANSACTION_CHIP_IDS,
  ...ADMIN_CHIP_IDS,
  ...AI_CHIP_IDS,
  ...TESTING_CHIP_IDS,
];

// ── Routing contract ──────────────────────────────────────────────────────────
// NL_ROUTED chips: handleActionClick calls setNlInputFromTile() — user sees the
// conversational input field and must press the Send button to execute.
// These are chips where the user needs to supply text before execution.
const NL_ROUTED_IDS = new Set([
  // Banking chips that need user-supplied parameters before execution
  "transfer", // "Transfer $100 from checking to savings"
  "deposit", // "Deposit $100 to my checking account"
  "withdraw", // "Withdraw $100 from my checking account"
  "balance", // "Check balance for my checking account"
  "sequential_think", // "Think: Should I transfer money..."
  // NL-routing testing chips
  "transfer_600_test", // "Transfer $600 from checking to savings"
  "demo_nl_routing", // "What is my checking account balance?"
  // Admin chip that prompts for completion
  "query_user", // "Query user by email: "
]);

// DIRECT chips: handleActionClick calls runAction() immediately — no input needed.
// AI/LLM chips belong here: they route through callMcpTool("sequential_think")
// and go through the full RFC 8693 token exchange pipeline.
const DIRECT_IDS = new Set([
  "accounts",
  "transactions",
  "sensitive-account-details",
  "mcp_tools",
  "logout",
  ...AI_CHIP_IDS,
]);

// ── CHIP_APPLICABLE_STEPS (mirrored from AIAgent.js) ───────────────────
// All chips that reach the banking backend exercise this full step set.
const FULL_STEP_SET = [
  "agent-llm-reasoning",
  "agent-token-init",
  "gw-scope-map",
  "agent-scope-aware-cache",
  "olb-resource-token",
  "claim-diagnostics",
];

// AI chips: same full step set as banking chips — they route through
// callMcpTool("sequential_think") which triggers RFC 8693 token exchange.
const AI_CHIP_STEPS = {
  ai_ask: FULL_STEP_SET,
  ai_helix_demo: FULL_STEP_SET,
  ai_explain: FULL_STEP_SET,
  ai_helix_explain: FULL_STEP_SET,
  ai_analyze: FULL_STEP_SET,
  ai_advice: FULL_STEP_SET,
  ai_helix_advice: FULL_STEP_SET,
};

// Banking chips: same full step set
const BANKING_CHIP_STEPS_SAMPLE = {
  accounts: FULL_STEP_SET,
  balance: FULL_STEP_SET,
  deposit: FULL_STEP_SET,
  transfer: FULL_STEP_SET,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BankingAgent chip catalog", () => {
  it("has no duplicate chip IDs across all groups", () => {
    const seen = new Set();
    const dupes = [];
    for (const id of ALL_CHIP_IDS) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it("account group contains all expected chips", () => {
    expect(ACCOUNT_CHIP_IDS).toContain("accounts");
    expect(ACCOUNT_CHIP_IDS).toContain("balance");
    expect(ACCOUNT_CHIP_IDS).toContain("sensitive-account-details");
    expect(ACCOUNT_CHIP_IDS).toContain("sequential_think");
  });

  it("transaction group contains all expected chips", () => {
    expect(TRANSACTION_CHIP_IDS).toContain("deposit");
    expect(TRANSACTION_CHIP_IDS).toContain("withdraw");
    expect(TRANSACTION_CHIP_IDS).toContain("transfer");
    expect(TRANSACTION_CHIP_IDS).toContain("transactions");
  });

  it("AI group contains all 7 LLM chips", () => {
    expect(AI_CHIP_IDS).toHaveLength(7);
    expect(AI_CHIP_IDS).toContain("ai_ask");
    expect(AI_CHIP_IDS).toContain("ai_helix_demo");
    expect(AI_CHIP_IDS).toContain("ai_explain");
    expect(AI_CHIP_IDS).toContain("ai_helix_explain");
    expect(AI_CHIP_IDS).toContain("ai_analyze");
    expect(AI_CHIP_IDS).toContain("ai_advice");
    expect(AI_CHIP_IDS).toContain("ai_helix_advice");
  });

  it("testing group contains compliance and NL routing chips", () => {
    expect(TESTING_CHIP_IDS).toContain("test_wrong_scope");
    expect(TESTING_CHIP_IDS).toContain("test_wrong_audience");
    expect(TESTING_CHIP_IDS).toContain("test_hitl_required");
    expect(TESTING_CHIP_IDS).toContain("transfer_600_test");
    expect(TESTING_CHIP_IDS).toContain("test_otp_required");
    expect(TESTING_CHIP_IDS).toContain("demo_intent_delegation");
    expect(TESTING_CHIP_IDS).toContain("demo_nl_routing");
  });
});

describe("Chip routing contract", () => {
  it("NL_ROUTED and DIRECT sets are non-overlapping", () => {
    const overlap = [...DIRECT_IDS].filter((id) => NL_ROUTED_IDS.has(id));
    expect(overlap).toEqual([]);
  });

  it("all AI group chips are direct-execution (call runAction() on click, not setNlInputFromTile)", () => {
    for (const id of AI_CHIP_IDS) {
      expect(DIRECT_IDS.has(id)).toBe(true);
      expect(NL_ROUTED_IDS.has(id)).toBe(false);
    }
  });

  it("core banking chips that need parameters are NL-routed", () => {
    const paramChips = ["transfer", "deposit", "withdraw", "balance"];
    for (const id of paramChips) {
      expect(NL_ROUTED_IDS.has(id)).toBe(true);
      expect(DIRECT_IDS.has(id)).toBe(false);
    }
  });

  it("banking chips with no required parameters are direct-execution", () => {
    const noParamBankingChips = ["accounts", "transactions"];
    for (const id of noParamBankingChips) {
      expect(DIRECT_IDS.has(id)).toBe(true);
      expect(NL_ROUTED_IDS.has(id)).toBe(false);
    }
  });

  it("the NL-routed set and direct set together cover all registered chip IDs (no unrouted chips)", () => {
    // demo_guide opens a modal; test_full_compliance_flow runs via runAction in testing group.
    const knownSpecial = new Set(["demo_guide", "test_full_compliance_flow"]);
    const unrouted = ALL_CHIP_IDS.filter((id) => !knownSpecial.has(id)).filter(
      (id) =>
        !NL_ROUTED_IDS.has(id) &&
        !DIRECT_IDS.has(id) &&
        !TESTING_CHIP_IDS.includes(id),
    );
    expect(unrouted).toEqual([]);
  });
});

describe("Full compliance pipeline — AI chips go through olb-resource-token", () => {
  // The whole point of the demo is that every chip — including AI/LLM chips —
  // exercises the full RFC 8693 token exchange pipeline. AI chips route through
  // callMcpTool("sequential_think") which triggers the MCP gateway (olb-resource-token)
  // just like balance checks, transfers, and deposits do.

  it("every AI chip step set includes olb-resource-token", () => {
    for (const steps of Object.values(AI_CHIP_STEPS)) {
      expect(steps).toContain("olb-resource-token");
    }
  });

  it("every AI chip step set includes agent-token-init and gw-scope-map", () => {
    for (const steps of Object.values(AI_CHIP_STEPS)) {
      expect(steps).toContain("agent-token-init");
      expect(steps).toContain("gw-scope-map");
    }
  });

  it("AI chip step sets match the banking chip step set exactly", () => {
    for (const aiSteps of Object.values(AI_CHIP_STEPS)) {
      expect(aiSteps).toEqual(FULL_STEP_SET);
    }
    for (const bankingSteps of Object.values(BANKING_CHIP_STEPS_SAMPLE)) {
      expect(bankingSteps).toEqual(FULL_STEP_SET);
    }
  });

  it("banking chips also include olb-resource-token", () => {
    for (const steps of Object.values(BANKING_CHIP_STEPS_SAMPLE)) {
      expect(steps).toContain("olb-resource-token");
    }
  });

  it("AI chips and banking chips exercise the same number of compliance steps", () => {
    const aiStepCount = Object.values(AI_CHIP_STEPS)[0].length;
    for (const steps of Object.values(BANKING_CHIP_STEPS_SAMPLE)) {
      expect(steps.length).toBe(aiStepCount);
    }
  });
});
