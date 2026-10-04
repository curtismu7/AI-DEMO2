import Anthropic from '@anthropic-ai/sdk';

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
export const viaGateway = (): boolean => Boolean(anthropicBaseUrl());

/**
 * Build the official SDK client for one agent. Gateway mode uses the
 * Agent Access key as an Authorization Bearer token; direct mode uses that
 * agent's provider key or the optional shared Anthropic key.
 */
export function anthropicClient(agent: AgentName): Anthropic {
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

export function describeMode(): string {
  return viaGateway() ? `Privilege (${anthropicBaseUrl()})` : 'direct Anthropic';
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
    model: value('MAIN_AGENT_MODEL', 'claude-sonnet-5'),
    anthropic: anthropicClient('MAIN_AGENT'),
    bearer: agentAccessKey('MAIN_AGENT'),
    bffSharedSecret: value('A2A_BFF_SHARED_SECRET'),
    workerA2aUrl: value('WORKER_A2A_URL', `http://127.0.0.1:${workerPort}/a2a`),
    workerTraceUrl: value('WORKER_TRACE_URL', `http://127.0.0.1:${workerPort}/trace`),
    chainA2aUrl: value('CHAIN_A2A_URL'),
  };
}

export interface WorkerAgentConfig {
  port: number;
  model: string;
  anthropic: Anthropic;
  bearer: string;
  mcpUrl: string;
  requireBearer: boolean;
}

export function workerAgentConfig(): WorkerAgentConfig {
  return {
    port: numberValue('WORKER_AGENT_PORT', 3301),
    model: value('WORKER_AGENT_MODEL', 'claude-opus-5'),
    anthropic: anthropicClient('WORKER_AGENT'),
    bearer: agentAccessKey('WORKER_AGENT'),
    mcpUrl: value('MCP_URL', `http://127.0.0.1:${numberValue('MCP_SERVER_PORT', 3302)}/mcp`),
    requireBearer: booleanValue('WORKER_REQUIRE_BEARER', false),
  };
}

export interface McpServerConfig {
  port: number;
  requireBearer: boolean;
  demoInjection: boolean;
  jsonResponse: boolean;
  stateful: boolean;
  sessionTtlMs: number;
}

export function mcpServerConfig(): McpServerConfig {
  return {
    port: numberValue('MCP_SERVER_PORT', 3302),
    requireBearer: booleanValue('MCP_REQUIRE_BEARER', false),
    demoInjection: booleanValue('MCP_DEMO_INJECTION', false),
    jsonResponse: booleanValue('MCP_JSON_RESPONSE', false),
    stateful: booleanValue('MCP_STATEFUL', true),
    sessionTtlMs: numberValue('MCP_SESSION_TTL_MS', 300_000),
  };
}
