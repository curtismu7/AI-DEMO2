import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { EventType } from '@ag-ui/core';
import { reasonOnce } from './reasoningGraph';
import type { ReasonMessage, ReasonResponse, ReasonToolSchema } from './reasonContract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}


// ---------------------------------------------------------------------------
// Shared state shape (mirrors docs/ag-ui-integration-guide.md)
// ---------------------------------------------------------------------------

interface TokenEvent {
  id: string;
  timestamp: string;
  type: string;
  label: string;
  token?: string;
  claims?: Record<string, unknown>;
  error?: string;
}

interface McpTrafficEntry {
  id: string;
  timestamp: string;
  direction: 'request' | 'response';
  tool: string;
  payload: unknown;
  durationMs?: number;
}

interface AuthorizeDecision {
  id: string;
  timestamp: string;
  decision: 'PERMIT' | 'DENY' | 'INDETERMINATE';
  policyId?: string;
  input?: unknown;
  obligations?: unknown[];
}

interface ArchTraceEntry {
  id: string;
  timestamp: string;
  step: string;
  component: string;
  metadata?: Record<string, unknown>;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: string;
  actor?: string;
  resource?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

interface ActiveRun {
  threadId: string;
  runId: string;
  status: 'running' | 'finished' | 'interrupted' | 'error';
  currentStep: string | null;
}

interface AgentRunState {
  tokenEvents: TokenEvent[];
  mcpTraffic: McpTrafficEntry[];
  authorizeDecisions: AuthorizeDecision[];
  archTrace: ArchTraceEntry[];
  auditEvents: AuditEvent[];
  activeRun: ActiveRun;
}

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: ReasonMessage[];
  tools?: ReasonToolSchema[];
  context?: {
    bffToolUrl?: string;
    sessionId?: string;
    initialTokenEvents?: TokenEvent[];
    provider?: string;
    model?: string;
  };
  resume?: Array<{
    interruptId: string;
    status: 'approved' | 'denied' | 'cancelled';
    payload?: unknown;
  }>;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function emit(res: Response, event: Record<string, unknown>): void {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
}

function emitStateDelta(
  res: Response,
  operations: Array<{ op: string; path: string; value?: unknown }>
): void {
  emit(res, {
    type: EventType.STATE_DELTA,
    delta: operations,
  });
}

// ---------------------------------------------------------------------------
// Tool execution (Step 1: stub when bffToolUrl is absent)
// ---------------------------------------------------------------------------

interface ToolExecResult {
  result: unknown;
  mcpEntry?: McpTrafficEntry;
  authorizeDecision?: AuthorizeDecision;
  callTokenEvents?: TokenEvent[];
}

async function executeTool(
  toolName: string,
  toolArgs: unknown,
  bffToolUrl: string | undefined,
  pinnedBffToolUrl: string | undefined,
  sessionId: string | undefined,
  internalSecret: string
): Promise<ToolExecResult> {
  // Prefer the env-pinned URL over the caller-supplied one to prevent SSRF.
  bffToolUrl = pinnedBffToolUrl || bffToolUrl;
  const id = uid('mcp');
  const timestamp = new Date().toISOString();

  if (!bffToolUrl) {
    const mcpEntry: McpTrafficEntry = {
      id,
      timestamp,
      direction: 'response',
      tool: toolName,
      payload: { stub: true, message: 'BFF tool URL not configured (Step 1)' },
    };
    return {
      result: { error: 'Tool execution not yet wired (Step 1)', tool: toolName, args: toolArgs },
      mcpEntry,
    };
  }

  const startMs = Date.now();
  let result: unknown;
  let authorizeDecision: AuthorizeDecision | undefined;
  let callTokenEvents: TokenEvent[] = [];

  try {
    const resp = await fetch(bffToolUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-gateway-secret': internalSecret,
      },
      body: JSON.stringify({ tool: toolName, args: toolArgs, sessionId }),
    });
    if (!resp.ok) {
      throw new Error(`BFF tool call failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as Record<string, unknown>;
    result = data.result ?? data;
    if (data.authorizeDecision) {
      authorizeDecision = data.authorizeDecision as AuthorizeDecision;
    }
    if (Array.isArray(data.tokenEvents)) {
      callTokenEvents = data.tokenEvents as TokenEvent[];
    }
  } catch (err) {
    result = { error: String(err), tool: toolName };
  }

  const durationMs = Date.now() - startMs;
  const mcpRespEntry: McpTrafficEntry = {
    id: uid('mcp-resp'),
    timestamp: new Date().toISOString(),
    direction: 'response',
    tool: toolName,
    payload: result,
    durationMs,
  };
  return { result, mcpEntry: mcpRespEntry, authorizeDecision, callTokenEvents };
}

// ---------------------------------------------------------------------------
// HITL interrupt detection
// ---------------------------------------------------------------------------

interface HitlInterrupt {
  id: string;
  reason: string;
  message: string;
  responseSchema: unknown;
  toolCallId: string;
  expiresAt: string;
}

function extractHitlInterrupt(toolResult: unknown): HitlInterrupt | null {
  if (
    typeof toolResult === 'object' &&
    toolResult !== null &&
    'hitlRequired' in toolResult &&
    (toolResult as Record<string, unknown>).hitlRequired === true
  ) {
    const r = toolResult as Record<string, unknown>;
    return {
      id: String(r.consentId ?? r.interruptId ?? uid('hitl')),
      reason: String(r.reason ?? 'consent_required'),
      message: String(r.message ?? 'User approval required'),
      responseSchema: r.responseSchema ?? { type: 'object', properties: {} },
      toolCallId: String(r.toolCallId ?? ''),
      expiresAt: String(r.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString()),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Constant-time secret comparison
// ---------------------------------------------------------------------------

function secretsMatch(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) {
      // Use expected-secret length for dummy comparison to avoid leaking secret length via timing.
      timingSafeEqual(Buffer.alloc(bb.length), Buffer.alloc(bb.length));
      return false;
    }
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function makeAgentRunHandler(internalSecret: string, pinnedBffToolUrl?: string) {
  return async function agentRunHandler(req: Request, res: Response): Promise<void> {
    const incoming = req.headers['x-internal-gateway-secret'];
    if (typeof incoming !== 'string' || !secretsMatch(incoming, internalSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as RunAgentInput;
    const { threadId, runId, messages: initialMessages, tools = [], context = {}, resume } = body;
    let messages: ReasonMessage[] = [...initialMessages];

    if (!threadId || !runId || !Array.isArray(messages)) {
      res.status(400).json({ error: 'threadId, runId, and messages are required' });
      return;
    }

    const { bffToolUrl, sessionId, initialTokenEvents = [], provider, model } = context;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let aborted = false;
    // Detect a genuine client disconnect via the RESPONSE stream, not the request.
    // `req.on('close')` fires when the request *body* stream ends (Node 16+) — for a
    // fully-read POST that happens mid-run, a false positive that aborted the content
    // stream of slow providers (e.g. llama.cpp's multi-second CPU inference), emitting
    // zero text deltas while the run still reported success. `res` 'close' fires on a
    // real disconnect; guarding on writableFinished avoids treating a normal end
    // (which also closes res) as a disconnect.
    res.on('close', () => { if (!res.writableFinished) aborted = true; });

    const state: AgentRunState = {
      tokenEvents: [...initialTokenEvents],
      mcpTraffic: [],
      authorizeDecisions: [],
      archTrace: [],
      auditEvents: [],
      activeRun: { threadId, runId, status: 'running', currentStep: null },
    };

    emit(res, { type: EventType.STATE_SNAPSHOT, snapshot: state });
    // initialTokenEvents are already in the STATE_SNAPSHOT — no need to re-emit via STATE_DELTA.

    // Handle HITL resume
    if (resume && resume.length > 0) {
      const { status: resumeStatus, interruptId } = resume[0];
      if (resumeStatus === 'cancelled') {
        const msgId = uid('msg');
        emit(res, { type: EventType.TEXT_MESSAGE_START, messageId: msgId, role: 'assistant' });
        emit(res, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: msgId, delta: 'The action was cancelled.' });
        emit(res, { type: EventType.TEXT_MESSAGE_END, messageId: msgId });
        emit(res, { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } });
        res.end();
        return;
      }
      if (resumeStatus === 'approved') {
        // Inject a synthetic tool result so the agent knows the HITL was approved.
        // The conversation history is supplied in `messages`; append a system note
        // so the LLM understands it should proceed with the original tool call.
        messages = [
          ...messages,
          {
            role: 'user' as const,
            content: `[System: The user approved the action (interrupt ${interruptId}). Please proceed.]`,
          },
        ];
      }
    }

    emit(res, { type: EventType.RUN_STARTED, threadId, runId });

    let conversationMessages: ReasonMessage[] = [...messages];
    const MAX_ITERATIONS = 10;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (aborted) break;

      emitStateDelta(res, [{ op: 'replace', path: '/activeRun/currentStep', value: 'step-' + (iter + 1) }]);
      emit(res, { type: EventType.STEP_STARTED, stepName: 'reasoning-' + (iter + 1) });

      let reasonResult: ReasonResponse | undefined;
      try {
        reasonResult = await reasonOnce({
          messages: conversationMessages,
          tools,
          provider: (provider ?? process.env.AGENT_PROVIDER ?? 'anthropic') as 'anthropic' | 'helix' | 'anthropic-lmstudio' | 'lmstudio',
          model,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        });
      } catch (err) {
        emit(res, { type: EventType.RUN_ERROR, message: 'Reasoning failed: ' + String(err), code: 'REASONING_ERROR' });
        res.end();
        return;
      }

      emit(res, { type: EventType.STEP_FINISHED, stepName: 'reasoning-' + (iter + 1) });

      if (reasonResult.type === 'final') {
        const msgId = uid('msg');
        emit(res, { type: EventType.TEXT_MESSAGE_START, messageId: msgId, role: 'assistant' });
        const answer = reasonResult.answer ?? '';
        const chunkSize = 100;
        for (let i = 0; i < answer.length; i += chunkSize) {
          if (aborted) break;
          emit(res, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: msgId, delta: answer.slice(i, i + chunkSize) });
        }
        emit(res, { type: EventType.TEXT_MESSAGE_END, messageId: msgId });
        emitStateDelta(res, [
          { op: 'replace', path: '/activeRun/status', value: 'finished' },
          { op: 'replace', path: '/activeRun/currentStep', value: null },
        ]);
        emit(res, { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } });
        res.end();
        return;
      }

      if (reasonResult.type === 'tool_calls') {
        // Pre-assign stable IDs so the assistant message and event emissions share the same id
        const callsWithIds = reasonResult.calls.map((c) => ({
          ...c,
          id: c.id ?? uid('call'),
        }));

        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant' as const,
            content: '',
            tool_calls: callsWithIds.map((c) => ({ id: c.id, name: c.name, args: c.args })),
          },
        ];

        const toolResultMessages: ReasonMessage[] = [];

        for (const call of callsWithIds) {
          if (aborted) break;

          const callId = call.id;

          emit(res, { type: EventType.TOOL_CALL_START, toolCallId: callId, toolCallName: call.name, parentMessageId: uid('msg') });
          emit(res, { type: EventType.TOOL_CALL_ARGS, toolCallId: callId, delta: JSON.stringify(call.args) });
          emit(res, { type: EventType.TOOL_CALL_END, toolCallId: callId });

          const { result, mcpEntry, authorizeDecision, callTokenEvents } = await executeTool(call.name, call.args, bffToolUrl, pinnedBffToolUrl, sessionId, internalSecret);

          const interrupt = extractHitlInterrupt(result);
          if (interrupt) {
            interrupt.toolCallId = callId;
            emitStateDelta(res, [{ op: 'replace', path: '/activeRun/status', value: 'interrupted' }]);
            emit(res, { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'interrupt', interrupts: [interrupt] } });
            res.end();
            return;
          }

          emit(res, {
            type: EventType.TOOL_CALL_RESULT,
            messageId: 'result-' + callId,
            toolCallId: callId,
            result: typeof result === 'string' ? result : JSON.stringify(result),
          });

          if (mcpEntry) {
            state.mcpTraffic.push(mcpEntry);
            emitStateDelta(res, [{ op: 'add', path: '/mcpTraffic/-', value: mcpEntry }]);
          }
          if (authorizeDecision) {
            state.authorizeDecisions.push(authorizeDecision);
            emitStateDelta(res, [{ op: 'add', path: '/authorizeDecisions/-', value: authorizeDecision }]);
          }
          // Emit per-tool token events (RFC 8693 exchange events from BFF)
          if (callTokenEvents && callTokenEvents.length > 0) {
            for (const te of callTokenEvents) {
              state.tokenEvents.push(te);
              emitStateDelta(res, [{ op: 'add', path: '/tokenEvents/-', value: te }]);
            }
          }

          const traceEntry: ArchTraceEntry = {
            id: uid('trace'),
            timestamp: new Date().toISOString(),
            step: 'tool:' + call.name,
            component: 'agent-service',
            metadata: { callId, hasResult: result !== null },
          };
          state.archTrace.push(traceEntry);
          emitStateDelta(res, [{ op: 'add', path: '/archTrace/-', value: traceEntry }]);

          const auditEvent: AuditEvent = {
            id: uid('audit'),
            timestamp: new Date().toISOString(),
            eventType: 'tool_executed',
            actor: 'agent',
            resource: call.name,
            outcome: 'success',
            metadata: { callId },
          };
          state.auditEvents.push(auditEvent);
          emitStateDelta(res, [{ op: 'add', path: '/auditEvents/-', value: auditEvent }]);

          toolResultMessages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: callId,
          });
        }

        conversationMessages = [...conversationMessages, ...toolResultMessages];
      }
    }

    // Max iterations reached
    emitStateDelta(res, [
      { op: 'replace', path: '/activeRun/status', value: 'finished' },
      { op: 'replace', path: '/activeRun/currentStep', value: null },
    ]);
    emit(res, { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: 'success' } });
    res.end();
  };
}
