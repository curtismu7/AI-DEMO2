// banking_api_server/services/mcpWebSocketClient.js
/**
 * JSON-RPC over WebSocket client for banking_mcp_server (MCP 2025-11-25 handshake + tools).
 * Shared by /api/mcp/tool and /api/mcp/inspector/*.
 *
 * Lifecycle: initialize → notifications/initialized → tools/list | tools/call (per MCP spec).
 */
const WebSocket = require('ws');
const configStore = require('./configStore');
const { writeMcpTrafficEntry } = require('./mcpTrafficLogger');
const { getCorrelationId } = require('../utils/correlationContext');
const { callLlamaCpp } = require('./llamacppLlmService');

/** Protocol version sent on initialize — runtime-configurable via Feature Flag 'mcp_use_legacy_protocol'.
 *  OFF (default) = 2025-11-25 (current spec).  ON = 2024-11-05 (previous spec).
 *  Falls back to MCP_CLIENT_PROTOCOL_VERSION env var, then 2025-11-25. */
const MCP_CLIENT_PROTOCOL_VERSION = process.env.MCP_CLIENT_PROTOCOL_VERSION || '2025-11-25';

/** Returns the protocol version to use for the current connection (checked at call time). */
function getMcpProtocolVersion() {
  const legacyFlag = configStore.getEffective('mcp_use_legacy_protocol');
  if (legacyFlag === true || legacyFlag === 'true') return '2024-11-05';
  return MCP_CLIENT_PROTOCOL_VERSION;
}

/** Versions this client can interoperate with — disconnect on mismatch (spec SHOULD). */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2024-11-05']);

/** CATALOG (not an authorization gate): scopes the RFC 8693 token exchange
 *  REQUESTS per MCP tool, and the requiredScopesHint surfaced by the MCP
 *  Inspector. Each tool lists [specific, broad] so either the precise scope OR
 *  the umbrella scope is sufficient.
 *  read  = view own data (accounts, balances, transactions)
 *  write = mutate data (transfer, deposit, withdrawal)
 *
 *  Architecture-note R1 (2026-05-15) / T-2: this map is NOT an authorization
 *  oracle. Whether an MCP tool call is permitted is decided solely by
 *  PingAuthorize (`mcpToolAuthorizationService.evaluateMcpFirstToolGate`,
 *  server.js). Do not reintroduce a local authz decision keyed off this map.
 *  Because it is no longer a security boundary, drift from BankingToolRegistry
 *  (BFF review WR-01) is a request-scope/advertisement accuracy concern, not a
 *  security gap — keep names aligned for correct exchange scopes, not for
 *  enforcement. Names should still match BankingToolRegistry. */
// MCP_TOOL_SCOPES is the BFF RFC 8693 exchange scope map. It now DERIVES from
// scope-topology.json (the SSOT) — do not hand-edit tool→scope here; edit the
// manifest. scopeTopology.regression.test.js fails if this drifts.
const scopeTopology = require('./scopeTopology');
const MCP_TOOL_SCOPES = Object.freeze(
  scopeTopology.allTools().reduce((acc, name) => {
    acc[name] = scopeTopology.toolScopes(name);
    return acc;
  }, {})
);

function getMcpServerUrl() {
  // Env-first (matches getMcpGatewayHttpUrl + tokenChainService): the boot-time
  // env→LMDB seed is async, so resolving via getEffective ALONE can return the
  // committed localhost default during the cold-start window and dial the wrong
  // host. The configmap/env value (e.g. ws://mcp-server:8080) must win.
  const url = process.env.MCP_SERVER_URL || configStore.getEffective('mcp_server_url') || 'ws://localhost:8080';
  // MCP_MTLS_ENABLED=true (compose default since #910) makes mcp-server serve
  // TLS on MCP_SERVER_PORT, so a ws:// URL lands in a TLS listener and the
  // server destroys the socket — "socket hang up". #910 fixed that for
  // scripts/health-check.js by deriving the scheme from the same flag; this
  // client was missed, which killed the MCP Inspector's direct discovery path.
  // The WS upgrade itself is exempt from the client-cert check (the mTLS
  // verifier runs in the HTTP request handler only), so TLS alone is enough.
  if (isMcpMtlsEnabled() && url.startsWith('ws://')) return `wss://${url.slice('ws://'.length)}`;
  return url;
}

/** True when mcp-server serves TLS on MCP_SERVER_PORT (its mTLS listener). */
function isMcpMtlsEnabled() {
  return process.env.MCP_MTLS_ENABLED === 'true';
}

/**
 * Gateway WebSocket URL, derived from the gateway HTTP URL (the gateway's WS
 * server is attached to the same port). Returns null when no gateway is
 * configured. Discovery (tools/list) targets THIS so the gateway's PingOne
 * Authorize per-tool decision (vertical + scope filtering) is applied — the
 * plain MCP server (getMcpServerUrl) returns all tools unfiltered.
 */
function getMcpGatewayWsUrl() {
  let http = process.env.MCP_GATEWAY_HTTP_URL || configStore.getEffective('mcp_gateway_http_url');
  if (!http) return null;
  // PingGateway (IG) is the HTTP transport only — it routes /health, /mcp* and
  // /aam, and does not serve a WebSocket listener (see ping-gateway/README.md:
  // "the gateway-audience token the Node gateway forwards is handled on the
  // WebSocket path"). In PingGateway mode MCP_GATEWAY_HTTP_URL points at IG, so
  // deriving the discovery WS URL from it dials IG's unrouted origin and the
  // handshake dies with a 404 — every discovery then degrades to the local
  // catalog and the UI stops showing Authorize-filtered chip affordance. Tool
  // CALLS still go through IG over HTTP; only WS discovery moves.
  const pg = process.env.MCP_PINGGATEWAY_URL || configStore.getEffective('mcp_pinggateway_url');
  if (pg && http.trim().replace(/\/+$/, '') === pg.trim().replace(/\/+$/, '')) {
    const nodeGw = process.env.MCP_DEMO_GATEWAY_URL || configStore.getEffective('mcp_demo_gateway_url');
    if (!nodeGw) return null;
    http = nodeGw;
  }
  return http.trim().replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`).replace(/\/+$/, '');
}

function getSessionAccessToken(req) {
  const t = req.session?.oauthTokens;
  if (!t) return null;
  return t.accessToken || t.access_token || null;
}

/**
 * Bearer string suitable for PingOne / MCP — excludes the synthetic cookie-session marker.
 */
function getSessionBearerForMcp(req) {
  const raw = getSessionAccessToken(req);
  if (!raw || typeof raw !== 'string' || raw === '_cookie_session') return null;
  return raw;
}

function jsonRpcIdsMatch(a, b) {
  return a === b || String(a) === String(b);
}

/** Limit concurrent MCP WebSocket handshakes per process (connection pool / back-pressure). */
const MCP_WS_MAX_CONCURRENT = Math.max(1, parseInt(process.env.MCP_WS_MAX_CONCURRENT || '8', 10) || 8);
let mcpWsActiveCount = 0;
const mcpWsWaitQueue = [];

/**
 * Acquire a slot in the MCP WebSocket pool; release when the RPC completes (success or error).
 * @returns {Promise<void>}
 */
function acquireMcpWsSlot() {
  return new Promise((resolve) => {
    if (mcpWsActiveCount < MCP_WS_MAX_CONCURRENT) {
      mcpWsActiveCount += 1;
      resolve();
    } else {
      mcpWsWaitQueue.push(resolve);
    }
  });
}

/**
 * Release a slot and wake the next waiter if any.
 */
function releaseMcpWsSlot() {
  if (mcpWsWaitQueue.length > 0) {
    const next = mcpWsWaitQueue.shift();
    next();
  } else {
    mcpWsActiveCount -= 1;
  }
}

/**
 * Reject all pending elicitation promises (called on WebSocket close/error).
 * Prevents memory leaks and unresolved promises when the connection drops.
 */
function rejectAllPendingElicitations(reason) {
  for (const [requestId, pending] of elicitationPendingPromises.entries()) {
    clearTimeout(pending.timeoutHandle);
    pending.reject(new Error(reason || 'WebSocket connection closed'));
  }
  elicitationPendingPromises.clear();
}

/**
 * Elicitation management: store pending elicitation responses per request ID.
 * Map key: `${requestId}`, value: { resolve, reject, timeout }
 */
const elicitationPendingPromises = new Map();

function createElicitationPromise(requestId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      elicitationPendingPromises.delete(requestId);
      reject(new Error(`Elicitation response timeout for request ${requestId}`));
    }, timeoutMs);

    elicitationPendingPromises.set(requestId, { resolve, reject, timeoutHandle });
  });
}

function resolveElicitation(requestId, response) {
  const pending = elicitationPendingPromises.get(requestId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    elicitationPendingPromises.delete(requestId);
    pending.resolve(response);
  }
}

function rejectElicitation(requestId, error) {
  const pending = elicitationPendingPromises.get(requestId);
  if (pending) {
    clearTimeout(pending.timeoutHandle);
    elicitationPendingPromises.delete(requestId);
    pending.reject(error);
  }
}

/**
 * After initialize + notifications/initialized, run one follow-up JSON-RPC method and return the result body.
 * @param {'tools/list'|'tools/call'} followMethod
 * @param {object} followParams
 * @param {string|null} [userSub] - User subject identifier passed as trusted metadata (not auth credential)
 * @param {string} [correlationId] - Optional correlation ID for distributed tracing
 * @param {{request?: object, response?: object}} [frameSink] - When provided, receives the exact
 *   follow-up JSON-RPC frames as sent/received (teaching surface; token visibility is intentional
 *   in this demo). Mutated even when the promise rejects with a JSON-RPC error.
 */
function mcpRpc(agentToken, followMethod, followParams, userSub, correlationId, frameSink, opts) {
  // Correlation: fall back to the ambient turn id when the caller didn't pass
  // one. Without this the WS path shipped NO params.correlationId, and the
  // gateway's extractCorrelationId — which sees no per-message HTTP headers on
  // a WebSocket — fell through to the JSON-RPC `id`. That id is the hardcoded
  // FOLLOW_REQUEST_ID (2) below, identical on every call, so every WS request
  // ever made collapsed into one ledger record ("2") and no tool call could be
  // joined to the ui.request hop of its own turn. Reading the ALS id here is
  // what actually links gateway/authz/mcp hops back to the originating turn.
  correlationId = correlationId || getCorrelationId();
  // WR-06: hold the pooled WS slot until the ENTIRE RPC promise settles.
  // Previously safeRelease() ran inside the message handler before
  // resolve()/reject() returned, so releaseMcpWsSlot() synchronously woke the
  // next queued waiter — which constructed a new WebSocket while this one was
  // still closing and this promise had not yet settled (response cross-talk /
  // slot-exhaustion race). The slot is now released in a single .finally()
  // after the promise resolves OR rejects. Pool size/topology unchanged —
  // only the release TIMING moved.
  let released = false;
  const safeRelease = () => {
    if (!released) {
      released = true;
      releaseMcpWsSlot();
    }
  };

  const rpcPromise = new Promise((resolve, reject) => {
    const INIT_REQUEST_ID = 1;
    const FOLLOW_REQUEST_ID = 2;

    // Phase 212: MCP traffic log
    const _mcpTrafficT0 = Date.now();

    acquireMcpWsSlot()
      .then(() => {
        // opts.serverUrl lets discovery target the gateway WS (Authorize filtering);
        // tool calls and the default path still use the plain MCP server URL.
        const mcpUrl = (opts && opts.serverUrl) || getMcpServerUrl();
        // For wss:// in dev with a self-signed cert, skip TLS verification.
        // Controlled by GATEWAY_HEALTH_PROBE_INSECURE (reuses the same dev flag
        // already used for the gateway health probe — never set in production).
        // For wss:// in dev with a self-signed cert, skip TLS verification.
        // Controlled by GATEWAY_HEALTH_PROBE_INSECURE (reuses the same dev flag
        // used for the health probe). The ws library takes (url, protocols, options)
        // so pass [] as protocols and the tls options as the third argument.
        // mcp-server's mTLS listener presents a self-signed cert regenerated on
        // every start (#910) — there is nothing stable to verify against, so
        // skip verification for it exactly as scripts/health-check.js does.
        const isMcpMtlsListener = isMcpMtlsEnabled() && mcpUrl === getMcpServerUrl();
        const wsTlsOpts =
          mcpUrl.startsWith('wss://') &&
          (isMcpMtlsListener ||
            (configStore.getEffective('gateway_health_probe_insecure') === 'true' &&
              process.env.NODE_ENV !== 'production'))
            ? { rejectUnauthorized: false }
            : {};
        // X-Active-Vertical: server-to-server hint so the gateway can scope
        // tools/list to the active vertical (AllowedVertical advice, spec §8).
        // Sourced from the BFF's configStore — never user-controlled. Harmless
        // to the MCP server directly (it ignores unknown headers).
        try {
          // Per-call vertical (opts.vertical) wins so a vertical switch actually
          // changes tools/list; falls back to the global active_vertical config.
          const activeVertical = (opts && opts.vertical) || configStore.getEffective('active_vertical');
          if (activeVertical) {
            wsTlsOpts.headers = { ...(wsTlsOpts.headers || {}), 'X-Active-Vertical': activeVertical };
          }
        } catch (_) { /* best-effort header */ }
        // X-Act-Client-Id / X-May-Act-Sub: native `act` IS now emittable via a resource
        // attribute (the `${(#root…)}` SpEL on the audience resource — see
        // docs/ACT_CLAIM_VERIFICATION.md) and is configured on the gateway resources. These
        // headers remain a DELIBERATE FALLBACK: the gateway prefers a native token `act` and
        // falls back to the header on hops/flows where native `act` isn't guaranteed (no-actor
        // exchanges, Exchange-#2, platform-connector mode). X-May-Act-Sub also carries the
        // per-user may_act.sub for the ENFORCE_MAY_ACT decision gate. Trusted because set
        // server-to-server (loopback); external callers can't spoof it (nor hold the MCP
        // token). The gateway forwards these to the Authorization Server (PingOne Authorize /
        // mock) as ActClientId + MayActSub. Do not remove — not redundant.
        try {
          wsTlsOpts.headers = {
            ...(wsTlsOpts.headers || {}),
            ...require('./mcpActorBridge').buildActorBridgeHeaders(),
          };
        } catch (_) { /* best-effort header */ }
        // Authorization on the WS UPGRADE: the gateway extracts the Bearer from the
        // upgrade header and closes 4001 without it. The MCP server reads the token
        // from the JSON-RPC message instead and ignores this header, so sending it
        // is harmless on the direct path and required on the gateway path.
        if (agentToken) {
          wsTlsOpts.headers = {
            ...(wsTlsOpts.headers || {}),
            Authorization: `Bearer ${agentToken}`,
          };
        }
        const ws = new WebSocket(mcpUrl, [], wsTlsOpts);
        /** @type {'awaiting_init' | 'awaiting_follow'} */
        let phase = 'awaiting_init';

        const timeout = setTimeout(() => {
          ws.terminate();
          reject(new Error('MCP call timed out'));
        }, 15000);

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Server-side policy rejections (e.g. DemoMCPServer.handleConnection's
        // authorizeLastHop check) close the socket cleanly with a reason instead of
        // emitting a WS-level error — ws surfaces that as 'close', not 'error'. Without
        // this handler the promise sat out the full 15s timeout below and reported the
        // generic "MCP call timed out" instead of the real rejection reason.
        ws.on('close', (code, reasonBuf) => {
          clearTimeout(timeout);
          const reason = (reasonBuf && reasonBuf.toString()) || '';
          const suffix = reason ? `: ${reason}` : '';
          reject(new Error(`MCP connection closed before response (code ${code}${suffix})`));
        });

        ws.on('open', () => {
          const initParams = {
            protocolVersion: getMcpProtocolVersion(),
            // Declares what this client actually handles below in the
            // 'awaiting_follow' server-initiated-request branch: elicitation
            // was already handled but never declared; sampling/roots are new.
            capabilities: {
              elicitation: {},
              sampling: {},
              roots: { listChanged: false },
            },
            clientInfo: { name: 'demo-api-server', version: '1.0.0', description: 'Super Banking Banking BFF — MCP WebSocket client' },
          };
          if (agentToken) initParams.agentToken = agentToken;
          if (userSub) initParams.userSub = userSub;
          if (correlationId) initParams.correlationId = correlationId;
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: INIT_REQUEST_ID,
              method: 'initialize',
              params: initParams,
            })
          );
        });

        ws.on('message', (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            clearTimeout(timeout);
            reject(new Error('MCP invalid JSON response'));
            return;
          }

          if (phase === 'awaiting_init') {
            if (!jsonRpcIdsMatch(msg.id, INIT_REQUEST_ID)) {
              clearTimeout(timeout);
              reject(new Error(`MCP unexpected response id (expected initialize ${INIT_REQUEST_ID})`));
              return;
            }
            if (msg.error) {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
              return;
            }
            // SHOULD (spec lifecycle): disconnect if server negotiated a version we cannot speak.
            const negotiatedVersion = msg.result && msg.result.protocolVersion;
            if (!SUPPORTED_PROTOCOL_VERSIONS.has(negotiatedVersion)) {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(`MCP server negotiated unsupported protocol version: ${negotiatedVersion}`));
              return;
            }
            phase = 'awaiting_follow';
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
              })
            );
            // Include agentToken in tool call params for MCP server authentication
            const callParams = { ...followParams };
            if (agentToken) callParams.agentToken = agentToken;
            if (userSub) callParams.userSub = userSub;
            if (correlationId) callParams.correlationId = correlationId;
            writeMcpTrafficEntry({
              dir: 'BFF→MCP',
              type: 'rpc_request',
              method: followMethod,
              tool: followParams && followParams.name ? followParams.name : null,
              ok: true,
              summary: `RPC → ${followMethod}${followParams && followParams.name ? ' ' + followParams.name : ''}`,
              correlationId: correlationId || null,
              payload: { method: followMethod, params: followParams },
            });
            const followFrame = {
              jsonrpc: '2.0',
              id: FOLLOW_REQUEST_ID,
              method: followMethod,
              params: callParams,
            };
            if (frameSink) frameSink.request = followFrame;
            ws.send(JSON.stringify(followFrame));
            return;
          }

          if (phase === 'awaiting_follow') {
            // Handle server-initiated requests (e.g., elicitation/create) before checking for responses
            if (msg.method && msg.id && !msg.result && !msg.error) {
              // This is a server-initiated request, not a response
              if (msg.method === 'elicitation/create') {
                // Emit elicitation event (same deps.emit → mcpFlowSseHub.publish
                // mechanism mcpToolPipeline.js uses for every other `phase:`
                // event) and wait for browser response. opts.emit is absent for
                // callers that don't pass a flow-trace-bound emitter (e.g. the
                // agent tool path, flowTraceId: null) — guarded, not required.
                if (opts && typeof opts.emit === 'function') {
                  opts.emit({
                    phase: 'elicitation_requested',
                    elicitationId: msg.id,
                    mode: msg.params?.mode,
                    message: msg.params?.message,
                    requestedSchema: msg.params?.requestedSchema,
                    url: msg.params?.url,
                    payload: msg.params
                  });
                }

                // Create a promise to wait for the browser's elicitation response
                createElicitationPromise(msg.id, 60000)
                  .then((elicitationResponse) => {
                    // Send the elicitation response back to the server
                    ws.send(JSON.stringify({
                      jsonrpc: '2.0',
                      id: msg.id,
                      result: elicitationResponse
                    }));

                    writeMcpTrafficEntry({
                      dir: 'BFF→MCP',
                      type: 'elicitation_response',
                      method: 'elicitation/response',
                      tool: followParams && followParams.name ? followParams.name : null,
                      ok: true,
                      summary: `Elicitation response sent (action: ${elicitationResponse.action})`,
                      correlationId: correlationId || null,
                      payload: { result: elicitationResponse }
                    });
                  })
                  .catch((err) => {
                    // Send error response to server
                    ws.send(JSON.stringify({
                      jsonrpc: '2.0',
                      id: msg.id,
                      error: {
                        code: -32001,
                        message: 'Elicitation failed: ' + err.message
                      }
                    }));

                    writeMcpTrafficEntry({
                      dir: 'BFF→MCP',
                      type: 'elicitation_error',
                      method: 'elicitation/response',
                      tool: followParams && followParams.name ? followParams.name : null,
                      ok: false,
                      summary: `Elicitation error: ${err.message}`,
                      correlationId: correlationId || null,
                      payload: { error: { message: err.message } }
                    });
                  });
                return;
              }

              // MCP Sampling — a backend server asking THIS client to run an
              // LLM completion on its behalf. Wired to a real local model
              // (llamacppLlmService, already used elsewhere in this process
              // for NL intent classification) — not a stub reply.
              if (msg.method === 'sampling/createMessage') {
                const reqMessages = (msg.params && msg.params.messages) || [];
                const chatMessages = reqMessages.map((m) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : ((m.content && m.content.text) || ''),
                }));
                if (msg.params && msg.params.systemPrompt) {
                  chatMessages.unshift({ role: 'system', content: msg.params.systemPrompt });
                }
                callLlamaCpp(chatMessages)
                  .then((text) => {
                    ws.send(JSON.stringify({
                      jsonrpc: '2.0',
                      id: msg.id,
                      result: {
                        role: 'assistant',
                        content: { type: 'text', text },
                        model: 'llama.cpp',
                        stopReason: 'endTurn',
                      },
                    }));
                  })
                  .catch((err) => {
                    ws.send(JSON.stringify({
                      jsonrpc: '2.0',
                      id: msg.id,
                      error: { code: -32001, message: 'Sampling failed: ' + err.message },
                    }));
                  });
                return;
              }

              // MCP Roots — a backend server asking which filesystem/workspace
              // boundaries this client grants it. Honest answer, not a stub:
              // this system exposes no filesystem to agent operations at all.
              if (msg.method === 'roots/list') {
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { roots: [] } }));
                return;
              }

              // Handle other server-initiated requests here in the future
              return;
            }

            // MCP spec: notifications/progress — an interim notification (no
            // id) that may arrive before the final response on a long-running
            // call. No tool in this demo emits one today (see MCP Inspector's
            // "Attach progress token" toggle), but the client must not treat
            // it as an out-of-order response — capture it on the frame sink
            // (teaching surface) and keep waiting for the real response.
            if (msg.method && msg.id === undefined && !msg.result && !msg.error) {
              if (frameSink) {
                frameSink.notifications = frameSink.notifications || [];
                frameSink.notifications.push(msg);
              }
              return;
            }

            // Check for tool/call or tools/list response
            if (!jsonRpcIdsMatch(msg.id, FOLLOW_REQUEST_ID)) {
              clearTimeout(timeout);
              reject(new Error(`MCP unexpected response id (expected ${followMethod} ${FOLLOW_REQUEST_ID})`));
              return;
            }
            clearTimeout(timeout);
            ws.close();
            if (frameSink) frameSink.response = msg;
            if (msg.error) {
              const mcpErr = new Error(msg.error.message || JSON.stringify(msg.error));
              if (msg.error.code === -32005) {
                mcpErr.code = 'mcp_insufficient_scope';
                mcpErr.mcpErrorData = msg.error.data || {};
              } else if (msg.error.code === -32042) {
                mcpErr.code = 'url_elicitation_required';
                mcpErr.mcpErrorData = msg.error.data || {};
              }
              writeMcpTrafficEntry({
                dir: 'MCP→BFF',
                type: 'error',
                method: followMethod,
                tool: followParams && followParams.name ? followParams.name : null,
                durationMs: Date.now() - _mcpTrafficT0,
                ok: false,
                summary: `RPC ← ${followMethod} ERROR: ${mcpErr.message}`,
                correlationId: correlationId || null,
                payload: { error: msg.error },
              });
              reject(mcpErr);
            } else {
              writeMcpTrafficEntry({
                dir: 'MCP→BFF',
                type: 'rpc_response',
                method: followMethod,
                tool: followParams && followParams.name ? followParams.name : null,
                durationMs: Date.now() - _mcpTrafficT0,
                ok: true,
                summary: `RPC ← ${followMethod}${followParams && followParams.name ? ' ' + followParams.name : ''} OK (${Date.now() - _mcpTrafficT0}ms)`,
                correlationId: correlationId || null,
                payload: { result: msg.result },
              });
              resolve(msg.result);
            }
          }
        });
      })
      .catch((err) => {
        reject(err);
      });
  });

  // WR-06: slot held until the promise fully settles, regardless of which
  // code path (success, MCP error, timeout, transport error) completed.
  return rpcPromise.finally(safeRelease);
}

function mcpListTools(agentToken, userSub, correlationId, opts) {
  return mcpRpc(agentToken, 'tools/list', {}, userSub, correlationId, undefined, opts);
}

function mcpCallTool(toolName, toolParams, agentToken, userSub, correlationId, opts) {
  return mcpRpc(agentToken, 'tools/call', {
    name: toolName,
    arguments: toolParams || {},
  }, userSub, correlationId, undefined, opts);
}

// Frame-capturing variants for the MCP Inspector teaching surface. Same wire
// behavior as the plain calls; additionally return the exact follow-up
// JSON-RPC frames. On rejection the captured frames ride on err.frames (the
// response frame is present when the failure was a JSON-RPC error).
async function mcpListToolsWithFrames(agentToken, userSub, correlationId, opts) {
  const frames = {};
  try {
    const result = await mcpRpc(agentToken, 'tools/list', {}, userSub, correlationId, frames, opts);
    return { result, frames };
  } catch (err) {
    err.frames = frames;
    throw err;
  }
}

async function mcpCallToolWithFrames(toolName, toolParams, agentToken, userSub, correlationId, opts) {
  const frames = {};
  try {
    const followParams = { name: toolName, arguments: toolParams || {} };
    // opts.meta: MCP spec request metadata (params._meta), e.g. progressToken —
    // sibling of name/arguments, not a tool argument. Opt-in only (MCP
    // Inspector's "Attach progress token" toggle); absent for every other caller.
    if (opts && opts.meta) followParams._meta = opts.meta;
    const result = await mcpRpc(agentToken, 'tools/call', followParams, userSub, correlationId, frames, opts);
    return { result, frames };
  } catch (err) {
    err.frames = frames;
    throw err;
  }
}

// Thin generic frame-capturing wrapper for non-tool-call JSON-RPC methods
// (Resources, Prompts, Completion, Logging — see MCP Inspector's POST /rpc).
// mcpRpc is already method-agnostic; this just mirrors mcpCallToolWithFrames's
// try/catch-and-attach-frames shape for an arbitrary `method`/`params` pair
// instead of pinning followMethod to 'tools/call'.
async function mcpRpcCall(method, params, agentToken, userSub, correlationId, opts) {
  const frames = {};
  try {
    const result = await mcpRpc(agentToken, method, params || {}, userSub, correlationId, frames, opts);
    return { result, frames };
  } catch (err) {
    err.frames = frames;
    throw err;
  }
}

module.exports = {
  MCP_TOOL_SCOPES,
  MCP_CLIENT_PROTOCOL_VERSION,
  getMcpProtocolVersion,
  getMcpServerUrl,
  getMcpGatewayWsUrl,
  getSessionAccessToken,
  getSessionBearerForMcp,
  mcpListTools,
  mcpCallTool,
  mcpListToolsWithFrames,
  mcpCallToolWithFrames,
  mcpRpcCall,
  resolveElicitation,
  rejectElicitation,
};
