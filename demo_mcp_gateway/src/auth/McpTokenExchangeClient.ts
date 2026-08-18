'use strict';

/**
 * McpTokenExchangeClient — RFC 8693 exchange for HTTP MCP upstream tokens (D-03).
 *
 * After PingOne Authorize permits a request, this client exchanges the
 * inbound gateway-audience token for a next-hop token targeted at the
 * correct upstream MCP-server audience (olb or invest), per D-05.
 *
 * Token flow (D-04: no token to LLM):
 *   caller  →  gateway (aud=gateway)  →  exchange  →  upstream (aud=mcp-olb or mcp-resource-server)
 *
 * The upstream token is ONLY used by the gateway to call the MCP server.
 * It is never returned to, logged for, or visible to the LLM.
 *
 * RFC 8707 `resource=` (not `audience=`): PingOne silently ignores `audience=`
 * and requires `resource=` to narrow to ONE resource server when the client
 * has grants on several — otherwise it fails with "May not request scopes
 * for multiple resources". The scope must also be explicit and single-
 * resource: subject scopes ∩ target-resource scopes (native + mirroredScopes).
 * Same proven pattern as the BFF's Exchange #1 (agentMcpTokenService.js).
 */

import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { routeTool, backendResourceUri } from '../router';
import type { GatewayConfig } from '../config';
import { cacheInsertWithEviction } from '../boundedTokenCache';
import { resourceScopesForBackend } from './scopeTopology';

export interface ExchangeResult {
  token: string;
  targetAud: string;
  cached: boolean;
}

// Simple in-memory cache: sha256(subjectToken + targetAud) → { token, expiresAt }
// HI-06: cap to MCP_EXCHANGE_CACHE_MAX, sweep expired + FIFO-evict on overflow.
// Same pattern as tokenExchange.ts so the two parallel caches share semantics.
const _cache = new Map<string, { token: string; expiresAt: number }>();
const MCP_EXCHANGE_CACHE_MAX = 1000;

function cacheKey(subjectToken: string, targetAud: string, requestScopes: string[]): string {
  // Full SHA-256 hex — no truncation in token-isolation primitives.
  // The requested scope set is part of the key: the same (subject, audience) pair
  // can be exchanged with different scopes (discovery fallback below vs. a
  // tools/call), and a scope-blind key would hand one path the other's token.
  const { createHash } = require('crypto');
  return createHash('sha256')
    .update(`${subjectToken}:${targetAud}:${[...requestScopes].sort().join(' ')}`)
    .digest('hex');
}

function _cacheInsertWithEviction(key: string, value: { token: string; expiresAt: number }): void {
  cacheInsertWithEviction(_cache, key, value, MCP_EXCHANGE_CACHE_MAX);
}

// F10: the gateway's own client-credentials token, reused across exchanges until
// shortly before it expires. This is the gateway's MACHINE identity — the actor
// that performs Exchange #3 — not any user's credential.
let _actorToken: { token: string; expiresAt: number } | null = null;

// The ONE scope this gateway's client is granted on each backend resource, used
// only as the tools/list fallback below. One scope per resource is required, not
// stylistic: twoExchangeReconciler.js partitions the MCP Gateway app's grants
// per backend, so a set spanning two resources (e.g. `mcp:invoke invest:read`)
// is rejected with 400 invalid_scope, and `mcp:invoke` alone against the invest
// resource is silently retargeted to the olb audience. Verified live 2026-08-10.
const BACKEND_DISCOVERY_SCOPE: Record<'olb' | 'invest' | 'jwtverifier', string> = {
  olb: 'mcp:invoke',
  invest: 'invest:read',
  jwtverifier: 'jwt:verify',
};

/**
 * PingOne answers a rejected exchange with `{ error, error_description }`, but
 * axios throws "Request failed with status code 400" and drops it — which is
 * exactly how a total tools/list outage stayed unreadable in the logs. Re-throw
 * with the reason attached. Never includes the request body (it carries tokens).
 */
function exchangeError(err: unknown, backend: string, targetAud: string): Error {
  if (axios.isAxiosError(err) && err.response) {
    const data = err.response.data as { error?: string; error_description?: string } | undefined;
    const detail = [data?.error, data?.error_description].filter(Boolean).join(': ');
    return new Error(
      `RFC 8693 exchange to backend=${backend} (resource=${targetAud}) rejected with ` +
      `HTTP ${err.response.status}${detail ? ` — ${detail}` : ''}`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export interface ScopeMismatchReason {
  /** Backend the call routed to (olb | invest | jwtverifier). */
  backend: 'olb' | 'invest' | 'jwtverifier';
  /** Scopes the caller's subject token actually carries. */
  subjectScopes: string[];
  /** Scopes this backend's resource server accepts (native + mirrored). */
  backendScopes: string[];
  /** Caller-facing sentence naming BOTH sets and how to fix it. */
  reason: string;
}

/**
 * Recover a caller-facing scope-mismatch reason from a REJECTED exchange.
 *
 * The tools/call path deliberately sends the exchange scope-less when the
 * caller∩backend scope intersection is empty — that request behaviour is pinned
 * by the "sends no scope without the flag" contract in exchangeForBackend and is
 * NOT changed here. PingOne then answers that scope-less exchange with
 *   invalid_scope: May not request scopes for multiple resources
 * — a message about resource ambiguity that names NEITHER the caller's scopes
 * nor the backend's, so the real cause never reaches the caller and was only
 * ever visible in a gateway log.
 *
 * This maps that specific rejection back into the two scope sets, recovered from
 * the subject token and the backend topology, so a caller (HTTP or WS transport)
 * can DENY with a clear reason learned from the RESPONSE. It performs no
 * exchange and does not invent or grant any scope.
 *
 * Returns null for every OTHER failure (leaving the generic
 * token_exchange_failed path untouched), and null when the scopes DO overlap
 * (so an unrelated multi-resource error is never mislabeled a scope mismatch).
 */
export function scopeMismatchReasonFromExchangeError(
  err: unknown,
  subjectToken: string,
  toolName?: string,
): ScopeMismatchReason | null {
  const msg = err instanceof Error ? err.message : String(err);
  // Gate on PingOne's empty-intersection signature ONLY — a bare `invalid_scope`
  // (which other exchange failures also carry) must NOT be mislabeled.
  if (!/multiple resources/i.test(msg)) return null;

  const target = toolName ? routeTool(toolName) : 'olb';
  const backend: 'olb' | 'invest' | 'jwtverifier' =
    target === 'invest' || target === 'jwtverifier' ? target : 'olb';
  const decoded = jwt.decode(subjectToken) as { scope?: string } | null;
  const subjectScopes = (decoded?.scope || '').split(' ').filter(Boolean);
  const backendScopes = resourceScopesForBackend(backend);
  const allowed = new Set(backendScopes);
  // Confirm the intersection really is empty — the same test exchangeForBackend
  // makes. If the caller DOES hold a backend scope, this multi-resource error
  // came from something else; do not mask it as a scope mismatch.
  if (subjectScopes.some((s) => allowed.has(s))) return null;

  const reason =
    `scope mismatch — this call to backend '${backend}' needs one of its scopes ` +
    `[${backendScopes.join(', ') || 'none'}], but your token carries ` +
    `[${subjectScopes.join(', ') || 'none'}] with no overlap. Grant the caller one ` +
    `of the backend's scopes, or add it to that resource's mirroredScopes.`;
  return { backend, subjectScopes, backendScopes, reason };
}

export class McpTokenExchangeClient {
  constructor(private readonly config: GatewayConfig) {}

  /**
   * Mint (or reuse) the gateway's own client_credentials access token, used as
   * the `actor_token` on Exchange #3.
   *
   * Throws on failure — deliberately. The actor chain is a security control:
   * a gateway that cannot prove which service it is must not go on to complete
   * the exchange as though the question never arose (contract C4 — omission is
   * not permission).
   */
  private async getActorToken(): Promise<string> {
    if (_actorToken && _actorToken.expiresAt > Date.now() + 5000) return _actorToken.token;

    // Prefer the MCP Token Exchanger principal (GW_INTROSPECTION_CLIENT_*) —
    // that app is granted `gateway:mcp:invoke` on the gateway resource. The
    // MCP Gateway app (MCP_GW_CLIENT_ID) is intentionally granted tool scopes
    // on OLB/invest backends instead; a bare CC mint with it fails PingOne's
    // multi-resource check ("May not request scopes for multiple resources").
    const actorClientId = this.config.introspectionClientId || this.config.clientId;
    const actorClientSecret = this.config.introspectionClientSecret || this.config.clientSecret;

    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    // RFC 8707: narrow to ONE resource. MCP_GW_RESOURCE_URI may be a comma-list
    // (primary + https + a2a); pick the first entry.
    const actorResource = String(this.config.gatewayResourceUri || '')
      .split(',')
      .map((s) => s.trim())
      .find(Boolean);
    if (actorResource) params.set('resource', actorResource);
    // Explicit single-resource scope — required when the client has grants on
    // more than one resource (see oauthService.getClientCredentialsTokenAs).
    params.set('scope', 'gateway:mcp:invoke');

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.tokenEndpointAuthMethod === 'post') {
      params.set('client_id', actorClientId);
      params.set('client_secret', actorClientSecret);
    } else {
      const credentials = Buffer.from(
        `${actorClientId}:${actorClientSecret}`,
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await axios.post(this.config.tokenEndpoint, params.toString(), {
      headers,
      timeout: 10000,
    });
    const { access_token, expires_in } = response.data as { access_token?: string; expires_in?: number };
    if (!access_token) {
      throw new Error('Actor token mint response missing access_token');
    }
    _actorToken = { token: access_token, expiresAt: Date.now() + (expires_in ?? 300) * 1000 };
    return access_token;
  }

  /**
   * Exchange the inbound gateway token for an upstream MCP-server token.
   *
   * @param subjectToken — the inbound bearer token (aud=gateway)
   * @param toolName     — tool name from MCP request; drives backend routing
   *                       undefined → default to OLB (for tools/list etc.)
   */
  async exchange(subjectToken: string, toolName?: string): Promise<ExchangeResult> {
    const target = toolName ? routeTool(toolName) : 'olb';
    const backend: 'olb' | 'invest' | 'jwtverifier' =
      target === 'invest' || target === 'jwtverifier' ? target : 'olb';
    return this.exchangeForBackend(subjectToken, backend);
  }

  /**
   * Exchange for an explicit backend — used by tools/list proxying and by
   * `exchange()` after tool→backend routing.
   *
   * @param opts.allowDiscoveryScopeFallback — tools/list only. See
   *        BACKEND_DISCOVERY_SCOPE: use the backend's own single-resource scope
   *        when the subject token carries none, instead of sending a scope-less
   *        exchange PingOne always rejects. NEVER set on the tools/call path —
   *        a call must run on scopes the caller actually holds.
   */
  async exchangeForBackend(
    subjectToken: string,
    backend: 'olb' | 'invest' | 'jwtverifier',
    opts: { allowDiscoveryScopeFallback?: boolean } = {},
  ): Promise<ExchangeResult> {
    const targetAud = backendResourceUri(backend, this.config);

    // RFC 8707: PingOne requires `resource=` to narrow to ONE resource server
    // when the client has grants on several — `audience=` alone is silently
    // ignored ("May not request scopes for multiple resources"). The scope
    // must be explicit and single-resource: subject scopes ∩ target resource
    // scopes (native + mirroredScopes). Same pattern as the BFF's Exchange #1
    // (agentMcpTokenService.js).
    const decoded = jwt.decode(subjectToken) as { scope?: string } | null;
    const subjectScopes = (decoded?.scope || '').split(' ').filter(Boolean);
    const allowed = new Set(resourceScopesForBackend(backend));
    let requestScopes = subjectScopes.filter((s) => allowed.has(s));

    // Empty intersection = a scope-less exchange, which PingOne rejects outright
    // (400 invalid_scope "May not request scopes for multiple resources") because
    // this client holds grants on several resources. That is not a hypothetical:
    // a gateway-audience token legitimately carries only the gateway's own
    // invocation scope (`gateway:mcp:invoke` on the PingGateway MCP resource,
    // `mcp:invoke` on the Node one), and NO caller token ever carries
    // `jwt:verify` — so tools/list could never read those backends' catalogs.
    // For discovery, fall back to the backend's own scope, the same fixed
    // per-backend scope PingGateway's routes use (PG_OLB_SCOPE / PG_INVEST_SCOPE).
    if (requestScopes.length === 0 && opts.allowDiscoveryScopeFallback) {
      requestScopes = [BACKEND_DISCOVERY_SCOPE[backend]];
    }

    // On the CALL path there is no discovery fallback — deliberately, since
    // inventing a scope the caller does not hold would manufacture authority, and
    // `sends no scope without the flag — the tools/call path is unchanged` pins
    // that. So the scope-less exchange still goes out and PingOne still rejects
    // it. What it answers with is `invalid_scope: May not request scopes for
    // multiple resources` — an error about resource ambiguity that says nothing
    // about the real cause, observed live on every sensitive_order_history call
    // as a recurring error-level failure pointing at the wrong thing.
    //
    // Say the real cause HERE, before the request, and leave the behaviour
    // exactly as tested. Diagnosability was the defect; the failure itself is
    // correct and deliberate.
    if (requestScopes.length === 0) {
      console.warn(
        `[GW] scope-less RFC 8693 exchange to backend=${backend} (resource=${targetAud}): ` +
        `subject token carries [${subjectScopes.join(', ') || 'none'}], this backend accepts ` +
        `[${[...allowed].join(', ') || 'none'}] — no overlap. PingOne will reject this as ` +
        `"May not request scopes for multiple resources", which names neither. Grant the caller ` +
        `one of the backend's scopes, or add it to that resource's mirroredScopes.`,
      );
    }

    const key = cacheKey(subjectToken, targetAud, requestScopes);
    const cached = _cache.get(key);
    if (cached && cached.expiresAt > Date.now() + 5000) {
      return { token: cached.token, targetAud, cached: true };
    }

    // F10 — preserve the delegation chain into the last hop. Without an
    // actor_token the gateway drops out of the chain it just finished verifying,
    // and whatever `act` the MCP server sees is only what the AS chose to copy
    // forward. RFC 8693 §2.1: actor_token_type is REQUIRED when actor_token is
    // present. Minted before the exchange so a mint failure fails the whole call.
    const actorToken = await this.getActorToken();

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: actorToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      resource: targetAud,
    });
    if (requestScopes.length > 0) params.set('scope', requestScopes.join(' '));

    let exchangeHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.tokenEndpointAuthMethod === 'post') {
      params.set('client_id', this.config.clientId);
      params.set('client_secret', this.config.clientSecret);
    } else {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`,
      ).toString('base64');
      exchangeHeaders['Authorization'] = `Basic ${credentials}`;
    }

    let response: { data: unknown };
    try {
      response = await axios.post(
        this.config.tokenEndpoint,
        params.toString(),
        {
          headers: exchangeHeaders,
          timeout: 10000,
        },
      );
    } catch (err) {
      throw exchangeError(err, backend, targetAud);
    }

    const { access_token, expires_in } = response.data as { access_token?: string; expires_in?: number };
    if (!access_token) {
      throw new Error('Token exchange response missing access_token');
    }

    _cacheInsertWithEviction(key, {
      token: access_token,
      expiresAt: Date.now() + (expires_in ?? 300) * 1000,
    });

    return { token: access_token, targetAud, cached: false };
  }

  static clearCache(): void {
    _cache.clear();
    _actorToken = null;
  }
}
