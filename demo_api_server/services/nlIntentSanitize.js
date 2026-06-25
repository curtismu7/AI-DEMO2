// banking_api_server/services/nlIntentSanitize.js
/**
 * Validates LLM JSON so only real banking actions and education panels execute.
 * Unknown kinds/actions fall back to heuristic parsing (no fake commands).
 */
'use strict';

const { parseHeuristic } = require('./nlIntentParser');

const VALID_BANKING_ACTIONS = new Set([
  'accounts', 'transactions', 'balance', 'deposit', 'withdraw', 'transfer', 'logout', 'mcp_tools',
  'mortgage_demo', 'vertical_feature_demo', 'biggest_purchase', 'spending_summary', 'web_search',
]);

const VALID_EDU_PANELS = new Set([
  'login-flow', 'token-exchange', 'may-act', 'mcp-protocol', 'introspection',
  'agent-gateway', 'rfc-index', 'step-up', 'pingone-authorize', 'cimd', 'human-in-loop',
  'par', 'rar', 'jwt-client-auth', 'agentic-maturity', 'oidc-21', 'best-practices',
  'langchain',
]);

/**
 * @param {object} result
 * @param {string} originalMessage
 * @returns {{ result: object, rejected: boolean, reason?: string }}
 */
function sanitizeNlResult(result, originalMessage) {
  if (!result || typeof result !== 'object' || !result.kind) {
    return { result: parseHeuristic(originalMessage), rejected: true, reason: 'missing_kind' };
  }

  const { kind } = result;

  if (kind === 'none') {
    if (typeof result.message !== 'string') {
      return { result: parseHeuristic(originalMessage), rejected: true, reason: 'none_invalid' };
    }
    return { result, rejected: false };
  }

  if (kind === 'education') {
    if (result.ciba === true) {
      return { result, rejected: false };
    }
    const panel = result.education?.panel;
    if (!panel || !VALID_EDU_PANELS.has(panel)) {
      const fallback = parseHeuristic(originalMessage);
      return { result: fallback, rejected: true, reason: 'invalid_education_panel' };
    }
    return { result, rejected: false };
  }

  if (kind === 'banking') {
    const action = result.banking?.action;
    if (!action || !VALID_BANKING_ACTIONS.has(action)) {
      const fallback = parseHeuristic(originalMessage);
      return { result: fallback, rejected: true, reason: 'invalid_banking_action' };
    }
    // Safety: if the user explicitly asks for "balances" (plural) and the LLM
    // incorrectly routes to "balance" without an accountId, switch to "accounts"
    // so the UI can show all balances instead of defaulting to checking.
    if (action === 'balance') {
      const t = String(originalMessage || '').toLowerCase();
      const asksForBalances = /\bbalances\b/.test(t) || /account balances/.test(t);
      let params = { ...(result.banking?.params || {}) };
      const accountId = params.accountId || params.account_id;
      if (asksForBalances && !accountId) {
        return {
          result: { ...result, banking: { ...result.banking, action: 'accounts', params: {} } },
          rejected: true,
          reason: 'balance_plural_without_account_id',
        };
      }
      // LLM prompts used to show accountId:"optional" as schema docs — models copy the literal "optional"
      const badPlaceholderAccountId = (v) =>
        typeof v === 'string' && /^(optional|omit|n\/a|none|unknown)$/i.test(v.trim());
      if (badPlaceholderAccountId(accountId)) {
        delete params.accountId;
        delete params.account_id;
        return { result: { ...result, banking: { ...result.banking, params } }, rejected: false };
      }
    }

    // Validate account type names for write actions — prevent LLM from using
    // account types that don't exist in the demo (e.g. 'credit_card', 'investment').
    if (['transfer', 'deposit', 'withdraw'].includes(action)) {
      const p = result.banking?.params || {};
      const VALID_REFS = new Set(['checking', 'savings', 'chk', 'sav']);
      const isValidRef = (v) => {
        if (v == null || v === '') return true; // omitted = ok (form will ask)
        const s = String(v).trim().toLowerCase()
          .replace(/\s+account$/, '').replace(/^(my|the|primary|main)\s+/, '');
        if (VALID_REFS.has(s)) return true;
        if (/^(chk-|sav-)/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return true;
        return false;
      };
      const toRef  = p.toId   || p.to_account_id;
      const fromRef = p.fromId || p.from_account_id;
      if (!isValidRef(toRef) || !isValidRef(fromRef)) {
        const bad = (!isValidRef(toRef) ? toRef : fromRef) || 'that account';
        return {
          result: {
            kind: 'none',
            message: `This demo only has Checking and Savings accounts — "${bad}" isn't available here. Try: "transfer $250 from checking to savings".`,
          },
          rejected: true,
          reason: 'invalid_account_type_name',
        };
      }
    }
    return { result, rejected: false };
  }

  return { result: parseHeuristic(originalMessage), rejected: true, reason: 'unknown_kind' };
}

module.exports = { sanitizeNlResult, VALID_BANKING_ACTIONS, VALID_EDU_PANELS };
