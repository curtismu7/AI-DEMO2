'use strict';

/**
 * Agent identity — acquires the actor_token for RFC 8693 token exchange.
 *
 * Mode A (default): client_secret — Basic auth client credentials flow.
 * Mode B (PKI):     private_key_jwt — signs a JWT with the agent's private key
 *                   (enabled via USE_PKI_AGENT_CREDS=true + AGENT_CERT_PATH).
 *
 * Returns a short-lived client-credentials access_token representing agent1.
 * The BFF/agent passes this as `actor_token` in the RFC 8693 exchange so that
 * PingOne can embed `act: { sub: AGENT_CLIENT_ID }` in the delegated token.
 */

import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import axios, { type AxiosResponse } from 'axios';
import jwt from 'jsonwebtoken';
import { AgentConfig } from './config';
import { teachLog } from './teachLogger';

let _cachedActorToken: { token: string; expiresAt: number } | null = null;
// HI-01: in-flight promise cache. The first cold-start caller fires the CC
// request to PingOne and stores the promise here; concurrent callers await
// the same promise so we never run N parallel client_credentials grants on
// startup. Cleared in the `.finally(...)` so future expiries can re-fetch.
let _inflightActorToken: Promise<string> | null = null;

export async function getActorToken(config: AgentConfig): Promise<string> {
  if (_cachedActorToken && _cachedActorToken.expiresAt > Date.now() + 10_000) {
    return _cachedActorToken.token;
  }

  if (_inflightActorToken) return _inflightActorToken;

  const fetcher = config.usePkiCreds
    ? _acquireViaPrivateKeyJwt(config)
    : _acquireViaClientSecret(config);
  _inflightActorToken = fetcher.finally(() => {
    _inflightActorToken = null;
  });
  return _inflightActorToken;
}

async function _acquireViaClientSecret(config: AgentConfig): Promise<string> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'ai_agent',
  });

  teachLog.step(1, 2, 'client_credentials actor token requested', { client_id: config.clientId, scope: 'ai_agent', auth_method: 'client_secret_basic' });

  // HI-03: scrub axios error before it bubbles up — the default error carries
  // the request body and Basic credentials via `err.config`.
  let response: AxiosResponse;
  try {
    response = await axios.post(config.tokenEndpoint, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      timeout: 10_000,
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const detail = e?.response?.data?.error || e?.response?.data?.error_description || e?.message || 'unknown';
    throw new Error(`agent_cc_failed status=${status ?? 'n/a'} detail=${detail}`);
  }

  const { access_token, expires_in } = response.data;
  if (!access_token) throw new Error('client_credentials response missing access_token');

  _cachedActorToken = { token: access_token, expiresAt: Date.now() + (expires_in || 300) * 1000 };
  teachLog.step(2, 2, 'actor token acquired', { token_type: response.data.token_type, expires_in });
  return access_token;
}

async function _acquireViaPrivateKeyJwt(config: AgentConfig): Promise<string> {
  if (!config.agentCertPath) {
    throw new Error('USE_PKI_AGENT_CREDS=true but AGENT_CERT_PATH is not set');
  }

  // Load private key from PKCS#12 or PEM file
  const raw = readFileSync(config.agentCertPath);
  const privateKey = createPrivateKey(raw);

  // Build client_assertion JWT per RFC 7521 §4.2 / OIDC Core §9
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

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'ai_agent',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    client_id: config.clientId,
  });

  teachLog.step(1, 2, 'client_credentials actor token requested', { client_id: config.clientId, scope: 'ai_agent', auth_method: 'private_key_jwt' });

  // HI-03: scrub axios error — body carries the signed client_assertion.
  let response: AxiosResponse;
  try {
    response = await axios.post(config.tokenEndpoint, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const detail = e?.response?.data?.error || e?.response?.data?.error_description || e?.message || 'unknown';
    throw new Error(`agent_cc_pki_failed status=${status ?? 'n/a'} detail=${detail}`);
  }

  const { access_token, expires_in } = response.data;
  if (!access_token) throw new Error('private_key_jwt client_credentials response missing access_token');

  _cachedActorToken = { token: access_token, expiresAt: Date.now() + (expires_in || 300) * 1000 };
  teachLog.step(2, 2, 'actor token acquired', { token_type: response.data.token_type, expires_in });
  return access_token;
}

export function clearActorTokenCache(): void {
  _cachedActorToken = null;
}
