/**
 * MCP Tool Registry — LangChain 1.x tool() wrappers
 * All tools receive auth context via config.configurable.agentContext
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod/v4');
const { explainTopic } = require('../services/educationTopics.js');
const { mcpCallTool } = require('../services/mcpWebSocketClient');
const { decodeJwtClaims, buildTokenEvent, buildGwAuthorizeEventExtra } = require('../services/agentMcpTokenService');
const { recordToolCall: recordMcpToolCall } = require('../services/mcpToolAuditStore');
const mcpGatewayClient = require('../services/mcpGatewayClient');
const configStore = require('../services/configStore');
const unifiedTrace = require('../services/unifiedTrace');


const braveSearchService = require('../services/braveSearchService');
const oauthService = require('../services/oauthService');

function _tryGetGatewayUrl() {
  try { return mcpGatewayClient.getMcpGatewayHttpUrl(); } catch (_) { return null; }
}

function _countSummary(arr, label, prefix = 'Returned') {
  const count = Array.isArray(arr) ? arr.length : null;
  return count !== null ? `${prefix} ${count} ${label}${count === 1 ? '' : 's'}.` : `${label.charAt(0).toUpperCase() + label.slice(1)}s returned.`;
}

/**
 * Build a safe, non-PII summary of the tool result for Token Chain display.
 * Returns counts and status only — no account numbers, balances, or user data.
 */
function _buildResultSummary(toolName, resultObj, isError) {
  if (isError || !resultObj) return '';
  if (toolName === 'get_my_accounts' || toolName === 'get_all_accounts') {
    return _countSummary(resultObj.accounts, 'account');
  }
  if (toolName === 'get_my_transactions') {
    return _countSummary(resultObj.transactions, 'transaction');
  }
  if (toolName === 'get_account_balance') {
    return resultObj.balance !== undefined ? 'Balance retrieved.' : 'Balance data returned.';
  }
  if (toolName === 'create_transfer' || toolName === 'create_deposit' || toolName === 'create_withdrawal') {
    const op = toolName.replace('create_', '');
    return resultObj.transactionId ? `${op} completed (id: ${String(resultObj.transactionId).slice(0, 8)}…).` : `${op} confirmed.`;
  }
  if (toolName === 'get_sensitive_account_details') {
    return _countSummary(resultObj.accounts, 'account', 'Returned sensitive details for');
  }
  // Generic: show top-level keys only
  const keys = typeof resultObj === 'object' ? Object.keys(resultObj) : [];
  return keys.length ? `Response keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '…' : ''}.` : 'Response received.';
}

/**
 * Internal MCP tool call with agent token (bypasses requireSession for agent context)
 * Used by agent tools which run in the same process but don't have session cookies
 */
async function callMcpToolInternal(toolName, params, agentToken, userId, tokenEvents = []) {
  // Choke point: never present an empty/missing bearer to the gateway — it 401s
  // with "Empty JWT payload". This covers EVERY agent path (vertical, banking,
  // LLM) at the one place the bearer is forwarded, so a tokenless session yields
  // a clean login_required instead of a raw gateway error. (The heuristic
  // vertical branch guards earlier too, for a nicer reply; this is the backstop
  // for the sibling banking/LLM paths.)
  if (!agentToken) {
    throw Object.assign(
      new Error('No delegated token for MCP tool call — sign in to continue.'),
      { code: 'login_required', login_required: true, httpStatus: 401 },
    );
  }

  // Hoisted above the try so the catch (failure trace) can read them too.
  const _traceStart = Date.now();
  const _decoded = decodeJwtClaims(agentToken); // decode once; reused below
  const _claims = _decoded?.claims || null;
  const userSub = _claims?.sub || null;
  const _tokenAud = _claims?.aud || null;
  const correlationId = require('node:crypto').randomUUID();
  let gwAuditTrail = null;

  // One trace emitter for the success and failure paths. writeTransaction is a
  // no-op when file logging is off, so call sites need no guard (per unifiedTrace contract).
  const emitTrace = ({ result, error }) => {
    unifiedTrace.writeTransaction({
      type: 'MCP: TOOL_CALL',
      timestamp: new Date().toISOString(),
      correlationId,
      userSub,
      tool: toolName,
      steps: unifiedTrace.buildMcpHopSteps({ tokenAud: _tokenAud, gwAuditTrail, result, error }),
      outcome: {
        ok: error ? false : !result?.isError,
        durationMs: Date.now() - _traceStart,
        detail: error ? error.message : (result?.isError ? 'tool returned error' : undefined),
      },
    });
  };

  try {
    const gatewayHttpUrl = _tryGetGatewayUrl();
    const routedVia = gatewayHttpUrl ? 'gateway' : 'websocket';

    // Step: MCP tool invoked — shows the tool dispatch with routing info
    if (tokenEvents) {
      const decoded = _decoded ? { claims: _decoded.claims, header: _decoded.header } : null;
      tokenEvents.push(buildTokenEvent(
        'mcp-tool-invoked',
        `MCP Tool Invoked: ${toolName}`,
        'acquiring',
        decoded,
        `Agent dispatching tool "${toolName}" for user ${userId} via ${routedVia === 'gateway' ? 'MCP Gateway (HTTP)' : 'MCP Server (WebSocket)'}. Delegated token presented as Bearer.`,
        { toolName, toolArgs: params ? Object.keys(params) : [], routedVia, actor: 'agent', onBehalfOf: userId }
      ));
    }

    // Route through HTTP gateway when MCP_GATEWAY_HTTP_URL is configured — the gateway
    // accepts the bearer token in the Authorization header (HTTP), whereas the WebSocket
    // path requires it in the WS protocol handshake which the current client doesn't send.
    // Fall back to WebSocket only when no gateway URL is set.
    let result;
    const _toolCallStart = Date.now();
    if (gatewayHttpUrl) {
      ({ result, gwAuditTrail } = await mcpGatewayClient.callToolViaGateway(
        gatewayHttpUrl, agentToken, toolName, params, { correlationId }
      ));
    } else {
      result = await mcpCallTool(toolName, params, agentToken, userSub, correlationId);
    }
    const _toolDuration = Date.now() - _toolCallStart;

    // Record in local audit store so /api/token-chain includes this agent-path call
    try {
      const decoded = _decoded; // already decoded once at function entry
      recordMcpToolCall({
        userId: userId || 'agent',
        toolName,
        success: !result?.isError,
        duration: _toolDuration,
        summary: result?.isError ? `${toolName} failed` : `${toolName} completed`,
        requestJson: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: params ?? {} } },
        resultJson: result ?? null,
        isDelegated: !!agentToken,
        userToken: decoded?.claims ? { sub: decoded.claims.sub || userId, scope: decoded.claims.scope || '' } : null,
      });
    } catch (_) { /* non-blocking */ }

    if (tokenEvents) {
      // Gateway audit trail — introspection, authorize decision, mTLS (agent path).
      // Mirrors the same logic in mcpToolPipeline.js for the direct-MCP path.
      if (gwAuditTrail) {
        if (gwAuditTrail.introspection) {
          const ir = gwAuditTrail.introspection;
          const irStatus = ir.skipped ? 'skipped' : (ir.active ? 'valid' : 'revoked');
          const irDesc = ir.skipped
            ? 'Gateway introspection skipped (endpoint not configured)'
            : (ir.active ? 'Gateway: token verified active via RFC 7662 introspection' : 'Gateway: token is revoked or no longer active');
          tokenEvents.push(buildTokenEvent('gw-introspection', 'Gateway — RFC 7662 Introspection', irStatus, null, irDesc,
            { rfc: 'RFC 7662', sub: ir.sub, exp: ir.exp }));
        }
        if (gwAuditTrail.authorize) {
          const az = gwAuditTrail.authorize;
          const azStatus = az.decision === 'PERMIT' ? 'permit' : (az.decision === 'INDETERMINATE' ? 'indeterminate' : 'deny');
          tokenEvents.push(buildTokenEvent('gw-authorize', 'Gateway — PingOne Authorize Decision', azStatus, null,
            `PingOne Authorize policy evaluation: ${az.decision}${az.reason ? ` (${az.reason})` : ''}`,
            buildGwAuthorizeEventExtra(az)));
        }
        if (gwAuditTrail.mcpAudit) {
          const a = gwAuditTrail.mcpAudit;
          const howResult = a.how?.result || a.how?.decision || 'recorded';
          const whoUser = a.who?.userSub || a.who?.clientId || 'unknown';
          const whatTool = a.what?.tool || a.what?.mcpMethod || toolName || 'mcp';
          tokenEvents.push(buildTokenEvent(
            'gw-mcp-audit',
            'PingGateway McpAuditFilter — who / what / when / where / how',
            howResult === 'blocked' ? 'deny' : 'active',
            null,
            `MCP audit: ${whoUser} called ${whatTool} → ${howResult} (also written to audit/mcp.audit.json)`,
            {
              mcpAudit: a,
              who: a.who,
              what: a.what,
              when: a.when,
              where: a.where,
              how: a.how,
              eventName: a.eventName || 'PING-GATEWAY-MCP',
            }
          ));
        }
        if (gwAuditTrail.mtls) {
          const mt = gwAuditTrail.mtls;
          tokenEvents.push(buildTokenEvent('gw-mtls', 'Gateway → MCP Server mTLS', mt.enabled ? 'active' : 'skipped', null,
            mt.enabled ? `Gateway → MCP server mTLS verified. Client cert: ${mt.subject || 'banking-mcp-gateway'}` : 'mTLS not enforced (MCP_MTLS_ENABLED=false).',
            { mtlsEnabled: mt.enabled, subject: mt.subject }));
        }
      }

      // MCP Gateway route — which upstream the gateway forwarded the request to
      const gwRoute = gwAuditTrail?.route || null;
      tokenEvents.push(buildTokenEvent(
        'mcp-gateway-route',
        `MCP Gateway → ${gwRoute?.upstream || (gatewayHttpUrl ? 'MCP Server' : 'Direct')}`,
        gwRoute?.status || (gatewayHttpUrl ? 'active' : 'skipped'),
        null,
        gatewayHttpUrl
          ? `Gateway routed tool "${toolName}" to upstream MCP server${gwRoute?.upstream ? ` at ${gwRoute.upstream}` : ''}${gwRoute?.path ? ` (${gwRoute.path})` : ''}. Gateway enforces token audience, introspection, and authorization before forwarding.`
          : `No MCP Gateway configured — tool "${toolName}" dispatched directly via WebSocket to MCP server.`,
        {
          toolName,
          routedVia,
          gatewayUrl: gatewayHttpUrl || null,
          upstream: gwRoute?.upstream || null,
          path: gwRoute?.path || null,
          durationMs: _toolDuration,
        }
      ));

      // Step 9 token event — shown when the MCP server is configured to exchange the
      // gateway token for a BFF-audience token before calling banking data endpoints.
      // mcp_step9_resource_uri mirrors BANKING_API_RESOURCE_URI on the MCP server.
      const step9Aud = configStore.getEffective('mcp_step9_resource_uri') || process.env.MCP_STEP9_RESOURCE_URI || '';
      if (step9Aud && !result?.isError) {
        tokenEvents.push(buildTokenEvent(
          'mcp-step9-exchange',
          'MCP Step 9 — Banking API Token',
          'exchanged',
          null,
          `MCP server exchanged the gateway token (aud=${configStore.getEffective('pingone_resource_mcp_gateway_uri') || 'mcpgateway.ping.demo'}) ` +
            `for a Banking API token (aud=${step9Aud}) via RFC 8693 before calling /api/accounts and /api/transactions endpoints.`,
          { rfc: 'RFC 8693', exchangeStep: 'step9', audience: step9Aud, source: 'agent-step9-exchange' }
        ));
      }

      // Resource server reply — safe summary of what the MCP server returned
      // (counts and status only; no account numbers, balances, or user data).
      const _isError = result?.isError ?? false;
      const _resultStatus = _isError ? 'error' : 'success';
      const _resultText = result?.content?.[0]?.type === 'text' ? result.content[0].text : null;
      let _resultObj = null;
      if (_resultText) {
        try { _resultObj = JSON.parse(_resultText); } catch (_) {}
      } else if (result && typeof result === 'object' && !result.content) {
        _resultObj = result;
      }
      const _resultSummary = _buildResultSummary(toolName, _resultObj, _isError);
      tokenEvents.push(buildTokenEvent(
        'resource-server-reply',
        `Resource Server Reply: ${toolName}`,
        _isError ? 'failed' : 'success',
        null,
        _isError
          ? `MCP server returned an error for tool "${toolName}": ${_resultObj?.message || _resultObj?.error || 'tool call failed'}.`
          : `MCP server replied to "${toolName}" in ${_toolDuration}ms. ${_resultSummary}`,
        {
          toolName,
          durationMs: _toolDuration,
          resultStatus: _resultStatus,
          resultSummary: _resultSummary,
          routedVia,
        }
      ));

      // MCP tool execution result (kept for backward compat — summarises the full round-trip)
      tokenEvents.push(buildTokenEvent(
        'mcp-tool-result',
        `Tool Complete: ${toolName}`,
        _isError ? 'failed' : 'success',
        null,
        _isError
          ? `Tool "${toolName}" failed after ${_toolDuration}ms.`
          : `Tool "${toolName}" completed in ${_toolDuration}ms on behalf of user ${userId}.`,
        { toolName, durationMs: _toolDuration, resultStatus: _resultStatus, actor: 'agent', onBehalfOf: userId }
      ));
      console.log('[MCP_TOOL] Added gateway audit + tool_call events');
    }

    // Unified token-chain trace — one ═══ block per call (no-op unless file
    // logging is on). The failure path emits the same block from the catch so a
    // gateway-PERMIT-then-forward-401 break is readable at a glance.
    emitTrace({ result });

    // Extract text content from MCP response format
    if (result?.content?.[0]?.type === 'text') {
      console.log('[MCP_TOOL] Returning text content from result');
      return result.content[0].text;
    }

    console.log('[MCP_TOOL] Returning result as-is');
    return result;
  } catch (error) {
    // Gateway HITL obligation: PingAuthorize required human approval and the
    // gateway returned -32002 with data { hitl:true, challengeId, challenge_type }.
    // This is NOT a failure — translate it into a structured hitl_required /
    // step_up_required result so the caller (mcpToolPipeline / dispatchVerticalIntent)
    // surfaces the AgentConsentModal instead of a tool error. challenge_type
    // 'step_up' → step_up_required; 'consent' (default) → hitl_required.
    if (error && error.hitl && error.rpcData) {
      const d = error.rpcData;
      const isStepUp = d.challenge_type === 'step_up';
      if (tokenEvents) {
        tokenEvents.push(buildTokenEvent(
          'tool-hitl',
          isStepUp ? 'Gateway — Step-up Required' : 'Gateway — Human Approval Required',
          'indeterminate',
          null,
          isStepUp
            ? 'PingOne Authorize returned INDETERMINATE — step-up MFA is required before this tool call can proceed.'
            : 'PingOne Authorize returned INDETERMINATE — human consent is required before this tool call can proceed.',
          { toolName, challengeId: d.challengeId || null, challengeType: d.challenge_type || 'consent', actor: 'agent' }
        ));
      }
      emitTrace({
        result: {
          isError: false,
          hitl: true,
          challenge_type: d.challenge_type || 'consent',
          detail: isStepUp ? 'step_up_required' : 'hitl_required',
        },
      });
      return JSON.stringify({
        error: isStepUp ? 'step_up_required' : 'hitl_required',
        hitl: { type: isStepUp ? 'step_up' : 'consent' },
        hitlChallengeId: d.challengeId || null,
        challenge_type: d.challenge_type || 'consent',
        message: d.instructions || (isStepUp
          ? 'This action requires step-up verification.'
          : 'This action requires your approval.'),
      });
    }

    console.error('[MCP_TOOL] ERROR: MCP tool call failed');
    console.error('[MCP_TOOL] Error name:', error.name);
    console.error('[MCP_TOOL] Error message:', error.message);
    console.error('[MCP_TOOL] Error stack:', error.stack);

    if (tokenEvents) {
      tokenEvents.push(buildTokenEvent(
        'tool-error',
        `Tool Error: ${toolName}`,
        'failed',
        null,
        `MCP tool "${toolName}" failed: ${error.message}`,
        { toolName, error: error.message, actor: 'agent' }
      ));
      console.log('[MCP_TOOL] Added tool_error event');
    }

    // Failure trace — captures the breaking hop (e.g. gateway PERMIT then a
    // forward 401 "Invalid or expired token" = the MCP server rejected the
    // forwarded aud). gwAuditTrail is null here when the gateway itself threw.
    emitTrace({ error });
    throw error;
  }
}

/**
 * Call an MCP tool via the BFF /api/mcp/tool endpoint
 * This endpoint handles token exchange before calling the MCP server
 * Used by external callers (browser, inspector) that have session cookies
 */
/**
 * Call an MCP tool via the BFF /api/mcp/tool endpoint.
 * Automatically attempts RFC 8693 scope upgrade on mcp_scope_denied (403) — retries once.
 * Used by external callers (browser, inspector) that have session cookies.
 */
async function callMcpTool(toolName, params, agentToken, userId, tokenEvents = [], _scopeUpgradeAttempted = false) {
  try {
    const mcpEndpoint = process.env.MCP_TOOL_ENDPOINT || 'https://api.ping.demo:3001/api/mcp/tool';

    const response = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(agentToken && { 'Authorization': `Bearer ${agentToken}` }),
        ...(userId && { 'X-User-Id': userId }),
      },
      body: JSON.stringify({ tool: toolName, params }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Scope upgrade: intercept mcp_scope_denied — RFC 8693 token exchange + single retry
      if (
        response.status === 403 &&
        data && data.error === 'mcp_scope_denied' &&
        !_scopeUpgradeAttempted &&
        agentToken
      ) {
        const audience = process.env.MCP_SERVER_RESOURCE_URI;
        const requestedScopes = [
          ...(data.availableScopes || []),
          ...(data.missingScopes || []),
        ];
        if (tokenEvents) {
          tokenEvents.push(buildTokenEvent(
            'scope-upgrade',
            `Scope Upgrade: ${toolName}`,
            'acquiring',
            null,
            `Token scope insufficient for "${toolName}" — attempting RFC 8693 exchange for missing scopes: ${(data.missingScopes || []).join(', ')}.`,
            { toolName, missingScopes: data.missingScopes || [], requestedScopes, audience, actor: 'agent' }
          ));
        }
        let upgradedToken;
        try {
          const exchangeResult = await oauthService.performTokenExchange(agentToken, audience, requestedScopes);
          upgradedToken = exchangeResult.access_token;
        } catch (exchangeError) {
          if (tokenEvents) {
            tokenEvents.push(buildTokenEvent(
              'scope-upgrade-failed',
              `Scope Upgrade Failed: ${toolName}`,
              'failed',
              null,
              `Scope upgrade failed for "${toolName}": ${exchangeError.message}`,
              { toolName, missingScopes: data.missingScopes || [], error: exchangeError.message, actor: 'agent' }
            ));
          }
          throw new Error('Insufficient scope and upgrade failed (missing: ' + (data.missingScopes || []).join(', ') + '): ' + exchangeError.message);
        }
        // Retry exactly once with upgraded token — share the same events array so the
        // upgrade and result appear as a continuous chain, not two separate lists.
        return callMcpTool(toolName, params, upgradedToken, userId, [...tokenEvents], true);
      }

      // HTTP 428 Precondition Required: step-up MFA or HITL consent — not a tool
      // failure, but a valid authorization precondition. Return the response so the
      // caller can prompt the user for MFA / consent.
      if (response.status === 428 && data && (data.error === 'mcp_step_up_required' || data.error === 'hitl_required')) {
        if (tokenEvents) {
          tokenEvents.push(buildTokenEvent(
            'tool-call-precondition-required',
            `Authorization Precondition: ${toolName}`,
            'indeterminate',
            null,
            `"${toolName}" requires ${data.error === 'mcp_step_up_required' ? 'step-up authentication' : 'human approval'} (HTTP 428).`,
            { toolName, statusCode: response.status, precondition: data.error, actor: 'agent' }
          ));
        }
        return data;
      }

      if (tokenEvents) {
        tokenEvents.push(buildTokenEvent(
          'tool-call-failed',
          `Tool Failed: ${toolName}`,
          'failed',
          null,
          `"${toolName}" returned HTTP ${response.status}: ${data.error || response.statusText}`,
          { toolName, statusCode: response.status, actor: 'agent', onBehalfOf: userId }
        ));
      }
      if (response.status === 401) throw new Error('Unauthorized: agent token may have expired');
      throw new Error(data.error || 'MCP tool failed: ' + response.statusText);
    }

    if (tokenEvents) {
      tokenEvents.push(buildTokenEvent(
        'tool-call-success',
        `Tool Succeeded: ${toolName}`,
        'success',
        null,
        `"${toolName}" completed successfully (HTTP ${response.status}).`,
        { toolName, statusCode: response.status, actor: 'agent', onBehalfOf: userId }
      ));
    }
    return data.result || data;
  } catch (error) {
    if (tokenEvents) {
      tokenEvents.push(buildTokenEvent(
        'tool-error',
        `Tool Error: ${toolName}`,
        'failed',
        null,
        `MCP tool "${toolName}" failed: ${error.message}`,
        { toolName, error: error.message, actor: 'agent' }
      ));
    }
    throw error;
  }
}


/**
 * Helper to extract auth context from LangChain config
 */
function getAgentContext(config) {
  return config?.configurable?.agentContext ?? {};
}

/**
 * Initialize tool registry with all available MCP tools
 * Returns array of LangChain tools ready for agent use
 * All tools receive auth via config.configurable.agentContext
 */
function createMcpToolRegistry() {
  return [
    // ─── Banking tools ───

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('get_my_accounts', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'get_my_accounts',
        description: 'Retrieve list of all user accounts with balances and details. This tool requires NO parameters - it automatically uses the authenticated user session. Call this directly when the user asks to "show my accounts", "see my accounts", "what accounts do I have", "check my balance", or "view account information". Do NOT ask for account details or username.',
        schema: z.object({}),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('get_account_balance', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'get_account_balance',
        description: 'Get balance for a specific account. Requires account_id (UUID from get_my_accounts response). Call when user asks about a specific account balance.',
        schema: z.object({
          account_id: z.string().min(1).describe('Account ID (UUID) from get_my_accounts response'),
        }),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('get_my_transactions', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'get_my_transactions',
        description: 'Retrieve user transaction history. Optionally limit the number of results. Call when user asks about recent activity, spending, or transaction history.',
        schema: z.object({
          limit: z.number().int().min(1).optional().describe('Max transactions to return'),
        }),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('get_sensitive_account_details', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'get_sensitive_account_details',
        description: 'Retrieve sensitive account details (full account number and routing number). Requires user consent — only call when the user has explicitly requested this sensitive information.',
        schema: z.object({}),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('get_weather', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'get_weather',
        description: 'Get current weather for a city. Call when the user asks about weather or conditions in a city — always attempt the call and let the result speak for itself, do not pre-judge whether a location is supported.',
        schema: z.object({
          city_name: z.string().min(1).describe('City name, e.g. "Austin" or "Austin, TX"'),
        }),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('create_transfer', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'create_transfer',
        description: 'Transfer money from one account to another. Requires user confirmation for amounts over $500. Call this when the user wants to send money between accounts.',
        schema: z.object({
          from_account_id: z.string().describe('Source account ID'),
          to_account_id: z.string().describe('Destination account ID'),
          amount: z.number().positive().describe('Amount in USD to transfer'),
          description: z.string().optional().describe('Optional transfer description'),
        }),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('create_deposit', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'create_deposit',
        description: 'Deposit funds into a bank account. Requires user confirmation for amounts over $500. Call this when the user wants to deposit money.',
        schema: z.object({
          to_account_id: z.string().describe('Target account ID'),
          amount: z.number().positive().describe('Deposit amount in USD'),
          description: z.string().optional().describe('Optional deposit description'),
        }),
      }
    ),

    tool(
      async (input, config) => {
        const { agentToken, userId, tokenEvents = [] } = getAgentContext(config);
        const result = await callMcpToolInternal('create_withdrawal', input, agentToken, userId, tokenEvents);
        return JSON.stringify(result);
      },
      {
        name: 'create_withdrawal',
        description: 'Withdraw funds from a bank account. Requires user confirmation for amounts over $500. Call this when the user wants to withdraw money.',
        schema: z.object({
          from_account_id: z.string().describe('Source account ID'),
          amount: z.number().positive().describe('Withdrawal amount in USD'),
          description: z.string().optional().describe('Optional withdrawal description'),
        }),
      }
    ),

    // ─── 3 new tools ───

    tool(
      async ({ topic }) => {
        return explainTopic(topic);
      },
      {
        name: 'explain_topic',
        description: 'Explain an OAuth, identity, or AI agent concept. Use for questions about login flows, token exchange, MCP protocol, HITL, LangChain, PingOne, or other demo concepts. Includes educational content about security patterns.',
        schema: z.object({
          topic: z.string().describe('Topic to explain. Examples: "login-flow", "token-exchange", "may-act", "langchain", "mcp-protocol", "introspection", "step-up", "human-in-loop", "agent-gateway", "pingone-authorize", "cimd"'),
        }),
      }
    ),

    tool(
      async ({ query }) => {
        try {
          const result = await braveSearchService.search(query, { count: 5 });
          if (!result.results?.length) return 'No search results found.';
          return result.results
            .map((r) => `**${r.title}**\n${r.description}\n${r.url}`)
            .join('\n\n');
        } catch (err) {
          if (err.code === 'BRAVE_NOT_CONFIGURED') {
            return 'Web search is not configured. Set BRAVE_SEARCH_API_KEY in the server environment.';
          }
          throw err;
        }
      },
      {
        name: 'brave_search',
        description: 'Search the web for current information. Use when the user asks about recent news, external documentation, or topics not covered by banking tools or education content.',
        schema: z.object({
          query: z.string().describe('Search query string'),
        }),
      }
    ),

    tool(
      async ({ username }, config) => {
        const { agentToken, userId } = getAgentContext(config);
        try {
          // Call BFF login activity endpoint
          const endpoint = process.env.MCP_TOOL_ENDPOINT
            ? new URL('/api/auth/activity/by-username', process.env.MCP_TOOL_ENDPOINT).href
            : 'https://api.ping.demo:3001/api/auth/activity/by-username';
          const res = await fetch(`${endpoint}?username=${encodeURIComponent(username)}`, {
            headers: {
              ...(agentToken && { Authorization: `Bearer ${agentToken}` }),
              ...(userId && { 'X-User-Id': userId }),
            },
          });
          if (!res.ok) {
            return `Unable to fetch login activity for "${username}" (HTTP ${res.status}).`;
          }
          const data = await res.json();
          const logs = data.logs?.slice(0, 5) ?? [];
          if (!logs.length) return `No login activity found for "${username}".`;
          return logs
            .map(
              (l) =>
                `- ${new Date(l.timestamp).toLocaleString()}: ${l.endpoint || '/auth'} from ${l.ipAddress || 'unknown IP'}`
            )
            .join('\n');
        } catch (err) {
          return `Could not retrieve login activity: ${err.message}`;
        }
      },
      {
        name: 'get_login_activity',
        description: 'Look up recent login activity for a specific username or email. Returns timestamps, endpoints, and IP addresses of recent logins. Useful for security audits.',
        schema: z.object({
          username: z.string().describe('The username or email address to look up'),
        }),
      }
    ),
  ];
}

module.exports = { callMcpTool, callMcpToolInternal, createMcpToolRegistry };
