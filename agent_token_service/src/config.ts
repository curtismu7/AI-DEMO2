'use strict';

import { readFileSync } from 'node:fs';
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
  // Optional RFC 8707 resource indicator (PingOne audience binding).
  resource: string;
  // Optional private_key_jwt mode (parity with demo_agent_service).
  usePkiCreds: boolean;
  agentCertPath: string;
  // Sidecar targets: name -> scope/audience/resource override for POST /v1/token.
  targets: Record<string, TargetConfig>;
  // Unix socket to serve on, in addition to host:port. Set it (and leave HOST on loopback)
  // so only containers that mount the socket's volume can reach the sidecar.
  socketPath?: string;
  // Extra OAuth clients the relay (POST /as/<token|par|introspect>) authenticates for, besides
  // the primary identity above. See ManagedClient.
  managedClients?: ManagedClient[];
}

// A client whose credentials live only here. The relay adds its authentication to a request
// the caller built without the secret, so the caller never holds it.
export interface ManagedClient {
  id: string;
  secret: string;
  authMethod: 'basic' | 'post';
}

export interface TargetConfig {
  scope?: string;
  audience?: string;
  resource?: string;
  // Name of a `resources` entry in scope-topology.json. Its `uri` becomes `resource` and its
  // `scopes` become `scope`, so the stack's source of truth is not copied by hand. Anything set
  // explicitly on the target wins. Consumed at load: it is not carried on the resolved target.
  topologyResource?: string;
}

interface TopologyResource {
  uri?: string;
  scopes?: string[];
}

// The topology is the repo's scope/audience source of truth (schema-checked in CI). The
// sidecar only reads it, once, at startup; a changed file takes effect on restart.
function readTopologyResources(): Record<string, TopologyResource> {
  const file = process.env.TOPOLOGY_PATH || '/config/scope-topology.json';
  let topology: { resources?: Record<string, TopologyResource> };
  try {
    topology = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(
      `TARGETS_JSON uses topologyResource but ${file} cannot be read as JSON: ` +
        `${err instanceof Error ? err.message : err}`,
    );
  }
  if (!topology.resources || typeof topology.resources !== 'object') {
    throw new Error(`${file} has no "resources" object`);
  }
  return topology.resources;
}

function parseTargets(): Record<string, TargetConfig> {
  const raw = process.env.TARGETS_JSON;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TARGETS_JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TARGETS_JSON must be an object of {target: {scope, audience, resource}}');
  }

  const out: Record<string, TargetConfig> = {};
  let topology: Record<string, TopologyResource> | undefined;
  for (const [name, target] of Object.entries(parsed as Record<string, TargetConfig>)) {
    const { topologyResource, ...explicit } = target;
    if (!topologyResource) {
      out[name] = explicit;
      continue;
    }
    if (!topology) topology = readTopologyResources();
    if (!Object.prototype.hasOwnProperty.call(topology, topologyResource)) {
      throw new Error(`TARGETS_JSON target "${name}": "${topologyResource}" is not a resource in the topology`);
    }
    const res = topology[topologyResource];
    if (!res.uri || !res.scopes || res.scopes.length === 0) {
      throw new Error(`TARGETS_JSON target "${name}": topology resource "${topologyResource}" has no uri or scopes`);
    }
    out[name] = { scope: res.scopes.join(' '), resource: res.uri, ...explicit };
  }
  return out;
}

// MANAGED_CLIENTS_JSON: [{"id":"<client id>","secretEnv":"<ENV VAR HOLDING THE SECRET>","authMethod":"post"}]
// The secret is read from the named env var (this service's own .env), never from the JSON.
function parseManagedClients(): ManagedClient[] {
  const raw = process.env.MANAGED_CLIENTS_JSON;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MANAGED_CLIENTS_JSON is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('MANAGED_CLIENTS_JSON must be an array');
  return parsed.map((entry, i) => {
    const { id, secretEnv, authMethod } = (entry || {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !id) throw new Error(`MANAGED_CLIENTS_JSON[${i}] has no "id"`);
    if (typeof secretEnv !== 'string' || !secretEnv) {
      throw new Error(`MANAGED_CLIENTS_JSON[${i}] (${id}) has no "secretEnv"`);
    }
    const secret = process.env[secretEnv];
    if (!secret) throw new Error(`MANAGED_CLIENTS_JSON[${i}] (${id}): env var ${secretEnv} is not set`);
    return { id, secret, authMethod: authMethod === 'basic' ? 'basic' : 'post' };
  });
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
    resource: optional('PINGONE_AGENT_RESOURCE', ''),
    usePkiCreds,
    agentCertPath,
    targets: parseTargets(),
    socketPath: process.env.SOCKET_PATH || undefined,
    managedClients: parseManagedClients(),
  };
}
