import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Groq behind the two Anthropic SDK calls the agents use (`messages.create` and
 * `messages.stream`), so the agent tool loops are the same for every provider.
 * Groq speaks the OpenAI chat-completions format at
 * `<baseUrl>/chat/completions` with the key as a Bearer token.
 *
 * Unlike Anthropic and Google, the Agent Privilege has no Groq provider (it answers
 * `/llm/groq` with a plain 403, like any unknown name), so these calls go DIRECT to Groq and
 * bypass the gateway: they do not appear in its records or follow its policy. The A2A and MCP
 * hops are unaffected.
 */

interface OpenAiToolCall { id?: string; type?: string; function?: { name?: string; arguments?: string } }
interface OpenAiMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string }
export interface OpenAiResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }; finish_reason?: string }[];
}
type Params = Anthropic.MessageCreateParamsNonStreaming;

export const GROQ_DIRECT_URL = 'https://api.groq.com/openai/v1';

const toolResultText = (content: Anthropic.ToolResultBlockParam['content']): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

function toMessages(params: Params): OpenAiMessage[] {
  const system = typeof params.system === 'string'
    ? params.system
    : (params.system ?? []).map(block => block.text).join('\n');
  const out: OpenAiMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const message of params.messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n');
      const calls = message.content.flatMap(block => (block.type === 'tool_use'
        ? [{ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }]
        : []));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn: each tool result becomes its own `tool` message, any text stays a user message.
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.is_error ? JSON.stringify({ error: toolResultText(block.content) }) : toolResultText(block.content) });
      } else if (block.type === 'text') {
        out.push({ role: 'user', content: block.text });
      }
    }
  }
  return out;
}

export function toGroqRequest(params: Params): Record<string, unknown> {
  const tools = (params.tools ?? []) as Anthropic.Tool[];
  const choice = params.tool_choice as { type?: string; disable_parallel_tool_use?: boolean } | undefined;
  return {
    model: params.model,
    max_tokens: params.max_tokens,
    messages: toMessages(params),
    ...(tools.length
      ? {
        tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })),
        ...(choice?.type === 'auto' ? { tool_choice: 'auto' } : {}),
        ...(choice?.disable_parallel_tool_use ? { parallel_tool_calls: false } : {}),
      }
      : {}),
  };
}

const parseArguments = (raw: string | undefined): Record<string, unknown> => {
  try { return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { return {}; }
};

export function fromGroqResponse(body: OpenAiResponse, model: string): Anthropic.Message {
  const choice = body.choices?.[0];
  if (!choice) throw new Error('Groq returned no answer');
  const content: Anthropic.ContentBlock[] = [];
  if (choice.message?.content) content.push({ type: 'text', text: choice.message.content, citations: null } as Anthropic.TextBlock);
  for (const call of choice.message?.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id ?? randomUUID(),
      name: call.function?.name ?? 'unknown',
      input: parseArguments(call.function?.arguments),
    } as Anthropic.ToolUseBlock);
  }
  const stopReason = content.some(block => block.type === 'tool_use')
    ? 'tool_use'
    : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { id: randomUUID(), type: 'message', role: 'assistant', model, content, stop_reason: stopReason } as Anthropic.Message;
}

// Same protection as the Gemini client: a call that never answers gets a deadline and one retry.
const DEFAULT_TIMEOUT_MS = 30_000;

export function groqClient(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; retryDelayMs?: number; timeoutMs?: number }): Anthropic {
  const base = (options.baseUrl || GROQ_DIRECT_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const didNotAnswer = () => new Error(`The model did not answer within ${timeoutMs / 1000} s, after two tries. It may be overloaded; try again.`);

  const create = async (params: Params, signal?: AbortSignal): Promise<Anthropic.Message> => {
    const timedOut = (error: unknown) => !signal?.aborted && (error as Error)?.name === 'TimeoutError';
    const send = () => {
      const deadline = AbortSignal.timeout(timeoutMs);
      return fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(toGroqRequest(params)),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    };
    const attempt = async (): Promise<Response | null> => {
      try { return await send(); } catch (error) { if (timedOut(error)) return null; throw error; }
    };
    let response = await attempt();
    if (response === null || response.status === 503) {
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 2000));
      response = await attempt();
    }
    if (response === null) throw didNotAnswer();
    let text: string;
    try { text = await response.text(); } catch (error) { throw timedOut(error) ? didNotAnswer() : error; }
    if (!response.ok) throw new Error(`Groq request returned ${response.status}: ${text.slice(0, 400)}`);
    return fromGroqResponse(JSON.parse(text) as OpenAiResponse, params.model);
  };

  // ponytail: no token streaming; the whole reply arrives as one 'text' event, like the Gemini client.
  const stream = (params: Params) => {
    const controller = new AbortController();
    const listeners: ((text: string) => void)[] = [];
    const done = create(params, controller.signal);
    done.catch(() => undefined);
    return {
      controller,
      on(_event: 'text', listener: (text: string) => void) { listeners.push(listener); },
      async finalMessage() {
        const message = await done;
        for (const block of message.content) {
          if (block.type === 'text') listeners.forEach(listener => listener(block.text));
        }
        return message;
      },
    };
  };

  // Only the two calls the agents use exist here, hence the cast.
  return { messages: { create, stream } } as unknown as Anthropic;
}
