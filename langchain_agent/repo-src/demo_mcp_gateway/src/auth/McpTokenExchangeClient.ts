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
 */

import axios from 'axios';
import { routeTool, backendResourceUri } from '../router';
import type { GatewayConfig } from '../config';
import { cacheInsertWithEviction } from '../boundedTokenCache';

export interface ExchangeResult {
  token: string;
  targetAud: string;
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

export class McpTokenExchangeClient {
  constructor(private readonly config: GatewayConfig) {}

  /**
   * Exchange the inbound gateway token for an upstream MCP-server token.
   *
   * @param subjectToken — the inbound bearer token (aud=gateway)
   * @param toolName     — tool name from MCP request; drives backend routing
   *                       undefined → default to OLB (for tools/list etc.)
   */
  async exchange(subjectToken: string, toolName?: string): Promise<ExchangeResult> {
    const backend = toolName ? routeTool(toolName) : 'olb';
    const targetAud = backendResourceUri(backend, this.config);

    const key = cacheKey(subjectToken, targetAud);
    const cached = _cache.get(key);
    if (cached && cached.expiresAt > Date.now() + 5000) {
      return { token: cached.token, targetAud };
    }

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: targetAud,
    });

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

    return { token: access_token, targetAud };
  }

  static clearCache(): void {
    _cache.clear();
  }
}
