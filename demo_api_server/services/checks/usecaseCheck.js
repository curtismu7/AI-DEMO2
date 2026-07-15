'use strict';
/**
 * Demo-check gate use cases — PERMIT happy path + DENY enforcement proof.
 * Spec: docs/superpowers/specs/2026-07-15-demo-check-unify-design.md
 */
const { register } = require('./registry');

function sessionToken(req) {
  const t = req?.session?.oauthTokens?.accessToken;
  if (!t || t === '_cookie_session') return null;
  return t;
}

const permitAccounts = {
  id: 'usecase.permit_accounts',
  name: 'UC1 — Delegated access PERMIT (get_my_accounts)',
  category: 'Use cases',
  severity: 'gate',
  async run(ctx) {
    const req = ctx.req || {};
    const userToken = sessionToken(req);
    if (!userToken) {
      return {
        status: 'fail',
        detail: 'No live user session token',
        nextAction: 'Sign in with the demo user, open Demo check, Run again',
      };
    }
    req.body = { ...(req.body || {}), useCaseId: 'delegated-access-with-proof' };
    const { executeBffTool } = require('../bffMcpToolExecutor');
    const tokenEvents = [];
    const userId = req.session?.user?.id || req.user?.id || null;
    const sessionId = req.sessionID || req.session?.id || '';
    const raw = await executeBffTool({
      name: 'get_my_accounts',
      args: {},
      userId,
      userToken,
      req,
      tokenEvents,
      sessionId,
    });
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    const failed = parsed && typeof parsed === 'object' && (parsed.error || parsed.isError);
    if (failed) {
      return {
        status: 'fail',
        detail: String(parsed.error || parsed.message || 'tool returned error').slice(0, 200),
        nextAction: 'Check MCP gateway / RFC 8693 exchange and that the demo user can read accounts',
        meta: {
          useCaseId: 'delegated-access-with-proof',
          expectedOutcome: 'PERMIT',
          tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
        },
      };
    }
    return {
      status: 'pass',
      detail: 'get_my_accounts succeeded (delegated PERMIT path)',
      meta: {
        useCaseId: 'delegated-access-with-proof',
        expectedOutcome: 'PERMIT',
        tokenChain: tokenEvents.map((e) => ({ id: e.id, label: e.label, status: e.status })),
        resultPreview: typeof raw === 'string' ? raw.slice(0, 300) : raw,
      },
    };
  },
};

const denyInsufficientScope = {
  id: 'usecase.deny_insufficient_scope',
  name: 'UC5 — Insufficient scope DENY (attack sim)',
  category: 'Use cases',
  severity: 'gate',
  async run(ctx) {
    const req = ctx.req || {};
    if (!sessionToken(req)) {
      return {
        status: 'fail',
        detail: 'No live user session token',
        nextAction: 'Sign in with the demo user, open Demo check, Run again',
      };
    }
    const { runAttackSim } = require('../attackSimulatorService');
    const result = await runAttackSim('insufficient-scope', req) || {};
    if (result.errorCode === 'no_session_token') {
      return {
        status: 'fail',
        detail: 'No live user session token',
        nextAction: 'Sign in with the demo user, open Demo check, Run again',
      };
    }
    if (result.errorCode === 'gateway_not_configured' || result.errorCode === 'wrong_aud_not_configured') {
      return {
        status: 'fail',
        detail: result.reason || result.errorCode,
        nextAction: 'Configure / enable the MCP gateway so DENY attack sims can run',
        meta: { useCaseId: 'insufficient-scope', sim: 'insufficient-scope', errorCode: result.errorCode },
      };
    }
    const denied = [401, 403].includes(result.status) && result.errorCode !== 'unexpected_permit';
    if (!denied) {
      return {
        status: 'fail',
        detail: result.errorCode === 'unexpected_permit'
          ? 'Gateway permitted the attack — enforcement may be off'
          : `expected DENY (401/403), got ${result.status} ${result.errorCode || ''}`,
        nextAction: 'Gateway enforcement off or wrong path — check PingGateway / authorize feature flags',
        meta: {
          useCaseId: 'insufficient-scope',
          expectedOutcome: 'DENY',
          sim: 'insufficient-scope',
          httpStatus: result.status,
          errorCode: result.errorCode,
          tokenChain: (result.tokenChainEvents || []).map((e) => ({
            id: e.id, label: e.label, status: e.status,
          })),
        },
      };
    }
    return {
      status: 'pass',
      detail: `Attack sim denied as expected (${result.status} ${result.errorCode || 'deny'})`,
      meta: {
        useCaseId: 'insufficient-scope',
        expectedOutcome: 'DENY',
        sim: 'insufficient-scope',
        httpStatus: result.status,
        errorCode: result.errorCode,
        tokenChain: (result.tokenChainEvents || []).map((e) => ({
          id: e.id, label: e.label, status: e.status,
        })),
      },
    };
  },
};

register(permitAccounts, denyInsufficientScope);
module.exports = { permitAccounts, denyInsufficientScope };
