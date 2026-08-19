// demo_api_ui/src/utils/authorizeResultExplain.js
// Plain-language explanation for PingOne Authorize Live Policy Console results.

const TX_DENY_USD = 2000;
const TX_STEP_UP_USD = 500;
const TX_CONSENT_USD = 250;
const STEP_UP_TYPES = new Set(['transfer', 'withdrawal']);
const STRONG_ACR = /multi[_\s-]?factor/i;

function acrLooksStrong(acr) {
  return STRONG_ACR.test(String(acr || ''));
}

function statementsFromResult(result) {
  const raw = result?.pingoneResponse || result?.raw || {};
  return Array.isArray(raw.statements) ? raw.statements : [];
}

function displayDecision(result) {
  if (!result) return null;
  if (result.stepUpRequired) return 'STEP_UP';
  if (result.consentRequired || result.hitlRequired) return 'CONSENT';
  return result.decision;
}

/** Walk the normalized policy tree and collect nodes of a given kind. */
function collectNodes(roots, kind, out = []) {
  for (const n of roots || []) {
    if (n.kind === kind) out.push(n);
    if (n.children?.length) collectNodes(n.children, kind, out);
  }
  return out;
}

/** Find a policy node by transaction vs MCP evaluation context. */
function resolveActivePolicy(roots, { isMcp }) {
  const policies = collectNodes(roots, 'POLICY');
  if (!policies.length) return null;
  const needle = isMcp ? /mcp|delegation/i : /transaction/i;
  return policies.find((p) => needle.test(p.name)) || policies[0];
}

/** Match a rule node by name (exact, then substring). */
function findRuleNode(roots, ruleName) {
  if (!ruleName) return null;
  const rules = collectNodes(roots, 'RULE');
  const target = String(ruleName).toLowerCase();
  return (
    rules.find((r) => String(r.name).toLowerCase() === target)
    || rules.find((r) => String(r.name).toLowerCase().includes(target) || target.includes(String(r.name).toLowerCase()))
    || null
  );
}

function resolvePolicyContext(roots, { isMcp, ruleLikely }) {
  const policySet = (roots || []).find((n) => n.kind === 'POLICY_SET') || roots?.[0] || null;
  const policy = resolveActivePolicy(roots, { isMcp });
  const rule = findRuleNode(roots, ruleLikely);
  return {
    policySetName: policySet?.name || null,
    policyName: policy?.name || null,
    policyDescription: policy?.description || '',
    ruleName: rule?.name || ruleLikely || null,
    ruleDescription: rule?.description || '',
    combiningAlgorithm: policy?.algorithm || policySet?.algorithm || null,
  };
}

/**
 * Infer which AI Demo transaction rule most likely drove the verdict.
 * Uses thresholds from the provisioned snapshot; statements refine the headline.
 */
function explainTransaction(parameters, result) {
  const amount = Number(parameters.Amount) || 0;
  const type = String(parameters.TransactionType || 'transfer').toLowerCase();
  const acr = parameters.Acr ?? '';
  const strongAcr = acrLooksStrong(acr);
  const decision = displayDecision(result);
  const stmts = statementsFromResult(result);
  const stmtNames = stmts.map((s) => s.name || s.code).filter(Boolean);

  const reasons = [];
  let ruleLikely = 'Permit Standard Transactions';
  let headline = '';

  if (amount > TX_DENY_USD) {
    ruleLikely = 'Deny Large Transactions';
    headline = `DENY — amount $${amount.toLocaleString()} exceeds the $${TX_DENY_USD.toLocaleString()} hard-deny limit.`;
    reasons.push(
      `Amount ($${amount.toLocaleString()}) is above the $${TX_DENY_USD.toLocaleString()} threshold.`,
      'DenyOverrides: a DENY rule wins over step-up MFA and consent obligations.',
      type === 'deposit'
        ? 'Deposits normally bypass step-up, but the deny rule still applies above $2,000.'
        : `Transaction type "${type}" does not waive the deny threshold.`,
    );
    if (acr) reasons.push(`ACR "${acr}" does not override the deny rule.`);
  } else if (decision === 'STEP_UP' || result.stepUpRequired) {
    ruleLikely = 'Require Step-Up MFA for High-Value Transfers';
    headline = `Step-up required — high-value ${type} without strong MFA.`;
    reasons.push(
      `Amount ($${amount.toLocaleString()}) is at or above $${TX_STEP_UP_USD.toLocaleString()}.`,
      `Type "${type}" is subject to step-up when MFA is not satisfied.`,
      strongAcr
        ? `ACR "${acr}" was treated as MFA-satisfied.`
        : `ACR is "${acr || '(none)'}" — policy expects Multi_Factor to satisfy step-up.`,
    );
  } else if (decision === 'CONSENT' || result.consentRequired || result.hitlRequired) {
    ruleLikely = 'Require Consent for Mid-Value Transactions';
    headline = 'Consent / HITL required before proceeding.';
    reasons.push(
      `Amount ($${amount.toLocaleString()}) is at or above the $${TX_CONSENT_USD.toLocaleString()} consent threshold.`,
      'The BFF would return HTTP 428 until the user approves.',
    );
  } else if (decision === 'DENY') {
    ruleLikely = stmtNames[0] || 'Transaction policy (deny)';
    headline = 'DENY — transaction blocked by the authorization policy.';
    reasons.push('PingOne returned DENY. Check the response statements and policy trace below.');
  } else {
    headline = 'PERMIT — transaction allowed under current thresholds.';
    if (amount < TX_CONSENT_USD) {
      reasons.push(`Amount ($${amount.toLocaleString()}) is below the $${TX_CONSENT_USD.toLocaleString()} consent threshold.`);
    } else if (strongAcr) {
      reasons.push('MFA (Multi_Factor ACR) satisfies any step-up obligation.');
    } else if (!STEP_UP_TYPES.has(type) || amount < TX_STEP_UP_USD) {
      reasons.push(
        STEP_UP_TYPES.has(type)
          ? `Amount is below the $${TX_STEP_UP_USD.toLocaleString()} step-up threshold for ${type}.`
          : `Type "${type}" is not in the step-up type list (transfer/withdrawal).`,
      );
    } else {
      reasons.push('No deny, step-up, or consent rule applied for this input.');
    }
  }

  if (stmtNames.length) {
    reasons.push(`PingOne statements: ${stmtNames.join('; ')}.`);
  }

  return {
    headline,
    ruleLikely,
    reasons,
    thresholds: [
      `Consent > $${TX_CONSENT_USD.toLocaleString()}`,
      `Step-up > $${TX_STEP_UP_USD.toLocaleString()} (transfer/withdrawal, no Multi_Factor)`,
      `Deny > $${TX_DENY_USD.toLocaleString()}`,
    ],
  };
}

/**
 * Infer MCP delegation rule from parameters + verdict.
 */
function explainMcp(parameters, result) {
  const decision = displayDecision(result);
  const stmts = statementsFromResult(result);
  const stmtNames = stmts.map((s) => s.name || s.code).filter(Boolean);
  const reasons = [];
  let ruleLikely = 'MCP Permit Valid Tool Invocation';
  let headline = '';

  const aud = String(parameters.TokenAudience || '');
  const resUri = String(parameters.McpResourceUri || '');
  const userId = String(parameters.UserId || '');
  const actId = String(parameters.ActClientId || '');
  const hitl = parameters.HitlApproved === true || parameters.HitlApproved === 'true';
  const tool = String(parameters.ToolName || '');

  if (decision === 'DENY') {
    if (aud && resUri && aud !== resUri) {
      ruleLikely = 'MCP Deny — Invalid Token Audience';
      headline = 'DENY — token audience does not match MCP resource URI.';
      reasons.push(`TokenAudience (${aud}) ≠ McpResourceUri (${resUri}).`);
    } else if (!userId || userId === 'none') {
      ruleLikely = 'MCP Deny — Missing User ID';
      headline = 'DENY — no authenticated user in the delegation chain.';
      reasons.push(`UserId is "${userId || '(empty)'}".`);
    } else if (!actId || actId === 'none') {
      ruleLikely = 'MCP Deny — Invalid Actor Chain';
      headline = 'DENY — act client is not a registered delegated actor.';
      reasons.push(`ActClientId is "${actId || '(empty)'}".`);
    } else if (parameters.InRequiredGroup === false) {
      ruleLikely = 'MCP Deny — Not In Required Group';
      headline = 'DENY — user is not in the required group for this tool.';
    } else {
      ruleLikely = stmtNames[0] || 'MCP policy (deny)';
      headline = 'DENY — MCP tool invocation blocked.';
      reasons.push('See statements and policy trace for the matching deny rule.');
    }
  } else if (decision === 'CONSENT' || result.consentRequired || result.hitlRequired) {
    ruleLikely = 'MCP Require HITL Consent for sensitive tools';
    headline = 'PERMIT with HITL consent obligation — approval required before execution.';
    reasons.push(`Tool "${tool}" requires human approval.`, `HitlApproved is ${hitl ? 'true' : 'false'}.`);
  } else if (decision === 'STEP_UP' || result.stepUpRequired) {
    ruleLikely = 'MCP Require Step-Up for sensitive tools';
    headline = 'PERMIT with step-up obligation — MFA required before execution.';
    reasons.push(`Tool "${tool}" is step-up gated.`);
  } else {
    headline = 'PERMIT — MCP delegation checks passed.';
    reasons.push('Audience, user, and actor chain validated.');
    if (tool) reasons.push(`Tool: ${tool}.`);
  }

  if (stmtNames.length) reasons.push(`PingOne statements: ${stmtNames.join('; ')}.`);

  return { headline, ruleLikely, reasons, thresholds: [] };
}

/**
 * Build a human-readable explanation for a live evaluate-endpoint result.
 * @param {{ parameters: object, result: object, preset: string, policies?: object[] }} opts
 */
export function explainAuthorizeResult({ parameters, result, preset, policies = [] }) {
  if (!result || !parameters) {
    return {
      headline: '',
      ruleLikely: '',
      reasons: [],
      thresholds: [],
      policyName: null,
      policyDescription: '',
      ruleName: null,
      ruleDescription: '',
      policySetName: null,
      combiningAlgorithm: null,
    };
  }

  const ctx = String(parameters.DecisionContext || '');
  const isMcp = preset === 'mcp' || ctx === 'McpFirstTool';
  const core = isMcp ? explainMcp(parameters, result) : explainTransaction(parameters, result);
  const policyCtx = resolvePolicyContext(policies, { isMcp, ruleLikely: core.ruleLikely });

  const pingReq = result.pingoneRequest || {};
  const apiSummary = pingReq.url
    ? `POST ${pingReq.url}`
    : 'POST /v1/environments/{envId}/decisionEndpoints/{endpointId}';

  return {
    ...core,
    ...policyCtx,
    apiSummary,
    decisionId: result.decisionId || null,
    elapsedMs: result.elapsedMs ?? null,
  };
}

export {
  TX_DENY_USD,
  displayDecision,
  resolvePolicyContext,
};
