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
 *  - `ff_require_act_for_agent_tools` pre-flight gate is the act-based replacement
 *    for the removed may_act-based checks. Authorization now keys on the `act`
 *    chain end to end.
 *  - Least-privilege: Agent 2 is granted ONLY `invest:read`, so T_invest cannot
 *    read checking accounts or move money — provable at the gateway/Authorize gate.
 *  - Always on (the a2aDelegated tools have no non-delegated path); additive and
 *    isolated from the single- and two-exchange paths in agentMcpTokenService.js.
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
  intermediateResourceName,
  A2A_GATEWAY_RESOURCE_NAME,
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
function defaultAxios() {
  return require('axios');
}

function authzEndpoint() {
  return process.env.PINGAUTHORIZE_ENDPOINT || 'http://localhost:9001';
}
function authzWorkerId() {
  return process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';
}

/**
 * Deliberately unregistered — any registered PingOne client id would make this
 * a real (not simulated) mismatch, defeating the point of the probe.
 */
const MISMATCH_NESTED_ACT_CLIENT_ID = 'unregistered-simulated-agent';

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
 * Non-empty trimmed config value, or null.
 * @param {unknown} v
 * @returns {string|null}
 */
function nonempty(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Resolve A2A audiences/scopes/credentials for a given vertical's specialist.
 *
 * Audience precedence (Exchange #1 intermediate):
 *   1. config `a2a_intermediate_audience_<appKey>` (env / LMDB)
 *   2. scope-topology.json per-specialist resource URI
 *   3. legacy shared intermediate / agent-gateway — ONLY when topology has no
 *      per-specialist resource (pre-37a-A2A deployments)
 *
 * Audience precedence (Exchange #2 specialist/gateway):
 *   1. config `a2a_gateway_audience`
 *   2. scope-topology.json "Super Banking A2A MCP Gateway"
 *   3. legacy shared mcp gateway / mcp server URI
 *
 * When topology lists a dedicated A2A resource, we never fall back to the
 * shared intermediate/gateway — that combination caused PingOne invalid_scope
 * (agent:invoke:<appKey> is not on the shared a2a-intermediate resource).
 *
 * @param {object}        cfgArg       configStore (or injected fake)
 * @param {object}        specialist   registry entry from a2aSpecialists
 * @param {object}        [scopeTopo]  scopeTopology module (or injected fake)
 */
function resolveA2aConfig(cfgArg, specialist, scopeTopo) {
  const cfg = cfgArg || defaultConfigStore();
  const topo = scopeTopo || defaultScopeTopology();

  // Agent 1 = the generalist (existing AI Agent app) — same across all verticals.
  const agent1ClientId = cfg.getEffective('pingone_ai_agent_client_id');
  const agent1Secret = cfg.getEffective('pingone_ai_agent_client_secret');

  // Agent 2 = the per-vertical specialist; credentials keyed by appKey.
  const agent2ClientId = cfg.getEffective(clientIdKey(specialist.appKey));
  const agent2Secret = cfg.getEffective(clientSecretKey(specialist.appKey));

  const topoIntermediateName = intermediateResourceName(specialist);
  const topoIntermediateUri = topoIntermediateName && typeof topo.resourceUri === 'function'
    ? nonempty(topo.resourceUri(topoIntermediateName))
    : null;
  const topoA2aGatewayUri = typeof topo.resourceUri === 'function'
    ? nonempty(topo.resourceUri(A2A_GATEWAY_RESOURCE_NAME))
    : null;

  // Exchange #1 — prefer per-specialist config, then topology, then legacy shared.
  // When topology has a per-specialist URI, the `||` chain never reaches shared
  // a2a-intermediate / agent-gateway (those lack agent:invoke:<appKey>).
  const intermediateAud =
    nonempty(cfg.getEffective(intermediateAudienceKey(specialist.appKey))) ||
    topoIntermediateUri ||
    nonempty(cfg.getEffective('a2a_intermediate_audience')) ||
    nonempty(cfg.getEffective('pingone_resource_a2a_intermediate_uri')) ||
    nonempty(cfg.getEffective('pingone_resource_agent_gateway_uri'));

  // Exchange #2 — prefer dedicated A2A gateway audience over shared mcpgateway.
  const specialistAud =
    nonempty(cfg.getEffective('a2a_gateway_audience')) ||
    topoA2aGatewayUri ||
    nonempty(cfg.getEffective('pingone_resource_mcp_gateway_uri')) ||
    nonempty(cfg.getEffective('mcp_gw_resource_uri')) ||
    nonempty(cfg.getEffective('pingone_resource_mcp_server_uri'));

  // Scope name is unique per specialist ("agent:invoke:<appKey>"), NOT overridable
  // via a shared config key — PingOne enforces one scope-name per client across ALL
  // its grants, and Agent 1 holds a grant on every specialist's intermediate
  // resource. A shared name collides silently (confirmed live: the exchanged token
  // comes back audienced to whichever resource that name first bound to, ignoring
  // the requested audience). See pingoneProvisionService.js Step 37a-A2A.
  const intermediateScope = `agent:invoke:${specialist.appKey}`;

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

  const c = resolveA2aConfig(cfg, specialist, scopeTopo);
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
  // The A2A evidence contract starts with the authenticated subject. The
  // exchange events below prove each agent hop, but without this marker the
  // verifier correctly treats an otherwise successful machine-token chain as
  // missing user delegation.
  tokenEvents.push(buildA2aEvent(
    'user-token',
    'Authenticated user token · A2A subject',
    'active',
    userToken,
    'The signed-in user token is the subject presented to Exchange #1; subsequent actor and exchange events must preserve this user identity.',
    { a2aRole: 'user-subject', vertical, userSub },
  ));

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

    const tAgent1 = await Promise.race([
      oauth.performTokenExchangeAs(
        userToken,
        agent1Actor,
        c.agent1ClientId,
        c.agent1Secret,
        c.intermediateAud,
        [c.intermediateScope],
        c.exchangeAuthMethod,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('A2A Exchange #1 timed out (30s)')), 30000)),
    ]);
    const tAgent1Decoded = decodeJwt(tAgent1);
    tokenEvents.push(buildA2aEvent(
      'a2a-exchange1',
      'A2A Exchange #1 — User → Agent 1 delegated token (RFC 8693 §2.1)',
      'exchanged',
      tAgent1,
      'PingOne mints a delegated token: subject stays the user, act:{sub:agent1} records that Agent 1 is acting on their behalf. No may_act — the chain is the source of truth; whether the delegation is allowed is decided by Authorize.',
      {
        a2aRole: 'exchange1',
        actPresent: !!tAgent1Decoded?.claims?.act,
        a2aSubtask: subtask,
        vertical,
        exchangeRequest: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: c.intermediateAud,
          scope: c.intermediateScope,
          has_actor_token: true,
          exchanger_client_id: c.agent1ClientId,
        },
      },
    ));

    // ── Exchange #2: Agent 1 token + Agent 2 (specialist) actor → nested act ─────
    // Agent 2's actor token targets its OWN intermediate audience (not the final
    // specialist/gateway audience) using its uniquely-named invoke scope. PingOne
    // enforces scope-name uniqueness across all grants for a given app, so a
    // specialist that already has `read` on Demo API cannot also hold `read` on MCP
    // Gateway — using the (per-specialist) intermediate audience + scope sidesteps
    // this constraint while still proving Agent 2's identity for the nested-act chain.
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

    const tInvest = await Promise.race([
      oauth.performTokenExchangeAs(
        tAgent1,
        agent2Actor,
        c.agent2ClientId,
        c.agent2Secret,
        c.specialistAud,
        specialistScopes,
        c.exchangeAuthMethod,
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('A2A Exchange #2 timed out (30s)')), 30000)),
    ]);
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
        exchangeRequest: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: c.specialistAud,
          scope: specialistScopes.join(' '),
          has_actor_token: true,
          exchanger_client_id: c.agent2ClientId,
        },
      },
    ));

    // Additive A2A *wire* hop (Agent Card + JSON-RPC) with a separate PingOne
    // bearer — does not replace nested-act MCP. Soft-fail so identity path wins.
    let protocolHandoff = null;
    if (opts.skipProtocolHandoff !== true) {
      try {
        const { sendA2aProtocolHandoff } = deps.sendA2aProtocolHandoff
          ? { sendA2aProtocolHandoff: deps.sendA2aProtocolHandoff }
          : require('./a2aProtocolClient');
        protocolHandoff = await sendA2aProtocolHandoff({
          vertical,
          subtask,
          tokenEvents,
          cfg,
          deps: { oauthService: oauth },
          baseUrl: opts.protocolBaseUrl,
        });
      } catch (protoErr) {
        tokenEvents.push(buildA2aEvent(
          'a2a-protocol-message',
          'A2A Protocol — SendMessage failed',
          'failed',
          null,
          `Wire hop threw (nested-act MCP path unchanged): ${protoErr.message}`,
          { a2aRole: 'protocol-message', vertical, error: protoErr.message },
        ));
      }
    }

    // Additive Verified Trust assertion — a signed credential alongside the
    // bearer chain, not instead of it. No DaVinci flow exists on this tenant
    // yet (verifiedTrustService throws NOT_CONFIGURED), so this is soft-fail
    // by design: any failure here must never affect tInvest/act above.
    let trustAssertion;
    const verifiedTrust = deps.verifiedTrustService || require('./verifiedTrustService');
    if (verifiedTrust.isEnabled()) {
      try {
        trustAssertion = await verifiedTrust.issueAgentTrustAssertion({
          agentId: c.agent2ClientId,
          actingForUserId: userSub,
          scope: specialistScopes.join(' '),
          chainId: `${userSub}:${specialist.appKey}:${Date.now()}`,
        });
        tokenEvents.push(buildA2aEvent(
          'verified-trust-issuance',
          'Verified Trust — signed agent assertion issued',
          'issued',
          null,
          `A signed SD-JWT credential was issued alongside the bearer chain, asserting ${specialist.specialistName} acts for the user — independently verifiable, portable across an org boundary.`,
          { a2aRole: 'verified-trust', vertical, specialist: specialist.specialistName, credentialId: trustAssertion.credentialId },
        ));
      } catch (vtErr) {
        tokenEvents.push(buildA2aEvent(
          'verified-trust-issuance',
          'Verified Trust — assertion not issued',
          'failed',
          null,
          `Bearer-token delegation unaffected: ${vtErr.message}`,
          { a2aRole: 'verified-trust', vertical, error: vtErr.message, code: vtErr.code || null },
        ));
      }
    }

    return {
      token: tInvest,
      tokenEvents,
      claims: tInvestDecoded?.claims || null,
      userSub,
      vertical,
      // The specialist's OWN vertical namespace (e.g. banking's Investment
      // Advisor is appKey 'investment') — distinct from `vertical` above,
      // which is the DELEGATING vertical. Needed to resolve the render
      // descriptor from the specialist's manifest, not the delegator's.
      specialistVertical: specialist.appKey,
      specialist: specialist.specialistName,
      tool,
      agent1: c.agent1ClientId,
      agent2: c.agent2ClientId,
      scopes: specialistScopes,
      actChainDepth,
      protocolHandoff,
      trustAssertion,
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

/**
 * Probe the same decision endpoint the gateway calls (POST .../decision) with a
 * fabricated, unregistered NestedActClientId — demonstrates the
 * invalid_a2a_generalist DENY (demo_authz_server/routes/decision.js:554-558)
 * without minting a real second agent identity. See docs/superpowers/specs/
 * 2026-08-11-delegation-chain-value-demo-design.md for why this is simulated
 * rather than a full live token mint.
 * @param {object} req - Express request (only req.session.user.id is read)
 * @param {object} opts - { vertical, tool, tokenEvents, deps }
 * @returns {Promise<{tokenEvents: object[], decision: string|null, reason: string|null, simulated: true, error?: string}>}
 */
async function probeGeneralistMismatch(req, opts = {}) {
  const deps = opts.deps || {};
  const cfg = deps.configStore || defaultConfigStore();
  const httpClient = deps.axios || defaultAxios();
  const scopeTopo = deps.scopeTopology || defaultScopeTopology();

  const tokenEvents = opts.tokenEvents || [];
  const vertical = opts.vertical;
  const base = { tokenEvents, decision: null, reason: null, simulated: true };

  const specialist = specialistForVertical(vertical);
  if (!specialist) {
    return { ...base, error: `No A2A specialist configured for vertical "${vertical}"` };
  }
  const tool = opts.tool || (specialist.tools || [])[0] || null;
  if (!tool) {
    return { ...base, error: `No specialist tool available for vertical "${vertical}"` };
  }

  const specialistScopes = deriveSpecialistScopes(specialist, scopeTopo);
  const c = resolveA2aConfig(cfg, specialist, scopeTopo);

  const parameters = {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    ToolName: tool,
    ClientId: req?.session?.user?.id || 'demo-user',
    ActClientId: c.agent2ClientId || '',
    TokenScopes: specialistScopes.join(' '),
    TokenAudience: c.specialistAud || 'mcpgateway.ping.demo',
    TransactionAmount: '',
    TransactionType: tool,
    ToAccountId: '',
    HitlApproved: '',
    ActChainDepth: '2',
    NestedActClientId: MISMATCH_NESTED_ACT_CLIENT_ID,
  };

  const decisionUrl = `${authzEndpoint()}/governance/pap/alpha/policy/${authzWorkerId()}/decision`;

  try {
    const response = await httpClient.post(
      decisionUrl,
      { parameters },
      { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
    );
    const decision = response.data?.decision || null;
    const reason = response.data?.reason || null;
    tokenEvents.push(buildA2aEvent(
      'a2a-mismatch-probe',
      `A2A — Simulated actor-mismatch probe (${specialist.specialistName})`,
      decision === 'DENY' ? 'denied' : 'evaluated',
      null,
      'A fabricated, unregistered NestedActClientId was sent directly to the same decision endpoint the ' +
      'gateway calls (not a full live token mint) — PingOne Authorize DENYs because the nested act.sub is ' +
      'not the registered generalist. This proves the policy evaluates the AGENT identity, not just the user.',
      { a2aRole: 'mismatch-probe', decision, reason, nestedActClientId: MISMATCH_NESTED_ACT_CLIENT_ID, simulated: true, vertical, specialist: specialist.specialistName },
    ));
    return { ...base, decision, reason };
  } catch (err) {
    return { ...base, error: err.message || 'mismatch_probe_failed' };
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
  resolveA2aConfig,
  delegateToSpecialist,
  probeGeneralistMismatch,
  // Exchange #2's requested scope. Exported so pingoneProvisionService (Step
  // 37a-A2A) grants the SAME scope the runtime asks for — a second, hand-rolled
  // derivation there once granted bare `read` while the runtime requested the
  // delegated scope, which a fresh bootstrap turns into invalid_scope.
  deriveSpecialistScopes,
  // exported for unit tests
  buildA2aEvent,
  countActDepth,
};
