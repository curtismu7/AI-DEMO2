import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Gemini behind the two Anthropic SDK calls the agents use
 * (`messages.create` and `messages.stream`), so the agent tool loops are the
 * same for both providers. Requests go to
 * `<baseUrl>/v1beta/models/<model>:generateContent` with the key as
 * `x-goog-api-key`; through Privilege the base URL is `https://<gateway>/llm/google`.
 */

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}
type ToolUse = Anthropic.ToolUseBlock & { thoughtSignature?: string };
type Params = Anthropic.MessageCreateParamsNonStreaming;

export const GEMINI_DIRECT_URL = 'https://generativelanguage.googleapis.com';

function toParts(content: Anthropic.MessageParam['content'], names: Map<string, string>): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.flatMap((block): GeminiPart[] => {
    if (block.type === 'text') return [{ text: block.text }];
    if (block.type === 'tool_use') {
      names.set(block.id, block.name);
      const signature = (block as ToolUse).thoughtSignature;
      return [{
        functionCall: { name: block.name, args: block.input as Record<string, unknown> },
        ...(signature ? { thoughtSignature: signature } : {}),
      }];
    }
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      return [{
        functionResponse: {
          name: names.get(block.tool_use_id) ?? 'unknown',
          response: block.is_error ? { error: text } : { result: text },
        },
      }];
    }
    return [];
  });
}

export function toGeminiRequest(params: Params): Record<string, unknown> {
  const names = new Map<string, string>();
  const system = typeof params.system === 'string'
    ? params.system
    : (params.system ?? []).map(block => block.text).join('\n');
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: params.messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: toParts(message.content, names),
    })),
    ...(params.tools?.length
      ? {
        tools: [{
          functionDeclarations: (params.tools as Anthropic.Tool[]).map(tool => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.input_schema,
          })),
        }],
      }
      : {}),
    generationConfig: { maxOutputTokens: params.max_tokens },
  };
}

export function fromGeminiResponse(body: GeminiResponse, model: string): Anthropic.Message {
  const candidate = body.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini returned no answer${body.promptFeedback?.blockReason ? ` (${body.promptFeedback.blockReason})` : ''}`);
  }
  const content = (candidate.content?.parts ?? []).flatMap((part): Anthropic.ContentBlock[] => {
    if (part.functionCall) {
      const block: ToolUse = {
        type: 'tool_use',
        id: part.functionCall.id ?? randomUUID(),
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      } as ToolUse;
      return [block];
    }
    if (part.text && !part.thought) return [{ type: 'text', text: part.text, citations: null } as Anthropic.TextBlock];
    return [];
  });
  const stopReason = content.some(block => block.type === 'tool_use')
    ? 'tool_use'
    : candidate.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
  return { id: randomUUID(), type: 'message', role: 'assistant', model, content, stop_reason: stopReason } as Anthropic.Message;
}

// A model call through the gateway sometimes sits for minutes before answering (seen live: about one
// call in three stalled past 150 s). Give each attempt a deadline and retry a stalled one once.
const DEFAULT_TIMEOUT_MS = 30_000;

export function geminiClient(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; retryDelayMs?: number; timeoutMs?: number }): Anthropic {
  const base = (options.baseUrl || GEMINI_DIRECT_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const didNotAnswer = () => new Error(`The model did not answer within ${timeoutMs / 1000} s, after two tries. It may be overloaded; try again.`);

  const create = async (params: Params, signal?: AbortSignal): Promise<Anthropic.Message> => {
    // The caller's abort is never retried; only this attempt's own deadline is.
    const timedOut = (error: unknown) => !signal?.aborted && (error as Error)?.name === 'TimeoutError';
    const send = () => {
      const deadline = AbortSignal.timeout(timeoutMs);
      return fetchImpl(`${base}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify(toGeminiRequest(params)),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    };
    const attempt = async (): Promise<Response | null> => {
      try { return await send(); } catch (error) { if (timedOut(error)) return null; throw error; }
    };
    let response = await attempt();
    // Google's free tier answers 503 "high demand" in bursts, and a call can stall; retry once.
    if (response === null || response.status === 503) {
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 2000));
      response = await attempt();
    }
    if (response === null) throw didNotAnswer();
    let text: string;
    try { text = await response.text(); } catch (error) { throw timedOut(error) ? didNotAnswer() : error; }
    if (!response.ok) throw new Error(`Gemini request returned ${response.status}: ${text.slice(0, 400)}`);
    return fromGeminiResponse(JSON.parse(text) as GeminiResponse, params.model);
  };

  // ponytail: the Google path does not stream tokens; the whole reply arrives
  // as one 'text' event. Switch to :streamGenerateContent if that matters.
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
