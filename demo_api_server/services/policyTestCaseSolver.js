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
  if (node.and) { node.and.conditions.forEach((c) => { satisfy(c, index, out, base); }); return; }
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
    rest.forEach((c) => { satisfy(c, index, out, base); });
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
  if (node.and) { node.and.conditions.forEach((c) => { collectAttributeNames(c, index, acc); }); return acc; }
  if (node.or) { node.or.conditions.forEach((c) => { collectAttributeNames(c, index, acc); }); return acc; }
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
