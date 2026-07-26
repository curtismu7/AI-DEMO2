'use strict';

/**
 * McpTokenExchangeClient — RFC 8693 exchange for HTTP MCP upstream tokens (D-03).
 *
 * After PingOne Authorize permits a request, this client exchanges the
 * inbound gateway-audience token for a next-hop token targeted at the
 * correct upstream MCP-server audience (olb or invest), per D-05.
 *
 * Token flow (D-04: no token to LLM):
 *   caller  →  gateway (aud=gateway)  →  exchange  →  upstream (aud=mcp-olb or mcp-invest)
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

function cacheKey(subjectToken: string, targetAud: string): string {
  // Full SHA-256 hex — no truncation in token-isolation primitives.
  const { createHash } = require('crypto');
  return createHash('sha256').update(`${subjectToken}:${targetAud}`).digest('hex');
}

function _cacheInsertWithEviction(key: string, value: { token: string; expiresAt: number }): void {
  cacheInsertWithEviction(_cache, key, value, MCP_EXCHANGE_CACHE_MAX);
}

// F10: the gateway's own client-credentials token, reused across exchanges until
// shortly before it expires. This is the gateway's MACHINE identity — the actor
// that performs Exchange #3 — not any user's credential.
let _actorToken: { token: string; expiresAt: number } | null = null;

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
   */
  async exchangeForBackend(subjectToken: string, backend: 'olb' | 'invest' | 'jwtverifier'): Promise<ExchangeResult> {
    const targetAud = backendResourceUri(backend, this.config);

    const key = cacheKey(subjectToken, targetAud);
    const cached = _cache.get(key);
    if (cached && cached.expiresAt > Date.now() + 5000) {
      return { token: cached.token, targetAud, cached: true };
    }

    // RFC 8707: PingOne requires `resource=` to narrow to ONE resource server
    // when the client has grants on several — `audience=` alone is silently
    // ignored ("May not request scopes for multiple resources"). The scope
    // must be explicit and single-resource: subject scopes ∩ target resource
    // scopes (native + mirroredScopes). Same pattern as the BFF's Exchange #1
    // (agentMcpTokenService.js).
    const decoded = jwt.decode(subjectToken) as { scope?: string } | null;
    const subjectScopes = (decoded?.scope || '').split(' ').filter(Boolean);
    const allowed = new Set(resourceScopesForBackend(backend));
    const requestScopes = subjectScopes.filter((s) => allowed.has(s));

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

    const response = await axios.post(
      this.config.tokenEndpoint,
      params.toString(),
      {
        headers: exchangeHeaders,
        timeout: 10000,
      },
    );

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
