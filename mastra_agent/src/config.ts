import * as dotenv from 'dotenv';
dotenv.config();

// Surface an insecure-default misconfig at startup. The dev fallback below keeps
// local dev working, but a silent weak shared secret must be visible.
if (!process.env.BFF_INTERNAL_SECRET) {
  console.warn(
    '⚠️  [config] BFF_INTERNAL_SECRET is not set — using the insecure dev fallback. ' +
      'Set BFF_INTERNAL_SECRET before any non-local deployment.',
  );
}

export interface Config {
  llmApiKey: string;
  anthropicApiKey: string;
  llmBaseUrl: string;
  model: string;
  bffInternalSecret: string;
  bffToolUrl: string;
  host: string;
  port: number;
}

export function getConfig(): Config {
  // The local llama.cpp multi-model proxy (:8090, OpenAI-compatible, local, $0)
  // is the default provider. Override via AGENT_LLM_BASE_URL /
  // AGENT_LLM_API_KEY / AGENT_LLM_MODEL to point at OpenAI or any other
  // OpenAI-compatible endpoint.
  return {
    llmApiKey:
      process.env.AGENT_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? 'llama-cpp',
    // Anthropic uses a dedicated key — the OpenAI-compat/local key above is
    // never valid against api.anthropic.com.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    llmBaseUrl: process.env.AGENT_LLM_BASE_URL ?? 'http://localhost:8090/v1',
    // Default is a proxy tier id (the router recognizes it and serves it from
    // the smallest loaded tier). Override via AGENT_LLM_MODEL.
    model:
      process.env.AGENT_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'phi-4-mini-instruct',
    bffInternalSecret: process.env.BFF_INTERNAL_SECRET ?? 'dev-shared-secret-change-me',
    bffToolUrl: process.env.BFF_INTERNAL_TOOL_URL ?? 'http://127.0.0.1:3001/internal/agent-tool',
    host: process.env.AGENT_HTTP_HOST ?? '127.0.0.1',
    // Guard against NaN (bad AGENT_HTTP_PORT) so we never hand app.listen(NaN).
    port: Number.isNaN(parseInt(process.env.AGENT_HTTP_PORT ?? '8892', 10))
      ? 8892
      : parseInt(process.env.AGENT_HTTP_PORT ?? '8892', 10),
  };
}
