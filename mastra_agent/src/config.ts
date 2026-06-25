import * as dotenv from 'dotenv';
dotenv.config();

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
  // LM Studio is the default provider (OpenAI-compatible, local, $0). Override
  // via AGENT_LLM_BASE_URL / AGENT_LLM_API_KEY / AGENT_LLM_MODEL to point at
  // OpenAI or any other OpenAI-compatible endpoint.
  return {
    llmApiKey:
      process.env.AGENT_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? 'lm-studio',
    // Anthropic uses a dedicated key — the OpenAI-compat/LM-Studio key above is
    // never valid against api.anthropic.com.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    llmBaseUrl: process.env.AGENT_LLM_BASE_URL ?? 'http://localhost:1234/v1',
    // Default matches run.sh's LM Studio auto-load model. Override via
    // AGENT_LLM_MODEL once you've loaded a different model in LM Studio.
    model:
      process.env.AGENT_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'google/gemma-4-e2b',
    bffInternalSecret: process.env.BFF_INTERNAL_SECRET ?? 'dev-shared-secret-change-me',
    bffToolUrl: process.env.BFF_INTERNAL_TOOL_URL ?? 'http://127.0.0.1:3001/internal/agent-tool',
    host: process.env.AGENT_HTTP_HOST ?? '127.0.0.1',
    port: parseInt(process.env.AGENT_HTTP_PORT ?? '8892', 10),
  };
}
