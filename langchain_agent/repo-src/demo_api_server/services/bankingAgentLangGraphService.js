/**
 * Banking Agent LangGraph Service
 * LangGraph agent executor for banking operations with MCP tools + HITL gates
 * Priority: heuristic regex (instant, zero-cost) → LangGraph LLM (when regex returns kind:'none')
 */

const { getBankingToolDefinitions, MAX_TOOL_ITERATIONS } = require('./agentBuilder');
const { executeBffTool } = require('./bffMcpToolExecutor');
const { resolveMcpAccessTokenWithEvents } = require('./agentMcpTokenService');
const z = require('zod');
const appEventService = require('./appEventService');
const { parseHeuristic, buildCatalogMessage } = require('./nlIntentParser');
const { resolveAgentMode } = require('./agentModeResolver');
const configStore = require('./configStore');
const dataStore = require('../data/store');
const { verticalManifest } = require('./verticalManifest');

// Read tool descriptions directly from the data/seeds/<id>.js CommonJS module.
// Seed files own LLM-facing tool descriptions; this is a parallel persistence
// layer pre-dating the manifest system. Cycle 2 may merge seeds into manifests.
function getSeedToolDescriptions(verticalId) {
  try {
    return require(path.join(__dirname, '..', 'data', 'seeds', `${verticalId}.js`)).toolDescriptions || {};
  } catch (_) {
    return {};
  }
}
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logDelegationEvent } = require('../middleware/delegationAuditLogger');

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
 * Execute a banking action identified by the heuristic parser, returning a chat-style reply.
 * Handles Phase 2-3 token exchange if needed.
 * @returns {{ reply: string, success: boolean, toolsCalled: string[], tokensUsed: number, requiresConsent: boolean, agentConfigured: boolean, tokenEvents: any[] } | null}
 */
async function executeHeuristicBanking(parsed, userId, userToken, req = null, subjectToken = null) {
  const action = parsed?.banking?.action;
  const params = parsed?.banking?.params || {};
  if (!action) return null;

  const sessionRole = req?.session?.user?.role;
  const isAdmin = sessionRole === 'admin';

  // Session-scoped: terminology follows THIS session's vertical, not the global.
  const manifest = verticalManifest.resolver.resolve(verticalManifest.resolver.activeIdFor(req));
  const term = manifest?.terminology || {};
  const termAccount = term.account || 'Account';
  const termAccounts = term.accounts || 'accounts';
  const termTransaction = term.transaction || 'transaction';
  const termTransactions = term.transactions || 'transactions';
  const termBalance = term.balance || 'balance';

  try {
    // READ actions — route through the full token-exchange → gateway → MCP server
    // pipeline so PingAuthorize evaluates every call (same path as the chip/action UI).
    // executeBffTool does RFC 8693 token exchange, calls the tool executor with the
    // exchanged agent token, and collects tokenEvents for the Token Chain panel.
    if (action === 'accounts' || action === 'balance' || action === 'transactions') {
      const tokenEvents = [];
      const sessionId = req?.sessionID || '';

      let toolName, toolArgs;
      if (action === 'accounts') {
        toolName = 'get_my_accounts';
        toolArgs = {};
      } else if (action === 'balance') {
        if (params.accountId) {
          toolName = 'get_account_balance';
          toolArgs = { account_id: params.accountId };
        } else {
          toolName = 'get_my_accounts';
          toolArgs = {};
        }
      } else {
        toolName = 'get_my_transactions';
        toolArgs = { limit: 10 };
      }

      const rawResult = await executeBffTool({ name: toolName, args: toolArgs, userId, userToken, req, tokenEvents, sessionId });

      let parsed2;
      try { parsed2 = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
      catch (_) { parsed2 = null; }

      if (!parsed2 || parsed2.error || parsed2.isError) {
        const errMsg = parsed2?.content?.[0]?.text || parsed2?.message || parsed2?.error || 'Tool call failed.';
        return { reply: `❌ ${errMsg}`, success: false, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }

      // accounts / balance: return structured accounts list
      if (action === 'accounts' || (action === 'balance' && !params.accountId)) {
        const accts = parsed2.accounts || [];
        if (!accts.length) {
          return { reply: isAdmin ? `No customer ${termAccounts} found in the system.` : `You don't have any ${termAccounts} yet.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, accounts: [] };
        }
        const lines = accts.map(a => {
          const type = a.accountType || a.account_type || a.type || termAccount;
          const num = a.accountNumber || a.account_number || '—';
          const bal = Number(a.balance ?? 0).toFixed(2);
          const cur = a.currency || 'USD';
          return `• **${type}** (${num}) — **$${bal}** ${cur}`;
        });
        const heading = action === 'balance' ? `Your ${termBalance}` : (isAdmin ? `Here are all customer ${termAccounts}` : `Here are your ${termAccounts}`);
        return { reply: `${heading}:\n\n${lines.join('\n\n')}`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, accounts: accts };
      }

      // balance for a specific account
      if (action === 'balance' && params.accountId) {
        const bal = parsed2.balance;
        const acctType = parsed2.accountType || parsed2.account_type || params.accountId;
        if (bal !== undefined) {
          return { reply: `Your **${acctType}** ${termBalance} is **$${Number(bal).toFixed(2)}**.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, balance: bal };
        }
        // fallback: show accounts list from result
        const accts2 = parsed2.accounts || [];
        const match = accts2.find(a => (a.accountType || a.account_type || a.type || '').toLowerCase() === String(params.accountId).toLowerCase() || a.id === params.accountId);
        if (match) {
          const bal2 = Number(match.balance ?? 0).toFixed(2);
          const type2 = match.accountType || match.account_type || match.type || termAccount;
          return { reply: `Your **${type2}** ${termBalance} is **$${bal2}**.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, balance: match.balance };
        }
        return { reply: `${termBalance} information is not available right now.`, success: false, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }

      // transactions
      const txns = parsed2.transactions || [];
      if (!txns.length) {
        return { reply: `No recent ${termTransactions} found.`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, transactions: [] };
      }
      const recent = txns.slice(0, 5);
      const lines = recent.map(t => `• ${t.type} — $${Number(t.amount).toFixed(2)} — ${t.description || t.type}`);
      return { reply: `Recent ${termTransactions}:\n\n${lines.join('\n')}`, success: true, toolsCalled: [toolName], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, transactions: recent };
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
        let result;
        try { result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
        catch (_) { result = null; }
        if (result?.error === 'hitl_required') {
          return { reply: result.message || 'This transfer requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: result.hitl || { type: 'consent' }, hitl_threshold_usd: result.hitl_threshold_usd || amount, fromAccountId: fromAcct.id, toAccountId: toAcct.id, transactionAmount: amount, transactionType: 'transfer' };
        }
        if (result?.error === 'step_up_required') {
          return { reply: result.message || 'Step-up authentication required for this transfer.', success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (result?.error || result?.isError) {
          return { reply: `Transfer failed: ${result.message || result.content?.[0]?.text || result.error}`, success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Transferred **$${amount.toFixed(2)}** from ${fromAcct.accountType} to ${toAcct.accountType}.`, success: true, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        return { reply: `Transfer failed: ${(err && err.message) ? err.message : String(err)}`, success: false, toolsCalled: ['create_transfer'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
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
        let result;
        try { result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
        catch (_) { result = null; }
        if (result?.error === 'hitl_required') {
          return { reply: result.message || 'This deposit requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: result.hitl || { type: 'consent' }, hitl_threshold_usd: result.hitl_threshold_usd || amount, toAccountId: toAcct.id, transactionAmount: amount, transactionType: 'deposit' };
        }
        if (result?.error === 'step_up_required') {
          return { reply: result.message || 'Step-up authentication required for this deposit.', success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (result?.error || result?.isError) {
          return { reply: `Deposit failed: ${result.message || result.content?.[0]?.text || result.error}`, success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Deposited **$${amount.toFixed(2)}** into ${toAcct.accountType}.`, success: true, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        return { reply: `Deposit failed: ${(err && err.message) ? err.message : String(err)}`, success: false, toolsCalled: ['create_deposit'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
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
        let result;
        try { result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult; }
        catch (_) { result = null; }
        if (result?.error === 'hitl_required') {
          return { reply: result.message || 'This withdrawal requires your approval. Please confirm in the consent dialog.', success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents, error: 'hitl_required', hitl: result.hitl || { type: 'consent' }, hitl_threshold_usd: result.hitl_threshold_usd || amount, fromAccountId: fromAcct.id, transactionAmount: amount, transactionType: 'withdrawal' };
        }
        if (result?.error === 'step_up_required') {
          return { reply: result.message || 'Step-up authentication required for this withdrawal.', success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        if (result?.error || result?.isError) {
          return { reply: `Withdrawal failed: ${result.message || result.content?.[0]?.text || result.error}`, success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
        }
        return { reply: `Withdrew **$${amount.toFixed(2)}** from ${fromAcct.accountType}.`, success: true, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      } catch (err) {
        // WR-07(a): non-Error throws have no .message — surface the real value.
        return { reply: `Withdrawal failed: ${(err && err.message) ? err.message : String(err)}`, success: false, toolsCalled: ['create_withdrawal'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents };
      }
    }

    // For mcp_tools — let LangGraph handle (needs MCP connection)

    if (action === 'sensitive_account_details') {
      const { get_sensitive_account_details } = require('./mcpLocalTools');
      // Use the real req (which has session.stepUpVerified) when available.
      // Fall back to a fakeReq built from token ACR claims when called without req.
      let effectiveReq = req;
      if (!effectiveReq && userToken) {
        try {
          const payload = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64').toString());
          effectiveReq = { user: { acr: payload.acr || payload['pingone:acr'] || '' } };
        } catch (e) { /* token decode failed — step-up will be required */ }
      }
      const result = await get_sensitive_account_details({}, userId, effectiveReq);
      if (result.error === 'hitl_required' || result.hitl_required) {
        return { reply: 'Viewing sensitive account details requires your approval. Please confirm in the consent modal to continue.', success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: true, agentConfigured: true, tokenEvents: [], error: 'hitl_required', hitl: { type: 'consent' }, hitl_threshold_usd: 0 };
      }
      if (!result.ok) {
        return { reply: `❌ ${result.error || 'Could not retrieve sensitive account details.'}`, success: false, toolsCalled: ['get_sensitive_account_details'], tokensUsed: 0, requiresConsent: false, agentConfigured: true, tokenEvents: [] };
      }
      const lines = result.accounts.map(a => {
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
        tokenEvents: [],
        // Include structured account data for UI panel display
        accountData: {
          user: result.user,
          accounts: result.accounts
        }
      };
    }
  } catch (err) {
    // WR-07(a): non-Error throws (string, MCP-error object without .message)
    // previously logged `undefined` and were swallowed — the function then
    // returned null, so the caller fell through to the LLM path which could
    // RE-EXECUTE a write tool (transfer/deposit/withdraw) a second time.
    // Log the real value, and re-throw for write actions so a partially
    // executed mutation is surfaced instead of silently double-run.
    const detail = (err && err.message) ? err.message : String(err);
    console.warn('[heuristicBanking] Error executing action:', action, detail);
    if (['transfer', 'deposit', 'withdraw'].includes(action)) {
      throw (err instanceof Error) ? err : new Error(`[heuristicBanking] ${action} failed: ${detail}`);
    }
  }
  return null;
}

/**
 * Phase 2 (agent consolidation) reason-loop helpers.
 *
 * Split "schema" from "execute": :3006 reasons over tool SCHEMAS only; the BFF
 * still EXECUTES tools locally via the SAME executors `createBankingAgent`'s
 * tool node used. Token custody + HITL enforcement stay BFF-side.
 */

/**
 * Tool SCHEMAS for :3006 — derived from the SAME tool list agentBuilder builds
 * (`getBankingToolDefinitions()` → `createMcpToolRegistry()`), with executors
 * stripped. Zod `schema` → JSON Schema so :3006's helixToolAdapter can read
 * `.properties`. No hand-duplicated schemas.
 */
function buildToolSchemasForAgent(activeVerticalId) {
  // Session-scoped: caller passes the request's vertical; fall back to global.
  const manifest = verticalManifest.resolver.resolve(activeVerticalId || verticalManifest.resolver.activeId());
  const verticalId = manifest?.id || 'banking';
  const verticalDescs = getSeedToolDescriptions(verticalId);
  const tools = getBankingToolDefinitions();
  return tools.map((tool) => {
    let inputSchema;
    try {
      inputSchema = tool.schema ? z.toJSONSchema(tool.schema) : { type: 'object', properties: {} };
    } catch (_e) {
      inputSchema = { type: 'object', properties: {} };
    }
    return {
      name: tool.name,
      description: verticalDescs[tool.name] || tool.description || '',
      inputSchema,
    };
  });
}

/**
 * Build tool schemas for the PingOne Admin reason loop.
 * Fetches the tool list from the hosted PingOne MCP server (HTTP) and converts
 * to the JSON Schema shape runReasonLoop expects.
 * @returns {Promise<Array<{ name: string, description: string, inputSchema: object }>>}
 */
async function buildPingOneAdminToolSchemas() {
  const { listTools } = require('./mcpPingOneHttpAdapter');
  const tools = await listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Execute a PingOne Admin tool via the hosted PingOne MCP server (HTTP).
 * Auth is handled inside the adapter with a worker client_credentials token.
 * @returns {Promise<string>} JSON-stringified result
 */
async function executePingOneTool(name, args) {
  const { callTool } = require('./mcpPingOneHttpAdapter');
  try {
    const result = await callTool(name, args || {});
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    console.error('[executePingOneTool] Error calling tool %s: %s', name, err.message);
    return JSON.stringify({ error: 'pingone_mcp_unavailable', message: err.message });
  }
}

/**
 * Build the reason-loop system prompt from the ACTIVE vertical: persona + domain
 * terminology + guardrails. The reason loop previously sent no system prompt, so
 * the LLM (Claude / Helix / LM Studio) reasoned with only tool schemas — generic,
 * occasionally refusing or using banking words in a non-banking vertical. This
 * keeps every provider in-character and tool-driven. Resolved per request so a
 * vertical switch is reflected immediately.
 */
function buildReasonSystemPrompt(activeVerticalId) {
  let manifest = null;
  try {
    // Session-scoped: caller passes the request's vertical; fall back to global.
    manifest = verticalManifest.resolver.resolve(activeVerticalId || verticalManifest.resolver.activeId());
  } catch (_) { /* fall back to the generic prompt below */ }
  const agent = (manifest && manifest.agent) || {};
  const persona = agent.persona || 'Assistant';
  const identity = (manifest && manifest.identity) || {};
  const displayName = identity.displayName || identity.name || 'this service';
  const term = (manifest && manifest.terminology) || {};
  const termBits = [];
  if (term.accounts) termBits.push(`"${term.accounts}" (not "accounts")`);
  if (term.transactions) termBits.push(`"${term.transactions}" (not "transactions")`);
  const termLine = termBits.length ? ` Use this domain's terminology: ${termBits.join(', ')}.` : '';
  return (
    `You are ${persona}, the assistant for ${displayName}. ` +
    `The user is already authenticated and is viewing their own data; the provided tools execute ` +
    `server-side against the user's session. Use the tools to fulfil requests — do not ask the user ` +
    `to log in, visit a website, or contact support, and never refuse on "this is a demo" or privacy ` +
    `grounds. If a request maps to a tool, call it; otherwise answer concisely and professionally.` +
    termLine
  );
}

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
 */
async function processAgentMessage({ message, userId, userToken, sessionId, tokenEvents = [], langchainConfig = {}, req = null }) {
  try {
    console.log('[processAgentMessage] Starting');
    appEventService.logEvent('agent', 'info', 'Agent processing message…', { tag: 'agent/message' });
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
      // Resolve via the shared resolver (env → configStore) so this matches the
      // BFF path, hot-loads from /config, and has no localhost fallback that
      // silently dials the wrong port (the ECONNREFUSED :3005 class).
      const gatewayMcpUrl = getMcpGatewayHttpUrl().replace(/\/$/, '') + '/mcp';
      try {
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
        const out = await runPlatformLoop(_agentMode.provider, {
          gatewayMcpUrl,
          gatewayToken: gwToken,
          userMessage: message,
          model: configStore.getEffective('langchain_model') || undefined,
        });
        return {
          reply: typeof out.data === 'string' ? out.data : JSON.stringify(out.data),
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

    if (heuristicEnabled) {
      const heuristic = parseHeuristic(message);
      if (heuristic && heuristic.kind === 'banking') {
        const heuristicResult = await executeHeuristicBanking(heuristic, userId, userToken, req, subjectToken);
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
          reply: buildCatalogMessage(),
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

    // PingOne Admin path — tool schemas from the hosted PingOne MCP server (HTTP), no token exchange
    if (langchainConfig?.provider === 'pingone-admin') {
      console.log('[processAgentMessage] PingOne Admin path — building tool schemas');
      const { provider: llmProvider, model: llmModel } = resolveLlmProvider(
        { ...langchainConfig, provider: undefined }
      );
      let pingOneToolSchemas;
      try {
        pingOneToolSchemas = await buildPingOneAdminToolSchemas();
      } catch (schemaErr) {
        console.error('[processAgentMessage] Failed to build PingOne tool schemas:', schemaErr.message);
        return {
          reply: 'PingOne Admin tools are unavailable. Ensure the hosted PingOne MCP feature is enabled and worker credentials are configured.',
          success: false,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: tokenEvents || [],
          error: 'pingone_tools_unavailable',
        };
      }
      const p1LoopResult = await runReasonLoop({
        messages: [{ role: 'user', content: message }],
        tools: pingOneToolSchemas,
        provider: llmProvider,
        model: llmModel,
        helixConfig: extractHelixConfig(langchainConfig),
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        maxIterations: MAX_TOOL_ITERATIONS,
        executeTool: async (name, args) => executePingOneTool(name, args),
      });
      if (p1LoopResult.ok) {
        console.log('[processAgentMessage] PingOne Admin reason loop completed');
        appEventService.logEvent('agent', 'info', 'PingOne Admin response ready', { tag: 'agent/complete' });
        if (LOG_FULL_PROMPTS) {
          appEventService.logEvent('agent_prompt', 'info', `LLM response: ${String(p1LoopResult.answer || '')}`,
            { tag: 'agent_prompt/llm_complete', metadata: { userId, response: String(p1LoopResult.answer || ''), model: llmModel || undefined } });
        }
        return {
          reply: p1LoopResult.answer,
          success: true,
          toolsCalled: [],
          inputTokens: p1LoopResult.inputTokens ?? 0,
          outputTokens: p1LoopResult.outputTokens ?? 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: tokenEvents || [],
        };
      }
      return {
        reply: p1LoopResult.reason === 'max_iterations'
          ? 'Agent reached maximum tool iteration limit. Please rephrase your request.'
          : 'PingOne Admin reasoning is temporarily unavailable.',
        success: false,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        error: p1LoopResult.reason || 'reasoning_unavailable',
      };
    }

    // Resolve LLM provider for the banking reason loop (after pingone-admin early return)
    const { provider, model } = resolveLlmProvider(langchainConfig);

    // If the resolved provider is Helix but no Helix credentials are configured,
    // fall back to the heuristics-only catalog message rather than attempting a
    // doomed Helix call that returns reasoning_unavailable.
    // "Configured" = helix_api_key is present (it's the only required secret;
    // helix_base_url has a default and helix_agent_id defaults to 'LLM2').
    if (provider === 'helix') {
      const helixCfg = extractHelixConfig(langchainConfig);
      const helixApiKey = helixCfg.helix_api_key || configStore.getEffective('helix_api_key') || '';
      if (!helixApiKey) {
        console.log('[processAgentMessage] Helix not configured (no API key) — returning catalog message (heuristic floor)');
        if (req) req.agentPath = 'heuristic';
        return {
          reply: buildCatalogMessage(),
          success: true,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: req?.tokenEvents || [],
        };
      }
    }

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

    // Session-scoped vertical for the agent's tools + persona (not the global).
    const _sessionVertical = verticalManifest.resolver.activeIdFor(req);
    const toolSchemas = buildToolSchemasForAgent(_sessionVertical);
    // HITL/consent note: real transfer-consent enforcement is the deterministic
    // heuristic, which runs and returns BEFORE this LLM/reason path
    // (ARCHITECTURE-TRUTHS T-3) and is unchanged. On THIS LLM/tool path a
    // HITL/consent denial from a tool surfaces as a generic error (same as the
    // pre-consolidation in-process graph path — it never produced a clean 428
    // here either). Do NOT assume the LLM path yields a 428; do NOT remove the
    // heuristic floor believing it does.
    const loopResult = await runReasonLoop({
      messages: [{ role: 'user', content: message }],
      tools: toolSchemas,
      systemPrompt: buildReasonSystemPrompt(_sessionVertical),
      provider,
      model,
      helixConfig: extractHelixConfig(langchainConfig),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: async (name, args) =>
        executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId }),
    });

    console.log('[processAgentMessage] Reason loop completed');
    appEventService.logEvent('agent', 'info', 'Agent response ready', { tag: 'agent/complete' });

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
    // reasoning_unavailable: prefer the heuristic's output if one exists for
    // this path (none does today — heuristic returns immediately on match), else
    // the generic message. ARCHITECTURE-TRUTHS T-3 deterministic floor.
    return heuristicFallbackResult || {
      reply: 'Advanced reasoning is temporarily unavailable. Please try a simpler request.',
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: 'reasoning_unavailable',
    };
  } catch (error) {
    // TOKEN_INACTIVE must propagate so the route can return 401 + need_auth
    if (error.code === 'TOKEN_INACTIVE') throw error;
    // Tag with source module if not already tagged — makes stack traces immediately actionable
    if (!error.source) error.source = 'bankingAgentLangGraphService';
    if (!error.message.startsWith('[')) error.message = `[bankingAgentLangGraphService] ${error.message}`;
    console.error('[processAgentMessage] ERROR: Agent processing error');
    appEventService.logEvent('agent', 'error', `Agent error: ${error.message}`, { tag: 'agent/error' });
    console.error('[processAgentMessage] Error name:', error.name);
    console.error('[processAgentMessage] Error message:', error.message);
    console.error('[processAgentMessage] Error stack:', error.stack);
    console.error('[processAgentMessage] Error code:', error.code);
    console.error('[processAgentMessage] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Return a graceful error response instead of throwing
    let userMessage = 'The banking agent encountered an error. Please try again.';
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

module.exports = {
  processAgentMessage
};
