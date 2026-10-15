import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

import { describeMode, mainAgentConfig, viaGateway } from '../config.js';
import { parseMode, parseProfile, parseUserName, withLabels, type Profile } from '../profile.js';
import { systemPromptFor } from './prompts.js';
import { stripUnsourcedScope, textOfTurn } from './scopeFilter.js';
import { buildWorkerClient } from './a2a-client.js';
import { MAIN, maskKey, pretty, runChain } from './chain.js';
import { renderPage } from './ui.js';

/** The token counts a model call reported, for the trace. Absent when the provider sent none. */
function tokenCounts(message: Anthropic.Message): { input: number; output: number } | undefined {
  const usage = message.usage;
  return usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined;
}

const config = mainAgentConfig();
const MAX_DELEGATION_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 4096;
const WORKER_DONE_CAP_MS = 1000;
function delegateToolFor(profile: Profile | null): Anthropic.Tool {
  if (!profile) return DELEGATE_TOOL;
  return { ...DELEGATE_TOOL, description: `Ask the ${profile.specialistName} to ${profile.subtaskHint}.` };
}

const DELEGATE_TOOL: Anthropic.Tool = {
  name: 'delegate_to_analyst',
  description: 'Ask the access-review analyst to look up entitlement, role, grant, or ticket data.',
  input_schema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'The complete access-review question to send to the analyst.' } },
    required: ['question'],
  },
};

const app = express();
app.use(express.json({ limit: '64kb' }));
app.get('/', (_req: Request, res: Response) => res.type('html').send(renderPage()));
app.get('/status', (_req: Request, res: Response) => {
  res.json({
    mode: describeMode('MAIN_AGENT'),
    viaGateway: viaGateway('MAIN_AGENT'),
    mainModel: config.model,
    worker: config.workerA2aUrl,
    bearerOnA2A: Boolean(config.bearer),
    chain: config.chainA2aUrl || null,
  });
});

interface ChatRequestBody { message?: unknown; sessionId?: unknown; vertical?: unknown; agentName?: unknown; specialistName?: unknown; tools?: unknown; subtaskHint?: unknown }
const conversations = new Map<string, Anthropic.MessageParam[]>();

function sendSse(res: Response, event: string, payload: unknown): void {
  if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function messageError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionError) return `Could not connect to the model provider or Privilege: ${error.message}`;
  if (error instanceof Anthropic.RateLimitError) return `Anthropic request was rate limited: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Anthropic request returned ${error.status ?? 'an error'}: ${error.message}`;
  return error instanceof Error ? error.message : 'The agent could not complete the request.';
}

async function startWorkerTrace(
  res: Response,
  signal: AbortSignal,
  contextId: string,
  at: () => string,
  profile: Profile | null,
  onWorkerDone: () => void = () => {},
): Promise<void> {
  const headers: Record<string, string> = {};
  if (config.bearer) headers.Authorization = `Bearer ${config.bearer}`;
  try {
    const traceUrl = new URL(config.workerTraceUrl);
    traceUrl.searchParams.set('contextId', contextId);
    const response = await fetch(traceUrl, { headers, signal });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
        if (dataLine) {
          try {
            const payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
            if (payload.contextId !== contextId) continue;
            // The worker's end-of-trace marker: every hop before it has already been relayed (one ordered stream). Not shown to the user.
            if (payload.kind === 'worker-done') { onWorkerDone(); continue; }
            const { contextId: _contextId, ...trace } = payload;
            sendSse(res, 'trace', { ...withLabels(trace as { from?: unknown; to?: unknown }, profile), at: at() });
          } catch { /* Ignore malformed trace events. */ }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch {
    if (!signal.aborted) sendSse(res, 'trace', { kind: 'error', text: 'Worker trace unavailable', at: at() });
  }
}

/** False (and a 401 already sent) unless the BFF's shared secret matches, when one is set. */
function bffAuthorized(req: Request, res: Response): boolean {
  if (!config.bffSharedSecret) return true;
  const expected = Buffer.from(config.bffSharedSecret);
  const supplied = Buffer.from(req.header('X-A2A-BFF-Secret') ?? '');
  if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  res.status(401).json({ error: 'BFF authentication required' });
  return false;
}

/**
 * The three-deep chain: main agent -> gateway -> middle agent -> gateway ->
 * specialist. Streams one `trace` event per hop, each with `from` and `to`.
 */
app.post('/chain', async (req: Request, res: Response) => {
  if (!bffAuthorized(req, res)) return;
  if (!config.chainA2aUrl) {
    res.status(503).json({ error: 'CHAIN_A2A_URL is not configured' });
    return;
  }
  const body = req.body as { message?: unknown; specialist?: unknown; relayCardText?: unknown };
  const profile = parseProfile(req.body);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const specialist = typeof body.specialist === 'string' ? body.specialist.trim() : '';
  if (!message || !/^[a-z0-9-]{1,64}$/.test(specialist)) {
    res.status(400).json({ error: 'message and a specialist name are required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const startedAt = Date.now();
  const at = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  try {
    const answer = await runChain({
      url: config.chainA2aUrl,
      bearer: config.bearer,
      message,
      specialist,
      relayCardText: body.relayCardText === true,
      profile,
      signal: abort.signal,
      emit: event => sendSse(res, 'trace', { ...event, at: at() }),
    });
    sendSse(res, 'token', { text: answer });
    sendSse(res, 'done', {});
  } catch (error) {
    if (!abort.signal.aborted) sendSse(res, 'error', { error: error instanceof Error ? error.message : 'The chain failed.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.post('/chat', async (req: Request, res: Response) => {
  if (!bffAuthorized(req, res)) return;

  const body = req.body as ChatRequestBody;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  const profile = parseProfile(body);
  const requestedSession = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const sessionId = requestedSession.length > 0 && requestedSession.length <= 128 ? requestedSession : randomUUID();
  const traceId = randomUUID();
  // Model-free path: a vertical profile already names the specialist, so delegate the user's text without asking the model.
  const heuristic = parseMode(body) === 'heuristics' && profile !== null;
  // A vertical change must not reuse another vertical's history.
  const conversationKey = profile ? `${sessionId}:${profile.vertical}` : sessionId;
  const systemPrompt = systemPromptFor(profile, parseUserName(body));
  const delegateTool = delegateToolFor(profile);
  const priorMessages = conversations.get(conversationKey) ?? [];
  const messages: Anthropic.MessageParam[] = [...priorMessages, { role: 'user', content: message }];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const startedAt = Date.now();
  const at = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const abort = new AbortController();
  const traceAbort = new AbortController();
  let abortActiveModelStream: (() => void) | undefined;
  let completed = false;
  const rawSourceTexts: string[] = [];
  res.on('close', () => {
    if (!res.writableEnded) {
      abort.abort();
      traceAbort.abort();
      abortActiveModelStream?.();
    }
  });

  let workerDone: () => void = () => {};
  const workerDonePromise = new Promise<void>(resolve => { workerDone = resolve; });
  void startWorkerTrace(res, traceAbort.signal, traceId, at, profile, workerDone);
  sendSse(res, 'trace', { kind: 'session', text: `session ${sessionId.slice(0, 8)} · ${heuristic ? 'heuristics (no model call)' : config.model}`, at: at() });

  try {
    const worker = await buildWorkerClient(config.workerA2aUrl, config.bearer);
    for (let round = 0; round < MAX_DELEGATION_ROUNDS; round += 1) {
      if (abort.signal.aborted) break;
      let calls: Anthropic.ToolUseBlock[];
      if (heuristic) {
        calls = [{ type: 'tool_use', id: 'heuristic', name: DELEGATE_TOOL.name, input: { question: message } } as Anthropic.ToolUseBlock];
      } else {
        const stream = config.anthropic.messages.stream({
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          tools: [delegateTool],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          messages,
        });
        abortActiveModelStream = () => stream.controller.abort();
        const response = await stream.finalMessage();
        abortActiveModelStream = undefined;
        const roundText = textOfTurn(response.content);
        sendSse(res, 'trace', { kind: 'model', from: 'main', to: 'main', text: `main agent · ${config.model}`, tokens: tokenCounts(response), at: at() });

        // With a vertical profile every question is a data question for its specialist. The local model
        // sometimes answers in text instead (a refusal, or the delegation written out), which ends the run with
        // nothing delegated. Delegate the user's question as asked, say so, and keep the history valid.
        const answeredWithoutDelegating = round === 0 && profile !== null
          && (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens')
          && !response.content.some(block => block.type === 'tool_use');
        if (answeredWithoutDelegating) {
          sendSse(res, 'trace', { kind: 'fallback', from: 'main', to: 'main', text: 'main agent did not delegate; delegating the question as asked', detail: roundText.slice(0, 400), at: at() });
          const forced = { type: 'tool_use', id: 'fallback-delegate', name: DELEGATE_TOOL.name, input: { question: message } } as Anthropic.ToolUseBlock;
          messages.push({ role: 'assistant', content: [forced] });
          calls = [forced];
        } else {
        // Sent after the round, through the claim filter. Streaming raw text bypassed it.
        if (roundText) sendSse(res, 'token', { text: stripUnsourcedScope(roundText, rawSourceTexts.join('\n')) });
        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
          completed = true;
          break;
        }
        if (response.stop_reason === 'pause_turn') continue;

        calls = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );
        if (calls.length === 0) {
          completed = true;
          break;
        }
        }
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      let delegatedAnswer = '';
      for (const call of calls) {
        if (call.name !== DELEGATE_TOOL.name) {
          results.push({ type: 'tool_result', tool_use_id: call.id, content: `Unknown tool: ${call.name}`, is_error: true });
          continue;
        }
        const input = call.input as { question?: unknown };
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (!question) {
          results.push({ type: 'tool_result', tool_use_id: call.id, content: 'The delegation request had no question.', is_error: true });
          continue;
        }

        // The A2A SDK hides the wire body, so the request shown is rebuilt from the fixed shape it sends.
        const request = [
          `POST ${config.workerA2aUrl.replace(/\/+$/, '')}/jsonrpc`,
          'Content-Type: application/json',
          ...(config.bearer ? [`Authorization: Bearer ${maskKey(config.bearer)}`] : []),
          '',
          pretty(JSON.stringify({
            jsonrpc: '2.0',
            id: '<request id>',
            method: 'message/send',
            params: { message: { role: 'user', messageId: '<message id>', parts: [{ kind: 'text', text: question }] } },
          })),
        ].join('\n');
        sendSse(res, 'trace', { ...withLabels({ from: MAIN, to: 'analyst' }, profile), kind: 'delegate', text: 'concierge → analyst_agent', detail: question, request, at: at() });
        const hopStartedAt = Date.now();
        try {
          const { text: answer, toolOutputs } = await worker.sendQuestion(question, traceId, profile ? { vertical: profile.vertical, tools: profile.tools, ...(heuristic ? { mode: 'heuristics' } : {}) } : undefined);
          const response = `HTTP 200\n\n${pretty(JSON.stringify({ jsonrpc: '2.0', id: '<request id>', result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text: answer }] } })).slice(0, 4000)}`;
          sendSse(res, 'trace', { ...withLabels({ from: 'analyst', to: MAIN }, profile), kind: 'result', text: 'analyst_agent returned', detail: answer, elapsedMs: Date.now() - hopStartedAt, response, at: at() });
          results.push({ type: 'tool_result', tool_use_id: call.id, content: answer });
          // Scope words are checked against the raw tool output, not the analyst's own text.
          // Heuristics: the answer IS the tool's own text, so nothing in it can be unsourced.
          delegatedAnswer = heuristic ? answer : stripUnsourcedScope(answer, toolOutputs.join('\n'));
          rawSourceTexts.push(...toolOutputs);
        } catch (error) {
          const detail = messageError(error);
          sendSse(res, 'trace', { ...withLabels({ from: MAIN, to: 'analyst' }, profile), kind: 'error', text: 'A2A delegation failed', detail, at: at() });
          results.push({ type: 'tool_result', tool_use_id: call.id, content: detail, is_error: true });
        }
      }
      if (!heuristic) messages.push({ role: 'user', content: results });
      // A model-free run delegates once, whatever came back (an empty or failed answer must never loop or reach a model).
      if (heuristic && !delegatedAnswer) delegatedAnswer = 'The specialist returned nothing for this question.';
      if (delegatedAnswer) {
        sendSse(res, 'token', { text: delegatedAnswer });
        messages.push({ role: 'assistant', content: delegatedAnswer });
        completed = true;
        break;
      }
    }

    if (!completed && !abort.signal.aborted) {
      const finalStream = config.anthropic.messages.stream({
        model: config.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: `${systemPrompt}\n\nDo not delegate again. Summarize only what is already established in this conversation.`,
        messages,
      });
      abortActiveModelStream = () => finalStream.controller.abort();
      const finalResponse = await finalStream.finalMessage();
      sendSse(res, 'trace', { kind: 'model', from: 'main', to: 'main', text: `main agent · ${config.model}`, tokens: tokenCounts(finalResponse), at: at() });
      abortActiveModelStream = undefined;
      // Buffered, not streamed: a scope claim can't be filtered after it has been sent.
      const finalText = finalResponse.content.map(block => (block.type === 'text' ? block.text : '')).join('');
      sendSse(res, 'token', { text: stripUnsourcedScope(finalText, rawSourceTexts.join('\n')) });
      messages.push({ role: 'assistant', content: finalResponse.content });
      completed = true;
    }

    if (completed && !abort.signal.aborted) {
      conversations.set(conversationKey, messages);
      sendSse(res, 'done', { sessionId });
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      const detail = messageError(error);
      sendSse(res, 'trace', { kind: 'error', text: 'Agent request failed', detail, at: at() });
      sendSse(res, 'error', { error: detail });
    }
  } finally {
    // The model-free run can finish before the worker's trace stream delivers its last hop: wait for the worker's
    // end-of-trace marker. The cap covers a worker too old to send one, or a trace stream that never connected.
    if (heuristic && !abort.signal.aborted) await Promise.race([workerDonePromise, new Promise(resolve => setTimeout(resolve, WORKER_DONE_CAP_MS))]);
    traceAbort.abort();
    if (!res.writableEnded) res.end();
  }
});

app.listen(config.port, config.host, () => {
  console.log(`\n[main] concierge on http://${config.host}:${config.port}`);
  console.log(`[main] model: ${config.model} — ${describeMode('MAIN_AGENT')}`);
  console.log(`[main] worker A2A: ${config.workerA2aUrl}${config.bearer ? ' (Bearer set)' : ' (no Bearer)'}\n`);
});
