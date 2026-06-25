import { AGUIEmitter } from '../src/aguiEmitter';

function makeCapture() {
  const events: Record<string, unknown>[] = [];
  const emit = async (event: Record<string, unknown>) => { events.push(event); };
  return { events, emit };
}

describe('AGUIEmitter', () => {
  it('onRunStart emits RUN_STARTED with runId and threadId', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onRunStart();
    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'run-1', threadId: 'thread-1' });
  });

  it('onRunEnd emits RUN_FINISHED', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onRunEnd();
    expect(events[0]).toMatchObject({ type: 'RUN_FINISHED', runId: 'run-1', threadId: 'thread-1' });
  });

  it('onLlmStart emits TEXT_MESSAGE_START with role assistant', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onLlmStart();
    expect(events[0]).toMatchObject({ type: 'TEXT_MESSAGE_START', role: 'assistant' });
  });

  it('onLlmToken emits TEXT_MESSAGE_CONTENT with delta', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onLlmToken('hello');
    expect(events[0]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' });
  });

  it('onLlmEnd emits TEXT_MESSAGE_END', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onLlmEnd();
    expect(events[0]).toMatchObject({ type: 'TEXT_MESSAGE_END' });
  });

  it('onToolStart emits TOOL_CALL_START with toolName', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onToolStart('tc-1', 'get_accounts', { userId: 'u1' });
    expect(events[0]).toMatchObject({ type: 'TOOL_CALL_START', toolCallId: 'tc-1', toolName: 'get_accounts' });
  });

  it('onToolEnd emits TOOL_CALL_END with result', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onToolEnd('tc-1', { accounts: [] });
    expect(events[0]).toMatchObject({ type: 'TOOL_CALL_END', toolCallId: 'tc-1' });
  });

  it('onError emits RUN_ERROR with message', async () => {
    const { events, emit } = makeCapture();
    const e = new AGUIEmitter('run-1', 'thread-1', emit);
    await e.onError(new Error('boom'));
    expect(events[0]).toMatchObject({ type: 'RUN_ERROR', message: 'boom' });
  });
});
