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

  // Two completed RFC 8693 exchanges on access tokens, no ID-JAG hop.
  const standardExchange = exchange1?.status === 'exchanged' && finalToken?.status === 'exchanged'
    && !events.some((event) => /id-?jag/i.test(String(event?.id || '')));

  const evidence = {
    userSessionProvider: providerOf(userToken?.claims?.iss, lane),
    agentIdentityProvider: providerOf(agentActor?.claims?.iss, lane),
    tokenIssuer: providerOf(finalToken?.claims?.iss, lane),
    subject: finalToken?.claims?.sub || null,
    actorChain: [audit?.who?.userSub, audit?.who?.agentSub].filter(Boolean),
    selectedTool,
    audiences: list(userToken?.claims?.aud),
    scopes: list(String(exchange1?.claims?.scope || '').split(/\s+/)).filter((scope) => scope !== AGENT_SCOPE),
    roleApplicability: { userLogin: Boolean(userToken), agentIdentity: Boolean(agentActor), tokenExchange: Boolean(standardExchange) },
  };
  if (standardExchange) {
    evidence.exchangeService = 'token-exchange';
    evidence.exchangeProvenance = `${provider}-standard`;
    evidence.exchangePath = 'standard-access-token';
    evidence.subjectTokenType = 'access_token';
  }
  // The resource server is defined by which server owns the tool. It is only
  // claimed when the tool that actually ran is the one the contract names.
  if (selectedTool && selectedTool === authorization?.primaryTool) evidence.resourceServer = authorization.resourceServer;
  if (authorization?.primaryTool) {
    evidence.gateway = { route: audit?.where?.routePath || null, verdict: audit?.how?.decision || null };
    evidence.authorize = { reference: gatewayAuthorize?.url || null, decision: gatewayAuthorize?.decision || null };
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
  async function verifyPrerequisites({ caseRow, prerequisites }) {
    const unsupported = [
      prerequisites?.a2aCredentials && 'A2A credentials',
      prerequisites?.parConfig && 'PAR configuration',
      prerequisites?.groupRequirement && 'group membership',
    ].filter(Boolean);
    if (unsupported.length) {
      return { status: 'blocked', reason: `worker cannot yet verify: ${unsupported.join(', ')}` };
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
