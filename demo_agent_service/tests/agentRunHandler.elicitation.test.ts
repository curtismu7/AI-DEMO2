// ELICITATION obligation — AG-UI interrupt/resume parity with HITL.
//
// The resume synthetic message previously told the LLM only "the user
// approved (interrupt X). Please proceed." with no field name/value to
// retry with — the LLM had to infer the control-arg name from nothing.
// This locks two things: (1) the interrupt the BFF's hitlRequired envelope
// produces carries toolName (needed to build an explicit retry hint), and
// (2) the resume message names the exact argument(s) to retry with,
// branching on the reason the frontend echoes back.
import { EventEmitter } from 'events';
import { makeAgentRunHandler } from '../src/agentRunHandler';
import { reasonOnce } from '../src/reasoningGraph';

jest.mock('../src/reasoningGraph', () => ({ reasonOnce: jest.fn() }));

const SECRET = 'test-secret';
const BFF_URL = 'http://127.0.0.1:3001/internal/agent-tool';

function makeReq(body: unknown): any {
  const req: any = new EventEmitter();
  req.headers = { 'x-internal-gateway-secret': SECRET };
  req.body = body;
  return req;
}

function makeRes(): any {
  const res: any = new EventEmitter();
  res.writes = [] as string[];
  res.writableFinished = false;
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn((s: string) => { res.writes.push(s); return true; });
  res.end = jest.fn(() => { res.writableFinished = true; res.emit('close'); });
  res.status = jest.fn(() => res);
  res.json = jest.fn();
  return res;
}

function parseEvents(res: any): any[] {
  return (res.writes as string[])
    .join('')
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

describe('agentRunHandler — ELICITATION interrupt shape', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

  it('the emitted interrupt carries toolName (needed to build an explicit retry hint)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          hitlRequired: true,
          consentId: 'elic-1',
          reason: 'elicitation_required',
          tool: 'create_withdrawal',
          message: 'Confirm create_withdrawal?',
        },
        tokenEvents: [],
      }),
    }) as unknown as typeof fetch;

    (reasonOnce as jest.Mock).mockResolvedValueOnce({
      type: 'tool_calls',
      calls: [{ name: 'create_withdrawal', args: { from_account_id: 'a1', amount: 100 }, id: 'call-1' }],
      messages: [],
    });

    const handler = makeAgentRunHandler(SECRET, BFF_URL);
    const req = makeReq({
      threadId: 't1', runId: 'r1',
      messages: [{ role: 'user', content: 'withdraw 100' }],
      tools: [{ name: 'create_withdrawal', description: '', parameters: {} }],
      context: { provider: 'anthropic', sessionId: 'sess-abc' },
    });
    const res = makeRes();
    await handler(req, res);

    const runFinished = parseEvents(res).find((e) => e.type === 'RUN_FINISHED');
    const interrupt = runFinished?.outcome?.interrupts?.[0];
    expect(interrupt?.id).toBe('elic-1');
    expect(interrupt?.reason).toBe('elicitation_required');
    expect(interrupt?.toolName).toBe('create_withdrawal');
  });
});

describe('agentRunHandler — resume message names the exact retry argument', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

  async function resumeWith(resumeItem: Record<string, unknown>) {
    global.fetch = jest.fn() as unknown as typeof fetch;
    (reasonOnce as jest.Mock).mockResolvedValueOnce({ type: 'final', answer: 'done', messages: [] });

    const handler = makeAgentRunHandler(SECRET, BFF_URL);
    const req = makeReq({
      threadId: 't1', runId: 'r2',
      messages: [{ role: 'user', content: 'withdraw 100' }],
      tools: [],
      context: { provider: 'anthropic', sessionId: 'sess-abc' },
      resume: [{ status: 'approved', interruptId: 'elic-1', ...resumeItem }],
    });
    await handler(req, makeRes());
    const call = (reasonOnce as jest.Mock).mock.calls[0][0];
    return call.messages as Array<{ role: string; content: string }>;
  }

  it('elicitation resume tells the LLM to retry with _elicitation_confirmed and _elicitation_id', async () => {
    const messages = await resumeWith({ reason: 'elicitation_required', toolName: 'create_withdrawal' });
    const hint = messages[messages.length - 1].content;
    expect(hint).toContain('_elicitation_confirmed=true');
    expect(hint).toContain('_elicitation_id="elic-1"');
    expect(hint).toContain('create_withdrawal');
  });

  it('default (HITL) resume tells the LLM to retry with _hitl_challenge_id', async () => {
    const messages = await resumeWith({ reason: 'consent', toolName: 'create_transfer' });
    const hint = messages[messages.length - 1].content;
    expect(hint).toContain('_hitl_challenge_id="elic-1"');
    expect(hint).not.toContain('_elicitation_confirmed');
  });
});
