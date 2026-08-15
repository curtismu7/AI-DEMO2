import { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { buildAgent } from './agentFactory';
import { AGUIEmitter } from './aguiEmitter';
import { getConfig } from './config';
import { resolveBffToolUrl } from './bffToolAdapter';
import type { EmitFn, RunCtx, ToolSchema } from './bffToolAdapter';

function formatSse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function handleRun(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const threadId = (body.threadId as string | undefined) ?? `t_${randomUUID().slice(0, 8)}`;
  const runId = (body.runId as string | undefined) ?? `r_${randomUUID().slice(0, 8)}`;
  const messages = (body.messages as Array<{ role: string; content: string }> | undefined) ?? [];
  const rawTools = (body.tools as Array<Record<string, unknown>> | undefined) ?? [];
  const ctx = (body.context as Record<string, unknown> | undefined) ?? {};
  // Vertical persona forwarded by the BFF from the active vertical manifest.
  // Used to override the default banking system prompt so the agent replies
  // in the active vertical's language (care, retail, sports, workforce, etc.).
  const verticalFlavor = (body.vertical_flavor as string | undefined) || undefined;

  const toolSchemas: ToolSchema[] = rawTools.map((t) => ({
    name: t.name as string,
    description: (t.description as string | undefined) ?? '',
    inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? { type: 'object', properties: {} },
  }));

  const sessionId = (ctx.sessionId as string | undefined) ?? '';
  const cfg = getConfig();
  // Abort the LLM stream and in-flight tool fetches the moment the client goes
  // away, so a disconnected browser doesn't keep the run (and its BFF calls)
  // burning.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());
  const runCtx: RunCtx = {
    bffToolUrl: resolveBffToolUrl(ctx.bffToolUrl as string | undefined, cfg.bffToolUrl),
    bffInternalSecret: cfg.bffInternalSecret,
    sessionId,
    abortSignal: abortController.signal,
  };
  // Per-run model override from BFF context wins; falls back to env-resolved
  // default (LM Studio's loaded model).
  const model = (ctx.model as string | undefined) || cfg.model;
  // Provider from BFF context: "anthropic" routes to Anthropic; anything else
  // (including "anthropic-lmstudio", "lmstudio", "") stays on LM Studio.
  const provider = (ctx.provider as string | undefined) || '';

  // This handler previously had zero stdout output, so a failed run left no
  // trace in `docker logs` — the only way to diagnose it was to reproduce it
  // by hand. Log enough per-run context to tell a bad prompt/model apart from
  // an unreachable dependency after the fact.
  console.log(
    `[mastra] run ${runId} start — messages=${messages.length} tools=${toolSchemas.length} ` +
      `model=${model} provider=${provider || 'lmstudio'} session=${sessionId.slice(0, 8)}`,
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emitFn: EmitFn = async (event) => {
    // Never write to a socket the client already closed — that throws
    // ERR_STREAM_WRITE_AFTER_END and crashes the handler.
    if (!res.writableEnded) res.write(formatSse(event));
  };

  const emitter = new AGUIEmitter(runId, threadId, emitFn);

  let streaming = false;
  try {
    await emitter.onRunStart();
    const agent = buildAgent(toolSchemas, runCtx, {
      baseUrl: cfg.llmBaseUrl,
      apiKey: cfg.llmApiKey,
      anthropicApiKey: cfg.anthropicApiKey,
      model,
      provider,
    }, verticalFlavor, emitFn);
    // Pass full conversation history for multi-turn context.
    // Mastra's Agent.stream() delegates to AI SDK streamText() which accepts CoreMessage[].
    // Cast through Parameters<> so the call stays typed without an explicit `any`.
    // Trust nothing about inbound message shape: drop entries without a string
    // content, and only ever forward user/assistant roles (anything else maps
    // to 'user') so agent.stream() can't break on a non-string content.
    const coreMessages = messages
      .filter((m) => m && typeof m.content === 'string')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));
    const stream = await agent.stream(
      coreMessages as Parameters<typeof agent.stream>[0],
      { abortSignal: abortController.signal },
    );

    // Consume fullStream (not textStream) so tool-call lifecycle reaches the UI
    // alongside text. It's a ReadableStream<ChunkType>; Node 18+ async-iterates it.
    type StreamPart = {
      type: string;
      textDelta?: string;
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
      result?: unknown;
      error?: unknown;
    };
    for await (const part of stream.fullStream as unknown as AsyncIterable<StreamPart>) {
      if (abortController.signal.aborted) break;
      if (part.type === 'text-delta') {
        if (!streaming) {
          await emitter.onLlmStart();
          streaming = true;
        }
        await emitter.onLlmToken(part.textDelta ?? '');
      } else if (part.type === 'tool-call') {
        await emitter.onToolStart(
          part.toolCallId as string,
          part.toolName as string,
          part.args,
        );
      } else if (part.type === 'tool-result') {
        await emitter.onToolEnd(part.toolCallId as string, part.result);
      } else if (part.type === 'tool-error') {
        // The `ai` SDK (v6.x) emits this instead of 'tool-result' when a tool's
        // execute() throws (e.g. bffToolAdapter's BffToolError on a BFF
        // timeout/non-2xx/client-abort). onToolStart already flipped
        // anyVisibleOutput, so without resolving this call onRunEnd would still
        // emit a false-success RUN_FINISHED while the UI's TOOL_CALL_START entry
        // spins forever. Resolve the pending entry, then fail the run the same
        // way the 'error' branch below does.
        const toolCallId = part.toolCallId as string;
        const toolErr = part.error;
        const message =
          toolErr instanceof Error
            ? toolErr.message
            : typeof toolErr === 'string'
              ? toolErr
              : JSON.stringify(toolErr ?? 'Tool execution failed');
        await emitter.onToolEnd(toolCallId, { error: message });
        if (streaming) {
          await emitter.onLlmEnd();
          streaming = false;
        }
        await emitter.onError(toolErr instanceof Error ? toolErr : new Error(message));
        return;
      } else if (part.type === 'error') {
        // A mid-stream provider error must not masquerade as a successful empty
        // run. Close any open message, surface RUN_ERROR, and stop.
        if (streaming) {
          await emitter.onLlmEnd();
          streaming = false;
        }
        const errVal = part.error;
        await emitter.onError(
          errVal instanceof Error
            ? errVal
            : new Error(typeof errVal === 'string' ? errVal : JSON.stringify(errVal ?? 'LLM stream error')),
        );
        return;
      }
    }

    if (streaming) await emitter.onLlmEnd();
    await emitter.onRunEnd();
  } catch (err) {
    // If we'd already opened a TEXT_MESSAGE_START, balance it with an END so the
    // UI message renderer isn't left stuck "streaming" behind the RUN_ERROR.
    if (streaming) {
      try {
        await emitter.onLlmEnd();
      } catch {
        // best-effort close; the RUN_ERROR below is what matters.
      }
    }
    await emitter.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    res.end();
  }
}
