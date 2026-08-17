'use strict';

/**
 * wsBindingGuard — WS-transport fail-closed guard for the HTTP-header-bound
 * proof mechanisms (DPoP RFC 9449, Web Bot Auth RFC 9421).
 *
 * Why this exists (BUGS.md #53):
 *   The HTTP path (authorizeMcpRequest.ts, Step 2d / 2d') fail-closes on a
 *   missing or invalid DPoP proof when REQUIRE_DPOP_PROOF=true, and on a
 *   missing/invalid Web Bot Auth signature when wbaMode=enforce. The WebSocket
 *   tools/call path had NO equivalent, so a caller could dodge an armed control
 *   simply by choosing the WS transport — the same transport-bypass class as the
 *   WS rate-limit gap (BUGS.md #13 / PR #1825).
 *
 * Why fail-closed rather than verify-on-WS:
 *   Both are HTTP-request-bound. A DPoP proof binds to exactly one HTTP
 *   method+URI (htm/htu) and carries a one-time jti for per-request replay
 *   defence; a Web Bot Auth signature covers the @authority + signature-agent of
 *   a single HTTP request. A long-lived WebSocket has exactly ONE HTTP request —
 *   the upgrade — so it cannot present a fresh per-tool-call proof, and the BFF's
 *   WS client (demo_api_server/services/mcpWebSocketClient.js) never sends these
 *   headers (only the HTTP client mcpGatewayClient.js does). Verifying a single
 *   upgrade-time proof per message would give neither the htu/htm binding nor the
 *   replay protection the RFCs require. So when either control is ENFORCED, the
 *   correct behaviour is to refuse the WS tool call and steer the caller to
 *   POST /mcp, where the proof can be bound and verified — never to silently
 *   allow it.
 *
 * Controls that are NOT handled here (already at WS/HTTP parity elsewhere):
 *   - RFC 7662 introspection + GatewayTokenPolicy — runMcpAuthorizationPipeline.
 *   - RAR intent-subset (REQUIRE_RAR_INTENT) — enforced in guardToolCall
 *     (pingAuthorizeGuard.ts) on both transports.
 *   - Intent token — validated in the WS tools/call branch already.
 */

export interface WsBindingRejection {
  /** JSON-RPC error code to emit. */
  code: number;
  /** Human-readable reason. */
  message: string;
  /** JSON-RPC error `data` payload. */
  data: { error: string; login_required: boolean };
}

/**
 * Decide whether an incoming WebSocket tools/call must be refused because an
 * HTTP-header-bound proof control is enforced and cannot be satisfied on WS.
 *
 * @returns `null` when the call may proceed, or a JSON-RPC rejection the caller
 *   should `send` before returning. DPoP is evaluated first so its more specific
 *   error surfaces when both are enforced.
 */
export function wsTransportBindingGuard(opts: {
  requireDpopProof: boolean;
  wbaMode: 'off' | 'monitor' | 'enforce';
}): WsBindingRejection | null {
  if (opts.requireDpopProof) {
    return {
      code: -32001,
      message:
        'DPoP proof (RFC 9449) is required but cannot be presented over the WebSocket transport; ' +
        'retry this tool call over the HTTP transport (POST /mcp), where the proof can be bound and verified.',
      data: { error: 'invalid_dpop_proof', login_required: false },
    };
  }
  if (opts.wbaMode === 'enforce') {
    return {
      code: -32001,
      message:
        'A valid Web Bot Auth signature (RFC 9421, tag=web-bot-auth) is required but cannot be presented over the ' +
        'WebSocket transport; retry this tool call over the HTTP transport (POST /mcp).',
      data: { error: 'invalid_web_bot_auth', login_required: false },
    };
  }
  return null;
}
