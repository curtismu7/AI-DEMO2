import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { buildBffTools, type ToolSchema, type RunCtx, type EmitFn } from './bffToolAdapter';

const DEFAULT_INSTRUCTIONS =
  'You are a helpful banking assistant. Use the available tools to answer the user\'s questions.';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  anthropicApiKey?: string;
  model: string;
  provider?: string;
}

export function buildAgent(
  toolSchemas: ToolSchema[],
  runCtx: RunCtx,
  llm: LlmProviderConfig,
  instructions?: string,
  emitFn?: EmitFn,
): Agent {
  const tools = buildBffTools(toolSchemas, runCtx, emitFn);

  const toolMap: Record<string, (typeof tools)[number]> = {};
  for (const tool of tools) {
    toolMap[tool.id] = tool;
  }

  let languageModel: unknown;
  if (llm.provider === 'anthropic') {
    // Use the native Anthropic provider with the Anthropic API key — NOT the
    // OpenAI-compat/LM-Studio key, which would 401 against api.anthropic.com.
    const anthropicProvider = createAnthropic({ apiKey: llm.anthropicApiKey ?? '' });
    const effectiveModel = llm.model.startsWith('claude') ? llm.model : 'claude-sonnet-4-6';
    languageModel = anthropicProvider(effectiveModel);
  } else {
    // createOpenAI() with a baseURL points the OpenAI provider at any
    // OpenAI-compatible endpoint (LM Studio, Groq, Together, etc).
    const openaiProvider = createOpenAI({ baseURL: llm.baseUrl, apiKey: llm.apiKey });
    languageModel = openaiProvider(llm.model);
  }

  // languageModel returns an AI SDK LanguageModel that Mastra's Agent
  // accepts at runtime, but its TS surface is DynamicArgument<MastraModelConfig>
  // which doesn't include the AI SDK type directly — cast through unknown.
  return new Agent({
    id: 'banking-agent',
    name: 'Banking Agent',
    instructions: instructions ?? DEFAULT_INSTRUCTIONS,
    model: languageModel as unknown as never,
    tools: toolMap,
  });
}
