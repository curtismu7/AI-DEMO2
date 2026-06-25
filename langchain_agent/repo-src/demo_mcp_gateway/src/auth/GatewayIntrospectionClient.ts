/**
 * GatewayIntrospectionClient — RFC 7662 active-token introspection.
 *
 * Called by authorizeMcpRequest before GatewayTokenPolicy to confirm the inbound
 * token is currently active (not revoked, not expired at the AS). Caches results
 * 30 s per token to avoid hammering PingOne on every tool call.
 *
 * Fails CLOSED: network errors → active: false (caller should reject the request).
 * GW_INTROSPECTION_ENDPOINT is required — introspection is never skipped.
 */

import { createHash } from 'node:crypto';
import axios from 'axios';
import type { GatewayConfig } from '../config';

export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  scope?: string;
  exp?: number;
  aud?: string | string[];
  client_id?: string;
  error?: string;
}

const _cache = new Map<string, { result: IntrospectionResult; expiresAt: number }>();
// HI-01: in production the positive-cache TTL is the residual revocation
// window — a token marked inactive at the AS still works for up to TTL
// against the gateway. 5s is a reasonable trade for a banking deployment;
// dev keeps 30s to limit AS round trips during demos. Document this in
// bff-sessions skill.
const CACHE_TTL_MS = process.env.NODE_ENV === 'production' ? 5_000 : 30_000;

function cacheKey(token: string): string {
  // Full hex digest — the cosmetic .slice(0, 24) is a 96-bit collision
  // surface for a cache used in a security-sensitive code path. Memory
  // cost of the extra 40 hex chars is trivial.
  return createHash('sha256').update(token).digest('hex');
}

// A TRANSIENT failure (network unreachable / timeout / 5xx) is worth retrying
// and must NOT be negative-cached — otherwise a brief PingOne/AS blip right
// after a restart turns into a sticky 401 for the demo operator. A genuine 4xx
// (e.g. bad introspection client creds) is a persistent config error: not
// retried, still fails closed.
function isTransientError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    if (!err.response) return true; // no HTTP response → connection refused / timeout / DNS
    return err.response.status >= 500 || err.response.status === 429; // 5xx or rate-limited
  }
  return true; // unknown error shape → treat as transient (retry is bounded)
}

export class GatewayIntrospectionClient {
  constructor(private readonly config: GatewayConfig) {}

  async introspect(token: string): Promise<IntrospectionResult> {
    // Introspection endpoint is required — if not configured, fail closed
    if (!this.config.introspectionEndpoint) {
      const msg = 'GW_INTROSPECTION_ENDPOINT not configured (required for token validation)';
      console.warn(`[GatewayIntrospection] ${msg}`);
      return { active: false, error: msg };
    }

    const key = cacheKey(token);
    const cached = _cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const params = new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    });

    // Authenticate introspection request using the gateway's configured method.
    // PingOne apps provisioned with token_endpoint_auth_method=post require
    // client credentials in the POST body (client_secret_post); apps using
    // client_secret_basic require an Authorization: Basic header.
    // MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD controls this (default: 'basic').
    // Use dedicated introspection credentials when configured; otherwise
    // fall back to the gateway's own client credentials. PingOne only returns
    // active:true for a token when the introspecting client is the issuing
    // client or a resource server that owns the token's audience — so if the
    // gateway is not that resource server, set GW_INTROSPECTION_CLIENT_ID +
    // GW_INTROSPECTION_CLIENT_SECRET to the appropriate client.
    const introspectClientId = this.config.introspectionClientId || this.config.clientId;
    const introspectClientSecret = this.config.introspectionClientSecret || this.config.clientSecret;

    const introspectHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.tokenEndpointAuthMethod === 'post') {
      // client_secret_post: credentials go in the POST body
      params.set('client_id', introspectClientId);
      params.set('client_secret', introspectClientSecret);
    } else {
      // client_secret_basic: credentials go in the Authorization header
      const credentials = Buffer.from(
        `${introspectClientId}:${introspectClientSecret}`
      ).toString('base64');
      introspectHeaders.Authorization = `Basic ${credentials}`;
    }

    const body = params.toString();

    // Bounded retry on TRANSIENT failures so a brief PingOne/AS blip right after
    // a restart does not surface as a spurious 401. One retry with a short
    // backoff; a confirmed active:false (HTTP 200) is cached as before, but a
    // transport failure is NOT cached so the next tool call retries immediately
    // instead of being stuck for the negative-cache window.
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 250;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post(
          this.config.introspectionEndpoint,
          body,
          {
            headers: introspectHeaders,
            timeout: 5000,
          }
        );

        const data = response.data as Record<string, unknown>;
        const result: IntrospectionResult = {
          active: data.active === true,
          sub: data.sub as string | undefined,
          scope: data.scope as string | undefined,
          exp: data.exp as number | undefined,
          aud: data.aud as string | string[] | undefined,
          client_id: data.client_id as string | undefined,
        };

        _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        break;
      }
    }

    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(
      '[GatewayIntrospection] Introspection failed — failing closed (not cached, retries next call):',
      msg
    );
    // Fail CLOSED, but deliberately do NOT cache a transport-error negative:
    // caching it would surface as a spurious 401 for up to the negative-cache
    // window right after a restart. Recovery is immediate on the next call.
    return { active: false, error: msg };
  }

  static clearCache(): void {
    _cache.clear();
  }
}
