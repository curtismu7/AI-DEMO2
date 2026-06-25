'use strict';

/**
 * PingOne agent-token acquisition.
 *
 * Ported from demo_agent_service/src/agentIdentity.ts (the proven, in-repo
 * client-credentials logic) and generalised so `scope` and `audience` are
 * configurable rather than the hardcoded `scope: 'ai_agent'`.
 *
 * Mode A (default): client_secret — Basic-auth client_credentials.
 * Mode B (PKI):     private_key_jwt — signs a JWT with the agent's private key
 *                   (USE_PKI_AGENT_CREDS=true + AGENT_CERT_PATH).
 *
 * Returns a short-lived client-credentials access_token representing the
 * dedicated PingOne AI_AGENT app. The caller (e.g. a Copilot Studio tool)
 * presents it as a Bearer when calling the MCP gateway.
 */

import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import axios, { type AxiosResponse } from 'axios';
import jwt from 'jsonwebtoken';
import type { BrokerConfig } from './config';

export interface AgentToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
}

interface CacheEntry {
  token: AgentToken;
  expiresAt: number;
}

// Cache keyed by identity+scope+audience so a process serving more than one
// agent identity never returns the wrong token.
const _cache = new Map<string, CacheEntry>();
// In-flight promise cache (HI-01): the first cold-start caller fires the CC
// request and stores the promise; concurrent callers await the same promise so
// we never run N parallel client_credentials grants. Cleared in `.finally`.
const _inflight = new Map<string, Promise<AgentToken>>();

function cacheKey(config: BrokerConfig): string {
  return `${config.clientId}|${config.scope}|${config.audience}`;
}

export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const noopLogger: Logger = { info: () => {}, error: () => {} };

export async function acquireAgentToken(
  config: BrokerConfig,
  logger: Logger = noopLogger,
): Promise<AgentToken> {
  const key = cacheKey(config);

  const cached = _cache.get(key);
  if (cached && cached.expiresAt > Date.now() + 10_000) {
    return cached.token;
  }

  const existing = _inflight.get(key);
  if (existing) return existing;

  const fetcher = (
    config.usePkiCreds
      ? _acquireViaPrivateKeyJwt(config, logger)
      : _acquireViaClientSecret(config, logger)
  ).finally(() => {
    _inflight.delete(key);
  });
  _inflight.set(key, fetcher);
  return fetcher;
}

function _buildScopeParams(config: BrokerConfig): URLSearchParams {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: config.scope,
  });
  // Some PingOne envs need an explicit audience/resource to stamp the token aud.
  if (config.audience) params.set('audience', config.audience);
  return params;
}

function _store(config: BrokerConfig, data: any): AgentToken {
  const { access_token, token_type, expires_in, scope } = data;
  if (!access_token) throw new Error('client_credentials response missing access_token');
  const token: AgentToken = {
    accessToken: access_token,
    tokenType: token_type || 'Bearer',
    expiresIn: expires_in || 300,
    scope: scope || config.scope,
  };
  _cache.set(cacheKey(config), {
    token,
    expiresAt: Date.now() + token.expiresIn * 1000,
  });
  return token;
}

async function _acquireViaClientSecret(config: BrokerConfig, logger: Logger): Promise<AgentToken> {
  const params = _buildScopeParams(config);
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (config.tokenAuthMethod === 'post') {
    // client_secret_post — credentials in the body (the convention for this
    // environment's agent/MCP apps; a basic↔post mismatch yields invalid_client).
    params.set('client_id', config.clientId);
    params.set('client_secret', config.clientSecret);
  } else {
    // client_secret_basic — credentials in the Authorization header.
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  logger.info(
    {
      client_id: config.clientId,
      scope: config.scope,
      auth_method: `client_secret_${config.tokenAuthMethod}`,
    },
    'client_credentials agent token requested',
  );

  // HI-03: scrub the axios error before it bubbles up — the default error
  // carries the request body and the credentials via `err.config`.
  let response: AxiosResponse;
  try {
    response = await axios.post(config.tokenEndpoint, params.toString(), {
      headers,
      timeout: 10_000,
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const detail =
      e?.response?.data?.error || e?.response?.data?.error_description || e?.message || 'unknown';
    throw new Error(`agent_cc_failed status=${status ?? 'n/a'} detail=${detail}`);
  }

  const token = _store(config, response.data);
  logger.info({ token_type: token.tokenType, expires_in: token.expiresIn }, 'agent token acquired');
  return token;
}

async function _acquireViaPrivateKeyJwt(config: BrokerConfig, logger: Logger): Promise<AgentToken> {
  if (!config.agentCertPath) {
    throw new Error('USE_PKI_AGENT_CREDS=true but AGENT_CERT_PATH is not set');
  }

  // Load private key from PKCS#12 or PEM file.
  const raw = readFileSync(config.agentCertPath);
  const privateKey = createPrivateKey(raw);

  // Build client_assertion JWT per RFC 7521 §4.2 / OIDC Core §9.
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: config.clientId,
      sub: config.clientId,
      aud: config.tokenEndpoint,
      jti: `${config.clientId}-${now}-${Math.random().toString(36).slice(2)}`,
      iat: now,
      exp: now + 300,
    },
    privateKey,
    { algorithm: 'RS256' },
  );

  const params = _buildScopeParams(config);
  params.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
  params.set('client_assertion', assertion);
  params.set('client_id', config.clientId);

  logger.info(
    { client_id: config.clientId, scope: config.scope, auth_method: 'private_key_jwt' },
    'client_credentials agent token requested',
  );

  // HI-03: scrub the axios error — the body carries the signed client_assertion.
  let response: AxiosResponse;
  try {
    response = await axios.post(config.tokenEndpoint, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const detail =
      e?.response?.data?.error || e?.response?.data?.error_description || e?.message || 'unknown';
    throw new Error(`agent_cc_pki_failed status=${status ?? 'n/a'} detail=${detail}`);
  }

  const token = _store(config, response.data);
  logger.info({ token_type: token.tokenType, expires_in: token.expiresIn }, 'agent token acquired');
  return token;
}

export function clearTokenCache(): void {
  _cache.clear();
  _inflight.clear();
}
