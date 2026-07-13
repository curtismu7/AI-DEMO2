# Policy Rule Test Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click a Rule in the PingOne Authorize Live Policy Console's Authorization Policies tree and get the Evaluate panel prefilled with a real trigger/avoid test for that rule, derived by solving the rule's actual condition tree.

**Architecture:** A new pure backend module (`policyTestCaseSolver.js`) walks each Rule's condition tree (from the P1AZ snapshot) and computes two parameter-override sets — one that makes the condition true, one that makes it false — merged onto domain-appropriate base defaults. `getAuthorizationPoliciesFromSnapshot()` attaches these as a `testCases` field per Rule node. The frontend adds two small actions per Rule ("Trigger →" / "Avoid →") that populate the existing Evaluate panel's preset and fields — no new evaluation code path, no auto-run.

**Tech Stack:** Node.js/Express (`demo_api_server`), Jest, React (`demo_api_ui`).

## Global Constraints

- Work happens in this worktree (`.claude/worktrees/policy-test-generator`, branch `feat/policy-test-generator`) — never the main checkout (per this repo's CLAUDE.md).
- Emoji allowlist: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟` only. Do not introduce others.
- Minimal diff: touch only the files/lines this feature needs.
- Stage files explicitly (`git add <files>`, never `git add -A`); verify `git branch --show-current` before each commit.
- Design spec: `docs/superpowers/specs/2026-07-12-policy-rule-test-generator-design.md` — this plan implements it exactly; do not add scope beyond it (no live-API-shape handling, no Policy/PolicySet-level buttons, no auto-run).

---

### Task 1: `policyTestCaseSolver.js` — condition-tree solver (TDD)

**Files:**
- Create: `demo_api_server/services/policyTestCaseSolver.js`
- Test: `demo_api_server/src/__tests__/policyTestCaseSolver.test.js`

**Interfaces:**
- Produces: `buildTestCasesForRule(rule, index)` → `{ trigger: { preset, parameters }, avoid: { preset, parameters } } | null`, where `rule` is a raw snapshot `Rule` entry (`{ condition, effectSettings }`) and `index` is a `Map<id, entry>` covering `CONDITION` and `ATTRIBUTE` snapshot entries (`entry.condition` for CONDITION entries, `entry.name`/`entry.valueType` for ATTRIBUTE entries).
- Produces: `PRESET_BASE_DEFAULTS` (`{ transaction, mcp, custom }` objects) — consumed by Task 2's wiring indirectly (already merged inside `buildTestCasesForRule`'s output) and by nothing else.
- Also exports `_classifyDomain`, `_collectAttributeNames`, `_satisfy`, `_violate` for direct unit testing (matches this codebase's `_`-prefixed test-only export convention, e.g. `_normalizeDecision` in `pingOneAuthorizeService.js`).

- [ ] **Step 1: Write the failing test file**

Create `demo_api_server/src/__tests__/policyTestCaseSolver.test.js`:

```js
const {
  _satisfy,
  _violate,
  _classifyDomain,
  buildTestCasesForRule,
} = require('../../services/policyTestCaseSolver');

function idx(entries) { return new Map(entries.map((e) => [e.id, e])); }

describe('policyTestCaseSolver satisfy/violate', () => {
  test('GreaterThan: satisfy is constant+1, violate is constant', () => {
    const index = idx([{ id: 'a1', name: 'Amount', valueType: 'NUMBER' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ Amount: 2001 });
    const avoid = {}; _violate(node, index, avoid, {});
    expect(avoid).toEqual({ Amount: 2000 });
  });

  test('Equals (string): satisfy is the constant, violate prefers a differing base default', () => {
    const index = idx([{ id: 'a1', name: 'TransactionType', valueType: 'STRING' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'withdrawal' } } } };
    const base = { TransactionType: 'transfer' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ TransactionType: 'withdrawal' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TransactionType: 'transfer' });
  });

  test('Equals (string): violate falls back to the generic sentinel when the base default equals the constant', () => {
    const index = idx([{ id: 'a1', name: 'TransactionType', valueType: 'STRING' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'transfer' } } } };
    const base = { TransactionType: 'transfer' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TransactionType: '__generated__' });
  });

  test('NotEquals (boolean): satisfy flips the constant, violate reproduces it', () => {
    const index = idx([{ id: 'a1', name: 'HitlApproved', valueType: 'BOOLEAN' }]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: 'true' } } } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ HitlApproved: false });
    const avoid = {}; _violate(node, index, avoid, {});
    expect(avoid).toEqual({ HitlApproved: true });
  });

  test('AND with disjoint attributes: satisfy sets both, violate falsifies only the first', () => {
    const index = idx([
      { id: 'a1', name: 'Amount', valueType: 'NUMBER' },
      { id: 'a2', name: 'TransactionType', valueType: 'STRING' },
    ]);
    const node = {
      and: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '500' } } } },
          { comparison: { left: { attribute: { id: 'a2' } }, op: 'Equals', right: { constant: { value: 'transfer' } } } },
        ],
      },
    };
    const base = { TransactionType: 'deposit' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ Amount: 501, TransactionType: 'transfer' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ Amount: 500, TransactionType: 'transfer' });
  });

  test('AND where two children constrain the same attribute: the falsifying write wins', () => {
    const index = idx([{ id: 'a1', name: 'UserId', valueType: 'STRING' }]);
    const node = {
      and: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: 'none' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'NotEquals', right: { constant: { value: '' } } } },
        ],
      },
    };
    const base = { UserId: 'demoUser' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ UserId: 'none' });
  });

  test('OR: satisfy picks the first branch', () => {
    const index = idx([{ id: 'a1', name: 'ToolName', valueType: 'STRING' }]);
    const node = {
      or: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'checkout' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'create_transfer' } } } },
        ],
      },
    };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ ToolName: 'checkout' });
  });

  test('OR of same-attribute Equals: violate picks one value distinct from every branch', () => {
    const index = idx([{ id: 'a1', name: 'ToolName', valueType: 'STRING' }]);
    const node = {
      or: {
        conditions: [
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'checkout' } } } },
          { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'create_transfer' } } } },
        ],
      },
    };
    const base = { ToolName: 'transfer' };
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ ToolName: 'transfer' });
  });

  test('NOT flips satisfy/violate on its child', () => {
    const index = idx([{ id: 'a1', name: 'Acr', valueType: 'STRING' }]);
    const node = { not: { condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { constant: { value: 'Multi_Factor' } } } } } };
    const base = { Acr: '' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ Acr: '' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ Acr: 'Multi_Factor' });
  });

  test('reference resolves the named condition transparently', () => {
    const index = idx([
      { id: 'a1', name: 'Amount', valueType: 'NUMBER' },
      { id: 'c1', condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } } },
    ]);
    const node = { reference: { id: 'c1' } };
    const trig = {}; _satisfy(node, index, trig, {});
    expect(trig).toEqual({ Amount: 2001 });
  });

  test('attribute-to-attribute comparison uses the right attribute\'s base default', () => {
    const index = idx([
      { id: 'a1', name: 'TokenAudience', valueType: 'STRING' },
      { id: 'a2', name: 'McpResourceUri', valueType: 'STRING' },
    ]);
    const node = { comparison: { left: { attribute: { id: 'a1' } }, op: 'Equals', right: { attribute: { id: 'a2' } } } };
    const base = { TokenAudience: 'mcpgateway.ping.demo', McpResourceUri: 'mcpgateway.ping.demo' };
    const trig = {}; _satisfy(node, index, trig, base);
    expect(trig).toEqual({ TokenAudience: 'mcpgateway.ping.demo' });
    const avoid = {}; _violate(node, index, avoid, base);
    expect(avoid).toEqual({ TokenAudience: '__generated__' });
  });
});

describe('policyTestCaseSolver domain classification', () => {
  test('attributes fully within the transaction preset classify as transaction', () => {
    expect(_classifyDomain(['Amount', 'Acr'])).toBe('transaction');
  });
  test('attributes fully within the mcp preset classify as mcp', () => {
    expect(_classifyDomain(['ToolName', 'HitlApproved'])).toBe('mcp');
  });
  test('attributes outside both presets classify as custom', () => {
    expect(_classifyDomain(['UserTier', 'Amount'])).toBe('custom');
  });
});

describe('buildTestCasesForRule', () => {
  test('an empty condition produces no test cases', () => {
    const rule = { effectSettings: { type: 'unconditionalPermit' }, condition: { empty: {} } };
    expect(buildTestCasesForRule(rule, new Map())).toBeNull();
  });

  test('effectSettings.condition takes precedence over the top-level condition when present', () => {
    const index = idx([{ id: 'a1', name: 'Amount', valueType: 'NUMBER' }]);
    const rule = {
      effectSettings: {
        type: 'conditionalDenyElsePermit',
        condition: { comparison: { left: { attribute: { id: 'a1' } }, op: 'GreaterThan', right: { constant: { value: '2000' } } } },
      },
      condition: { empty: {} },
    };
    const result = buildTestCasesForRule(rule, index);
    expect(result.trigger.preset).toBe('transaction');
    expect(result.trigger.parameters.Amount).toBe(2001);
    expect(result.avoid.parameters.Amount).toBe(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/policyTestCaseSolver.test.js`
Expected: FAIL with `Cannot find module '../../services/policyTestCaseSolver'`

- [ ] **Step 3: Implement the solver**

Create `demo_api_server/services/policyTestCaseSolver.js`:

```js
'use strict';

/**
 * Solves PingOne Authorize condition trees (from the P1AZ snapshot) into
 * concrete parameter overrides that make a Rule's condition true ("trigger")
 * or false ("avoid") — used by the Live Policy Console to generate a
 * ready-to-run test for a rule directly from its actual policy logic, rather
 * than guessing from its description.
 *
 * Handles exactly the operators/combinators present in the current snapshot:
 * comparison (GreaterThan/Equals/NotEquals, constant or attribute-to-attribute
 * right-hand side), and/or/not, and reference (a named, reusable
 * sub-condition).
 */

const TRANSACTION_FIELDS = new Set(['Amount', 'TransactionType', 'UserId', 'Acr']);
const MCP_FIELDS = new Set(['ToolName', 'TokenAudience', 'ActClientId', 'UserId', 'HitlApproved', 'McpResourceUri', 'DecisionContext']);

// Mirrors the tuned-to-PERMIT defaults already hardcoded in EvaluatePanel's
// component state (PingOneAuthorizePage.jsx) for the transaction/mcp presets.
// The custom domain starts from the mcp defaults plus inert baselines for the
// tier/group/A2A attributes those rules describe as "inert unless the BFF
// sends" the attribute.
const PRESET_BASE_DEFAULTS = {
  transaction: {
    Amount: 5000,
    TransactionType: 'transfer',
    UserId: 'demoUser',
    Acr: '',
  },
  mcp: {
    DecisionContext: 'McpFirstTool',
    UserId: 'demoUser',
    ToolName: 'transfer',
    TokenAudience: 'mcpgateway.ping.demo',
    ActClientId: 'd21c5124-8ac5-43d1-81f2-31a7ec649b96',
    McpResourceUri: 'mcpgateway.ping.demo',
    HitlApproved: false,
  },
  custom: {
    DecisionContext: 'McpFirstTool',
    UserId: 'demoUser',
    ToolName: 'transfer',
    TokenAudience: 'mcpgateway.ping.demo',
    ActClientId: 'd21c5124-8ac5-43d1-81f2-31a7ec649b96',
    McpResourceUri: 'mcpgateway.ping.demo',
    HitlApproved: false,
    Acr: '',
    Amount: 100,
    UserTier: 'PrivateBanking',
    RequiredGroup: 'none',
    InRequiredGroup: true,
    ActChainDepth: 1,
    NestedActClientId: '',
  },
};

const GENERIC_STRING_SENTINEL = '__generated__';

function resolveConstant(rawValue, valueType) {
  if (valueType === 'NUMBER') return Number(rawValue);
  if (valueType === 'BOOLEAN') return rawValue === 'true' || rawValue === true;
  return rawValue;
}

/** A value guaranteed different from every value in `avoidValues`, preferring
 * the domain's own base default for that attribute when it's safe to reuse. */
function distinctFromAll(avoidValues, valueType, baseValue) {
  if (valueType === 'BOOLEAN') return !avoidValues[0];
  if (baseValue !== undefined && !avoidValues.includes(baseValue)) return baseValue;
  if (valueType === 'NUMBER') return Math.max(...avoidValues) + 1;
  return GENERIC_STRING_SENTINEL;
}

function resolveRef(node, index) {
  const cond = index.get(node.reference.id);
  if (!cond) throw new Error(`Unresolved condition reference: ${node.reference.id}`);
  return cond.condition;
}

/** Resolves the right-hand side of a comparison to a concrete value: a
 * literal constant, or (for attribute-to-attribute comparisons) the other
 * attribute's base default. */
function rightValue(comparison, index, leftAttr, base) {
  if (comparison.right.constant !== undefined) {
    return resolveConstant(comparison.right.constant.value, leftAttr.valueType);
  }
  if (comparison.right.attribute !== undefined) {
    const rightAttr = index.get(comparison.right.attribute.id);
    return base[rightAttr.name];
  }
  throw new Error(`Unsupported comparison right-hand side: ${JSON.stringify(comparison.right)}`);
}

function applyComparison(comparison, index, out, base, mode) {
  const leftAttr = index.get(comparison.left.attribute.id);
  const constant = rightValue(comparison, index, leftAttr, base);
  const baseValue = base[leftAttr.name];
  if (comparison.op === 'GreaterThan') {
    out[leftAttr.name] = mode === 'satisfy' ? constant + 1 : constant;
    return;
  }
  if (comparison.op === 'Equals') {
    out[leftAttr.name] = mode === 'satisfy' ? constant : distinctFromAll([constant], leftAttr.valueType, baseValue);
    return;
  }
  if (comparison.op === 'NotEquals') {
    out[leftAttr.name] = mode === 'satisfy' ? distinctFromAll([constant], leftAttr.valueType, baseValue) : constant;
    return;
  }
  throw new Error(`Unsupported comparator "${comparison.op}" on attribute "${leftAttr.name}"`);
}

/** True when every child is a bare `attr Equals constant` comparison on the
 * same attribute — the pattern every OR in the current snapshot uses
 * (tool-name lists, actor-id lists, transaction-type lists). Returns the
 * leaves, or null if the pattern doesn't match. */
function sameAttributeEqualsList(children) {
  const leaves = children.map((c) => (c.comparison && c.comparison.op === 'Equals' ? c.comparison : null));
  if (!leaves.every(Boolean)) return null;
  const firstId = leaves[0].left.attribute.id;
  if (!leaves.every((c) => c.left.attribute.id === firstId)) return null;
  return leaves;
}

function violateOr(children, index, out, base) {
  const leaves = sameAttributeEqualsList(children);
  if (leaves) {
    const attr = index.get(leaves[0].left.attribute.id);
    const constants = leaves.map((c) => resolveConstant(c.right.constant.value, attr.valueType));
    out[attr.name] = distinctFromAll(constants, attr.valueType, base[attr.name]);
    return;
  }
  // Non-uniform OR (e.g. OR of AND-subtrees): falsifying the first branch is
  // sufficient as long as the domain's base defaults don't independently
  // satisfy the remaining branches. True for every OR in the current
  // snapshot (pinned by this module's and the integration tests) and far
  // simpler than exhaustively falsifying every branch.
  violate(children[0], index, out, base);
}

function satisfy(node, index, out, base) {
  if (!node || node.empty) return;
  if (node.reference) return satisfy(resolveRef(node, index), index, out, base);
  if (node.not) return violate(node.not.condition, index, out, base);
  if (node.comparison) return applyComparison(node.comparison, index, out, base, 'satisfy');
  if (node.or) return satisfy(node.or.conditions[0], index, out, base);
  if (node.and) { node.and.conditions.forEach((c) => satisfy(c, index, out, base)); return; }
  throw new Error(`Unrecognized condition node: ${JSON.stringify(node)}`);
}

function violate(node, index, out, base) {
  if (!node || node.empty) return;
  if (node.reference) return violate(resolveRef(node, index), index, out, base);
  if (node.not) return satisfy(node.not.condition, index, out, base);
  if (node.comparison) return applyComparison(node.comparison, index, out, base, 'violate');
  if (node.or) return violateOr(node.or.conditions, index, out, base);
  if (node.and) {
    const [target, ...rest] = node.and.conditions;
    // Best-effort realism first, so the falsifying write below always wins
    // on any attribute the two share (e.g. two NotEquals checks on UserId).
    rest.forEach((c) => satisfy(c, index, out, base));
    violate(target, index, out, base);
    return;
  }
  throw new Error(`Unrecognized condition node: ${JSON.stringify(node)}`);
}

function collectAttributeNames(node, index, acc = new Set()) {
  if (!node || node.empty) return acc;
  if (node.reference) return collectAttributeNames(resolveRef(node, index), index, acc);
  if (node.not) return collectAttributeNames(node.not.condition, index, acc);
  if (node.comparison) {
    acc.add(index.get(node.comparison.left.attribute.id).name);
    if (node.comparison.right.attribute !== undefined) acc.add(index.get(node.comparison.right.attribute.id).name);
    return acc;
  }
  if (node.and) { node.and.conditions.forEach((c) => collectAttributeNames(c, index, acc)); return acc; }
  if (node.or) { node.or.conditions.forEach((c) => collectAttributeNames(c, index, acc)); return acc; }
  throw new Error(`Unrecognized condition node: ${JSON.stringify(node)}`);
}

function classifyDomain(attrNames) {
  const names = [...attrNames];
  if (names.every((n) => TRANSACTION_FIELDS.has(n))) return 'transaction';
  if (names.every((n) => MCP_FIELDS.has(n))) return 'mcp';
  return 'custom';
}

/**
 * @param {object} rule - a raw snapshot Rule entry ({ condition, effectSettings }).
 * @param {Map} index - id -> CONDITION|ATTRIBUTE snapshot entry.
 * @returns {{trigger: {preset: string, parameters: object}, avoid: {preset: string, parameters: object}} | null}
 */
function buildTestCasesForRule(rule, index) {
  const condition = (rule.effectSettings && rule.effectSettings.condition) || rule.condition;
  if (!condition || condition.empty) return null;

  const domain = classifyDomain(collectAttributeNames(condition, index));
  const base = PRESET_BASE_DEFAULTS[domain];

  const triggerOverrides = {};
  satisfy(condition, index, triggerOverrides, base);
  const avoidOverrides = {};
  violate(condition, index, avoidOverrides, base);

  return {
    trigger: { preset: domain, parameters: { ...base, ...triggerOverrides } },
    avoid: { preset: domain, parameters: { ...base, ...avoidOverrides } },
  };
}

module.exports = {
  buildTestCasesForRule,
  PRESET_BASE_DEFAULTS,
  _classifyDomain: classifyDomain,
  _collectAttributeNames: collectAttributeNames,
  _satisfy: satisfy,
  _violate: violate,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/policyTestCaseSolver.test.js`
Expected: PASS, all 16 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/policyTestCaseSolver.js demo_api_server/src/__tests__/policyTestCaseSolver.test.js
git commit -m "Add policy rule condition-tree solver for the Live Policy Console"
```

---

### Task 2: Wire the solver into `getAuthorizationPoliciesFromSnapshot()`

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js:822-864`
- Test: `demo_api_server/src/__tests__/policyTestCaseSolverSnapshotIntegration.test.js`

**Interfaces:**
- Consumes: `buildTestCasesForRule(rule, index)` from Task 1 (`demo_api_server/services/policyTestCaseSolver.js`).
- Produces: every `RULE`-kind node returned by `getAuthorizationPoliciesFromSnapshot()` gains a `testCases` field (`null` for unconditional rules, else `{ trigger, avoid }` as defined in Task 1).

- [ ] **Step 1: Write the failing integration test**

Create `demo_api_server/src/__tests__/policyTestCaseSolverSnapshotIntegration.test.js`:

```js
const { getAuthorizationPoliciesFromSnapshot } = require('../../services/pingOneAuthorizeService');

function findRule(nodes, name) {
  for (const n of nodes) {
    if (n.kind === 'RULE' && n.name === name) return n;
    const found = findRule(n.children || [], name);
    if (found) return found;
  }
  return null;
}

describe('getAuthorizationPoliciesFromSnapshot testCases wiring', () => {
  const policies = getAuthorizationPoliciesFromSnapshot();

  test('snapshot loads', () => {
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
  });

  test('unconditional rules get no test cases', () => {
    expect(findRule(policies, 'Permit Standard Transactions').testCases).toBeNull();
    expect(findRule(policies, 'MCP Permit Valid Tool Invocation').testCases).toBeNull();
  });

  test('Deny Large Transactions: Amount > 2000', () => {
    const tc = findRule(policies, 'Deny Large Transactions').testCases;
    expect(tc.trigger.preset).toBe('transaction');
    expect(tc.trigger.parameters.Amount).toBe(2001);
    expect(tc.avoid.parameters.Amount).toBe(2000);
  });

  test('Require Step-Up MFA for High-Value Transfers: Amount > 500, transfer/withdrawal, no MFA', () => {
    const tc = findRule(policies, 'Require Step-Up MFA for High-Value Transfers').testCases;
    expect(tc.trigger.preset).toBe('transaction');
    expect(tc.trigger.parameters).toMatchObject({ Amount: 501, TransactionType: 'transfer', Acr: '' });
    expect(tc.avoid.parameters).toMatchObject({ Amount: 500, TransactionType: 'transfer', Acr: '' });
  });

  test('Require Consent for Mid-Value Transactions: Amount > 250', () => {
    const tc = findRule(policies, 'Require Consent for Mid-Value Transactions').testCases;
    expect(tc.trigger.parameters.Amount).toBe(251);
    expect(tc.avoid.parameters.Amount).toBe(250);
  });

  test('MCP Deny — Invalid Token Audience: TokenAudience must differ from McpResourceUri to trigger', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid Token Audience').testCases;
    expect(tc.trigger.preset).toBe('mcp');
    expect(tc.trigger.parameters.TokenAudience).toBe('__generated__');
    expect(tc.avoid.parameters.TokenAudience).toBe(tc.avoid.parameters.McpResourceUri);
  });

  test('MCP Deny — Missing User ID: UserId must be "none" to trigger', () => {
    const tc = findRule(policies, 'MCP Deny — Missing User ID').testCases;
    expect(tc.trigger.parameters.UserId).toBe('none');
    expect(tc.avoid.parameters.UserId).toBe('demoUser');
  });

  test('MCP Deny — Invalid Actor Chain: avoid uses a registered actor id', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid Actor Chain').testCases;
    expect(tc.avoid.parameters.ActClientId).toBe('f4dd707d-f78d-4417-ba56-dc8707d10a1f');
  });

  test('MCP Require HITL Consent for sensitive tools: trigger uses a gated tool with HitlApproved false', () => {
    const tc = findRule(policies, 'MCP Require HITL Consent for sensitive tools').testCases;
    expect(tc.trigger.parameters).toMatchObject({ ToolName: 'book_appointment', HitlApproved: false });
  });

  test('MCP Deny — Invalid A2A Generalist: trigger needs a 2+ hop chain with an unverified generalist', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid A2A Generalist').testCases;
    expect(tc.trigger.preset).toBe('custom');
    expect(tc.trigger.parameters).toMatchObject({ ActChainDepth: 2, NestedActClientId: '' });
    expect(tc.avoid.parameters.ActChainDepth).toBe(1);
  });

  test('MCP Require Step-Up for sensitive tools: trigger uses a gated tool with no MFA', () => {
    const tc = findRule(policies, 'MCP Require Step-Up for sensitive tools').testCases;
    expect(tc.trigger.preset).toBe('custom');
    expect(tc.trigger.parameters).toMatchObject({ ToolName: 'cash_out_store_credit', Acr: '' });
  });

  test('MCP Deny — Tier Tool Not Allowed: trigger is a Standard-tier user on a restricted tool', () => {
    const tc = findRule(policies, 'MCP Deny — Tier Tool Not Allowed').testCases;
    expect(tc.trigger.parameters).toMatchObject({ UserTier: 'Standard', ToolName: 'create_withdrawal' });
    expect(tc.avoid.parameters.UserTier).toBe('PrivateBanking');
  });

  test('MCP Deny — Tier Amount Exceeded: trigger is a Standard-tier user over the $2000 cap', () => {
    const tc = findRule(policies, 'MCP Deny — Tier Amount Exceeded').testCases;
    expect(tc.trigger.parameters).toMatchObject({ UserTier: 'Standard', Amount: 2001 });
    expect(tc.avoid.parameters.UserTier).toBe('PrivateBanking');
  });

  test('MCP Deny — Not In Required Group: trigger requires a group the user lacks', () => {
    const tc = findRule(policies, 'MCP Deny — Not In Required Group').testCases;
    expect(tc.trigger.parameters).toMatchObject({ InRequiredGroup: false });
    expect(tc.trigger.parameters.RequiredGroup).not.toBe('none');
    expect(tc.avoid.parameters.RequiredGroup).toBe('none');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/policyTestCaseSolverSnapshotIntegration.test.js`
Expected: FAIL — `findRule(...).testCases` is `undefined`, not the expected shape (the field doesn't exist yet).

- [ ] **Step 3: Wire the solver into `getAuthorizationPoliciesFromSnapshot()`**

In `demo_api_server/services/pingOneAuthorizeService.js`, add the require near the top of the file (after the existing `require('../utils/circuitBreaker')` at line 43):

```js
const { buildTestCasesForRule } = require('./policyTestCaseSolver');
```

Then replace lines 839-859 (the `byId` build + `toNode`) with:

```js
  const byId = new Map();
  const conditionIndex = new Map();
  for (const e of entries) {
    if (!e || !e.id) continue;
    if (e.type === 'PolicySet' || e.type === 'Policy' || e.type === 'Rule') byId.set(e.id, e);
    if (e.type === 'CONDITION' || e.type === 'ATTRIBUTE') conditionIndex.set(e.id, e);
  }
  if (byId.size === 0) return null;

  const toNode = (entry, depth) => {
    if (!entry) return null;
    const isRule = entry.type === 'Rule';
    const childRefs = Array.isArray(entry.children) ? entry.children : [];
    return {
      id: entry.id,
      kind: isRule ? 'RULE' : (depth === 0 ? 'POLICY_SET' : 'POLICY'),
      name: entry.name || '(unnamed)',
      description: entry.description || '',
      enabled: entry.disabled !== true,
      algorithm: entry.combiningAlgorithm?.algorithm || null,
      effect: entry.effectSettings?.type || null,
      children: childRefs.map((c) => toNode(byId.get(c.id), depth + 1)).filter(Boolean),
      ...(isRule ? { testCases: buildTestCasesForRule(entry, conditionIndex) } : {}),
    };
  };
```

(The rest of the function — the `roots`/`return` lines — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/policyTestCaseSolverSnapshotIntegration.test.js`
Expected: PASS, all 13 tests green.

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run: `cd demo_api_server && npx jest src/__tests__/pingOneAuthorize src/__tests__/authorizeSnapshotDrift.test.js`
Expected: PASS (no existing test reads the new `testCases` field, so none should break; this confirms the edit didn't disturb `_normalizePolicyNode`, `getAuthorizationPolicies`, or drift-check behavior).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/pingOneAuthorizeService.js demo_api_server/src/__tests__/policyTestCaseSolverSnapshotIntegration.test.js
git commit -m "Attach solved trigger/avoid test cases to snapshot Rule nodes"
```

---

### Task 3: Frontend — Trigger/Avoid actions on each Rule

**Files:**
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (style constants, `PolicyNode`, `PoliciesCard`)

**Interfaces:**
- Consumes: `node.testCases` (from Task 2) — `null` or `{ trigger: {preset, parameters}, avoid: {preset, parameters} }`.
- Produces: calls `onTestRule({ ruleName, case: 'trigger'|'avoid', preset, parameters })` — consumed by Task 4's page-level handler.

- [ ] **Step 1: Add styles**

In the `S` object, immediately after the `polDisabled` entry (around line 145, just before the closing `};` of `S`), add:

```js
  polTestActions: { display: 'flex', gap: '10px', marginTop: '6px' },
  polTestBtn: { background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline' },
  pendingLabel: { fontSize: '11px', fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '6px', padding: '4px 10px', marginBottom: '10px', display: 'inline-block' },
```

- [ ] **Step 2: Add Trigger/Avoid buttons to `PolicyNode`, thread the callback through**

Replace the current `PolicyNode` function:

```jsx
function PolicyNode({ node }) {
  if (!node) return null;
  const kindLabel = { POLICY_SET: 'Policy Set', POLICY: 'Policy', RULE: 'Rule' }[node.kind] || node.kind;
  return (
    <div style={S.polNode(node.kind)}>
      <div style={S.polHead}>
        <span style={S.polKind(node.kind)}>{kindLabel}</span>
        <span style={S.polName}>{node.name}</span>
        {node.algorithm && <span style={S.polMeta}>{node.algorithm}</span>}
        {node.effect && <span style={S.polEffect(node.effect)}>{node.effect.replace(/_/g, ' ')}</span>}
        {!node.enabled && <span style={S.polDisabled}>disabled</span>}
      </div>
      {node.description && <p style={S.polDesc}>{node.description}</p>}
      {node.children?.length > 0 && (
        <div style={S.polChildren}>
          {node.children.map((c) => <PolicyNode key={c.id} node={c} />)}
        </div>
      )}
    </div>
  );
}
```

with:

```jsx
function PolicyNode({ node, onTestRule }) {
  if (!node) return null;
  const kindLabel = { POLICY_SET: 'Policy Set', POLICY: 'Policy', RULE: 'Rule' }[node.kind] || node.kind;
  return (
    <div style={S.polNode(node.kind)}>
      <div style={S.polHead}>
        <span style={S.polKind(node.kind)}>{kindLabel}</span>
        <span style={S.polName}>{node.name}</span>
        {node.algorithm && <span style={S.polMeta}>{node.algorithm}</span>}
        {node.effect && <span style={S.polEffect(node.effect)}>{node.effect.replace(/_/g, ' ')}</span>}
        {!node.enabled && <span style={S.polDisabled}>disabled</span>}
      </div>
      {node.description && <p style={S.polDesc}>{node.description}</p>}
      {node.kind === 'RULE' && node.testCases && (
        <div style={S.polTestActions}>
          <button style={S.polTestBtn} onClick={() => onTestRule({ ruleName: node.name, case: 'trigger', ...node.testCases.trigger })}>Trigger →</button>
          <button style={S.polTestBtn} onClick={() => onTestRule({ ruleName: node.name, case: 'avoid', ...node.testCases.avoid })}>Avoid →</button>
        </div>
      )}
      {node.children?.length > 0 && (
        <div style={S.polChildren}>
          {node.children.map((c) => <PolicyNode key={c.id} node={c} onTestRule={onTestRule} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Thread `onTestRule` through `PoliciesCard`**

In `PoliciesCard`, change the function signature from `function PoliciesCard({ state }) {` to `function PoliciesCard({ state, onTestRule }) {`, and change the tree render line:

```jsx
            <div style={S.polTree}>
              {state.policies.map((p) => <PolicyNode key={p.id} node={p} />)}
            </div>
```

to:

```jsx
            <div style={S.polTree}>
              {state.policies.map((p) => <PolicyNode key={p.id} node={p} onTestRule={onTestRule} />)}
            </div>
```

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/PingOneAuthorizePage.jsx
git commit -m "Add Trigger/Avoid actions to rules in the Authorization Policies tree"
```

---

### Task 4: Frontend — page + Evaluate panel wiring

**Files:**
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx` (main page component, `EvaluatePanel`)

**Interfaces:**
- Consumes: `onTestRule` calls from Task 3 (`{ ruleName, case, preset, parameters }`).
- Produces: `EvaluatePanel` receives a `pendingTest` prop and applies it without auto-running the evaluation.

- [ ] **Step 1: Add `pendingTest` state and handler to the main page component**

In `PingOneAuthorizePage`, change:

```jsx
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [recent, setRecent] = useState({ decisions: [], error: null, loading: false });
  const [enabling, setEnabling] = useState(false);
```

to:

```jsx
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [recent, setRecent] = useState({ decisions: [], error: null, loading: false });
  const [enabling, setEnabling] = useState(false);
  const [pendingTest, setPendingTest] = useState(null);
```

Then, immediately after the `useEffect(() => { load(); }, [load]);` line, add:

```jsx
  const handleTestRule = useCallback((testCase) => {
    setPendingTest(testCase);
    document.getElementById('evaluate-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
```

- [ ] **Step 2: Pass the handler/state to `PoliciesCard` and `EvaluatePanel`, add the scroll anchor**

Change:

```jsx
      {/* Authorization policies (read-only tree) */}
      <PoliciesCard state={policiesState} />

      {/* Evaluate */}
      <div style={S.card}>
        <div style={S.cardHead}><span style={S.cardTitle}>Evaluate</span></div>
        <div style={S.cardBody}>
          {selectedId
            ? <EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policies={policiesState.policies} />
            : <div style={S.empty}>Select a decision endpoint to evaluate.</div>}
        </div>
      </div>
```

to:

```jsx
      {/* Authorization policies (read-only tree) */}
      <PoliciesCard state={policiesState} onTestRule={handleTestRule} />

      {/* Evaluate */}
      <div style={S.card} id="evaluate-card">
        <div style={S.cardHead}><span style={S.cardTitle}>Evaluate</span></div>
        <div style={S.cardBody}>
          {selectedId
            ? <EvaluatePanel endpointId={selectedId} autoPreset={autoPreset} policies={policiesState.policies} pendingTest={pendingTest} />
            : <div style={S.empty}>Select a decision endpoint to evaluate.</div>}
        </div>
      </div>
```

- [ ] **Step 3: `EvaluatePanel` accepts and applies `pendingTest`**

Change the function signature from `function EvaluatePanel({ endpointId, autoPreset, policies }) {` to `function EvaluatePanel({ endpointId, autoPreset, policies, pendingTest }) {`.

Immediately after the existing effect:

```jsx
  // When the endpoint changes, reset to its auto-detected preset and clear result.
  useEffect(() => {
    setPreset(autoPreset);
    setResult(null);
    setErr(null);
    setLastTrace(null);
    setLastParameters(null);
  }, [endpointId, autoPreset]);
```

add:

```jsx
  // Apply a rule-generated test case (from the Authorization Policies tree):
  // switch to its preset and populate that preset's fields. Never auto-runs —
  // the user still clicks "Evaluate (live)".
  useEffect(() => {
    if (!pendingTest) return;
    setPreset(pendingTest.preset);
    setResult(null);
    setErr(null);
    const p = pendingTest.parameters;
    if (pendingTest.preset === 'transaction') {
      if (p.Amount !== undefined) setAmount(String(p.Amount));
      if (p.TransactionType !== undefined) setTxType(p.TransactionType);
      if (p.Acr !== undefined) setAcr(p.Acr);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else if (pendingTest.preset === 'mcp') {
      if (p.ToolName !== undefined) setToolName(p.ToolName);
      if (p.TokenAudience !== undefined) setTokenAudience(p.TokenAudience);
      if (p.ActClientId !== undefined) setActClientId(p.ActClientId);
      if (p.McpResourceUri !== undefined) setMcpResourceUri(p.McpResourceUri);
      if (p.HitlApproved !== undefined) setHitlApproved(!!p.HitlApproved);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else {
      const rows = Object.entries(p).map(([key, value]) => ({ key, value: String(value) }));
      rows.push({ key: '', value: '' });
      setCustomRows(rows);
    }
  }, [pendingTest]);
```

- [ ] **Step 4: Show which rule/case is loaded**

Immediately before the `<div style={S.tabs}>` line in `EvaluatePanel`'s returned JSX, add:

```jsx
      {pendingTest && (
        <div style={S.pendingLabel}>Testing: {pendingTest.ruleName} — {pendingTest.case}</div>
      )}
```

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/PingOneAuthorizePage.jsx
git commit -m "Wire rule-generated test cases into the Evaluate panel"
```

---

### Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the local stack**

Run: `./run-docker.sh start` (or `./run.sh` for the native launcher — see `CLAUDE.md`). Wait for `demo-api-server` and `ui` to be healthy.

- [ ] **Step 2: Sign in and open the console**

Navigate to the app, sign in as `demouser` / `Baseball123!` (per this repo's documented demo login), then go to **PingOne Authorize → Live Policy Console** (`/pingone-authorize`).

- [ ] **Step 3: Verify a `transaction`-domain rule (Deny Large Transactions)**

In the Authorization Policies tree, find **Deny Large Transactions** and click **Trigger →**.
Expected: page scrolls to the Evaluate card; "Testing: Deny Large Transactions — trigger" label appears; Transaction preset is selected; Amount field shows `2001`.
Click **Evaluate (live)**. Expected: decision is `DENY`.

Click **Avoid →** on the same rule.
Expected: label updates to "— avoid"; Amount field shows `2000`.
Click **Evaluate (live)**. Expected: decision is `PERMIT`.

- [ ] **Step 4: Verify a `custom`-domain rule (MCP Deny — Tier Amount Exceeded)**

Click **Trigger →** on **MCP Deny — Tier Amount Exceeded**.
Expected: preset switches to **Custom parameters**; rows include `UserTier=Standard` and `Amount=2001` (among the other mcp-derived rows).
Click **Evaluate (live)** against an MCP-capable decision endpoint. Expected: decision is `DENY`.

- [ ] **Step 5: Verify unconditional rules show no buttons**

Confirm **Permit Standard Transactions** and **MCP Permit Valid Tool Invocation** render with no Trigger/Avoid actions (only the read-only rule row).

- [ ] **Step 6: Confirm no regression to manual editing**

With a rule's test case loaded, manually edit a field (e.g. change Amount) and click Evaluate. Expected: the manual edit is respected (pendingTest only prefills once per click, it does not lock the fields).
