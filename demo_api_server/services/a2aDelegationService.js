'use strict';

/**
 * Agent-to-Agent (A2A) specialist delegation — chained RFC 8693 token exchange.
 *
 * Scenario: the generalist banking assistant (Agent 1 = the existing "AI Agent" app)
 * delegates an investment sub-task to a narrower specialist (Agent 2 = the
 * "Investment Advisor" app). The delegation is expressed as a NESTED `act` chain
 * minted by PingOne across two exchanges:
 *
 *   Exchange #1:  subject = user access token
 *                 actor   = Agent 1 (AI Agent) client-credentials token
 *                 → T_agent1  { sub: user, act: { sub: agent1 }, aud: a2a-intermediate }
 *
 *   Exchange #2:  subject = T_agent1   (already carries act:{agent1})
 *                 actor   = Agent 2 (Investment Advisor) client-credentials token
 *                 → T_invest  { sub: user, act: { sub: agent2, act: { sub: agent1 } },
 *                               aud: <gateway/invest>, scope: invest:read }
 *
 * Design notes:
 *  - `may_act` IS used (unlike the header comment used to say) — it's what makes
 *    PingOne emit a native `act` claim at all (see docs/ACT_CLAIM_VERIFICATION.md).
 *    Each specialist gets its OWN A2A Intermediate resource/audience with a literal
 *    `may_act = {sub: <that specialist's client id>}` (pingoneProvisionService.js
 *    Step 37a-A2A) — RFC 8707 resource indicators: a single audience shared across
 *    all 9 specialists would let one specialist's token be replayed toward another's
 *    exchange. Whether the delegation is *allowed* (beyond act-claim mechanics) is
 *    still a separate policy decision made by PingOne Authorize over the `act` chain
 *    at tool-call time (see authorize-pipeline / Slice 2) — deliberately separate
 *    from the legacy `ff_require_may_act` gate, which is why A2A lives in its own
 *    service rather than resolveMcpAccessTokenWithEvents().
 *  - Least-privilege: Agent 2 is granted ONLY `invest:read`, so T_invest cannot
 *    read checking accounts or move money — provable at the gateway/Authorize gate.
 *  - Gated behind ff_a2a_delegation; additive and isolated from the single- and
 *    two-exchange paths in agentMcpTokenService.js.
 *
 * The two exchange steps are dependency-injectable (opts.deps) so the chain can be
 * unit-tested without a live PingOne tenant.
 */

// tokenUtils is dependency-free (Buffer/base64 only) — safe to require eagerly.
const { decodeJwt } = require('../utils/tokenUtils');
const {
  specialistForVertical,
  clientIdKey,
  clientSecretKey,
  intermediateAudienceKey,
} = require('../config/a2aSpecialists');

// Heavy runtime deps (oauthService→axios, configStore→lmdb, mcpWebSocketClient→ws)
// are lazy-required so unit tests can inject lightweight fakes without installing them.
function defaultConfigStore() {
  return require('./configStore');
}
function defaultOauthService() {
  return require('./oauthService');
}
function defaultSessionBearer() {
  return require('./mcpWebSocketClient').getSessionBearerForMcp;
}
function defaultScopeTopology() {
  return require('./scopeTopology');
}

/**
 * Derive the specialist's requested scopes from the SoT (scope-topology.json).
 * Prefers `a2aDelegatedScope` when present (a specialist-only scope that avoids
 * PingOne's scope-name uniqueness constraint across grants), falling back to
 * `requiredScopes` for each tool. scope-topology is the single SoT; we never
 * re-declare scopes here.
 */
function deriveSpecialistScopes(specialist, scopeTopo) {
  const topo = scopeTopo || defaultScopeTopology();
  const set = new Set();
  for (const tool of specialist.tools || []) {
    const delegatedScope = topo.a2aDelegatedScope ? topo.a2aDelegatedScope(tool) : null;
    if (delegatedScope) {
      set.add(delegatedScope);
    } else {
      for (const s of topo.toolScopes(tool) || []) set.add(s);
    }
  }
  return [...set];
}

/** A2A is enabled only when the feature flag is on. */
function isA2aEnabled(cfg) {
  const store = cfg || defaultConfigStore();
  const v = store.getEffective('ff_a2a_delegation');
  return v === true || v === 'true';
}

/**
 * Build a token-chain event row in the same shape the UI (TokenChainDisplay) and
 * the report formatter consume: { id, label, status, claims:{...act...}, ... }.
 * Raw token strings are never included — only the decoded claims (intentional for
 * this teaching demo; see feedback_tokens_visible_teaching).
 */
function buildA2aEvent(id, label, status, token, explanation, extra = {}) {
  const decoded = token ? decodeJwt(token) : null;
  return {
    id,
    label,
    status,
    timestamp: new Date().toISOString(),
    alg: decoded?.header?.alg || null,
    claims: decoded?.claims || null,
    explanation,
    ...extra,
  };
}

/**
 * Resolve A2A audiences/scopes/credentials for a given vertical's specialist.
 * @param {object} cfgArg      configStore (or injected fake)
 * @param {object} specialist  registry entry from a2aSpecialists (vertical-specific)
 */
function resolveA2aConfig(cfgArg, specialist) {
  const cfg = cfgArg || defaultConfigStore();

  // Agent 1 = the generalist (existing AI Agent app) — same across all verticals.
  const agent1ClientId = cfg.getEffective('pingone_ai_agent_client_id');
  const agent1Secret = cfg.getEffective('pingone_ai_agent_client_secret');

  // Agent 2 = the per-vertical specialist; credentials keyed by appKey.
  const agent2ClientId = cfg.getEffective(clientIdKey(specialist.appKey));
  const agent2Secret = cfg.getEffective(clientSecretKey(specialist.appKey));

  // Exchange #1 result audience (intermediate) — THIS SPECIALIST'S OWN dedicated
  // resource (RFC 8707; pingoneProvisionService.js Step 37a-A2A provisions one per
  // appKey, each carrying its own may_act). Falls back to the legacy shared
  // key/agent-gateway audience for deployments that haven't been re-provisioned yet.
  const intermediateAud =
    cfg.getEffective(intermediateAudienceKey(specialist.appKey)) ||
    cfg.getEffective('a2a_intermediate_audience') ||
    cfg.getEffective('pingone_resource_a2a_intermediate_uri') ||
    cfg.getEffective('pingone_resource_agent_gateway_uri');

  // Exchange #2 result audience — the MCP gateway audience the specialist tools are
  // reached through (same audience the normal MCP path targets).
  const specialistAud =
    cfg.getEffective('pingone_resource_mcp_gateway_uri') ||
    cfg.getEffective('mcp_gw_resource_uri') ||
    cfg.getEffective('pingone_resource_mcp_server_uri');

  const intermediateScope = (cfg.getEffective('a2a_intermediate_scope') || 'agent:invoke').trim();

  // Agent 2 actor-token auth method (PingOne app token-endpoint auth). 'post' by
  // default to match the AI Agent actor convention.
  const agent2AuthMethod = (
    cfg.getEffective(`pingone_${specialist.appKey}_agent_cc_auth_method`) ||
    process.env[`PINGONE_A2A_${specialist.appKey.toUpperCase()}_AGENT_CC_AUTH_METHOD`] ||
    'post'
  ).toLowerCase();
  const exchangeAuthMethod = (
    cfg.getEffective(`pingone_${specialist.appKey}_agent_exchange_auth_method`) ||
    process.env[`PINGONE_A2A_${specialist.appKey.toUpperCase()}_AGENT_EXCHANGE_AUTH_METHOD`] ||
    'post'
  ).toLowerCase();

  return {
    agent1ClientId,
    agent1Secret,
    agent2ClientId,
    agent2Secret,
    intermediateAud,
    specialistAud,
    intermediateScope,
    agent2AuthMethod,
    exchangeAuthMethod,
  };
}

/**
 * Perform the chained RFC 8693 exchange that produces the nested act token,
 * for the active vertical's specialist (resolved from the per-vertical registry).
 *
 * @param {object}        req                Express request (session holds the user token)
 * @param {object}        opts
 * @param {string}        opts.vertical      Active vertical id (selects the specialist)
 * @param {string}        [opts.subtask]     Human description of the delegated sub-task
 * @param {string}        [opts.tool]        Specialist tool the run intends to call
 * @param {Array}         [opts.tokenEvents] Mutable event array to append to (shared chain)
 * @param {object}        [opts.deps]        Injected dependencies for testing
 * @returns {Promise<{ token: string|null, tokenEvents: Array, claims: object|null,
 *                      userSub: string|null, vertical: string, specialist: string,
 *                      agent1: string, agent2: string, scopes: string[],
 *                      actChainDepth: number, error?: string }>}
 */
async function delegateToSpecialist(req, opts = {}) {
  const deps = opts.deps || {};
  const oauth = deps.oauthService || defaultOauthService();
  const cfg = deps.configStore || defaultConfigStore();
  const sessionBearer = deps.getSessionBearerForMcp || defaultSessionBearer();
  const scopeTopo = deps.scopeTopology || defaultScopeTopology();

  const tokenEvents = opts.tokenEvents || [];
  const vertical = opts.vertical;

  const base = { token: null, tokenEvents, claims: null, userSub: null, vertical };

  if (!isA2aEnabled(cfg)) {
    return { ...base, error: 'A2A delegation is disabled (ff_a2a_delegation=false)' };
  }

  const specialist = specialistForVertical(vertical);
  if (!specialist) {
    return { ...base, error: `No A2A specialist configured for vertical "${vertical}"` };
  }

  const subtask = opts.subtask || specialist.subtaskHint;
  // Constrain the tool to the specialist's own allowlist. Via delegate_to_specialist
  // the LLM can name ANY tool (free-form arg); one the specialist is not provisioned
  // for would otherwise flow through and fail downstream as a confusing Authorize
  // DENY (the delegated token lacks that tool's scope). Reject it here with a clear,
  // actionable message instead so the agent can tell the user what the specialist
  // actually does.
  const allowedTools = specialist.tools || [];
  const requestedTool = opts.tool || null;
  if (requestedTool && !allowedTools.includes(requestedTool)) {
    return {
      ...base,
      error:
        `The ${specialist.specialistName} can only run: ${allowedTools.join(', ') || '(none)'}. ` +
        `It is not authorized for "${requestedTool}".`,
    };
  }
  const tool = requestedTool || allowedTools[0] || null;
  // Scope is DERIVED from the SoT (scope-topology.json) — never re-declared here.
  const specialistScopes = deriveSpecialistScopes(specialist, scopeTopo);

  const c = resolveA2aConfig(cfg, specialist);
  if (!c.agent2ClientId || !c.agent2Secret) {
    return {
      ...base,
      error: `${specialist.specialistName} (Agent 2) credentials not configured — set PINGONE_A2A_${specialist.appKey.toUpperCase()}_AGENT_CLIENT_ID/SECRET`,
    };
  }
  if (!c.specialistAud) {
    return { ...base, error: 'A2A specialist audience not configured' };
  }

  const userToken = sessionBearer(req);
  if (!userToken) {
    return { ...base, error: 'No user token in session for A2A delegation' };
  }
  const userDecoded = decodeJwt(userToken);
  const userSub = userDecoded?.claims?.sub || null;

  try {
    // ── Exchange #1: user → Agent 1 delegated token (act:{agent1}) ───────────────
    const agent1Actor = await oauth.getAiAgentClientCredentialsToken();
    tokenEvents.push(buildA2aEvent(
      'a2a-agent1-actor',
      'A2A — Agent 1 (generalist) Actor Token · client_credentials',
      'acquired',
      agent1Actor,
      'The generalist agent authenticates as itself (RFC 6749 §4.4). This actor token names Agent 1 as the party acting on the user’s behalf in Exchange #1.',
      { a2aRole: 'agent1-actor', vertical },
    ));

    const tAgent1 = await oauth.performTokenExchangeAs(
      userToken,
      agent1Actor,
      c.agent1ClientId,
      c.agent1Secret,
      c.intermediateAud,
      [c.intermediateScope],
      c.exchangeAuthMethod,
    );
    const tAgent1Decoded = decodeJwt(tAgent1);
    tokenEvents.push(buildA2aEvent(
      'a2a-exchange1',
      'A2A Exchange #1 — User → Agent 1 delegated token (RFC 8693 §2.1)',
      'exchanged',
      tAgent1,
      'PingOne mints a delegated token: subject stays the user, act:{sub:agent1} records that Agent 1 is acting on their behalf. No may_act — the chain is the source of truth; whether the delegation is allowed is decided by Authorize.',
      { a2aRole: 'exchange1', actPresent: !!tAgent1Decoded?.claims?.act, a2aSubtask: subtask, vertical },
    ));

    // ── Exchange #2: Agent 1 token + Agent 2 (specialist) actor → nested act ─────
    // Agent 2's actor token targets the INTERMEDIATE audience (a2a-intermediate.ping.demo)
    // rather than the final specialist audience. PingOne enforces scope-name uniqueness
    // across all grants for a given app, so a specialist that already has `read` on
    // Demo API cannot also hold `read` on MCP Gateway. Using the intermediate audience
    // (where every specialist has `agent:invoke`) sidesteps this constraint while still
    // proving Agent 2's identity for the nested-act chain.
    const agent2Actor = await oauth.getClientCredentialsTokenAs(
      c.agent2ClientId,
      c.agent2Secret,
      c.intermediateAud,
      c.agent2AuthMethod,
      c.intermediateScope,
    );
    tokenEvents.push(buildA2aEvent(
      'a2a-agent2-actor',
      `A2A — ${specialist.specialistName} (Agent 2) Actor Token · client_credentials`,
      'acquired',
      agent2Actor,
      `The ${specialist.specialistName} authenticates as itself (scoped to the A2A intermediate resource) for ${tool || 'its tool'} only. Authorize is what approves the delegated call.`,
      { a2aRole: 'agent2-actor', vertical, specialist: specialist.specialistName },
    ));

    const tInvest = await oauth.performTokenExchangeAs(
      tAgent1,
      agent2Actor,
      c.agent2ClientId,
      c.agent2Secret,
      c.specialistAud,
      specialistScopes,
      c.exchangeAuthMethod,
    );
    const tInvestDecoded = decodeJwt(tInvest);
    const act = tInvestDecoded?.claims?.act || null;
    const actChainDepth = countActDepth(act);
    tokenEvents.push(buildA2aEvent(
      'a2a-exchange2',
      `A2A Exchange #2 — nested act {${specialist.specialistName} → generalist} (RFC 8693 §4.1)`,
      'exchanged',
      tInvest,
      'PingOne nests the actor chain: act:{sub:agent2, act:{sub:agent1}}, subject still the user. The resource server now sees the FULL agent chain that acted on the user’s behalf — auditable end to end — while the token stays bound to the user. PingOne Authorize then decides PERMIT/DENY over this chain.',
      {
        a2aRole: 'exchange2',
        actPresent: !!act,
        actChainDepth,
        a2aTool: tool,
        scope: specialistScopes.join(' '),
        vertical,
        specialist: specialist.specialistName,
      },
    ));

    return {
      token: tInvest,
      tokenEvents,
      claims: tInvestDecoded?.claims || null,
      userSub,
      vertical,
      specialist: specialist.specialistName,
      tool,
      agent1: c.agent1ClientId,
      agent2: c.agent2ClientId,
      scopes: specialistScopes,
      actChainDepth,
    };
  } catch (err) {
    tokenEvents.push(buildA2aEvent(
      'a2a-exchange-failed',
      'A2A delegation failed',
      'failed',
      null,
      `Chained RFC 8693 exchange failed: ${err.message}`,
      { a2aRole: 'error', error: err.message, httpStatus: err.httpStatus || null },
    ));
    return { token: null, tokenEvents, claims: null, userSub, error: err.message };
  }
}

/** Count nesting depth of an act chain: act:{agent2, act:{agent1}} → 2. */
function countActDepth(act) {
  let depth = 0;
  let node = act;
  while (node && (node.sub || node.client_id)) {
    depth += 1;
    node = node.act;
  }
  return depth;
}

module.exports = {
  isA2aEnabled,
  resolveA2aConfig,
  delegateToSpecialist,
  // exported for unit tests
  buildA2aEvent,
  countActDepth,
};
