'use strict';

/**
 * A2A Protocol specialist servers (@a2a-js/sdk) — one Agent Card + JSON-RPC
 * mount per vertical in a2aSpecialists. Always on: the a2aDelegated tools are
 * reachable ONLY through the two-hop chain, so these endpoints are a required
 * subsystem, not a feature.
 */

const crypto = require('node:crypto');
const express = require('express');
const { Role, TaskState } = require('@a2a-js/sdk');
const {
  DefaultRequestHandler,
  DefaultExecutionEventBusManager,
  DefaultPushNotificationSender,
  AgentEvent,
} = require('@a2a-js/sdk/server');
const { pushEnabled, createGuardedPushStore } = require('./a2aPushGuard');
const { jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const {
  specialistForVertical,
  specialistDirectory,
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
const { redactValue } = require('../utils/logRedact');
const { createA2aTaskStore } = require('./lmdb/a2aTaskStore.lmdb');
const { tenantMatches } = require('./a2aTenantService');

const taskStores = new Map();
function taskStoreFor(vertical) {
  if (!taskStores.has(vertical)) {
    let store;
    const ensure = () => (store || (store = createA2aTaskStore()));
    taskStores.set(vertical, new Proxy({}, {
      get(_target, property) {
        const value = ensure()[property];
        return typeof value === 'function' ? value.bind(ensure()) : value;
      },
    }));
  }
  return taskStores.get(vertical);
}

// One event bus manager for all requests. The handler is rebuilt per request,
// and the SDK finds a running task's bus through its manager, so a reconnecting
// request (SubscribeToTask) can only attach if every handler shares this one.
let eventBusManagerSingleton = null;
function sharedEventBusManager() {
  if (!eventBusManagerSingleton) eventBusManagerSingleton = new DefaultExecutionEventBusManager();
  return eventBusManagerSingleton;
}

/**
 * The SDK saves task state and sends push notifications from inside the loop
 * that serves SendStreamingMessage. If that caller disconnects, the loop stops:
 * the task keeps running but its result is never stored and no callback fires,
 * so the stored task stays "working" forever. Keep draining after an early
 * return so a dropped stream cannot strand the task.
 */
function keepDrainingAfterDisconnect(stream) {
  return (async function* drained() {
    let finished = false;
    try {
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          finished = true;
          return;
        }
        yield next.value;
      }
    } finally {
      if (!finished) {
        void (async () => {
          try {
            for (;;) if ((await stream.next()).done) return;
          } catch (err) {
            console.warn('[a2a-wire] background drain after disconnect failed: %s', err?.message);
          }
        })();
      }
    }
  }());
}

function withDrainOnDisconnect(handler) {
  const original = handler.sendMessageStream.bind(handler);
  handler.sendMessageStream = (...args) => keepDrainingAfterDisconnect(original(...args));
  return handler;
}

// One push store for all requests (the handler is rebuilt per request, so a
// per-handler store would forget every registered callback). In memory: a
// callback lives as long as its task, which finishes in seconds.
let pushStoreSingleton = null;
function sharedPushStore() {
  if (!pushStoreSingleton) pushStoreSingleton = createGuardedPushStore();
  return pushStoreSingleton;
}

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
 * log, as the bearer gate does). `result` is the tool pipeline's own object —
 * on an mcp_error it can carry a raw upstream `message` — so it is passed
 * through `redactValue` (utils/logRedact.js, the same JWT-stripping pass the
 * BFF's own logs go through) before it reaches the wire; the tool pipeline's
 * own error paths are not otherwise guaranteed token-free.
 *
 * `fields.tokenEvents`, when present, is the specialist's own token-chain rows
 * (a2a-agent2-actor / a2a-exchange2 / tool-dispatched) — only set by the HTTP
 * router (see createA2aProtocolRouter below), never by the in-process path,
 * because only the HTTP transport has no other way to hand its chain back to
 * the caller (a2aProtocolClient.js#finishHop reads it off this metadata).
 */
function publishReply(eventBus, requestContext, fields) {
  const { specialist, vertical, result, toolError, diagnostic, actChainDepth = null, scopes = [], tokenEvents, taskMode = false } = fields;
  const safeResult = redactValue(result);
  const part = {
    content: { $case: 'text', value: JSON.stringify({ result: safeResult, toolError, diagnostic }) },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
  const metadata = {
    vertical,
    specialist: specialist.specialistName,
    specialistAppKey: specialist.appKey,
    actChainDepth,
    scopes,
    toolError,
    ...(diagnostic ? { diagnostic } : {}),
    demoLayer: 'a2a-protocol-wire',
    ...(tokenEvents ? { tokenEvents: redactValue(tokenEvents) } : {}),
  };
  const contextId = requestContext.contextId || '';
  const taskId = requestContext.taskId || '';

  if (taskMode) {
    // Task lifecycle (opt-in): the same data, delivered as an artifact and then
    // a terminal status, so a streaming or reconnecting caller sees the steps.
    eventBus.publish(AgentEvent.artifactUpdate({
      taskId,
      contextId,
      artifact: {
        artifactId: crypto.randomUUID(),
        name: 'tool-result',
        description: `Result of ${specialist.specialistName}'s tool call`,
        parts: [part],
        metadata,
        extensions: [],
      },
      append: false,
      lastChunk: true,
      metadata: undefined,
    }));
    eventBus.publish(AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: {
        state: toolError ? TaskState.TASK_STATE_FAILED : TaskState.TASK_STATE_COMPLETED,
        message: undefined,
        timestamp: new Date().toISOString(),
      },
      metadata: undefined,
    }));
    return;
  }

  eventBus.publish(
    AgentEvent.message({
      messageId: crypto.randomUUID(),
      contextId,
      taskId,
      role: Role.ROLE_AGENT,
      parts: [part],
      metadata,
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
    // The HTTP A2A mount runs sessionMiddleware but not authenticateToken, so
    // ctx.req.session can belong to an unrelated caller while ctx.claims.sub is
    // the PingOne-validated subject the bearer gate (verifyA2aBearer) actually
    // authorized. Prefer the validated bearer's subject; session is only a
    // defensive fallback for the unlikely case claims is absent (routes/oauth.js
    // ~L362: session.user.id and claims.sub are the same PingOne sub).
    const userId = ctx.claims?.sub || ctx.req?.session?.user?.id || 'anon';
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
      // Opt-in task lifecycle: a plain SendMessage still gets one Message back
      // (the Token Chain reads that); `metadata.task: true` asks for a Task.
      const taskMode = meta.task === true;
      if (taskMode) {
        eventBus.publish(AgentEvent.task({
          id: requestContext.taskId || '',
          contextId: requestContext.contextId || '',
          status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
          artifacts: [],
          history: [],
          metadata: undefined,
        }));
      }
      // `diagnostic` travels to the caller with the reply so a refusal is never
      // a dead-end: the wire client surfaces it as a failed token event (the
      // 2026-09-26 mid-restart demo showed an unexplained a2a_unauthorized
      // chain because these refusals were console.warn-only).
      const reply = (fields) =>
        publishReply(eventBus, requestContext, {
          specialist,
          vertical,
          taskMode,
          ...(ctx.exposeTokenEvents ? { tokenEvents } : {}),
          ...fields,
        });

      if (ctx.claims?.tenantHandle && !tenantMatches(ctx.claims.tenantHandle, meta.tenant)) {
        console.warn('[a2a-wire] tenant mismatch: claims=%s meta=%s', ctx.claims.tenantHandle, meta.tenant);
        return reply({ result: null, toolError: 'a2a_tenant_mismatch', diagnostic: `tenant ${ctx.claims.tenantHandle} does not match the requested ${meta.tenant || '(none)'}` });
      }

      let tool;
      try {
        tool = assertSkillAllowed(specialist, meta.tool);
      } catch (err) {
        console.warn('[a2a-wire] %s refused a skill: %s (requested=%s allowed=%s)', specialist.specialistName, err.message, meta.tool, (specialist.tools || []).join(','));
        return reply({ result: null, toolError: 'not_authorized_for_skill', diagnostic: `tool "${meta.tool || '(none)'}" is not in ${specialist.specialistName}'s skills [${(specialist.tools || []).join(', ')}]` });
      }

      const subjectToken = opts.subjectToken || null;
      if (!subjectToken) {
        console.warn('[a2a-wire] no subject token for %s on %s', tool, vertical);
        return reply({ result: null, toolError: 'a2a_no_subject_token', diagnostic: 'the wire hop arrived with no delegated user token — the generalist exchange chain failed upstream' });
      }

      try {
        // Exchange #2: the specialist adds itself to the act chain, in its own
        // process, with its own credentials. The generalist never sees this token.
        const ex = await exchangeAsSpecialist(subjectToken, { vertical, tool, tokenEvents });
        if (!ex?.token) {
          console.warn('[a2a-wire] Exchange #2 failed for %s: %s', tool, ex?.error);
          return reply({ result: null, toolError: 'a2a_exchange_failed', diagnostic: `Exchange #2 failed: ${ex?.error || 'unknown'}` });
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
        return reply({ result: null, toolError: 'a2a_specialist_error', diagnostic: `specialist execution failed: ${err?.message || 'unknown'}` });
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
  const pushStore = pushEnabled() ? sharedPushStore() : undefined;
  const handler = withDrainOnDisconnect(new DefaultRequestHandler(
    card,
    taskStoreFor(vertical),
    makeSpecialistExecutor(specialist, vertical, { subjectToken, ctx }),
    sharedEventBusManager(),
    pushStore,
    pushStore ? new DefaultPushNotificationSender(pushStore) : undefined,
  ));
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

  // Public display metadata for selectors and learning surfaces. Credentials,
  // grants, and tenant data stay out of this response; protocol capabilities
  // continue to come from each signed Agent Card.
  router.get('/registry', (_req, res) => {
    res.json({ specialists: specialistDirectory() });
  });

  for (const vertical of verticalsWithSpecialist()) {
    // Startup probe only — "does this vertical have a card to serve?". The
    // request handler itself is built per request below.
    if (!createSpecialistProtocolHandler(vertical, typeof getCfg === 'function' ? getCfg() : getCfg)) {
      continue;
    }
    const base = `/${encodeURIComponent(vertical)}`;

    router.get(`${base}/.well-known/agent-card.json`, async (req, res) => {
      const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
      const auth = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      let options = {};
      if (auth) {
        try {
          const claims = await require('../middleware/a2aPingOneBearer').verifyA2aBearer(auth[1].trim(), { vertical, cfg });
          options = { authenticated: true, tenantHandle: claims.tenantHandle };
        } catch (err) {
          const e = err;
          res.set('WWW-Authenticate', e.challenge || 'Bearer error="invalid_token"');
          return res.status(e.status || 401).json({ error: e.message || 'unauthorized' });
        }
      }
      const card = await getSignedCard(vertical, cfg, options);
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
        // The task store is shared per specialist and persists through LMDB;
        // request-specific bearer/session/executor context remains per request.
        //
        // tokenEvents: [] here is real and per-request (fresh each call, never
        // shared across requests) — the specialist executor mutates this SAME
        // array as it runs Exchange #2 and dispatches the tool. Unlike the
        // in-process path, an HTTP caller cannot read that array by reference
        // (it never crosses the wire), so exposeTokenEvents:true tells
        // publishReply to fold it into the JSON-RPC reply's metadata, where
        // a2aProtocolClient.js#finishHop reads it back out for the HTTP
        // transport (sendA2aProtocolHandoff / A2A_PROTOCOL_HTTP=1) — see
        // TECH_DEBT.md "HTTP transport drops the specialist's token-chain rows".
        const built = createSpecialistProtocolHandler(
          vertical,
          typeof getCfg === 'function' ? getCfg() : getCfg,
          {
            req,
            tokenEvents: [],
            sessionId: req.sessionID,
            claims: req.a2aPingOne?.claims,
            exposeTokenEvents: true,
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
  sharedEventBusManager,
  withDrainOnDisconnect,
};
