'use strict';

/**
 * Reconnect over a real HTTP connection: a real listening server running the
 * SDK's JSON-RPC + SSE handler, a handler built per request (as the router does),
 * a client that aborts its stream, and a brand-new connection that rejoins.
 */

const http = require('node:http');
const express = require('express');
const {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
} = require('@a2a-js/sdk/server');
const { jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const { TaskState } = require('@a2a-js/sdk');
const { buildSpecialistAgentCard } = require('../services/a2aAgentCardService');
const { sharedEventBusManager, withDrainOnDisconnect } = require('../services/a2aProtocolServer');

const CARD = buildSpecialistAgentCard('banking', { getEffective: () => '' });
const USER = { isAuthenticated: true, userName: 'user-http', tenantId: 'tenant-http' };

function slowExecutor() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    release: () => release(),
    async execute(requestContext, eventBus) {
      const { taskId, contextId } = requestContext;
      eventBus.publish(AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [],
        history: [],
        metadata: undefined,
      }));
      await gate;
      eventBus.publish(AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: { artifactId: 'a1', name: 'tool-result', description: '', parts: [], metadata: undefined, extensions: [] },
        append: false,
        lastChunk: true,
        metadata: undefined,
      }));
      eventBus.publish(AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: new Date().toISOString() },
        metadata: undefined,
      }));
    },
    async cancelTask() {},
  };
}

let server;
let base;
let executor;
const taskStore = new InMemoryTaskStore();

beforeAll(async () => {
  executor = slowExecutor();
  const app = express();
  // A new handler for every request, exactly like createA2aProtocolRouter.
  app.use((req, res, next) => {
    const plain = new DefaultRequestHandler(CARD, taskStore, executor, sharedEventBusManager());
    // x-no-drain lets one test run the same flow without the drain wrapper.
    const requestHandler = req.headers['x-no-drain'] ? plain : withDrainOnDisconnect(plain);
    return jsonRpcHandler({ requestHandler, userBuilder: async () => USER })(req, res, next);
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  executor.release();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  executor = slowExecutor(); // a fresh gate per test
});

function rpc(method, params, id = '1', extraHeaders = {}) {
  return { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0', ...extraHeaders }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) };
}

/** Yield each SSE `data:` payload as it arrives. */
async function* sseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame.split('\n').find((line) => line.startsWith('data:'));
      if (data) yield JSON.parse(data.slice(5)).result;
    }
  }
}

const kindOf = (result) => Object.keys(result).find((key) => ['task', 'statusUpdate', 'artifactUpdate', 'message'].includes(key));

test('abort the stream, rejoin on a new connection while the task still runs, and see it finish', async () => {
  // Connection 1: start a streamed task, read its first event, then abort the socket.
  const abort = new AbortController();
  const first = await fetch(base, {
    ...rpc('SendStreamingMessage', { message: { messageId: 'm-http', role: 'ROLE_USER', parts: [{ text: 'go' }] } }),
    signal: abort.signal,
  });
  expect(first.status).toBe(200);
  expect(first.headers.get('content-type')).toMatch(/text\/event-stream/);
  const started = (await sseEvents(first).next()).value;
  expect(kindOf(started)).toBe('task');
  const taskId = started.task.id;
  abort.abort();

  // Connection 2: a brand-new request rejoins the running task.
  const second = await fetch(base, rpc('SubscribeToTask', { id: taskId }, '2'));
  expect(second.status).toBe(200);
  const events = sseEvents(second);
  const snapshot = (await events.next()).value;
  expect(kindOf(snapshot)).toBe('task');
  expect(snapshot.task.id).toBe(taskId);

  executor.release(); // the turn finishes while the rejoined stream is open
  const rest = [];
  for await (const event of events) rest.push(kindOf(event));

  expect(rest).toEqual(expect.arrayContaining(['artifactUpdate', 'statusUpdate']));

  // The result was stored although connection 1 was gone, and a finished task cannot be rejoined.
  const got = await (await fetch(base, rpc('GetTask', { id: taskId }, '3'))).json();
  expect(got.result.status.state).toMatch(/COMPLETED/);
  const again = await (await fetch(base, rpc('SubscribeToTask', { id: taskId }, '4'))).json();
  expect(JSON.stringify(again.error)).toMatch(/terminal/i);
});

// Recorded observation, not a requirement: over a real connection the SDK's Express
// handler keeps consuming the stream after the client aborts, so the finished task is
// stored even without withDrainOnDisconnect. The wrapper only matters if something
// calls return() on the stream (see a2aSpecialistResubscribe.test.js). If this starts
// failing, the SDK changed and the wrapper has become necessary on the HTTP path.
test('without the drain wrapper, an aborted real stream still stores the finished task', async () => {
  const abort = new AbortController();
  const first = await fetch(base, {
    ...rpc('SendStreamingMessage', { message: { messageId: 'm-nodrain', role: 'ROLE_USER', parts: [{ text: 'go' }] } }, '1', { 'x-no-drain': '1' }),
    signal: abort.signal,
  });
  const taskId = (await sseEvents(first).next()).value.task.id;
  abort.abort();
  executor.release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const got = await (await fetch(base, rpc('GetTask', { id: taskId }, '2', { 'x-no-drain': '1' }))).json();
  expect(got.result.status.state).toMatch(/COMPLETED/);
});
