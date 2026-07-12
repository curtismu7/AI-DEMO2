/**
 * Banking Agent LangGraph Service
 * LangGraph agent executor for banking operations with MCP tools + HITL gates
 * Priority: heuristic regex (instant, zero-cost) → LangGraph LLM (when regex returns kind:'none')
 */

const { getBankingToolDefinitions, MAX_TOOL_ITERATIONS } = require('./agentBuilder');
const { executeBffTool, executeBffToolWithToken } = require('./bffMcpToolExecutor');
const { searchPublicBranches, formatBranchCatalogReply } = require('../data/publicBranchCatalog');
const { buildPublicCatalogTokenEvents } = require('./publicCatalogTokenEvents');
const { isAdminClientToken, adminTokenAgentResponse, isVerticalExemptFromAdminTokenGuard } = require('./customerTokenGuard');
const { executePluginToolViaMcp } = require('./verticalMcpExecution');
const { classifyMcpToolResult } = require('./mcpToolOutcome');
const { parseToolResult } = require('./llmResponseContract');
const { resolveMcpAccessTokenWithEvents } = require('./agentMcpTokenService');
const z = require('zod');
const appEventService = require('./appEventService');
const { parseHeuristic, buildCatalogMessage, resolveVerticalRouting } = require('./nlIntentParser');
const { resolveAgentMode } = require('./agentModeResolver');
const configStore = require('./configStore');
const runtimeSettings = require('../config/runtimeSettings');
const dataStore = require('../data/store');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logDelegationEvent } = require('../middleware/delegationAuditLogger');
const { verticalManifest } = require('./verticalManifest');
const verticalDispatch = require('./verticalDispatch');
const { recordToolCall: recordMcpToolCall } = require('./mcpToolAuditStore');
const conversationStore = require('./lmdb/conversationStore.lmdb');

/**
 * IN-04: agent chat content is PII-equivalent in a banking context. The
 * verbose per-message preview/length console logs and the full-prompt
 * appEventService entry are gated behind LOG_FULL_PROMPTS (off by default).
 * When off, only a short non-reversible fingerprint is logged so the flow is
 * still traceable without persisting the user's message text.
 */
const LOG_FULL_PROMPTS = process.env.LOG_FULL_PROMPTS === 'true';
function _messageFingerprint(msg) {
  const s = typeof msg === 'string' ? msg : String(msg ?? '');
  const len = s.length;
  const h = crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
  return `len=${len} sha1=${h}`;
}

/**
 * WR-07(b): Sanitize an account identifier before it lands in a transaction
 * `description` string. accountType is user-controlled (set at account
 * creation) and flows unsanitized into the audit log + Token Chain
 * explanation strings. Strip control chars and template/markup-injection-ish
 * characters, collapse whitespace, and bound the length. Not a
 * code-execution vector — defence-in-depth so a hostile account label can't
 * inject into logged/persisted free text.
 */
function sanitizeAccountLabel(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '') // control chars
    .replace(/[`$<>{}\\]/g, '')            // template / markup injection chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'account';
}

/**
 * POST to /api/transactions via internal HTTP, going through all auth/HITL gates.
 * Uses HTTPS if certs are present (matching server.js startup logic), HTTP otherwise.
 */
async function _callTransactionsApi(body, userToken) {
  if (!userToken) throw new Error('No user token — cannot call /api/transactions');
  const PORT = process.env.PORT || 3001;
  const certFile = path.join(__dirname, '../certs/api.ping.demo+2.pem');
  const useHttps = fs.existsSync(certFile);
  const host = 'localhost';
  const baseUrl = `${useHttps ? 'https' : 'http'}://${host}:${PORT}`;
  const config = {
    method: 'POST',
    url: `${baseUrl}/api/transactions`,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
    data: body,
    validateStatus: () => true,
  };
  if (useHttps) {
    // CR-04: Default to TLS verification ON. Previously this passed
    // `rejectUnauthorized: false` unconditionally, sending a PingOne bearer
    // over an unverified TLS channel. mkcert installs the local CA, so the
    // default agent verifies api.ping.demo / localhost loopback certs fine.
    //
    // Dev escape hatch (mirrors BL-04 in agentMcpTokenService._resolveFinalMcpAudience):
    // only relax verification when NODE_ENV is non-production AND the target
    // is a loopback hostname. Production hard-ignores the flag.
    const isProd = process.env.NODE_ENV === 'production';
    const isLoopback = host === 'localhost' || host === '127.0.0.1';
    if (!isProd && isLoopback) {
      config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }
  return axios(config);
}

/**
 * Dispatch a banking action based on parsed intent.
 * Reusable by both executeHeuristicBanking and banking plugin executeTool.
 * @param {string} action - The banking action (accounts, balance, transactions, transfer, deposit, withdraw, sensitive_account_details)
 * @param {object} params - Action-specific parameters (fromId, toId, amount, etc.)
 * @param {string} userId - User ID for lookups
 * @param {object} ctx - Context object with { userToken, req, subjectToken, isAdmin, terminology }
 * @returns {Promise<{reply, success, toolsCalled, ...} | null>}
 */
async function dispatchBankingAction(action, params, userId, ctx) {
  const { userToken, req, subjectToken, isAdmin, terminology: _term } = ctx;

  try {
    // Public catalog — no RFC 8693 exchange (progressive trust Act 1 / UC24).
    if (action === 'branch_hours') {
      const result = searchPublicBranches(params || {});
      const tokenEvents = buildPublicCatalogTokenEvents('get_branch_hours');
      return {
        reply: formatBranchCatalogReply(result),
        success: true,
        toolsCalled: ['get_branch_hours'],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents,
        branches: result.branches,
        publicCatalog: true,
      };
    }

    // READ actions — route through the full token-exchange → gateway → MCP server
    // pipeline so PingAuthorize evaluates every call (same path as the chip/action UI).
    // executeBffTool does RFC 8693 token exchange, calls the tool executor with the
    // exchanged agent token, and collects tokenEvents for the Token Chain panel.
    if (action === 'accounts' || action === 'balance' || action === 'transactions' || action === 'account_nickname') {
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';

      let toolName, toolArgs;
      if (action === 'accounts') {
        toolName = 'get_my_accounts';
        toolArgs = {};
      } else if (action === 'account_nickname') {
        toolName = 'get_account_nickname';
        toolArgs = params.accountId ? { account_id: params.accountId } : {};
      } else if (action === 'balance') {
        if (params.accountId) {
          toolName = 'get_account_balance';
          toolArgs = { account_id: params.accountId };
        } else {
          // No specific account — show all accounts with balances
          toolName = 'get_my_accounts';
          toolArgs = {};
        }
      } else {
        toolName = 'get_my_transactions';
        toolArgs = { limit: 10 };
      }

      const rawResult = await executeBffTool({ name: toolName, args: toolArgs, userId, userToken, req, tokenEvents, sessionId });

      const { result: parsed2 } = parseToolResult(rawResult, { site: `banking_read:${toolName}` });

      // An MCP error result (e.g. invalid_token / 401 from the gateway or backend)
      // arrives as { content:[{text}], isError:true } with NO top-level `.error`, so
      // it would otherwise fall through to the empty-accounts "you don't have any
      // accounts yet" success branch below — masking an auth failure as success (D-2).
      // Detect it here and surface the real error, mirroring the write/sensitive path.
      if (!parsed2 || parsed2.error || parsed2.isError) {
        const errMsg = parsed2?.content?.[0]?.text || parsed2?.error_description || parsed2?.message || parsed2?.error || 'Tool call failed.';
        return { reply: `❌ ${errMsg}`, success: false, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }

      if (action === 'account_nickname') {
        const nick = parsed2.nickname;
        if (!nick) {
          return { reply: '❌ Could not resolve an account nickname.', success: false, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Your account nickname: **${nick}**`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, nickname: nick };
      }

      // accounts / balance: return structured accounts list
      if (action === 'accounts' || (action === 'balance' && !params.accountId)) {
        const accts = parsed2.accounts || [];
        if (!accts.length) {
          return { reply: isAdmin ? 'No customer accounts found in the system.' : 'You don\'t have any accounts yet.', success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, accounts: [] };
        }
        const lines = accts.map(a => {
          const type = a.accountType || a.account_type || a.type || 'Account';
          const num = a.accountNumber || a.account_number || '—';
          const bal = Number(a.balance ?? 0).toFixed(2);
          const cur = a.currency || 'USD';
          return `• **${type}** (${num}) — **$${bal}** ${cur}`;
        });
        const _acctNoun = (_term && _term.accounts) || 'accounts';
        const _balNoun = (_term && _term.balance) || 'balances';
        const heading = action === 'balance'
          ? `Your ${_balNoun}`
          : (isAdmin ? `Here are all customer ${_acctNoun}` : `Here are your ${_acctNoun}`);
        return { reply: `${heading}:\n\n${lines.join('\n\n')}`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, accounts: accts };
      }

      // balance for a specific account
      if (action === 'balance' && params.accountId) {
        const bal = parsed2.balance;
        const acctType = parsed2.accountType || parsed2.account_type || params.accountId;
        const _balLabel = (_term && _term.balance) || acctType;
        if (bal !== undefined) {
          return { reply: `Your **${_balLabel}** balance is **$${Number(bal).toFixed(2)}**.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, balance: bal };
        }
        // fallback: show accounts list from result
        const accts2 = parsed2.accounts || [];
        const match = accts2.find(a => (a.accountType || a.account_type || a.type || '').toLowerCase() === String(params.accountId).toLowerCase() || a.id === params.accountId);
        if (match) {
          const bal2 = Number(match.balance ?? 0).toFixed(2);
          const type2 = match.accountType || match.account_type || match.type || 'Account';
          const _balLabel2 = (_term && _term.balance) || type2;
          return { reply: `Your **${_balLabel2}** balance is **$${bal2}**.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, balance: match.balance };
        }
        return { reply: 'Balance information is not available right now.', success: false, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }

      // transactions
      const txns = parsed2.transactions || [];
      if (!txns.length) {
        return { reply: 'No recent transactions found.', success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, transactions: [] };
      }
      const recent = txns.slice(0, 5);
      const lines = recent.map(t => `• ${t.type} — $${Number(t.amount).toFixed(2)} — ${t.description || t.type}`);
      const _txNoun = (_term && _term.transactions) || 'transactions';
      return { reply: `Recent ${_txNoun}:\n\n${lines.join('\n')}`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, transactions: recent };
    }

    if (action === 'transfer') {
      if (!params.fromId || !params.toId || !params.amount) {
        const missing = [];
        if (!params.fromId) missing.push('source account (e.g. "from checking")');
        if (!params.toId) missing.push('destination account (e.g. "to savings")');
        if (!params.amount) missing.push('amount (e.g. "$100")');
        return { reply: `I can help you transfer funds. Please provide: ${missing.join(', ')}.\n\nExample: "Transfer $100 from checking to savings"`, success: true, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      // Resolve account type names → IDs via local store (read-only lookup, no write)
      const accounts = await dataStore.getAccountsByUserId(userId);
      const fromAcct = accounts?.find(a => a.accountType?.toLowerCase() === params.fromId?.toLowerCase() || a.id === params.fromId);
      const toAcct = accounts?.find(a => a.accountType?.toLowerCase() === params.toId?.toLowerCase() || a.id === params.toId);
      if (!fromAcct || !toAcct) {
        return { reply: `❌ Could not find the specified accounts. Your accounts: ${(accounts || []).map(a => a.accountType).join(', ')}`, success: false, toolsCalled: ['transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const amount = parseFloat(params.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        return { reply: '❌ Please specify a valid positive amount.', success: false, toolsCalled: ['transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      // Route through the full token-exchange → gateway → MCP pipeline (same as read actions
      // and the LLM path). This ensures PingAuthorize evaluates every write, the Token Chain
      // panel shows the exchange, and HITL/step-up gates fire correctly.
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';
      try {
        const rawResult = await executeBffTool({
          name: 'create_transfer',
          args: {
            from_account_id: fromAcct.id,
            to_account_id: toAcct.id,
            amount,
            // WR-07(b): sanitize account labels before they reach the audit log.
            description: params.description || `Transfer from ${sanitizeAccountLabel(fromAcct.accountType)} to ${sanitizeAccountLabel(toAcct.accountType)}`,
          },
          userId, userToken, req, tokenEvents, sessionId,
        });
        const { result } = parseToolResult(rawResult, { site: 'create_transfer' });
        const tc = classifyMcpToolResult(result);
        if (tc.kind === 'hitl') {
          return { reply: tc.message || 'This transfer requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: tc.hitl, hitl_threshold_usd: tc.hitl_threshold_usd || amount, fromAccountId: fromAcct.id, toAccountId: toAcct.id, transactionAmount: amount, transactionType: 'transfer' };
        }
        if (tc.kind === 'step_up') {
          return { reply: tc.message || 'Step-up authentication required for this transfer.', success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (tc.kind === 'error') {
          return { reply: `Transfer failed: ${tc.message}`, success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Transferred **$${amount.toFixed(2)}** from ${fromAcct.accountType} to ${toAcct.accountType}.`, success: true, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        const detail = (err && err.message) ? err.message : String(err);
        console.warn('[dispatchBankingAction] Error executing transfer:', detail);
        throw (err instanceof Error) ? err : new Error(`[dispatchBankingAction] transfer failed: ${detail}`);
      }
    }

    if (action === 'deposit') {
      if (!params.toId || !params.amount) {
        const missing = [];
        if (!params.toId) missing.push('account (e.g. "into checking")');
        if (!params.amount) missing.push('amount (e.g. "$50")');
        return { reply: `I can help you deposit funds. Please provide: ${missing.join(', ')}.\n\nExample: "Deposit $50 into checking"`, success: true, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const accounts = await dataStore.getAccountsByUserId(userId);
      const toAcct = accounts?.find(a => a.accountType?.toLowerCase() === params.toId?.toLowerCase() || a.id === params.toId);
      if (!toAcct) {
        return { reply: `❌ Could not find account "${params.toId}". Your accounts: ${(accounts || []).map(a => a.accountType).join(', ')}`, success: false, toolsCalled: ['deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const amount = parseFloat(params.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        return { reply: '❌ Please specify a valid positive amount.', success: false, toolsCalled: ['deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      // Route through token-exchange → gateway → MCP (same path as reads and LLM).
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';
      try {
        const rawResult = await executeBffTool({
          name: 'create_deposit',
          args: { to_account_id: toAcct.id, amount, description: params.description || 'Agent deposit' },
          userId, userToken, req, tokenEvents, sessionId,
        });
        const { result } = parseToolResult(rawResult, { site: 'create_deposit' });
        const dc = classifyMcpToolResult(result);
        if (dc.kind === 'hitl') {
          return { reply: dc.message || 'This deposit requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: dc.hitl, hitl_threshold_usd: dc.hitl_threshold_usd || amount, toAccountId: toAcct.id, transactionAmount: amount, transactionType: 'deposit' };
        }
        if (dc.kind === 'step_up') {
          return { reply: dc.message || 'Step-up authentication required for this deposit.', success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (dc.kind === 'error') {
          return { reply: `Deposit failed: ${dc.message}`, success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Deposited **$${amount.toFixed(2)}** into ${toAcct.accountType}.`, success: true, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        const detail = (err && err.message) ? err.message : String(err);
        console.warn('[dispatchBankingAction] Error executing deposit:', detail);
        throw (err instanceof Error) ? err : new Error(`[dispatchBankingAction] deposit failed: ${detail}`);
      }
    }

    if (action === 'withdraw') {
      if (!params.fromId || !params.amount) {
        const missing = [];
        if (!params.fromId) missing.push('account (e.g. "from checking")');
        if (!params.amount) missing.push('amount (e.g. "$50")');
        return { reply: `I can help you withdraw funds. Please provide: ${missing.join(', ')}.\n\nExample: "Withdraw $50 from checking"`, success: true, toolsCalled: [], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const accounts = await dataStore.getAccountsByUserId(userId);
      const fromAcct = accounts?.find(a => a.accountType?.toLowerCase() === params.fromId?.toLowerCase() || a.id === params.fromId);
      if (!fromAcct) {
        return { reply: `Could not find account "${params.fromId}". Your accounts: ${(accounts || []).map(a => a.accountType).join(', ')}`, success: false, toolsCalled: ['withdraw'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const amount = parseFloat(params.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        return { reply: 'Please specify a valid positive amount.', success: false, toolsCalled: ['withdraw'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      // Route through token-exchange → gateway → MCP (same path as reads and LLM).
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';
      try {
        const rawResult = await executeBffTool({
          name: 'create_withdrawal',
          args: { from_account_id: fromAcct.id, amount, description: params.description || 'Agent withdrawal' },
          userId, userToken, req, tokenEvents, sessionId,
        });
        const { result } = parseToolResult(rawResult, { site: 'create_withdrawal' });
        const wc = classifyMcpToolResult(result);
        if (wc.kind === 'hitl') {
          return { reply: wc.message || 'This withdrawal requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: wc.hitl, hitl_threshold_usd: wc.hitl_threshold_usd || amount, fromAccountId: fromAcct.id, transactionAmount: amount, transactionType: 'withdrawal' };
        }
        if (wc.kind === 'step_up') {
          return { reply: wc.message || 'Step-up authentication required for this withdrawal.', success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (wc.kind === 'error') {
          return { reply: `Withdrawal failed: ${wc.message}`, success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Withdrew **$${amount.toFixed(2)}** from ${fromAcct.accountType}.`, success: true, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        const detail = (err && err.message) ? err.message : String(err);
        console.warn('[dispatchBankingAction] Error executing withdraw:', detail);
        throw (err instanceof Error) ? err : new Error(`[dispatchBankingAction] withdraw failed: ${detail}`);
      }
    }

    // For mcp_tools — let LangGraph handle (needs MCP connection)

    if (action === 'sensitive_account_details') {
      // Route through the full token-exchange → MCP gateway → MCP server pipeline
      // so PingOne Authorize evaluates the request and the Token Chain panel shows
      // all facets (mcp-tool-invoked, gw-authorize, resource-server-reply, etc.).
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';
      const rawResult = await executeBffTool({
        name: 'get_sensitive_account_details', args: {}, userId, userToken, req, tokenEvents, sessionId,
      });
      if (rawResult?.hitl || rawResult?.error === 'hitl_required') {
        return { reply: 'Viewing sensitive account details requires your approval. Please confirm in the consent modal to continue.', success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: true, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: rawResult.hitl || { type: 'consent' }, hitl_threshold_usd: 0 };
      }
      if (!rawResult || rawResult.isError) {
        const errMsg = rawResult?.content?.[0]?.text || rawResult?.error || 'Could not retrieve sensitive account details.';
        return { reply: `❌ ${errMsg}`, success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }
      const { result: parsed, parseFailed } = parseToolResult(rawResult?.content?.[0]?.text ?? rawResult, { site: 'get_sensitive_account_details' });
      if (parseFailed) {
        return { reply: `❌ ${parsed.error_description}`, success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }
      const accounts = parsed?.accounts || [];
      const lines = accounts.map(a => {
        const parts = [`• **${a.accountType}** — ${a.name || a.accountType}`];
        if (a.accountNumberFull) parts.push(`  Account #: ${a.accountNumberFull}`);
        if (a.routingNumber) parts.push(`  Routing #: ${a.routingNumber}`);
        if (a.swiftCode) parts.push(`  SWIFT: ${a.swiftCode}`);
        return parts.join('\n');
      });
      return {
        reply: `Here are your sensitive account details:\n\n${lines.join('\n\n')}`,
        success: true,
        toolsCalled: ['get_sensitive_account_details'],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents,
        accountData: { user: parsed?.user, accounts },
      };
    }

    // Unhandled actions that need LLM reasoning — return null to signal fallthrough
    if (['mcp_tools', 'mortgage_demo', 'invest_demo', 'vertical_feature_demo', 'biggest_purchase', 'spending_summary', 'unusual_patterns', 'afford_check', 'logout', 'api_key_demo', 'dual_token_demo', 'web_search'].includes(action)) {
      return null; // Heuristic matched but requires client-side / LLM formatting
    }

    // Unknown action — log and suggest fallback
    console.warn('[dispatchBankingAction] Unknown banking action:', action);
    return {
      reply: `I don't recognize that action (${action}). Try "show my accounts", "my balance", or "transfer money".`,
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: [],
    };
  } catch (err) {
    // TOKEN_INACTIVE must propagate so the route returns 401 — do not swallow it.
    if (err && err.code === 'TOKEN_INACTIVE') throw err;
    // WR-07(a): non-Error throws have no .message — surface the real value.
    const detail = (err && err.message) ? err.message : String(err);
    console.warn('[dispatchBankingAction] Unhandled error in action:', action, detail);
    // Write actions (transfer, deposit, withdraw) already throw in their catch blocks above.
    // Read actions fall through and return an error reply above.
    // Only re-throw if we haven't already handled it.
    if (['transfer', 'deposit', 'withdraw'].includes(action)) {
      throw err; // Already wrapped in the action's catch block
    }
  }
  return null;
}

/**
 * Execute a banking action identified by the heuristic parser, returning a chat-style reply.
 * Thin wrapper around dispatchBankingAction.
 * @returns {{ reply: string, success: boolean, toolsCalled: string[], tokensUsed: number, requiresConsent: boolean, agentConfigured: boolean, tokenEvents: any[] } | null}
 */
async function executeHeuristicBanking(parsed, userId, userToken, req = null, subjectToken = null, verticalCtx = null) {
  const action = parsed?.banking?.action;
  const params = parsed?.banking?.params || {};
  if (!action) return null;

  const ctx = {
    userToken,
    req,
    subjectToken,
    isAdmin: req?.session?.user?.role === 'admin',
    terminology: (verticalCtx && verticalCtx.terminology) || null,
  };

  return dispatchBankingAction(action, params, userId, ctx);
}

/**
 * Phase 2 (agent consolidation) reason-loop helpers.
 *
 * Split "schema" from "execute": :3006 reasons over tool SCHEMAS only; the BFF
 * still EXECUTES tools locally via the SAME executors `createBankingAgent`'s
 * tool node used. Token custody + HITL enforcement stay BFF-side.
 */

/**
 * Build a vertical-overridden description for a shared core tool.
 * Returns null if the tool is not one of the 4 overridable tools, or if
 * the manifest has no terminology.
 *
 * @param {string} toolName
 * @param {object|null} terminology - manifest.terminology
 * @returns {string|null}
 */
/**
 * Build tool schemas for the reason loop. Plugins provide their own tool definitions
 * with descriptions already customized per vertical. This is delegated to verticalDispatch.
 * Legacy fallback (no plugin) uses getBankingToolDefinitions().
 *
 * @param {string} activeId - Active vertical ID.
 * @param {object} activeManifest - Active vertical manifest (for legacy fallback).
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */

/**
 * A2A interception: delegate_to_specialist is NOT an MCP tool — it triggers the
 * chained RFC 8693 delegation (a2aDelegationService) using the active vertical's
 * specialist, pushing the a2a-* events onto the shared tokenEvents (→ SSE/UI).
 * Returns a JSON string for the reason loop.
 */
async function executeA2aDelegation(activeId, args, { req, tokenEvents, sessionId }) {
  const a2a = require('./a2aDelegationService');
  const events = tokenEvents || [];
  const result = await a2a.delegateToSpecialist(req, {
    vertical: activeId,
    subtask: args && args.subtask,
    tool: args && args.tool,
    tokenEvents: events,
  });
  if (result.error || !result.token) {
    return JSON.stringify({ delegated: false, error: result.error || 'delegation_failed' });
  }

  // Execute the specialist's tool WITH the minted nested-act token. The pipeline
  // skips the user→agent exchange (suppliedToken) and runs Authorize + the gateway
  // call; Authorize PERMITs the depth-2 act chain (the generalist alone is DENIED).
  let toolResult = null;
  if (result.tool) {
    const raw = await executeBffToolWithToken({
      name: result.tool,
      args: (args && args.args) || {},
      req,
      tokenEvents: events,
      sessionId: sessionId || req?.sessionID || '',
      suppliedToken: result.token,
      suppliedUserSub: result.userSub,
    });
    ({ result: toolResult } = parseToolResult(raw, { site: `a2a:${result.tool}` }));
  }

  return JSON.stringify({
    delegated: true,
    specialist: result.specialist,
    vertical: result.vertical,
    tool: result.tool,
    actChainDepth: result.actChainDepth,
    scopes: result.scopes,
    result: toolResult,
    note:
      `Delegated to the ${result.specialist}. A nested act chain ` +
      `(act:{${result.specialist} → generalist}) bound to the user was minted, and ` +
      `PingOne Authorize permitted the specialist to run ${result.tool}.`,
  });
}

// Plugin-first executeTool. Returns a function with the reason-loop signature
// (name, args) => Promise<string>. Plugin results are JSON-stringified so the
// reason loop sees a string, matching executeBffTool's contract.
function resolveExecuteTool(activeId, { userId, userToken, req, tokenEvents, sessionId, isAdmin = false }) {
  return async (name, args) => {
    if (name === 'delegate_to_specialist') {
      return executeA2aDelegation(activeId, args, { req, tokenEvents, sessionId });
    }
    if (verticalDispatch.isPluginToolName(name)) {
      return executeBffTool({
        name,
        args: args || {},
        userId,
        userToken,
        req,
        tokenEvents,
        sessionId,
      });
    }
    const out = await verticalDispatch.executeToolFor(
      activeId, name, args, { userId, userToken, req, tokenEvents, sessionId, isAdmin },
      (n, a) => executeBffTool({ name: n, args: a, userId, userToken, req, tokenEvents, sessionId }),
    );
    return typeof out === 'string' ? out : JSON.stringify(out);
  };
}

function resolveToolSchemas(activeId, activeManifest) {
  if (verticalDispatch.hasPlugin(activeId)) {
    return verticalDispatch.toolSchemasFor(activeId, { isAdmin: false }, () => []);
  }

  const tools = getBankingToolDefinitions();
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

// Build a meaningful reply string from vertical plugin result data, themed per vertical terminology.
function buildVerticalReply(action, data, render, verticalCtx) {
  const term = verticalCtx && verticalCtx.terminology;

  if (render === 'list_gear' || render === 'list_rentals') {
    const noun = render === 'list_gear'
      ? (term && term.transactions || 'orders')
      : 'rentals';
    const items = data.orders || data.rentals || [];
    const count = Array.isArray(items) ? items.length : 0;
    return `Here are your ${noun} (${count} total).`;
  }
  if (render === 'loyalty_balance' || render === 'rewards_balance') {
    const noun = (term && term.balance) || (render === 'rewards_balance' ? 'rewards' : 'balance');
    const pts = data && (data.points != null ? data.points : data.balance);
    return pts != null ? `Your ${noun}: ${pts}` : `Here is your ${noun}.`;
  }
  if (render === 'list_appointments') {
    const noun = term && term.transactions || 'appointments';
    const items = data.appointments || [];
    return `Here are your ${noun} (${Array.isArray(items) ? items.length : 0} total).`;
  }
  if (render === 'view_records' || render === 'view_coverage') {
    const noun = render === 'view_coverage'
      ? (term && term.balance || 'coverage')
      : (term && term.accounts || 'records');
    return `Here is your ${noun}.`;
  }
  if (render === 'view_benefits') {
    const items = (data && data.benefits) || [];
    const count = Array.isArray(items) ? items.length : 0;
    return `Here are your benefits (${count} total).`;
  }
  if (render === 'pto_balance') {
    return `Here is your time-off balance.`;
  }
  if (render === 'list_expenses') {
    const items = (data && data.expenses) || [];
    const count = Array.isArray(items) ? items.length : 0;
    return `Here are your expenses (${count} total).`;
  }
  if (render === 'list_orders') {
    const items = (data && data.orders) || [];
    const count = Array.isArray(items) ? items.length : 0;
    return `Here ${count === 1 ? 'is' : 'are'} your ${term && term.transactions || 'orders'} (${count} total).`;
  }
  // order_status / gear_order_status render a single-order CARD (the result IS the
  // order object: product/status/date). Summarize that one order rather than
  // counting a collection — a one-click "Track my order" defaults to the most
  // recent order (no orderId), so this is the common path.
  if (render === 'order_status' || render === 'gear_order_status') {
    const order = (data && data.order) || data || null;
    const product = order && order.product;
    const status = order && order.status;
    if (!product && !status) return `I couldn't find that order.`;
    return `Your ${product || 'order'}${status ? ` is ${status}` : ''}.`;
  }
  // Write/confirmation actions: these create or mutate something, so a
  // "Here are your ..." heading is wrong. Keyed off the ACTION (stable), not
  // `render` — on a failed MCP round-trip `render` degrades to 'text', but the
  // confirmation copy must still hold (and degrade gracefully on empty data)
  // rather than fall through to the noun fallback ("...book appointment.").
  if (action === 'book_appointment') {
    const provider = data && data.provider;
    const when = data && data.when;
    return `Your appointment${provider ? ` with ${provider}` : ''}${when ? ` on ${when}` : ''} is confirmed.`;
  }
  if (action === 'release_records') {
    const id = data && (data.id || data.recordId);
    return `Your record${id ? ` (${id})` : ''} has been released.`;
  }
  if (action === 'checkout') {
    const product = data && data.product;
    const amount = data && data.amount;
    return `Order placed${product ? ` for ${product}` : ''}${amount != null ? ` ($${amount})` : ''}.`;
  }
  if (action === 'submit_expense') {
    const category = data && data.category;
    const amount = data && data.amount;
    return `Expense submitted${category ? ` for ${category}` : ''}${amount != null ? ` ($${amount})` : ''}.`;
  }
  if (action === 'request_time_off') {
    const days = data && data.days;
    const remaining = data && data.remaining;
    return `Time-off request${days != null ? ` for ${days} day${days === 1 ? '' : 's'}` : ''} submitted.${remaining != null ? ` ${remaining} day${remaining === 1 ? '' : 's'} remaining.` : ''}`;
  }
  // Admin vertical write/confirmation actions (same reasoning as the block above).
  if (action === 'freeze_account') {
    const frozen = data && data.frozen;
    return `Account${data && data.accountId ? ` ${data.accountId}` : ''} ${frozen ? 'frozen' : 'unfrozen'}.`;
  }
  if (action === 'adjust_balance') {
    const bal = data && data.newBalance;
    return `Balance adjusted.${bal != null ? ` New balance: $${Number(bal).toFixed(2)}.` : ''}`;
  }
  if (action === 'reset_customer_password') {
    return `Password reset flagged — this customer must set a new password on next login.`;
  }
  if (action === 'delete_customer') {
    return `Customer${data && data.userId ? ` ${data.userId}` : ''} and all associated data have been deleted.`;
  }
  if (action === 'lookup_customer') {
    const count = data && data.count;
    return count === 1 ? `Found 1 matching customer.` : `Found ${count || 0} matching customers.`;
  }
  // Fallback: derive the noun from the ACTION name (e.g. view_benefits ->
  // "benefits", list_expenses -> "expenses") rather than term.accounts, which
  // would leak "Accounts" into non-banking verticals that lack an explicit case.
  const noun = action
    .replace(/^(view|list|show|get|check)_/, '')
    .replace(/_/g, ' ');
  return `Here are your ${noun}.`;
}

// Fills userId/accountId from the admin dashboard's picker-selected customer
// (req.body.customer, set by adminCustomerContext on the SPA) when the
// resolved admin tool needs one and the parsed message didn't supply it.
// accountId resolves to the customer's first account — same "first held
// record" default used elsewhere for demo write tools with no explicit id.
function applyAdminCustomerContext(vertical, params, toolDef, req) {
  if (vertical !== 'admin' || !toolDef) return params;
  const customer = req && req.body && req.body.customer;
  const customerId = customer && typeof customer === 'object' ? customer.id : null;
  if (customerId == null) return params;

  const props = (toolDef.inputSchema && toolDef.inputSchema.properties) || {};
  const args = { ...(params || {}) };
  if ('userId' in props && args.userId == null) {
    args.userId = String(customerId);
  }
  if ('accountId' in props && args.accountId == null) {
    try {
      const store = require('../data/store');
      const accounts = store.getAccountsByUserId(String(customerId)) || [];
      if (accounts[0]) args.accountId = accounts[0].id;
    } catch (_) { /* best-effort default only — leave accountId unset */ }
  }
  return args;
}

// kind:'vertical' heuristic dispatch — runs the active vertical's plugin tool
// and packages the result both for the chat reply and the UI render descriptor.
// Mirrors executeHeuristicBanking's return envelope, adding `verticalResult`.
async function dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents = [], sessionId = '', isAdmin = false, verticalCtx = null, hitlChallengeId = null }) {
  const { vertical, action } = heuristic;
  let { params } = heuristic;

  // A2A fast-path: if ff_a2a_delegation is on AND the resolved action is declared
  // a2aDelegated in scope-topology, skip the BFF preflight and route directly
  // through the RFC 8693 nested-act delegation service. Authorization happens at
  // the gateway using the specialist token — the generalist token alone is DENIED.
  if (action !== 'delegate_to_specialist') {
    const { isA2aDelegatedTool } = require('./scopeTopology');
    const { isA2aEnabled } = require('./a2aDelegationService');
    if (isA2aEnabled() && isA2aDelegatedTool(action)) {
      const a2aJson = await executeA2aDelegation(vertical, { tool: action }, { req, tokenEvents, sessionId });
      let a2aResult;
      try { a2aResult = JSON.parse(a2aJson); } catch (_) { a2aResult = { delegated: false, error: a2aJson }; }
      const a2aReply = a2aResult.delegated
        ? `Delegation complete — ${a2aResult.specialist} retrieved ${a2aResult.tool ? a2aResult.tool.replace(/_/g, ' ') : 'the requested data'} on your behalf (act-chain depth ${a2aResult.actChainDepth}).`
        : `❌ ${a2aResult.error || 'A2A delegation failed'}`;
      return {
        reply: a2aReply,
        success: a2aResult.delegated === true,
        toolsCalled: ['delegate_to_specialist'],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents,
      };
    }
  }

  // 1. Resolve the plugin tool def to read its required-params + authz.
  // If user is admin, tools from the admin overlay are also available (merged by verticalDispatch).
  const plugin = verticalDispatch.resolvePlugin(vertical);

  // Local-tool bypass: teaching/education tools are pure-local computations (text +
  // an education-panel directive, or a token decode). They must NOT trigger an authz
  // decision or an RFC 8693 exchange, so run the plugin's executeTool directly and skip
  // the pre-flight + MCP path below. Gated to tools a plugin explicitly marks local —
  // no existing plugin implements isLocalTool, so this is inert for every current vertical.
  if (plugin && typeof plugin.isLocalTool === 'function' && plugin.isLocalTool(action)) {
    let local;
    try {
      local = await plugin.executeTool(action, params || {}, { userId, userToken, req, tokenEvents, sessionId, isAdmin, hitlChallengeId });
    } catch (e) {
      return {
        reply: `❌ ${e.message || 'teaching tool failed'}`,
        success: false, toolsCalled: [action], tokensUsed: 0,
        requiresConsent: false, agentConfigured: true, tokenEvents,
      };
    }
    const data = local?.result;
    const render = local?.render || 'text';
    // A demonstrate tool may surface a real HITL challenge from the inner pipeline.
    // Forward it in the same envelope the MCP vertical-HITL path uses (lines ~927-939)
    // so the UI consent handler opens AgentConsentModal and the approve-retry threads
    // the challenge id back through ctx.hitlChallengeId.
    if (data && data.error === 'hitl_required') {
      return {
        error: 'hitl_required',
        hitl: data.hitl || { type: 'consent' },
        reply: (typeof data.text === 'string' && data.text) || 'This action requires your approval.',
        success: false,
        action,
        requiresConsent: true,
        hitlChallengeId: data.hitlChallengeId || null,
        toolsCalled: [action],
        tokensUsed: 0,
        agentConfigured: true,
        tokenEvents,
      };
    }
    const isErr = !!(data && data.error);
    const reply = isErr
      ? `❌ ${data.error}`
      : (data && typeof data.text === 'string' && data.text)
        || `Executed ${String(action).replace(/_/g, ' ')}.`;
    return {
      reply,
      success: !isErr,
      toolsCalled: [action],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents,
      // Only attach a verticalResult for non-text renders (text tools show only the reply).
      ...(render !== 'text' ? { verticalResult: { action, render, data } } : {}),
      // Forward an education-panel directive to the UI when the tool requested one.
      ...(data && data.education ? { education: data.education } : {}),
    };
  }

  const toolDef = (verticalDispatch.toolSchemasFor(vertical, { isAdmin }, () => []) || [])
    .find((t) => t.name === action);

  // Admin dashboard's Customer Admin picker selects a customer client-side —
  // there's no server session state for it, so the SPA resends
  // { customer: { id, name } } on every admin chat turn. Fill userId/accountId
  // from it when the resolved tool needs one the parsed message didn't name,
  // so "View Profile" etc. don't dead-end on a clarify prompt after a picker
  // selection.
  params = applyAdminCustomerContext(vertical, params, toolDef, req);

  // Authz runs INSIDE the pipeline now — no separate pre-flight here.
  // The vertical path takes the SAME single path as banking (and the LLM path):
  // executePluginToolViaMcp → executeBffTool → runMcpToolPipeline, whose
  // evaluateMcpFirstToolGate is the one authorization gate. (The previous
  // agentPreflightService.evaluate ran that exact same gate a second time only
  // because plugin tools used to bypass runMcpToolPipeline.) PERMIT/DENY/HITL/
  // STEP_UP are surfaced from the pipeline via executePluginToolViaMcp's
  // hitlEnvelope (HITL/step-up) or out.result.error (deny), handled below.

  // Missing-params check — clarify before dispatching the tool.
  const required = (toolDef && toolDef.inputSchema && toolDef.inputSchema.required) || [];
  const missing = required.filter((k) => params == null || params[k] == null || params[k] === '');
  if (missing.length) {
    // Humanize raw param keys for the user-facing prompt (orderId -> Order ID).
    const missingLabels = missing.map((k) => String(k)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\bId\b/g, 'ID')
      .replace(/^./, (c) => c.toUpperCase()));
    // Look up the example hint from the active vertical plugin's heuristics.
    const heuristics = plugin ? plugin.getHeuristics() : [];
    const paramHint = heuristics.find((h) => h.action === action)?.paramHint || null;
    return {
      reply: `To ${String(action).replace(/_/g, ' ')}, I need: ${missingLabels.join(', ')}. Please provide ${missing.length > 1 ? 'these details' : 'this detail'}.`,
      success: false,
      needsParams: { action, missing, hint: paramHint },
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents,
    };
  }

  // A2A overlay: delegate_to_specialist triggers the RFC 8693 nested-act chain service,
  // not the normal MCP pipeline. Applies to every vertical with a specialist registered.
  // Banking reaches here because nlIntentParser exempts this action from kind:'banking'.
  if (action === 'delegate_to_specialist') {
    const a2aJson = await executeA2aDelegation(vertical, params || {}, { req, tokenEvents, sessionId });
    let a2a;
    try { a2a = JSON.parse(a2aJson); } catch (_) { a2a = { delegated: false, error: a2aJson }; }
    const reply = a2a.delegated
      ? `Delegation complete — ${a2a.specialist} retrieved ${a2a.tool ? a2a.tool.replace(/_/g, ' ') : 'the requested data'} on your behalf (act-chain depth ${a2a.actChainDepth}).`
      : `❌ ${a2a.error || 'A2A delegation failed'}`;
    return {
      reply,
      success: a2a.delegated === true,
      toolsCalled: ['delegate_to_specialist'],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents,
    };
  }

  // Cross-vertical banking MCP: account nickname always routes through dispatchBankingAction.
  if (action === 'account_nickname') {
    const bankingResult = await dispatchBankingAction(action, params || {}, userId, {
      userToken,
      req,
      subjectToken: null,
      isAdmin,
      terminology: verticalCtx?.terminology || null,
    });
    if (bankingResult?.tokenEvents?.length) {
      tokenEvents.push(...bankingResult.tokenEvents);
    }
    if (!bankingResult) {
      return {
        reply: buildCatalogMessage(verticalCtx),
        success: true,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents,
      };
    }
    return bankingResult;
  }

  // Banking plugin heuristics emit action aliases (balance, accounts) — map to real MCP
  // tools via dispatchBankingAction. executePluginToolViaMcp would call Unknown tool: balance.
  if (vertical === 'banking') {
    const bankingResult = await dispatchBankingAction(action, params || {}, userId, {
      userToken,
      req,
      subjectToken: null,
      isAdmin,
      terminology: verticalCtx?.terminology || null,
    });
    if (bankingResult?.tokenEvents?.length) {
      tokenEvents.push(...bankingResult.tokenEvents);
    }
    // Guard: dispatchBankingAction returns null when the action needs LLM fallback.
    // Return a safe default rather than null so the route doesn't crash on .toolsCalled.
    if (!bankingResult) {
      return {
        reply: buildCatalogMessage(verticalCtx),
        success: true,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents,
      };
    }
    return bankingResult;
  }

  // Execute — always MCP (RFC 8693 → gateway → MCP → /api/path/vertical-tool).
  // Thread the approved challenge id so the pipeline's HITL gate verifies a prior
  // approval receipt and PERMITs instead of re-challenging.
  const mcpResult = await executePluginToolViaMcp({
    name: action,
    args: normalizeVerticalToolArgs(params, toolDef),
    userId,
    userToken,
    req,
    tokenEvents,
    sessionId,
    hitlChallengeId,
  });
  if (mcpResult.hitlEnvelope) {
    const parsed = mcpResult.hitlEnvelope;
    const isStepUp = parsed.error === 'step_up_required';
    return {
      error: parsed.error,
      ...(isStepUp
        ? {
            step_up_required: true,
            // Carry the step-up method/ACR so the client can drive CIBA with the
            // right acr_values. Prefer values the pipeline supplied; otherwise fall
            // back to the configured defaults (same source as mcpLocalTools /
            // transactionAuthorizationService — parity with the removed preflight).
            step_up_method: parsed.step_up_method || runtimeSettings.get('stepUpMethod') || 'email',
            step_up_acr: parsed.step_up_acr || runtimeSettings.get('stepUpAcrValue') || 'Multi_Factor',
          }
        : { hitl: parsed.hitl || { type: 'consent' } }),
      reply: parsed.message || (isStepUp ? 'This action requires step-up verification.' : 'This action requires your approval.'),
      success: false,
      action,
      requiresConsent: !isStepUp,
      hitlChallengeId: parsed.hitlChallengeId || null,
      toolsCalled: [action],
      tokensUsed: 0,
      agentConfigured: true,
      tokenEvents,
    };
  }
  const out = mcpResult.out || { result: { error: 'mcp_tool_failed' }, render: 'text' };
  const data = out?.result;
  const isErr = !!(data?.error);
  let reply = isErr ? `❌ ${data.error}` : buildVerticalReply(action, data, out?.render, verticalCtx);
  // Safeguard: buildVerticalReply should always return a string, but ensure non-empty reply
  if (!reply) {
    reply = `Executed ${action.replace(/_/g, ' ')}.`;
  }
  return {
    reply,
    success: !isErr,
    toolsCalled: [action],
    tokensUsed: 0,
    requiresConsent: false,
    agentConfigured: true,
    tokenEvents,
    verticalResult: { action, render: (out && out.render) || 'text', data },
  };
}

/**
 * Execute a tool the SAME way agentBuilder's tool node did:
 * `tool.invoke(args, { configurable: { agentContext: { agentToken, userId, tokenEvents } } })`.
 * Token custody stays BFF-side — the MCP/agent token is resolved HERE via
 * `resolveMcpAccessTokenWithEvents` (the same call `createBankingAgent` made
 * before invoking tools), never on :3006.
 *
 * HITL/consent note: real transfer-consent enforcement is the deterministic
 * heuristic, which runs and returns BEFORE this LLM/reason path
 * (ARCHITECTURE-TRUTHS T-3) and is unchanged. On THIS LLM/tool path a
 * HITL/consent denial from a tool surfaces as a generic error (same as the
 * pre-consolidation in-process graph path — it never produced a clean 428
 * here either). Do NOT assume the LLM path yields a 428; do NOT remove the
 * heuristic floor believing it does.
 */
/**
 * Same `{ helix_base_url, helix_api_key, helix_environment_id,
 * helix_agent_id, helix_prompt_field_id }` object literal agentBuilder.js
 * builds (~lines 173-179), read from langchainConfig.
 *
 * Falls back to configStore for any field not present in the session —
 * Helix credentials are persisted in configStore (runtimeData.json/SQLite)
 * but may not have been copied into req.session.langchain_config yet (e.g.
 * fresh session, tab switch without visiting config page).
 */
function extractHelixConfig(langchainConfig = {}) {
  const cfg = langchainConfig || {};
  return {
    helix_base_url:      cfg.helix_base_url      || configStore.getEffective('helix_base_url')      || '',
    helix_api_key:       cfg.helix_api_key        || configStore.getEffective('helix_api_key')        || '',
    helix_environment_id: cfg.helix_environment_id || configStore.getEffective('helix_environment_id') || '',
    helix_agent_id:      cfg.helix_agent_id       || configStore.getEffective('helix_agent_id')       || '',
    helix_prompt_field_id: cfg.helix_prompt_field_id || configStore.getEffective('helix_prompt_field_id') || '',
  };
}

/**
 * Process incoming user message through the agent
 *
 * Response shape:
 *   {
 *     reply: string,                    // Natural language response
 *     success: boolean,                 // Whether execution succeeded
 *     toolsCalled: string[],            // Which tools were invoked
 *     intent?: string,                  // [Added by POST /api/agent/invoke] Extracted intent (e.g., "transfer", "view_balance")
 *     confidence?: number,              // [Added by POST /api/agent/invoke] Confidence score (0–1)
 *     tokenEvents?: object[],           // Token exchange events for UI display
 *     requiresConsent?: boolean,        // Whether HITL consent is pending
 *     agentPath?: string,               // 'heuristic' or 'llm' for attribution
 *     ... (other fields per tool context)
 *   }
 */
async function processAgentMessage({ message, userId, userToken, sessionId, tokenEvents = [], langchainConfig = {}, vertical = null, req = null }) {
  try {
    console.log('[processAgentMessage] Starting');
    appEventService.logEvent('agent', 'info', 'Agent processing message…', { tag: 'agent/message', metadata: { ...(req?.body?.useCaseId ? { useCaseId: req.body.useCaseId } : {}) } });
    // IN-04: non-reversible fingerprint by default; full detail only under
    // LOG_FULL_PROMPTS (treat chat content as PII in a banking context).
    if (LOG_FULL_PROMPTS) {
      console.log('[processAgentMessage] userId:', userId);
      console.log('[processAgentMessage] userToken present:', !!userToken);
      console.log('[processAgentMessage] userToken length:', userToken?.length || 0);
      console.log('[processAgentMessage] sessionId:', sessionId);
      console.log('[processAgentMessage] tokenEvents count:', tokenEvents?.length || 0);
      console.log('[processAgentMessage] message length:', message?.length || 0);
    } else {
      console.log('[processAgentMessage] message', _messageFingerprint(message));
    }

    // Extract subject token from request (Phase 3: user has authorized)
    const subjectToken = req?.body?.subjectToken;
    if (subjectToken) {
      console.log('[processAgentMessage] Subject token provided, Phase 3 token exchange available');
      if (req?.recordTokenEvent) {
        req.recordTokenEvent('subject_token_provided', {
          source: 'agent_request',
        });
      }
    }

    // Fail fast: the customer AI agent must never run with an admin-client token.
    // Such a token cannot read customer banking data, so tool calls return
    // wrong-identity results and the reason loop retries — the "show my accounts"
    // loop. Return a structured requiresCustomerLogin envelope (zero tool calls)
    // so the SPA offers "Log in as customer" vs "Cancel (stay on admin)".
    //
    // Exempt verticals where an admin token is the CORRECT credential — the
    // admin console (its chips are admin-only tools) and OAuth Academy (a pure
    // teaching surface). See isVerticalExemptFromAdminTokenGuard for the full
    // rationale. Money-moving tools stay protected by the per-tool guard in
    // bffMcpToolExecutor (isCustomerBankingTool + isAdminClientToken).
    if (!isVerticalExemptFromAdminTokenGuard(vertical) && isAdminClientToken(userToken)) {
      console.warn('[processAgentMessage] Admin-client token on customer agent — requiring customer login (no tool calls)');
      appEventService.logEvent('agent', 'warning',
        'Admin token used on the customer agent — prompting customer sign-in',
        { tag: 'agent/admin_token_on_customer' });
      return adminTokenAgentResponse(tokenEvents);
    }

    // ── Heuristic first: handle known banking intents without LLM ──
    // Falls through to LangGraph/LLM only if heuristic doesn't match or if disabled.
    // The heuristic returns IMMEDIATELY on a match (precedence unchanged,
    // ARCHITECTURE-TRUTHS T-3). There is no "fell through with a result" case,
    // so on the LLM-fallback path heuristicFallbackResult stays null and the
    // reasoning_unavailable branch uses the generic message.
    let heuristicFallbackResult = null;
    const rawMode = configStore.getEffective('agent_mode');
    const _agentMode = rawMode
      ? resolveAgentMode(
          rawMode, configStore.getEffective('agent_external_wiring'))
      : null;
    // Modes 4b/5b: platform-driven. The external platform (OpenAI/Anthropic)
    // drives the tool loop against the gateway with a BFF-minted gateway
    // token. Educational "delegation lost" path — see spec §5. The gateway
    // (D-05 + PingAuthorize) still enforces; only per-tool exchange + act
    // are lost. Token custody stays here (BFF mints the gateway token).
    if (_agentMode && _agentMode.externalWiring === 'platform' && _agentMode.provider) {
      const { runPlatformLoop } = require('./platformAgentRuntime');
      const oauthService = require('./oauthService');
      const { getMcpGatewayHttpUrl } = require('./mcpGatewayClient');
      const gatewayAud = configStore.getEffective('pingone_resource_mcp_gateway_uri');
      try {
        // Resolve via the shared resolver (env → configStore) so this matches the
        // BFF path, hot-loads from /config, and has no localhost fallback that
        // silently dials the wrong port (the ECONNREFUSED :3005 class). Inside the
        // try so an unconfigured gateway URL returns platform_runtime_error rather
        // than throwing past this branch to the generic outer catch.
        const gatewayMcpUrl = getMcpGatewayHttpUrl().replace(/\/$/, '') + '/mcp';
        // I-1: the RFC 8693 subject MUST be the user's session access token
        // (same source the working BFF path exchanges — resolveMcpAccessToken-
        // WithEvents → getSessionBearerForMcp → session oauthTokens.accessToken,
        // which executeBffTool seeds from this same `userToken` param). The SPA
        // never sends a token (token-custody rule), so req.body.subjectToken is
        // always undefined here; using it 401s every platform request.
        if (!userToken) {
          return {
            reply: 'Platform agent error: no user token in session',
            success: false,
            toolsCalled: [],
            tokensUsed: 0,
            requiresConsent: false,
            agentConfigured: true,
            tokenEvents: (req && req.tokenEvents) || [],
            degradedDelegation: true,
            error: 'platform_runtime_error',
          };
        }
        const gwToken = await oauthService.performTokenExchange(
          userToken, gatewayAud, ['mcp:invoke']);
        // Session-scoped persona: give the external platform agent THIS session's
        // vertical voice (same systemPromptFlavor the in-house reason loop uses),
        // so "Just ChatGPT"/Anthropic/etc. speak the right vertical, not the global.
        const { verticalId: _pfVid } = resolveVerticalRouting(vertical);
        const _pfManifest = verticalManifest.resolver.resolve(_pfVid);
        const _pfSystemPrompt = verticalDispatch.hasPlugin(_pfVid)
          ? verticalDispatch.systemPromptFor(_pfVid, {}, () => _pfManifest?.agent?.systemPromptFlavor)
          : _pfManifest?.agent?.systemPromptFlavor;
        const out = await runPlatformLoop(_agentMode.provider, {
          gatewayMcpUrl,
          gatewayToken: gwToken,
          userMessage: message,
          model: configStore.getEffective('langchain_model') || undefined,
          systemPrompt: _pfSystemPrompt || undefined,
        });
        const platformReply = out.ok
          ? (typeof out.data === 'string' ? out.data : JSON.stringify(out.data))
          : (() => {
              const d = out.data;
              const msg = d?.error?.message || d?.message || (typeof d === 'string' ? d : null);
              return `Claude agent returned ${out.status}${msg ? ': ' + msg : ''}`;
            })();
        return {
          reply: platformReply,
          success: out.ok,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: (req && req.tokenEvents) || [],
          degradedDelegation: true,
        };
      } catch (e) {
        return {
          reply: `Platform agent error: ${e.message}`,
          success: false,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: (req && req.tokenEvents) || [],
          degradedDelegation: true,
          error: 'platform_runtime_error',
        };
      }
    }
    // ARCHITECTURE-TRUTHS T-3 (amended): heuristic ROUTING is mode-dependent.
    // ff_heuristic_enabled is still honored when no explicit agent_mode is set
    // (back-compat). agent_mode wins when present. Server-side transfer/HITL
    // SAFETY enforcement is independent of this gate and is unchanged.
    const heuristicEnabled = rawMode
      ? _agentMode.heuristicRouting
      : configStore.getEffective('ff_heuristic_enabled') !== 'false';

    // `forceHeuristic` (set by the SPA when a `both`-mode chip already resolved
    // to a vertical/banking intent at /nl) makes the heuristic vertical/banking
    // dispatch run REGARDLESS of agent_mode. Without it, a "Helix only" session
    // (heuristicRouting:false) would re-route a chip's known action to the LLM
    // and skip the per-vertical service that holds its canned response —
    // surfacing as an empty "Done." reply. Only forces the deterministic path
    // when the parsed heuristic actually matches; freeform prompts still fall
    // through to the LLM. Works for ALL verticals.
    const forceHeuristic = req?.body?.forceHeuristic === true;
    const hitlChallengeId = (typeof req?.body?.hitlChallengeId === 'string' && req.body.hitlChallengeId) || null;

    if (heuristicEnabled || forceHeuristic) {
      // Resolve the active vertical's context once so every heuristic-path
      // response (routing, reply headings, no-match catalog) speaks the
      // vertical's language. Absolute rule: heuristics must work for ALL
      // verticals, never leak banking terms. Banking → null → all helpers
      // fall back to the original banking wording (regression-safe).
      const { verticalId: _activeVerticalId, verticalCtx: _verticalCtx } = resolveVerticalRouting(vertical);
      const isAdmin = req && req.session && req.session.user && req.session.user.role === 'admin';

      const heuristic = parseHeuristic(message, _activeVerticalId, _verticalCtx, {
        isAdmin,
        heuristicsOnly: _agentMode && _agentMode.mode === 'heuristics',
      });
      if (heuristic && heuristic.kind === 'vertical') {
        // A matched vertical action always dispatches an MCP tool call through
        // the gateway, which needs the user's session bearer for the RFC 8693
        // exchange. Without it, resolveMcpAccessTokenWithEvents returns a null
        // token and the vertical path forwards an empty bearer to the gateway,
        // which 401s with "Empty JWT payload". Mirror the platform path's
        // guard (see the `if (!userToken)` check above) and return a clean
        // need_auth instead of surfacing that gateway error to the user.
        if (!userToken || userToken === '_cookie_session') {
          if (req) req.agentPath = 'heuristic';
          console.warn('[processAgentMessage] vertical intent blocked — no real OAuth token (got: %s)', userToken || 'null');
          return {
            reply: 'Please sign in again — your session has no active token, so I cannot securely call that tool on your behalf.',
            success: false,
            toolsCalled: [],
            tokensUsed: 0,
            requiresConsent: false,
            agentConfigured: true,
            tokenEvents: req?.tokenEvents || [],
            need_auth: true,
            agentInitRequired: true,
            error: 'need_auth',
            requiresLogin: true,
          };
        }
        const verticalResult = await dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents: [...tokenEvents], sessionId: req?.sessionID || '', isAdmin, verticalCtx: _verticalCtx, hitlChallengeId });
        if (req) req.agentPath = 'heuristic';
        try {
          appEventService.logEvent('agent', 'info', `Heuristic vertical: ${heuristic.action}`, { tag: 'agent/heuristic_vertical' });
        } catch (e) { /* audit must never break the request path */ }
        return verticalResult;
      }
      if (heuristic && heuristic.kind === 'banking') {
        const heuristicResult = await executeHeuristicBanking(heuristic, userId, userToken, req, subjectToken, _verticalCtx);
        if (heuristicResult) {
          // Best-effort agent-path attribution for the delegation audit log
          // (see delegationAuditLogger.buildAuditEvent agentPath). req may be
          // null on non-HTTP call sites — skip silently if so.
          if (req) req.agentPath = 'heuristic';
          if (req) {
            try {
              logDelegationEvent(req, 'delegation_action', {
                agentPath: 'heuristic',
                agentAction: heuristic?.banking?.action || null,
                note: 'Tool/answer produced by the deterministic heuristic path (no LLM).',
              });
            } catch (e) { /* audit must never break the request path */ }
          }
          console.log('[processAgentMessage] Heuristic matched:', heuristic.banking?.action, '— skipping LLM');
          appEventService.logEvent('agent', 'info', `Heuristic: ${heuristic.banking?.action}`, { tag: 'agent/heuristic' });
          appEventService.logEvent('agent_prompt', 'info', `Heuristic tool dispatch: ${heuristic.banking?.action}`,
            { tag: 'agent_prompt/heuristic_tool', metadata: { action: heuristic.banking?.action, userId } });
          return heuristicResult;
        }
        // Heuristic matched but couldn't execute (transfer/deposit/etc.) — fall through to LLM
      }
      // Mode 1 (Heuristics-only): NO LLM. An unrecognised query returns the
      // deterministic capability catalog instead of falling through to an LLM.
      if (_agentMode && _agentMode.mode === 'heuristics') {
        if (req) req.agentPath = 'heuristic';
        return {
          reply: buildCatalogMessage(_verticalCtx),
          success: true,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: (req && req.tokenEvents) || [],
        };
      }
    } else {
      console.log('[processAgentMessage] Heuristic disabled via ff_heuristic_enabled flag — using LLM for all queries');
      if (req?.recordTokenEvent) {
        req.recordTokenEvent('heuristic_disabled', { reason: 'ff_heuristic_enabled=false' });
      }
    }

    // Phase 2 (agent consolidation): the LLM fallback no longer builds an
    // in-process LangGraph. Instead the BFF drives the reason loop against
    // :3006 (which reasons over tool SCHEMAS only) and EXECUTES the SAME tool
    // executors locally — token custody + HITL enforcement stay BFF-side. The
    // agent⇄tools loop bound (WR-03) is now enforced in runReasonLoop's
    // for(i < maxIterations) cap, still using MAX_TOOL_ITERATIONS.
    console.log('[processAgentMessage] Driving :3006 reason loop...');
    appEventService.logEvent('agent', 'info', 'Initializing reasoning agent', { tag: 'agent/init' });
    appEventService.logEvent('agent', 'info', 'LLM reasoning…', { tag: 'agent/invoke' });
    // IN-04: only emit the raw prompt into the admin events feed under
    // LOG_FULL_PROMPTS; otherwise log a non-reversible fingerprint.
    if (LOG_FULL_PROMPTS) {
      appEventService.logEvent('agent_prompt', 'info', `LLM prompt: ${String(message)}`,
        { tag: 'agent_prompt/llm_invoke', metadata: { userId, sessionId, messageLength: message?.length || 0, prompt: String(message), systemPrompt: langchainConfig?.systemPrompt || undefined, model: langchainConfig?.model || undefined } });
    } else {
      appEventService.logEvent('agent_prompt', 'info', `LLM prompt (${_messageFingerprint(message)})`,
        { tag: 'agent_prompt/llm_invoke', metadata: { userId, sessionId, messageLength: message?.length || 0, promptFingerprint: _messageFingerprint(message), model: langchainConfig?.model || undefined } });
    }

    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { runReasonLoop } = require('./agentReasoningClient');

    // Provider precedence on the bff reason-loop path: an explicit per-session
    // langchainConfig.provider (set by the LLM Config / mode picker) wins; when
    // the session carries none — e.g. a public page like OAuth Academy that
    // never ran the picker — fall back to the resolved agent_mode provider
    // (env-first AGENT_MODE, the documented single source of truth) instead of
    // silently defaulting to Helix. Without this, an unseeded session hit Helix
    // (partially configured → "Missing input") even though AGENT_MODE=llamacpp.
    const _providerConfig =
      langchainConfig && langchainConfig.provider
        ? langchainConfig
        : _agentMode && _agentMode.provider
          ? { ...langchainConfig, provider: _agentMode.provider }
          : langchainConfig;
    const { provider, model } = resolveLlmProvider(_providerConfig);

    // NOTE: the old "Helix unconfigured → silently return the catalog message"
    // fallback (former ARCHITECTURE-TRUTH T-3b) was RETIRED (2026-06-12). With
    // the four single-brain modes, an unconfigured provider is greyed out in the
    // UI so it cannot be selected; the default mode is `heuristics` (no LLM), so
    // the no-config experience is the deterministic catalog via the heuristics
    // terminal above — not a hidden fallback on the LLM path. If an LLM mode is
    // selected anyway (e.g. via API) with no credentials, the reason loop fails
    // honestly with reasoning_unavailable rather than masking misconfiguration.

    // Best-effort agent-path attribution: any tool the reason loop drives via
    // executeBffTool → /api/mcp/tool will carry this in the delegation audit.
    if (req) req.agentPath = 'reason_loop_3006';
    if (req) {
      try {
        logDelegationEvent(req, 'delegation_action', {
          agentPath: 'reason_loop_3006',
          note: 'Reasoning delegated to banking_agent_service (:3006); BFF drives the tool loop and retains token custody.',
        });
      } catch (e) { /* audit must never break the request path */ }
    }

    const { verticalId: activeId } = resolveVerticalRouting(vertical);
    const activeManifest = verticalManifest.resolver.resolve(activeId);
    const isAdminUser = req?.session?.user?.role === 'admin';
    const toolSchemas = verticalDispatch.toolSchemasFor(activeId, { isAdmin: isAdminUser }, () => []);
    const systemPrompt = verticalDispatch.hasPlugin(activeId)
      ? verticalDispatch.systemPromptFor(activeId, {}, () => activeManifest?.agent?.systemPromptFlavor)
      : activeManifest?.agent?.systemPromptFlavor;
    // HITL/consent note: real transfer-consent enforcement is the deterministic
    // heuristic, which runs and returns BEFORE this LLM/reason path
    // (ARCHITECTURE-TRUTHS T-3) and is unchanged. On THIS LLM/tool path a
    // HITL/consent denial from a tool surfaces as a generic error (same as the
    // pre-consolidation in-process graph path — it never produced a clean 428
    // here either). Do NOT assume the LLM path yields a 428; do NOT remove the
    // heuristic floor believing it does.

    // Load conversation history for continuity (per-user, per-vertical thread)
    const verticalForHistory = vertical || 'banking';
    const historyMessages = conversationStore.getHistory(userId, verticalForHistory) || [];
    const messages = [...historyMessages, { role: 'user', content: message }];

    const loopResult = await runReasonLoop({
      messages,
      tools: toolSchemas,
      provider,
      model,
      systemPrompt,
      helixConfig: extractHelixConfig(langchainConfig),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: resolveExecuteTool(activeId, { userId, userToken, req, tokenEvents, sessionId, isAdmin: isAdminUser }),
    });

    console.log('[processAgentMessage] Reason loop completed');
    appEventService.logEvent('agent', 'info', 'Agent response ready', { tag: 'agent/complete' });

    // A 200-but-empty answer from the runtime is not a success: returning it as
    // success:true with an empty reply makes the SPA render a meaningless
    // placeholder. Treat it as reasoning_unavailable so every caller gets a real
    // error (and the heuristic floor below can substitute if it has output).
    if (loopResult.ok && !String(loopResult.answer || '').trim()) {
      loopResult.ok = false;
      loopResult.reason = loopResult.reason || 'empty_answer';
    }
    if (loopResult.ok) {
      appEventService.logEvent('agent_prompt', 'info', `LLM response: ${String(loopResult.answer || '')}`,
        { tag: 'agent_prompt/llm_complete', metadata: { userId, response: String(loopResult.answer || ''), model: model || undefined } });
      return {
        reply: loopResult.answer,
        success: true,
        toolsCalled: [],
        inputTokens: loopResult.inputTokens ?? 0,
        outputTokens: loopResult.outputTokens ?? 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
      };
    }
    // Loop guard tripped: a tool returned a terminal signal (e.g. admin token on
    // a customer tool). Surface its structured envelope so the SPA renders the
    // login-as-customer action card instead of a generic error.
    if (loopResult.reason === 'tool_terminal' && loopResult.toolResult?.requiresCustomerLogin) {
      return adminTokenAgentResponse(tokenEvents);
    }
    if (loopResult.reason === 'tool_terminal' || loopResult.reason === 'repeated_tool_call') {
      const tr = loopResult.toolResult || {};
      return {
        reply: tr.message || 'The assistant could not complete that request. Please try rephrasing.',
        success: false,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        error: tr.error || loopResult.reason,
      };
    }
    if (loopResult.reason === 'max_iterations') {
      // WR-03 preserved: bounded loop → graceful "maximum tool iteration
      // limit" response (shape matches this file's other returns). The bound
      // is now enforced BFF-side by runReasonLoop instead of LangGraph's
      // GraphRecursionError, still using MAX_TOOL_ITERATIONS.
      console.warn('[processAgentMessage] Max tool iteration limit reached:', MAX_TOOL_ITERATIONS);
      appEventService.logEvent('agent', 'warning',
        `Agent reached maximum tool iteration limit (${MAX_TOOL_ITERATIONS})`,
        { tag: 'agent/recursion_limit' });
      return {
        reply: 'Agent reached maximum tool iteration limit. Please rephrase your request or try a simpler query.',
        success: false,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        error: 'max_tool_iterations',
      };
    }
    // reasoning_unavailable: LLM service failed. Say so honestly — the old
    // behavior returned the heuristics capability catalog as success:true,
    // which misreported an LLM/provider outage as "Heuristics-only mode" and
    // sent whoever debugged it down the wrong path (it masked the live-site
    // provider misconfiguration for a full day). heuristicFallbackResult (a
    // real matched heuristic answer) still takes precedence when present.
    return heuristicFallbackResult || {
      reply:
        `The ${provider || 'configured'} LLM could not complete this request` +
        `${loopResult.reason ? ` (${loopResult.reason})` : ''}. ` +
        (provider === 'llamacpp'
          ? 'If the stack was just deployed or restarted, the local model takes several minutes to load — try again shortly. '
          : '') +
        'Switch the agent to "Heuristics only" mode for deterministic responses, ' +
        'or check the LLM backend status and try again.',
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: 'reasoning_unavailable',
    };
  } catch (rawError) {
    // Normalize non-Error throws (e.g. thrown strings/objects) so property accesses below are safe.
    const error = (rawError instanceof Error) ? rawError : Object.assign(new Error(String(rawError)), { _originalThrow: rawError });
    // TOKEN_INACTIVE must propagate so the route can return 401 + need_auth
    if (error.code === 'TOKEN_INACTIVE') throw error;
    // Tag with source module if not already tagged — makes stack traces immediately actionable
    if (!error.source) error.source = 'demoAgentLangGraphService';
    if (!error.message.startsWith('[')) error.message = `[demoAgentLangGraphService] ${error.message}`;
    console.error('[processAgentMessage] ERROR: Agent processing error');
    appEventService.logEvent('agent', 'error', `Agent error: ${error.message}`, { tag: 'agent/error' });
    console.error('[processAgentMessage] Error name:', error.name);
    console.error('[processAgentMessage] Error message:', error.message);
    console.error('[processAgentMessage] Error stack:', error.stack);
    console.error('[processAgentMessage] Error code:', error.code);
    console.error('[processAgentMessage] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Session has no delegated user token (expired / login round-trip never
    // completed). Say so explicitly and flag requiresLogin so the UI can
    // prompt a fresh sign-in instead of a generic "agent error".
    if (error.code === 'login_required' || error.login_required) {
      return {
        reply: 'Your session is no longer signed in — the sign-in may have expired or not completed. Please sign in again to continue.',
        success: false,
        error: 'login_required',
        requiresLogin: true,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentError: true,
        errorMessage: error.message,
      };
    }

    // Return a graceful error response instead of throwing
    let userMessage = 'The agent encountered an error. Please try again.';
    if (error.message.includes('model') && (error.message.includes('not found') || error.message.includes('not_found'))) {
      userMessage = 'No AI model is configured. Your request could not be understood — try rephrasing with keywords like "show accounts", "my balance", or "transfer".';
    } else if (error.message.includes('API key') || error.message.includes('401')) {
      userMessage = 'Authentication error. Please log out and log in again.';
    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT') || error.name === 'AbortError') {
      userMessage = 'The AI service took too long to respond. Please try again.';
    } else if (error.message.includes('429') || error.message.includes('rate limit')) {
      userMessage = 'Too many requests. Please wait a moment and try again.';
    }
    return {
      reply: userMessage,
      success: false,
      error: error.message,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentError: true,
      errorMessage: error.message
    };
  }
}

/**
 * Normalize a vertical tool's args to its schema before the RFC 8693 → gateway → MCP call.
 * The heuristic parser attaches a generic `recordId` that tool schemas don't declare (they
 * use billId/poId/etc.), and the generated MCP schema is additionalProperties:false — so an
 * undeclared recordId is rejected at the gateway with HTTP 400. Drop a recordId that merely
 * echoes the $ amount (the amount-driven policy chips run against the default record);
 * otherwise map it to the tool's own id field so a real id ("pay bill 402") still targets
 * the right record. No-op when the tool genuinely declares recordId.
 */
function normalizeVerticalToolArgs(params, toolDef) {
  if (!params || params.recordId == null) return params;
  const props = (toolDef && toolDef.inputSchema && toolDef.inputSchema.properties) || {};
  if ('recordId' in props) return params;
  const args = { ...params };
  const echoesAmount = args.amount != null && String(args.recordId) === String(args.amount);
  if (!echoesAmount) {
    const idProp = Object.keys(props).find((k) => /Id$/i.test(k));
    if (idProp && args[idProp] == null) args[idProp] = args.recordId;
  }
  delete args.recordId;
  return args;
}

module.exports = {
  processAgentMessage,
  dispatchBankingAction,
  dispatchVerticalIntent,
  __test: { resolveToolSchemas, resolveExecuteTool, dispatchVerticalIntent, buildVerticalReply, executeA2aDelegation, normalizeVerticalToolArgs, applyAdminCustomerContext },
};
