'use strict';

/**
 * Readiness worker operations for `agent-chip` Demo Steps.
 *
 * A chip is run exactly as the UI runs it — POST /api/agent/invoke on the
 * lane's own BFF as the signed-in readiness identity — and the evidence the
 * runner validates is read from that response's token events. Every evidence
 * field is taken from something the run actually produced. A field the run
 * did not produce is left out, so the runner's contract check fails it; it is
 * never filled in from the catalog to make a row pass.
 */

const { outcomeFromAgentResponse } = require('./useCaseConformance');
const { USE_CASES } = require('../config/useCases');

// Readiness rows carry the catalog id (UC1); the BFF routes take the slug.
const slugFor = (caseRow) => USE_CASES.find((useCase) => useCase.id === caseRow?.id)?.useCaseId || null;

const INVOKE_PATH = '/api/agent/invoke';
const FLAG_ENABLE_PATH = '/api/demo-flags/enable';
const AGENT_SCOPE = 'agent:invoke';
const AGENT_STATE_PATH = '/api/agent-builder/state';
// UC38's flag: the route behind it refuses to delegate without an MFA acr.
const MFA_GATED_FLAG = 'ff_personal_agent_concierge';

const eventById = (events, id) => events.find((event) => event && event.id === id) || null;
const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]).filter(Boolean).map(String);

// A token belongs to the lane's provider only if its issuer is the exact
// issuer this lane was configured to expect.
function providerOf(issuer, { provider, expectedIssuer }) {
  return issuer && issuer === expectedIssuer ? provider : null;
}

/**
 * Map one /api/agent/invoke response onto the runner's evidence contract.
 * @returns {{ observed: string, evidence: object }}
 */
function evidenceFromAgentInvoke({ response, provider, expectedIssuer, authorization }) {
  const events = Array.isArray(response?.tokenEvents) ? response.tokenEvents : [];
  const lane = { provider, expectedIssuer };
  const userToken = eventById(events, 'user-token');
  const agentActor = eventById(events, 'two-ex-agent-actor');
  const exchange1 = eventById(events, 'two-ex-exchange1');
  const finalToken = eventById(events, 'two-ex-final-token');
  const gatewayAuthorize = eventById(events, 'gw-authorize');
  const audit = eventById(events, 'gw-mcp-audit')?.mcpAudit || null;
  const selectedTool = list(response?.toolsCalled)[0] || audit?.what?.tool || null;

  // PingOne Authorize answers a step-up or approval requirement as
  // INDETERMINATE plus an obligation; the BFF records its reading of that as
  // mcpAuthorizeEvaluation.outcome (STEP_UP, HITL_REQUIRED). That reading is
  // the decision the demo acts on, so it is the one reported. When the
  // gateway's Authorize filter holds the call it writes no audit event, so the
  // route and actors for a held call come from the challenge and the decision
  // request the BFF recorded.
  const evaluation = response?.mcpAuthorizeEvaluation?.outcome ? response.mcpAuthorizeEvaluation : null;
  const heldByAuthorize = !audit && gatewayAuthorize?.denyingFilter === 'P1AZDecision' && Boolean(evaluation);
  const challenge = events.find((event) => event?.type === 'mcp_challenge' && event.phase === 'tools/call');
  let challengedRoute = null;
  try { challengedRoute = challenge?.url ? new URL(challenge.url).pathname : null; } catch { /* left null */ }
  const decisionActors = [evaluation?.request?.parameters?.UserId, evaluation?.request?.parameters?.ActClientId].filter(Boolean);

  // The public path (progressive trust, UC24): the BFF reports the exchange
  // and Authorize as skipped and the tool as dispatched, with no user token.
  const publicCatalog = eventById(events, 'token-exchange')?.status === 'skipped'
    && eventById(events, 'authorize-decision')?.status === 'skipped'
    && eventById(events, 'tool-dispatched')?.status === 'success'
    && !userToken && !exchange1 && !finalToken;

  // The gateway's own policy filters (the weather route) audit the call
  // without naming the caller. The actors are then the ones on the tokens the
  // gateway was sent: the exchanged token's subject and the agent actor.
  const auditActors = [audit?.who?.userSub, audit?.who?.agentSub].filter(Boolean);
  const tokenActors = [finalToken?.claims?.sub, agentActor?.claims?.client_id].filter(Boolean);
  // Decided by the gateway alone: an audit verdict, and neither a gateway
  // Authorize event nor an Authorize reading from the BFF.
  const decidedByGatewayPolicy = Boolean(audit?.how?.decision) && !gatewayAuthorize && !evaluation;

  // Two completed RFC 8693 exchanges on access tokens, no ID-JAG hop.
  const standardExchange = exchange1?.status === 'exchanged' && finalToken?.status === 'exchanged'
    && !events.some((event) => /id-?jag/i.test(String(event?.id || '')));

  const evidence = {
    userSessionProvider: providerOf(userToken?.claims?.iss, lane),
    agentIdentityProvider: providerOf(agentActor?.claims?.iss, lane),
    tokenIssuer: providerOf(finalToken?.claims?.iss, lane),
    subject: finalToken?.claims?.sub || null,
    actorChain: auditActors.length ? auditActors : audit ? tokenActors : heldByAuthorize ? decisionActors : [],
    selectedTool,
    // Where each required scope was actually held: the user's own token when
    // it carries the scope, otherwise the first exchange that minted it.
    audiences: [...new Set((authorization?.requiredScopes?.length ? authorization.requiredScopes : [null]).flatMap((scope) => {
      const holds = (event) => scope === null || String(event?.claims?.scope || '').split(/\s+/).includes(scope);
      return list((holds(userToken) ? userToken : holds(exchange1) ? exchange1 : null)?.claims?.aud);
    }))],
    scopes: list(String(exchange1?.claims?.scope || '').split(/\s+/)).filter((scope) => scope !== AGENT_SCOPE),
    roleApplicability: { userLogin: Boolean(userToken), agentIdentity: Boolean(agentActor), tokenExchange: Boolean(standardExchange) },
  };
  if (standardExchange) {
    // Each exchanged token as issued: its subject, then the actors named in
    // its own nested `act` claim. Nothing is taken from the gateway's audit.
    evidence.exchangeHops = [exchange1, finalToken].map((hop) => {
      const actors = [];
      for (let act = hop.claims?.act; act?.sub; act = act.act) actors.push(act.sub);
      return { subject: hop.claims?.sub || null, actorChain: [hop.claims?.sub, ...actors].filter(Boolean) };
    });
    evidence.exchangeService = 'token-exchange';
    evidence.exchangeProvenance = `${provider}-standard`;
    // Actor-bound when the BFF verified a customer-owned workload agent and
    // used it, not the built-in agent, as the actor of the first exchange.
    evidence.exchangePath = eventById(events, 'personal-agent-lookup')?.status === 'active'
      ? 'actor-bound-standard-two-exchange'
      : 'standard-access-token';
    evidence.subjectTokenType = 'access_token';
  }
  // The resource server is defined by which server owns the tool. It is only
  // claimed when the tool that actually ran is the one the contract names.
  if (selectedTool && selectedTool === authorization?.primaryTool) evidence.resourceServer = authorization.resourceServer;
  if (publicCatalog) {
    evidence.publicCatalog = true;
    evidence.gateway = { applicable: false };
    evidence.authorize = { applicable: false };
  } else if (authorization?.primaryTool) {
    evidence.gateway = audit
      ? { route: audit.where?.routePath || audit.where?.route || null, verdict: audit.how?.decision || null }
      : { route: heldByAuthorize ? challengedRoute : null, verdict: heldByAuthorize ? evaluation.outcome : null };
    evidence.authorize = decidedByGatewayPolicy
      ? { applicable: false, decidedBy: audit.how.policy || audit.where?.filter || 'gateway policy' }
      : {
        reference: gatewayAuthorize?.url || evaluation?.decisionId || null,
        decision: evaluation?.outcome || gatewayAuthorize?.decision || null,
        ...(evaluation && gatewayAuthorize?.decision && evaluation.outcome !== gatewayAuthorize.decision ? { rawDecision: gatewayAuthorize.decision } : {}),
      };
  } else {
    evidence.gateway = { applicable: false };
    evidence.authorize = { applicable: false };
  }
  return { observed: outcomeFromAgentResponse(response), evidence };
}

/**
 * Session operations bound to one signed-in lane session.
 * `request(path, { method, body })` is the login handle's same-origin request.
 */
function createCaseOperations({ request, provider, expectedIssuer }) {
  async function verifyPrerequisites({ caseRow, vertical, prerequisites }) {
    // Workload-agent steps (UC38, UC44) run as a customer who has registered a
    // workload agent. UC38 also needs that customer to pass MFA, which a
    // headless worker cannot do, so it is blocked rather than run.
    if (caseRow?.expectedBehaviorByVertical?.[vertical]?.adaptedFromLink) {
      if (list(prerequisites?.requiredFlags).includes(MFA_GATED_FLAG)) {
        return { status: 'blocked', reason: 'needs the customer to pass MFA step-up, which this worker cannot do' };
      }
      const state = await request(AGENT_STATE_PATH, { method: 'GET' });
      if (state.status !== 200 || !state.body?.agent) {
        return { status: 'blocked', reason: 'no workload agent is registered for the readiness identity' };
      }
    }
    const unsupported = [
      prerequisites?.a2aCredentials && 'A2A credentials',
      prerequisites?.parConfig && 'PAR configuration',
      prerequisites?.groupRequirement && 'group membership',
    ].filter(Boolean);
    if (unsupported.length) {
      return { status: 'blocked', reason: `worker cannot yet verify: ${unsupported.join(', ')}` };
    }
    // CIBA completes only after a person approves on their own device. A
    // headless worker reaches the challenge and no further, so the step is
    // blocked rather than run and reported as a wrong outcome.
    if (list(prerequisites?.requiredFlags).includes('ciba_enabled')) {
      return { status: 'blocked', reason: 'CIBA needs an out-of-band approval on a device, which this worker cannot give' };
    }
    if (!list(prerequisites?.requiredFlags).length) return { status: 'pass' };
    // Arms only this lane's BFF, which has its own config store. The endpoint
    // resolves the flag set from the use case itself, never from the caller.
    const armed = await request(FLAG_ENABLE_PATH, { method: 'POST', body: { useCaseId: slugFor(caseRow) } });
    if (armed.status !== 200 || armed.body?.success !== true) {
      return { status: 'blocked', reason: `lane could not arm required flags (HTTP ${armed.status})` };
    }
    const missing = list(prerequisites.requiredFlags).filter((flag) => !list(armed.body.flags).includes(flag));
    return missing.length
      ? { status: 'blocked', reason: `lane did not arm: ${missing.join(', ')}` }
      : { status: 'pass' };
  }

  async function executeReadinessCase({ caseRow, vertical, mode, behavior, authorization }) {
    if (mode !== 'agent-chip') {
      const error = new Error(`worker has no adapter for execution mode ${mode}`);
      error.code = 'unsupported-operation';
      throw error;
    }
    const invoked = await request(INVOKE_PATH, {
      method: 'POST',
      body: { prompt: behavior.triggerText, vertical, useCaseId: slugFor(caseRow) },
    });
    if (invoked.status !== 200) return { observed: `HTTP_${invoked.status}`, evidence: {} };
    return evidenceFromAgentInvoke({ response: invoked.body, provider, expectedIssuer, authorization });
  }

  return { verifyPrerequisites, executeReadinessCase };
}

module.exports = { createCaseOperations, evidenceFromAgentInvoke };
