'use strict';

/**
 * A2A Protocol specialist servers (@a2a-js/sdk) — one Agent Card + JSON-RPC
 * mount per vertical in a2aSpecialists. Always on: the a2aDelegated tools are
 * reachable ONLY through the two-hop chain, so these endpoints are a required
 * subsystem, not a feature.
 */

const crypto = require('node:crypto');
const express = require('express');
const { Role } = require('@a2a-js/sdk');
const {
  DefaultRequestHandler,
  InMemoryTaskStore,
  AgentEvent,
} = require('@a2a-js/sdk/server');
const { jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const {
  specialistForVertical,
  verticalsWithSpecialist,
} = require('../config/a2aSpecialists');
const { buildSpecialistAgentCard } = require('./a2aAgentCardService');
const {
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
} = require('../middleware/a2aPingOneBearer');
const { getSignedCard, publicJwks } = require('./a2aCardSigningService');
const { exchangeAsSpecialist } = require('./a2aDelegationService');
const { executeBffToolWithToken } = require('./bffMcpToolExecutor');
const { parseToolResult } = require('./llmResponseContract');

function defaultConfigStore() {
  return require('./configStore');
}

/**
 * The specialist may only run the tools its registry entry names. Anything else
 * is refused here, before any token is minted — the Agent Card advertises these
 * skills and nothing else.
 */
function assertSkillAllowed(specialist, tool) {
  const allowed = specialist.tools || [];
  if (!tool || !allowed.includes(tool)) {
    const err = new Error(`not authorized for skill "${tool || '(none)'}"`);
    err.a2aAuthorization = true;
    throw err;
  }
  return tool;
}

/**
 * Publish the single A2A reply. DATA ONLY — the nested-act token the specialist
 * just minted stays on this side of the wire, and the caller gets the tool
 * result. One text part, because this mount already has a proven text-part
 * shape; the failure codes are deliberately generic (the detail goes to the
 * log, as the bearer gate does) so an upstream message can never carry a
 * credential into the reply.
 */
function publishReply(eventBus, requestContext, fields) {
  const { specialist, vertical, result, toolError, actChainDepth = null, scopes = [] } = fields;
  eventBus.publish(
    AgentEvent.message({
      messageId: crypto.randomUUID(),
      contextId: requestContext.contextId || '',
      taskId: requestContext.taskId || '',
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: { $case: 'text', value: JSON.stringify({ result, toolError }) },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      metadata: {
        vertical,
        specialist: specialist.specialistName,
        specialistAppKey: specialist.appKey,
        actChainDepth,
        scopes,
        toolError,
        demoLayer: 'a2a-protocol-wire',
      },
      extensions: [],
      referenceTaskIds: [],
    }),
  );
}

/**
 * The gateway AUTHORIZES, but it cannot always SERVE.
 *
 * Only banking's OLB tools sit behind the gateway's backend. Every other
 * vertical's specialist tool (sensitive_patient_records, sensitive_tax_record,
 * ...) is implemented in this process by the vertical plugin, so the A2A call
 * ran the full chain, PingOne Authorize PERMITted it, and the gateway then had
 * nothing to forward to (HTTP 502). Authorization succeeded; only delivery
 * failed, and the BFF is the resource server for these tools.
 *
 * REGRESSION_PLAN §1 LOCKED — conditions copied verbatim from
 * demoAgentLangGraphService.js's executeA2aDelegation. Deliberately narrow:
 * only after a transport/upstream failure (never after a DENY or a challenge,
 * which are real answers), only when the active vertical's plugin owns the
 * tool, and only when the call was authorized — the gateway recorded a PERMIT,
 * or, with no gateway, the BFF's own P1AZ gate did (it is the enforcement point
 * then). mcp_error comes from any failure, including one before any decision;
 * serving locally without a PERMIT would skip PingOne Authorize entirely.
 */
async function maybeServeLocally({ vertical, tool, args, ctx, toolResult, tokenEvents }) {
  const authorized =
    toolResult &&
    typeof toolResult === 'object' &&
    toolResult.error === 'mcp_error' &&
    [toolResult.gatewayDecision, toolResult.bffDecision].some(
      (d) => String(d || '').toUpperCase() === 'PERMIT',
    );
  if (!authorized) return toolResult;

  // Lazy require: keeps the module graph free of a startup cycle, and resolves
  // the same verticalDispatch instance a test spies on.
  const verticalDispatch = require('./verticalDispatch');
  const ownsTool = (() => {
    try {
      const schemas = verticalDispatch.toolSchemasFor(vertical, { isAdmin: false }, () => []) || [];
      return schemas.some((t) => (t && (t.name || t.function?.name)) === tool);
    } catch (_) {
      return false;
    }
  })();
  if (!ownsTool) return toolResult;

  try {
    // Call executeToolFor DIRECTLY — never resolveExecuteTool, whose A2A
    // fast-path re-enters A2A delegation for every a2aDelegated tool name and
    // would recurse forever on exactly the upstream failure this path handles.
    // Authorization already ran; this is delivery only.
    const userId = ctx.req?.session?.user?.id || ctx.claims?.sub || 'anon';
    const localOut = await verticalDispatch.executeToolFor(
      vertical,
      tool,
      args,
      {
        userId,
        userToken: null,
        req: ctx.req,
        tokenEvents,
        sessionId: ctx.sessionId || ctx.req?.sessionID || '',
        isAdmin: false,
      },
      async () => ({ result: { error: 'no_local_plugin_handler' }, render: 'text' }),
    );
    const localResult =
      localOut && typeof localOut === 'object' && !Array.isArray(localOut) && 'result' in localOut
        ? localOut.result
        : localOut;
    if (localResult && !(typeof localResult === 'object' && 'error' in localResult)) {
      console.log(
        '[a2a-wire] %s authorized at the gateway, served locally (no gateway backend for this vertical)',
        tool,
      );
      return localResult;
    }
  } catch (localErr) {
    console.warn('[a2a-wire] local execution of %s failed: %s', tool, localErr?.message);
  }
  return toolResult;
}

/**
 * AgentExecutor: the SPECIALIST runs its own RFC 8693 Exchange #2 and makes the
 * tool call itself, then replies with data. No token ever crosses the wire.
 *
 * @param {object} specialist config/a2aSpecialists entry
 * @param {string} vertical
 * @param {{ subjectToken?: string, ctx?: object }} [opts] `ctx` is per call:
 *   `{ req, tokenEvents, sessionId, claims, toolArgs }`.
 */
function makeSpecialistExecutor(specialist, vertical = specialist.appKey, opts = {}) {
  return {
    async execute(requestContext, eventBus) {
      const ctx = opts.ctx || {};
      const tokenEvents = ctx.tokenEvents || [];
      const meta = requestContext.userMessage?.metadata || {};
      const reply = (fields) =>
        publishReply(eventBus, requestContext, { specialist, vertical, ...fields });

      let tool;
      try {
        tool = assertSkillAllowed(specialist, meta.tool);
      } catch (err) {
        console.warn('[a2a-wire] %s refused a skill: %s', specialist.specialistName, err.message);
        return reply({ result: null, toolError: 'not_authorized_for_skill' });
      }

      const subjectToken = opts.subjectToken || null;
      if (!subjectToken) {
        console.warn('[a2a-wire] no subject token for %s on %s', tool, vertical);
        return reply({ result: null, toolError: 'a2a_no_subject_token' });
      }

      try {
        // Exchange #2: the specialist adds itself to the act chain, in its own
        // process, with its own credentials. The generalist never sees this token.
        const ex = await exchangeAsSpecialist(subjectToken, { vertical, tool, tokenEvents });
        if (!ex?.token) {
          console.warn('[a2a-wire] Exchange #2 failed for %s: %s', tool, ex?.error);
          return reply({ result: null, toolError: 'a2a_exchange_failed' });
        }

        // In-process the generalist supplies the args directly; an external HTTP
        // caller can only express them in the message metadata.
        const args = ctx.toolArgs ?? meta.args ?? {};
        const raw = await executeBffToolWithToken({
          name: tool,
          args,
          req: ctx.req || null,
          tokenEvents,
          sessionId: ctx.sessionId || ctx.req?.sessionID || '',
          suppliedToken: ex.token,
          suppliedUserSub: ex.claims?.sub || ctx.claims?.sub || null,
        });
        const { result: parsed } = parseToolResult(raw, { site: `a2a-wire:${tool}` });
        const toolResult = await maybeServeLocally({
          vertical,
          tool,
          args,
          ctx,
          toolResult: parsed,
          tokenEvents,
        });

        // Detect the error by key presence, not truthiness — an empty-string
        // error is still a failure.
        const toolHasError = toolResult && typeof toolResult === 'object' && 'error' in toolResult;
        return reply({
          result: toolResult,
          toolError: toolHasError ? toolResult.error || 'tool_error' : null,
          actChainDepth: ex.actChainDepth ?? null,
          scopes: ex.scopes || [],
        });
      } catch (err) {
        console.warn('[a2a-wire] %s failed on %s: %s', tool, vertical, err?.message);
        return reply({ result: null, toolError: 'a2a_specialist_error' });
      }
    },
    async cancelTask() {},
  };
}

/**
 * Build request handler + card for one vertical.
 * @param {string} vertical
 * @param {object} [cfg]
 * @param {object} [ctx] per-call context `{ req, tokenEvents, sessionId, claims,
 *   toolArgs, subjectToken }`. The subject token for Exchange #2 is the inbound
 *   Exchange #1 bearer: passed explicitly, or read off the request the bearer
 *   gate already validated.
 */
function createSpecialistProtocolHandler(vertical, cfg, ctx) {
  const specialist = specialistForVertical(vertical);
  if (!specialist) return null;
  const card = buildSpecialistAgentCard(vertical, cfg);
  if (!card) return null;
  const subjectToken = ctx?.subjectToken || ctx?.req?.a2aPingOne?.token || null;
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    makeSpecialistExecutor(specialist, vertical, { subjectToken, ctx }),
  );
  return { handler, card, specialist };
}

/**
 * Express router: /:vertical/.well-known/agent-card.json + /:vertical JSON-RPC.
 * Mount at `/a2a/specialists` without session authenticateToken.
 */
function createA2aProtocolRouter(opts = {}) {
  const getCfg = opts.configStore || defaultConfigStore;
  const router = express.Router();

  // Verification key for the Agent Card signatures (A2A v1.0 §8.4). Public, like the cards.
  router.get('/.well-known/jwks.json', (_req, res) => res.json(publicJwks()));

  for (const vertical of verticalsWithSpecialist()) {
    // Startup probe only — "does this vertical have a card to serve?". The
    // request handler itself is built per request below.
    if (!createSpecialistProtocolHandler(vertical, typeof getCfg === 'function' ? getCfg() : getCfg)) {
      continue;
    }
    const base = `/${encodeURIComponent(vertical)}`;

    router.get(`${base}/.well-known/agent-card.json`, async (_req, res) => {
      const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
      const card = await getSignedCard(vertical, cfg);
      if (!card) return res.status(404).json({ error: 'no_specialist' });
      return res.json(card);
    });

    router.use(
      base,
      requireA2aPingOneBearer(vertical),
      (req, res, next) => {
        // Built PER REQUEST: the executor needs this request's bearer (the
        // Exchange #1 subject token), session and claims, which a handler built
        // once at startup cannot supply — it degrades every real call to
        // a2a_no_subject_token. Guarded by
        // tests/a2aSpecialistRouterContext.test.js, which fails if this is
        // reverted to startup construction. req.a2aPingOne is set by the gate
        // above, which still runs first and is unchanged.
        // ponytail: a fresh InMemoryTaskStore per request, so no task outlives
        // the response — fine for this one-shot message/send hop; share a store
        // per vertical if task polling is ever needed.
        const built = createSpecialistProtocolHandler(
          vertical,
          typeof getCfg === 'function' ? getCfg() : getCfg,
          {
            req,
            tokenEvents: [],
            sessionId: req.sessionID,
            claims: req.a2aPingOne?.claims,
          },
        );
        if (!built) return next();
        return jsonRpcHandler({
          requestHandler: built.handler,
          userBuilder: pingOneA2aUserBuilder,
        })(req, res, next);
      },
    );
  }

  return router;
}

module.exports = {
  createA2aProtocolRouter,
  createSpecialistProtocolHandler,
  makeSpecialistExecutor,
  assertSkillAllowed,
};
