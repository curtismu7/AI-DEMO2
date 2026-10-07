'use strict';

/**
 * Reconnect to a running specialist task. The router builds a new
 * DefaultRequestHandler per request, so a reconnecting request only sees the
 * running task if the handlers share one event bus manager.
 */

const {
  AgentEvent,
  DefaultRequestHandler,
  DefaultExecutionEventBusManager,
  InMemoryTaskStore,
  ServerCallContext,
} = require('@a2a-js/sdk/server');
const { SendMessageRequest, SubscribeToTaskRequest, TaskState } = require('@a2a-js/sdk');
const { buildSpecialistAgentCard } = require('../services/a2aAgentCardService');
const { sharedEventBusManager, withDrainOnDisconnect } = require('../services/a2aProtocolServer');

const CARD = buildSpecialistAgentCard('banking', { getEffective: () => '' });
const USER = { isAuthenticated: true, userName: 'user-reconnect', tenantId: 'tenant-r' };

function ctx() {
  return new ServerCallContext({ user: USER });
}

/** A specialist that stays "working" until `release()` is called. */
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

async function startAndDrop(handler) {
  const stream = handler.sendMessageStream(
    SendMessageRequest.fromJSON({ message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'go' }], metadata: { task: true } } }),
    ctx(),
  );
  const first = await stream.next();
  const taskId = first.value.payload.value.id;
  await stream.return(); // the caller's connection drops; the task keeps running
  return taskId;
}

async function collect(stream) {
  const kinds = [];
  for await (const event of stream) kinds.push(event.payload.$case);
  return kinds;
}

async function reconnect(manager, taskStore, taskId, executor) {
  const second = new DefaultRequestHandler(CARD, taskStore, slowExecutor(), manager);
  const pending = collect(second.resubscribe(SubscribeToTaskRequest.fromJSON({ id: taskId }), ctx()));
  await new Promise((resolve) => setTimeout(resolve, 20));
  executor.release();
  return pending;
}

test('a second handler reconnects to a running task through the shared manager and sees it finish', async () => {
  const taskStore = new InMemoryTaskStore();
  const executor = slowExecutor();
  const manager = sharedEventBusManager();
  const taskId = await startAndDrop(withDrainOnDisconnect(new DefaultRequestHandler(CARD, taskStore, executor, manager)));

  const kinds = await reconnect(manager, taskStore, taskId, executor);

  expect(kinds[0]).toBe('task');
  expect(kinds).toEqual(expect.arrayContaining(['artifactUpdate', 'statusUpdate']));
});

test('a dropped stream still stores the finished task, so GetTask is right and the task is then closed to subscribers', async () => {
  const taskStore = new InMemoryTaskStore();
  const executor = slowExecutor();
  const manager = sharedEventBusManager();
  const taskId = await startAndDrop(withDrainOnDisconnect(new DefaultRequestHandler(CARD, taskStore, executor, manager)));
  await reconnect(manager, taskStore, taskId, executor);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const reader = new DefaultRequestHandler(CARD, taskStore, slowExecutor(), manager);
  const stored = await reader.getTask({ id: taskId, historyLength: undefined }, ctx());
  expect(stored.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
  expect(stored.artifacts).toHaveLength(1);
  await expect(collect(reader.resubscribe(SubscribeToTaskRequest.fromJSON({ id: taskId }), ctx()))).rejects.toThrow(/terminal/);
});

test('without the drain a dropped stream strands the task at working (the SDK behaviour the wrapper exists for)', async () => {
  const taskStore = new InMemoryTaskStore();
  const executor = slowExecutor();
  const manager = sharedEventBusManager();
  const taskId = await startAndDrop(new DefaultRequestHandler(CARD, taskStore, executor, manager));
  await reconnect(manager, taskStore, taskId, executor);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const reader = new DefaultRequestHandler(CARD, taskStore, slowExecutor(), manager);
  const stored = await reader.getTask({ id: taskId, historyLength: undefined }, ctx());
  expect(stored.status.state).toBe(TaskState.TASK_STATE_WORKING);
});

test('handlers that each own a manager (the per-request default) only get the snapshot, never the finish', async () => {
  const taskStore = new InMemoryTaskStore();
  const executor = slowExecutor();
  const taskId = await startAndDrop(new DefaultRequestHandler(CARD, taskStore, executor, new DefaultExecutionEventBusManager()));

  const kinds = await reconnect(new DefaultExecutionEventBusManager(), taskStore, taskId, executor);

  expect(kinds).toEqual(['task']);
});

test('the card advertises streaming, which resubscription requires', () => {
  expect(CARD.capabilities.streaming).toBe(true);
});
