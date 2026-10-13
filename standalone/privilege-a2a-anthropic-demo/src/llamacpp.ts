import type Anthropic from '@anthropic-ai/sdk';

/**
 * llama.cpp behind the two Anthropic SDK calls the agents use (`messages.create`
 * and `messages.stream`), so the agent tool loops are the same for every provider.
 *
 * Two wire targets, chosen by LLAMACPP_BASE_URL:
 *  - SET (the demo default): the Agent Privilege's custom lane
 *    `https://…/llm/custom/v1` — the call goes THROUGH the gateway, so it is
 *    governed (virtual-key budget, records, policy). Auth = the custom virtual
 *    key as the Bearer.
 *  - UNSET: llama-server directly (`http://host:8090/v1`), same OpenAI
 *    chat-completions wire, no gateway in the path.
 *
 * The Groq adapter does the Anthropic→OpenAI translation; this file is that
 * same translation with different defaults and error wording. Kept as its own
 * file rather than parameterizing groq.ts because the two differ in what "no
 * base URL" means (Groq: the vendor's cloud; llama.cpp: your own llama-server)
 * and the error text must name the right env vars.
 */

import {
  fromGroqResponse,
  toGroqRequest,
  type OpenAiResponse,
} from './groq.js';

interface Params extends Anthropic.MessageCreateParamsNonStreaming {}

export const LLAMACPP_DEFAULT_BASE_URL = 'http://127.0.0.1:8090/v1';

// Same protection as the Groq/Gemini clients: a call that never answers gets a
// deadline and one retry. Local inference can be slow, so the deadline is longer.
const DEFAULT_TIMEOUT_MS = 120_000;

export function llamacppClient(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; retryDelayMs?: number; timeoutMs?: number }): Anthropic {
  const base = (options.baseUrl || LLAMACPP_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const didNotAnswer = () => new Error(`The model did not answer within ${timeoutMs / 1000} s, after two tries. It may still be loading; try again.`);

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
    if (!response.ok) throw new Error(`llama.cpp request returned ${response.status}: ${text.slice(0, 400)}`);
    return fromGroqResponse(JSON.parse(text) as OpenAiResponse, params.model);
  };

  // ponytail: no token streaming; the whole reply arrives as one 'text' event, like the Groq client.
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
