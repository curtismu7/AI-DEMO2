// banking_agent_service/src/reasoningGraph.ts
// One reasoning step (the BFF drives the loop). Helix = helixToolAdapter (sentinel);
// Anthropic/LM Studio = native tool_use.
// Reasoning-only: NEVER executes a tool, NEVER touches a token.
// Helix/Anthropic failure → reasoningUnavailable (BFF applies the
// heuristic floor — ARCHITECTURE-TRUTHS T-3).
import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ReasonRequest, ReasonResponse, ReasonMessage } from './reasonContract';
import { helixReason, HelixUnparseableError } from './helixToolAdapter';
import { callHelix } from './helixClient';
import { teachLog } from './teachLogger';

// Map our internal ReasonMessage[] to Anthropic's MessageParam[].
// Tool results in our format: { role:'tool', content:'...', tool_call_id:'...' }
// Anthropic format: { role:'user', content:[{ type:'tool_result', tool_use_id, content }] }
function toAnthropicMessages(messages: ReasonMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      // Collect consecutive tool results into a single user turn
      const results: Anthropic.ToolResultBlockParam[] = [];
      while (i < messages.length && messages[i].role === 'tool') {
        const m = messages[i];
        results.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: m.content,
        });
        i++;
      }
      out.push({ role: 'user', content: results });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant turn that contains tool_use blocks
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      out.push({ role: 'assistant', content: blocks });
      i++;
    } else {
      out.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      i++;
    }
  }
  return out;
}

const DEFAULT_MODELS: Record<string, string> = {
  helix: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  // llama-server serves whatever model it was launched with; this is only a
  // last-resort fallback when /v1/models can't be reached and no env override.
  llamacpp: 'local-model',
};

// Map our internal ReasonMessage[] to LangChain BaseMessage[] for the llama.cpp path.
// Mirrors toAnthropicMessages but in LangChain's message classes (ChatOpenAI talks
// to llama-server's OpenAI-compatible /v1/chat/completions, so assistant tool_calls
// and tool results map 1:1).
function toLangChainMessages(messages: ReasonMessage[], systemPrompt?: string): BaseMessage[] {
  const out: BaseMessage[] = [];
  if (systemPrompt) out.push(new SystemMessage(systemPrompt));
  for (const msg of messages) {
    if (msg.role === 'tool') {
      out.push(new ToolMessage({ content: msg.content, tool_call_id: msg.tool_call_id ?? '' }));
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      out.push(new AIMessage({
        content: msg.content ?? '',
        tool_calls: msg.tool_calls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args, type: 'tool_call' as const })),
      }));
    } else if (msg.role === 'assistant') {
      out.push(new AIMessage({ content: msg.content }));
    } else {
      out.push(new HumanMessage({ content: msg.content }));
    }
  }
  return out;
}

// qwen3 and other "thinking" models can wrap chain-of-thought in <think>…</think>.
// Strip it from the user-visible answer so the demo shows a clean final response.
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ChatOpenAI normally returns `content` as a string, but some versions/models
// return MessageContentComplex[] (an array of text/other blocks). Extract the
// text from either shape so a non-string content can never silently collapse to
// an empty answer in the llama.cpp reasoning path.
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) => (typeof b === 'string' ? b : (b as { text?: string })?.text ?? ''))
      .join('');
  }
  return '';
}

// LM Studio exposes an Anthropic-compatible endpoint, so these providers reuse
// the Anthropic tool-use reasoning path below with a local baseURL.
const LMSTUDIO_PROVIDERS = new Set<string>(['anthropic-lmstudio', 'lmstudio']);

/** Resolve the model id from LM Studio's loaded models (OpenAI-style /v1/models). */
async function resolveLmStudioModel(originBase: string): Promise<string> {
  try {
    const res = await fetch(`${originBase}/v1/models`);
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const first = Array.isArray(data?.data) ? data.data.find((m) => m && m.id) : undefined;
    if (first?.id) return first.id;
  } catch { /* fall through to placeholder */ }
  return 'local-model';
}

/**
 * Resolve the model id llama-server is serving (OpenAI-style /v1/models).
 * `apiBase` already includes the /v1 suffix.
 */
async function resolveLlamaCppModel(apiBase: string): Promise<string> {
  try {
    const res = await fetch(`${apiBase}/models`);
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const first = Array.isArray(data?.data) ? data.data.find((m) => m && m.id) : undefined;
    if (first?.id) return first.id;
  } catch { /* fall through to fallback */ }
  return DEFAULT_MODELS.llamacpp;
}

export async function reasonOnce(req: ReasonRequest): Promise<ReasonResponse> {
  const isLmStudio = LMSTUDIO_PROVIDERS.has(req.provider as string);
  if (req.provider === 'anthropic' || isLmStudio) {
    const apiKey = isLmStudio
      ? 'lm-studio' // LM Studio ignores the key but the SDK requires a non-empty one
      : (req.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) {
      teachLog.error('Anthropic API key missing', null, { operation: 'reasonOnce' });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
    try {
      const clientOpts: { apiKey: string; baseURL?: string } = { apiKey };
      let model: string;
      if (isLmStudio) {
        // baseURL must be the origin only — the Anthropic SDK appends /v1/messages.
        const originBase = (process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1').replace(/\/v1\/?$/, '');
        clientOpts.baseURL = originBase;
        model = req.model || process.env.LMSTUDIO_MODEL || (await resolveLmStudioModel(originBase));
      } else {
        model = req.model || DEFAULT_MODELS.anthropic;
      }
      const client = new Anthropic(clientOpts);
      const tools: Anthropic.Tool[] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }));
      const anthropicMessages = toAnthropicMessages(req.messages);
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        tools,
        messages: anthropicMessages,
        ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
      });
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const calls = toolUseBlocks.map((b) => ({ id: b.id, name: b.name, args: b.input as Record<string, unknown> }));
        const assistantMsg: ReasonMessage = {
          role: 'assistant',
          content: (response.content.find((b) => b.type === 'text') as Anthropic.TextBlock | undefined)?.text ?? '',
          tool_calls: calls,
        };
        return { type: 'tool_calls', calls, messages: [...req.messages, assistantMsg] };
      }
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      const answer = textBlock?.text ?? '';
      return {
        type: 'final',
        answer,
        messages: [...req.messages, { role: 'assistant', content: answer }],
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
    } catch (err) {
      teachLog.error('Anthropic reasoning step failed', err, { operation: 'reasonOnce' });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
  }

  if (req.provider === 'helix') {
    try {
      // Pin helix_base_url from env when set to prevent SSRF via caller-supplied URL.
      const helixCfg = process.env.HELIX_BASE_URL
        ? { ...req.helixConfig, helix_base_url: process.env.HELIX_BASE_URL }
        : (req.helixConfig || {});
      const r = await helixReason(helixCfg, req.messages, req.tools, callHelix, req.systemPrompt);
      if (r.tool_calls && r.tool_calls.length > 0) {
        return { type: 'tool_calls', calls: r.tool_calls, messages: [...req.messages, { role: 'assistant', content: '', tool_calls: r.tool_calls }] };
      }
      const answer = r.content ?? '';
      const inputChars = req.messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
      return {
        type: 'final',
        answer,
        messages: [...req.messages, { role: 'assistant', content: answer }],
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(answer.length / 4),
      };
    } catch (err) {
      // HelixUnparseableError OR any transport error → signal, do not fabricate.
      const note = err instanceof HelixUnparseableError ? 'helix_unparseable' : 'helix_error';
      teachLog.error('reasoning step failed', err, { operation: 'reasonOnce' });
      teachLog.info('reasoning unavailable — BFF heuristic floor will apply', { reason: note });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
  }

  if (req.provider === 'llamacpp') {
    // Local small LLM via llama.cpp's llama-server (OpenAI-compatible /v1 API with
    // native tool-calling — e.g. Qwen3). baseURL is pinned from env to prevent SSRF
    // via a caller-supplied URL. 127.0.0.1 (not localhost) — Node resolves localhost
    // to ::1 but llama-server binds IPv4 by default.
    try {
      // LLAMACPP_BASE_URL is the origin only (no /v1); we append /v1 for the
      // OpenAI-compatible API, matching the BFF's llamacppLlmService convention.
      const origin = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
      const baseURL = `${origin}/v1`;
      const model = req.model || process.env.LLAMACPP_MODEL || (await resolveLlamaCppModel(baseURL));
      const llm = new ChatOpenAI({
        model,
        temperature: 0,
        apiKey: 'llama-cpp', // llama-server ignores the key, but the SDK requires one
        configuration: { baseURL },
      });
      const withTools = req.tools.length > 0
        ? llm.bindTools(req.tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })))
        : llm;
      const response = await withTools.invoke(toLangChainMessages(req.messages, req.systemPrompt));
      const text = stripThink(extractTextContent(response.content));
      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length > 0) {
        const calls = toolCalls.map((tc) => ({
          id: tc.id ?? `llamacpp-${crypto.randomUUID()}`,
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
        }));
        const assistantMsg: ReasonMessage = {
          role: 'assistant',
          content: text,
          tool_calls: calls,
        };
        return { type: 'tool_calls', calls, messages: [...req.messages, assistantMsg] };
      }
      return {
        type: 'final',
        answer: text,
        messages: [...req.messages, { role: 'assistant', content: text }],
        inputTokens: response.usage_metadata?.input_tokens,
        outputTokens: response.usage_metadata?.output_tokens,
      };
    } catch (err) {
      teachLog.error('llama.cpp reasoning step failed', err, { operation: 'reasonOnce' });
      return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
    }
  }

  // Unknown provider — signal unavailable so the BFF applies the heuristic floor.
  teachLog.error('unknown provider in reasonOnce', null, { operation: 'reasonOnce', provider: req.provider });
  return { type: 'final', answer: '', messages: req.messages, reasoningUnavailable: true };
}
