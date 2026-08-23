// demo_api_server/tests/agentRun.runsList.test.js
'use strict';

// GET /api/agent/runs — history list backing the /agent-flow-inspector page's
// left sidebar. Verifies ownership scoping (mirrors /runs/:runId/events),
// newest-first ordering, and status derivation from recorded AG-UI events.

const express = require('express');
const request = require('supertest');

jest.mock('../services/configStore', () => ({
  getEffective: (k) => (k === 'ff_agui_enabled' ? 'true' : ''),
  get: () => undefined,
}));

jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (_req, _res, next) => next(),
}));

// setup.js's global afterEach() calls jest.resetModules(), so a module
// reference captured once at file scope goes stale for every test after the
// first. Resolve the (possibly fresh) module inside each test instead, so
// _recordTraceEvents and the router app always share the same _traceStore.
function agentRunModule() {
  return require('../routes/agentRun');
}

function makeApp(userId) {
  const app = express();
  app.use((req, _res, next) => {
    req.agentContext = userId ? { userId } : {};
    next();
  });
  app.use('/api/agent', agentRunModule());
  return app;
}

function sseChunk(event) {
  return Buffer.from(`data: ${JSON.stringify(event)}\n\n`);
}

describe('GET /api/agent/runs', () => {
  test('lists only the requester\'s owned runs, newest first, with derived status', async () => {
    agentRunModule().__test._recordTraceEvents(
      'run-old-success',
      sseChunk({ type: 'RUN_STARTED', runId: 'run-old-success', threadId: 'thread-a' }),
      'user-1',
      'langchain',
    );
    agentRunModule().__test._recordTraceEvents(
      'run-old-success',
      sseChunk({ type: 'RUN_FINISHED', runId: 'run-old-success', threadId: 'thread-a' }),
      'user-1',
      'langchain',
    );

    await new Promise((r) => setTimeout(r, 5));

    agentRunModule().__test._recordTraceEvents(
      'run-new-failed',
      sseChunk({ type: 'RUN_STARTED', runId: 'run-new-failed', threadId: 'thread-b' }),
      'user-1',
      'openai_agents',
    );
    agentRunModule().__test._recordTraceEvents(
      'run-new-failed',
      sseChunk({ type: 'RUN_ERROR', message: 'boom' }),
      'user-1',
      'openai_agents',
    );

    agentRunModule().__test._recordTraceEvents(
      'run-other-user',
      sseChunk({ type: 'RUN_STARTED', runId: 'run-other-user', threadId: 'thread-c' }),
      'user-2',
      'langchain',
    );

    const res = await request(makeApp('user-1')).get('/api/agent/runs');

    expect(res.status).toBe(200);
    const runIds = res.body.runs.map((r) => r.runId);
    expect(runIds).toContain('run-old-success');
    expect(runIds).toContain('run-new-failed');
    expect(runIds).not.toContain('run-other-user');

    // newest first
    expect(runIds.indexOf('run-new-failed')).toBeLessThan(runIds.indexOf('run-old-success'));

    const success = res.body.runs.find((r) => r.runId === 'run-old-success');
    expect(success.status).toBe('success');
    expect(success.threadId).toBe('thread-a');
    expect(success.frameworkLabel).toBe('LangChain / LangGraph');

    const failed = res.body.runs.find((r) => r.runId === 'run-new-failed');
    expect(failed.status).toBe('failed');
    expect(failed.frameworkLabel).toBe('OpenAI Agents SDK');
  });

  test('an in-progress run (no RUN_FINISHED/RUN_ERROR yet) reports status in_progress', async () => {
    agentRunModule().__test._recordTraceEvents(
      'run-pending',
      sseChunk({ type: 'RUN_STARTED', runId: 'run-pending', threadId: 'thread-d' }),
      'user-3',
      'langchain',
    );

    const res = await request(makeApp('user-3')).get('/api/agent/runs');
    const pending = res.body.runs.find((r) => r.runId === 'run-pending');
    expect(pending.status).toBe('in_progress');
  });

  // Regression guard: GET /runs previously returned every run in the store
  // (up to the 500-entry cap) with no way to page through them.
  test('supports limit/offset pagination while defaulting to the full list', async () => {
    for (let i = 0; i < 5; i++) {
      agentRunModule().__test._recordTraceEvents(
        `run-page-${i}`,
        sseChunk({ type: 'RUN_STARTED', runId: `run-page-${i}` }),
        'user-4',
        'langchain',
      );
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 2));
    }

    const full = await request(makeApp('user-4')).get('/api/agent/runs');
    expect(full.body.runs.length).toBe(5);
    expect(full.body.total).toBe(5);

    const page = await request(makeApp('user-4')).get('/api/agent/runs?limit=2&offset=1');
    expect(page.body.runs.length).toBe(2);
    expect(page.body.total).toBe(5);
    // Newest-first ordering preserved across the paginated slice.
    expect(page.body.runs[0].runId).toBe(full.body.runs[1].runId);
    expect(page.body.runs[1].runId).toBe(full.body.runs[2].runId);
  });
});
