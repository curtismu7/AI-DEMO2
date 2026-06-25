// Regression: the SSE run handler must keep streaming the assistant answer when
// the *request* stream closes mid-run. Node 16+ fires `req`'s 'close' event when
// the request body stream ends (which, for a fully-read POST, happens long before
// a slow provider like Ollama finishes), so wiring the abort flag to req-close
// produced empty answers for slow models — `RUN_FINISHED success` with zero
// TEXT_MESSAGE_CONTENT deltas. Disconnect must be detected via `res` 'close'
// (guarded by writableFinished) instead.
import { EventEmitter } from 'events';
import { makeAgentRunHandler } from '../src/agentRunHandler';
import { reasonOnce } from '../src/reasoningGraph';

jest.mock('../src/reasoningGraph', () => ({ reasonOnce: jest.fn() }));

const SECRET = 'test-secret';

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

test('streams the answer even when the request stream closes mid-run', async () => {
  let resolveReason!: (v: unknown) => void;
  (reasonOnce as jest.Mock).mockReturnValue(new Promise((r) => { resolveReason = r; }));

  const handler = makeAgentRunHandler(SECRET);
  const req = makeReq({
    threadId: 't1',
    runId: 'r1',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    context: { provider: 'anthropic' },
  });
  const res = makeRes();

  const done = handler(req, res);
  // The Node footgun: request body stream emits 'close' while the model is still
  // thinking. With the old req-close wiring this set aborted=true and swallowed
  // the answer; with the fix it is ignored.
  req.emit('close');
  // Model now returns a real final answer.
  resolveReason({ type: 'final', answer: 'hello world', messages: [] });
  await done;

  const body = (res.writes as string[]).join('');
  expect(body).toContain('TEXT_MESSAGE_CONTENT');
  expect(body).toContain('hello world');
});
