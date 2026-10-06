import Anthropic from '@anthropic-ai/sdk';

import { geminiClient } from './gemini.js';
import { groqClient } from './groq.js';

export type AgentName = 'MAIN_AGENT' | 'WORKER_AGENT';

const value = (name: string, fallback = ''): string => process.env[name]?.trim() || fallback;
const numberValue = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const booleanValue = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
};

export const anthropicBaseUrl = (): string => value('ANTHROPIC_BASE_URL').replace(/\/+$/, '');
export const geminiBaseUrl = (): string => value('GEMINI_BASE_URL').replace(/\/+$/, '');

export type Provider = 'anthropic' | 'google' | 'groq';

/** Each agent picks its own provider with `<AGENT>_PROVIDER`: `anthropic` (default), `google` or `groq`. */
export const providerOf = (agent: AgentName): Provider => {
  const name = value(`${agent}_PROVIDER`).toLowerCase();
  return name === 'google' || name === 'groq' ? name : 'anthropic';
};
export const usesGoogle = (agent: AgentName): boolean => providerOf(agent) === 'google';
export const usesGroq = (agent: AgentName): boolean => providerOf(agent) === 'groq';
// Groq is always direct: the Privilege gateway has no Groq provider.
const providerBaseUrl = (agent: AgentName): string => (usesGroq(agent) ? '' : usesGoogle(agent) ? geminiBaseUrl() : anthropicBaseUrl());
export const viaGateway = (agent: AgentName): boolean => Boolean(providerBaseUrl(agent));

/** The model an agent uses when `<AGENT>_MODEL` is not set. */
const DEFAULT_MODEL: Record<AgentName, Record<Provider, string>> = {
  MAIN_AGENT: { anthropic: 'claude-sonnet-5', google: 'gemini-flash-latest', groq: 'openai/gpt-oss-120b' },
  WORKER_AGENT: { anthropic: 'claude-opus-5', google: 'gemini-flash-lite-latest', groq: 'openai/gpt-oss-120b' },
};
const modelFor = (agent: AgentName): string => value(`${agent}_MODEL`, DEFAULT_MODEL[agent][providerOf(agent)]);

/**
 * Build the model client for one agent. Gateway mode uses the Agent Access
 * key (Authorization Bearer for Anthropic, x-goog-api-key for Google); direct
 * mode uses that agent's provider key or the optional shared provider key.
 */
export function anthropicClient(agent: AgentName): Anthropic {
  if (usesGroq(agent)) {
    const apiKey = value(`${agent}_GROQ_KEY`) || value('GROQ_API_KEY');
    if (!apiKey) throw new Error(`Set ${agent}_GROQ_KEY or GROQ_API_KEY to use Groq (it is called directly, not through Privilege)`);
    const timeoutMs = Number(value('GROQ_TIMEOUT_MS'));
    return groqClient({ apiKey, baseUrl: value('GROQ_BASE_URL') || undefined, ...(timeoutMs > 0 ? { timeoutMs } : {}) });
  }
  if (usesGoogle(agent)) {
    const baseUrl = geminiBaseUrl();
    const apiKey = baseUrl ? value(`${agent}_KEY`) : value(`${agent}_GEMINI_KEY`) || value('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error(baseUrl
        ? `${agent}_KEY is required when GEMINI_BASE_URL points at Privilege`
        : `Set ${agent}_GEMINI_KEY or GEMINI_API_KEY, or configure GEMINI_BASE_URL and ${agent}_KEY`);
    }
    // GEMINI_TIMEOUT_MS overrides the per-attempt deadline (default 30 s; one retry on a stall).
    const timeoutMs = Number(value('GEMINI_TIMEOUT_MS'));
    return geminiClient({ apiKey, baseUrl, ...(timeoutMs > 0 ? { timeoutMs } : {}) });
  }

  const baseURL = anthropicBaseUrl();
  if (baseURL) {
    const authToken = value(`${agent}_KEY`);
    if (!authToken) {
      throw new Error(`${agent}_KEY is required when ANTHROPIC_BASE_URL points at Privilege`);
    }
    return new Anthropic({ authToken, baseURL });
  }

  const apiKey = value(`${agent}_ANTHROPIC_API_KEY`) || value('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error(`Set ${agent}_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY, or configure ANTHROPIC_BASE_URL and ${agent}_KEY`);
  }
  return new Anthropic({ apiKey });
}

export function agentAccessKey(agent: AgentName): string {
  return value(`${agent}_KEY`);
}

export function describeMode(agent: AgentName): string {
  if (usesGroq(agent)) return 'direct Groq (model calls bypass the Privilege gateway)';
  const provider = usesGoogle(agent) ? 'Google' : 'Anthropic';
  return viaGateway(agent) ? `${provider} via Privilege (${providerBaseUrl(agent)})` : `direct ${provider}`;
}

export interface MainAgentConfig {
  host: string;
  port: number;
  model: string;
  anthropic: Anthropic;
  bearer: string;
  bffSharedSecret: string;
  workerA2aUrl: string;
  workerTraceUrl: string;
  /** The middle agent's gateway A2A URL for the three-deep chain; blank = chain disabled. */
  chainA2aUrl: string;
}

export function mainAgentConfig(): MainAgentConfig {
  const workerPort = numberValue('WORKER_AGENT_PORT', 3301);
  return {
    host: value('MAIN_AGENT_HOST', '127.0.0.1'),
    port: numberValue('MAIN_AGENT_PORT', 3300),
    model: modelFor('MAIN_AGENT'),
    anthropic: anthropicClient('MAIN_AGENT'),
    bearer: agentAccessKey('MAIN_AGENT'),
    bffSharedSecret: value('A2A_BFF_SHARED_SECRET'),
    workerA2aUrl: value('WORKER_A2A_URL', `http://127.0.0.1:${workerPort}/a2a`),
    workerTraceUrl: value('WORKER_TRACE_URL', `http://127.0.0.1:${workerPort}/trace`),
    chainA2aUrl: value('CHAIN_A2A_URL'),
  };
}

export interface WorkerAgentConfig {
  host: string;
  port: number;
  /** The JSON-RPC address published in the agent card; behind Privilege, the gateway route. */
  publicUrl: string;
  model: string;
  anthropic: Anthropic;
  bearer: string;
  mcpUrl: string;
  requireBearer: boolean;
}

export function workerAgentConfig(): WorkerAgentConfig {
  return {
    host: value('WORKER_AGENT_HOST', '127.0.0.1'),
    port: numberValue('WORKER_AGENT_PORT', 3301),
    publicUrl: value('WORKER_PUBLIC_URL', `http://127.0.0.1:${numberValue('WORKER_AGENT_PORT', 3301)}/a2a/jsonrpc`),
    model: modelFor('WORKER_AGENT'),
    anthropic: anthropicClient('WORKER_AGENT'),
    bearer: agentAccessKey('WORKER_AGENT'),
    mcpUrl: value('MCP_URL', `http://127.0.0.1:${numberValue('MCP_SERVER_PORT', 3302)}/mcp`),
    requireBearer: booleanValue('WORKER_REQUIRE_BEARER', false),
  };
}

export interface McpServerConfig {
  host: string;
  port: number;
  requireBearer: boolean;
  demoInjection: boolean;
  jsonResponse: boolean;
  stateful: boolean;
  sessionTtlMs: number;
}

export function mcpServerConfig(): McpServerConfig {
  return {
    host: value('MCP_SERVER_HOST', '127.0.0.1'),
    port: numberValue('MCP_SERVER_PORT', 3302),
    requireBearer: booleanValue('MCP_REQUIRE_BEARER', false),
    demoInjection: booleanValue('MCP_DEMO_INJECTION', false),
    jsonResponse: booleanValue('MCP_JSON_RESPONSE', false),
    stateful: booleanValue('MCP_STATEFUL', true),
    sessionTtlMs: numberValue('MCP_SESSION_TTL_MS', 300_000),
  };
}
