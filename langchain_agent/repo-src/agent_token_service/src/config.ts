'use strict';

import dotenv from 'dotenv';
dotenv.config();

/**
 * Broker configuration. All values come from the environment (.env or a vault
 * layered on top). Required values fail fast at startup so a misconfigured
 * deploy never serves a 500 on the first /token request.
 */
export interface BrokerConfig {
  port: number;
  host: string;
  // Caller front-door auth: the static key callers send in `x-api-key`.
  apiKey: string;
  // PingOne token endpoint.
  tokenEndpoint: string;
  // Copilot's dedicated PingOne agent app (WEB_APP + client-credentials).
  clientId: string;
  clientSecret: string;
  // Token-endpoint auth method. PingOne agent/MCP apps in this environment use
  // 'post' (credentials in body); 'basic' sends the Authorization header.
  tokenAuthMethod: 'basic' | 'post';
  // Requested scope (space-delimited) — e.g. 'agent:invoke'.
  scope: string;
  // Optional explicit audience/resource param.
  audience: string;
  // Optional private_key_jwt mode (parity with demo_agent_service).
  usePkiCreds: boolean;
  agentCertPath: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Compute the PingOne token endpoint from envId + region when an explicit
// PINGONE_TOKEN_ENDPOINT isn't set. Mirrors demo_agent_service/src/config.ts.
function resolveTokenEndpoint(): string {
  const explicit = process.env.PINGONE_TOKEN_ENDPOINT;
  if (explicit) return explicit;
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  if (envId) return `https://auth.pingone.${region}/${envId}/as/token`;
  return required('PINGONE_TOKEN_ENDPOINT');
}

export function loadConfig(): BrokerConfig {
  const usePkiCreds = optional('USE_PKI_AGENT_CREDS', 'false') === 'true';
  const agentCertPath = optional('AGENT_CERT_PATH', '');
  if (usePkiCreds && !agentCertPath) {
    throw new Error('USE_PKI_AGENT_CREDS=true but AGENT_CERT_PATH is not set');
  }

  return {
    port: parseInt(process.env.PORT || '8097', 10),
    // Default to loopback so a misconfigured deploy can't expose the token
    // broker on all interfaces. Set HOST=0.0.0.0 explicitly behind TLS/a tunnel.
    host: process.env.HOST || '127.0.0.1',
    apiKey: required('BROKER_API_KEY'),
    tokenEndpoint: resolveTokenEndpoint(),
    clientId: required('PINGONE_AGENT_CLIENT_ID'),
    // Secret is required unless using private_key_jwt.
    clientSecret: usePkiCreds
      ? optional('PINGONE_AGENT_CLIENT_SECRET', '')
      : required('PINGONE_AGENT_CLIENT_SECRET'),
    tokenAuthMethod: optional('PINGONE_AGENT_TOKEN_AUTH_METHOD', 'post') === 'basic'
      ? 'basic'
      : 'post',
    scope: optional('PINGONE_AGENT_SCOPE', 'agent:invoke'),
    audience: optional('PINGONE_AGENT_AUDIENCE', ''),
    usePkiCreds,
    agentCertPath,
  };
}
