/**
 * @file setupWizard.route.test.js
 * Tests for the Setup Wizard routes under /api/admin/setup/.
 *
 * NOTE: setup.js calls jest.resetModules() in afterEach, clearing the module cache
 * after every test. All module references are therefore re-acquired inside beforeEach
 * so that each test gets fresh mock instances with the correct implementations.
 *
 * SSE routes (POST /run, /recreate, /run-tests) are tested with direct handler
 * invocation rather than supertest. Supertest/superagent hangs on text/event-stream
 * responses because it waits for socket close rather than response body end.
 *
 * JSON routes (POST /validate, GET /config-template, 400 validations) use supertest.
 *
 * Covers:
 *   POST /run       — 400 missing fields; SSE events (connected, step, complete, [DONE], error)
 *   POST /recreate  — 400 missing fields; SSE emits recreate-success
 *   POST /validate  — 400 missing fields; 200 valid creds; 400 bad creds
 *   GET  /config-template — 200 shape; required/optional sections
 *   POST /run-tests — 400 unknown suite; SSE start, stdout, stderr, done, [DONE], default suite
 */

'use strict';

const { EventEmitter } = require('events');
const express = require('express');
const request = require('supertest');

// ── Mocks — explicit factories prevent real modules from loading ───────────────
// Factories persist across jest.resetModules(); the jest.fn() instances inside
// are recreated on each fresh require() after resetModules.

jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  requireAdmin: jest.fn((_req, _res, next) => next()),
  authenticateToken: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../services/pingoneProvisionService', () => ({
  provisionEnvironment: jest.fn(),
  recreateResource: jest.fn(),
  PingOneProvisionService: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// ── Module-level references (re-acquired in beforeEach after resetModules) ─────

let requireAdmin;
let provisionEnvironment;
let recreateResource;
let PingOneProvisionService;
let spawn;
let setupWizardRouter;

// ── App + handler helpers (use module-level let vars via closure) ──────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/setup', setupWizardRouter);
  return app;
}

function findRouteHandlers(method, path) {
  const route = setupWizardRouter.stack
    .map((l) => l.route)
    .filter(Boolean)
    .find((r) => r.path === path && r.methods[method.toLowerCase()]);
  if (!route) throw new Error(`Route ${method.toUpperCase()} ${path} not found in router`);
  return route.stack.map((l) => l.handle);
}

function invokeSseRoute(method, path, body) {
  return new Promise((resolve) => {
    const writes = [];
    const mockReq = { body, user: { id: 'admin1', role: 'admin' }, on: jest.fn() };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((data) => resolve({ isJson: true, data, writes })),
      writeHead: jest.fn(),
      write: jest.fn((data) => writes.push(String(data))),
      end: jest.fn(() => resolve({ writes })),
      headersSent: false,
    };

    const handlers = findRouteHandlers(method, path);
    let i = 0;
    const next = () => {
      if (i < handlers.length) handlers[i++](mockReq, mockRes, next);
    };
    next();
  });
}

function parseSSEEvents(writes) {
  return writes
    .join('')
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data: ') && b !== 'data: [DONE]')
    .map((b) => { try { return JSON.parse(b.slice(6)); } catch (_) { return null; } })
    .filter(Boolean);
}

// ── Mock child process factory ────────────────────────────────────────────────

function makeMockChild({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child;
}

// ── Setup — re-acquire modules after jest.resetModules() ──────────────────────

beforeEach(() => {
  // Re-acquire fresh instances: setup.js afterEach calls jest.resetModules()
  // which clears the cache; next require creates new jest.fn() from the factory.
  const auth = require('../../middleware/auth');
  const pingone = require('../../services/pingoneProvisionService');
  const cp = require('child_process');
  setupWizardRouter = require('../../routes/setupWizard');

  requireAdmin = auth.requireAdmin;
  provisionEnvironment = pingone.provisionEnvironment;
  recreateResource = pingone.recreateResource;
  PingOneProvisionService = pingone.PingOneProvisionService;
  spawn = cp.spawn;

  requireAdmin.mockImplementation((_req, _res, next) => next());

  provisionEnvironment.mockImplementation(async (_config, onStep) => {
    onStep({ step: 'create-resource', message: 'Creating resource...' });
    return { provisioned: ['Super Banking API'] };
  });

  recreateResource.mockResolvedValue({ success: true, message: 'Resource recreated' });

  PingOneProvisionService.mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    populationId: 'pop-abc123',
    findResourceByName: jest.fn().mockResolvedValue(null),
    findUserByUsername: jest.fn().mockResolvedValue(null),
  }));

  spawn.mockReturnValue(makeMockChild());
});

// ── POST /run — validation (supertest, JSON response) ────────────────────────

describe('POST /api/admin/setup/run — validation', () => {
  it('returns 400 when envId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/run')
      .send({ workerClientId: 'cid', workerClientSecret: 'secret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
  });

  it('returns 400 when workerClientSecret is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/run')
      .send({ envId: 'env-1', workerClientId: 'cid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
  });
});

// ── POST /run — SSE stream (direct handler invocation) ────────────────────────

describe('POST /api/admin/setup/run — SSE stream', () => {
  const BODY = { envId: 'env-1', workerClientId: 'cid', workerClientSecret: 'secret' };

  it('SSE stream includes connected, step, and complete events', async () => {
    const { writes } = await invokeSseRoute('post', '/run', BODY);
    const allText = writes.join('');
    expect(allText).toContain('"step":"connected"');
    expect(allText).toContain('"step":"create-resource"');
    expect(allText).toContain('"step":"complete"');
  });

  it('SSE stream ends with [DONE] sentinel and calls res.end()', async () => {
    const { writes } = await invokeSseRoute('post', '/run', BODY);
    expect(writes.join('')).toContain('[DONE]');
  });

  it('emits error event when provisionEnvironment throws', async () => {
    provisionEnvironment.mockRejectedValue(new Error('PingOne API timeout'));
    const { writes } = await invokeSseRoute('post', '/run', BODY);
    const events = parseSSEEvents(writes);
    const errorEvent = events.find((e) => e.step === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toContain('PingOne API timeout');
  });
});

// ── POST /recreate — validation (supertest) ───────────────────────────────────

describe('POST /api/admin/setup/recreate — validation', () => {
  it('returns 400 when resource is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/recreate')
      .send({ envId: 'env-1', workerClientId: 'cid', workerClientSecret: 'secret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
  });
});

// ── POST /recreate — SSE stream (direct handler invocation) ──────────────────

describe('POST /api/admin/setup/recreate — SSE stream', () => {
  it('emits recreate-success on success', async () => {
    const { writes } = await invokeSseRoute('post', '/recreate', {
      resource: 'Super Banking API',
      envId: 'env-1',
      workerClientId: 'cid',
      workerClientSecret: 'secret',
    });
    const events = parseSSEEvents(writes);
    const successEvent = events.find((e) => e.step === 'recreate-success');
    expect(successEvent).toBeDefined();
  });
});

// ── POST /validate (supertest, JSON) ─────────────────────────────────────────

describe('POST /api/admin/setup/validate', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/validate')
      .send({ envId: 'env-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
  });

  it('returns 200 with valid=true and environment on valid credentials', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/validate')
      .send({ envId: 'env-1', workerClientId: 'cid', workerClientSecret: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.environment).toHaveProperty('envId', 'env-1');
    expect(res.body.environment).toHaveProperty('populationId', 'pop-abc123');
  });

  it('returns 400 with valid=false when initialize throws', async () => {
    PingOneProvisionService.mockImplementation(() => ({
      initialize: jest.fn().mockRejectedValue(new Error('401 Unauthorized')),
    }));

    const res = await request(buildApp())
      .post('/api/admin/setup/validate')
      .send({ envId: 'env-1', workerClientId: 'bad', workerClientSecret: 'wrong' });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.error).toContain('Unauthorized');
  });
});

// ── GET /config-template (supertest, JSON) ────────────────────────────────────

describe('GET /api/admin/setup/config-template', () => {
  it('returns 200 with required and optional sections', async () => {
    const res = await request(buildApp()).get('/api/admin/setup/config-template');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('required');
    expect(res.body).toHaveProperty('optional');
  });

  it('required section contains envId, workerClientId, workerClientSecret', async () => {
    const res = await request(buildApp()).get('/api/admin/setup/config-template');
    expect(res.body.required).toHaveProperty('envId');
    expect(res.body.required).toHaveProperty('workerClientId');
    expect(res.body.required).toHaveProperty('workerClientSecret');
  });

  it('optional section contains region with known options', async () => {
    const res = await request(buildApp()).get('/api/admin/setup/config-template');
    expect(res.body.optional).toHaveProperty('region');
    expect(res.body.optional.region.options).toContain('com');
    expect(res.body.optional.region.options).toContain('eu');
  });
});

// ── POST /run-tests — admin gate removed (49b1776b) ──────────────────────────

describe('POST /api/admin/setup/run-tests — no admin gate (49b1776b)', () => {
  it('returns non-403 even when requireAdmin is set to block — gate was removed', async () => {
    // Set requireAdmin to reject so any route that still carries it would return 403.
    // /run-tests must NOT carry requireAdmin after 49b1776b.
    requireAdmin.mockImplementation((_req, res) => res.status(403).json({ error: 'forbidden' }));

    const res = await request(buildApp())
      .post('/api/admin/setup/run-tests')
      .send({ suite: 'not:a:real:suite' }); // unknown suite → 400

    // 403 would mean requireAdmin is still on the route — the fix removed it
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400); // route is reached; unknown suite → 400
  });

  it('requireAdmin still blocks /config-template (gate not removed from other routes)', async () => {
    requireAdmin.mockImplementation((_req, res) => res.status(403).json({ error: 'forbidden' }));

    const res = await request(buildApp()).get('/api/admin/setup/config-template');

    expect(res.status).toBe(403);
  });
});

// ── POST /run-tests — validation (supertest) ──────────────────────────────────

describe('POST /api/admin/setup/run-tests — validation', () => {
  it('returns 400 with error=unknown_suite for an unknown suite', async () => {
    const res = await request(buildApp())
      .post('/api/admin/setup/run-tests')
      .send({ suite: 'not:a:real:suite' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_suite');
    expect(Array.isArray(res.body.known)).toBe(true);
  });
});

// ── POST /run-tests — SSE stream (direct handler invocation) ─────────────────

describe('POST /api/admin/setup/run-tests — SSE stream', () => {
  it('emits start event with suite label', async () => {
    spawn.mockReturnValue(makeMockChild({ stdout: 'PASS\n' }));
    const { writes } = await invokeSseRoute('post', '/run-tests', { suite: 'bff:unit' });
    const events = parseSSEEvents(writes);
    const startEvent = events.find((e) => e.type === 'start');
    expect(startEvent).toBeDefined();
    expect(startEvent.suite).toBe('bff:unit');
    expect(startEvent.label).toBe('BFF unit tests');
  });

  it('emits stdout events', async () => {
    spawn.mockReturnValue(makeMockChild({ stdout: 'PASS src/foo.test.js\n' }));
    const { writes } = await invokeSseRoute('post', '/run-tests', { suite: 'bff:unit' });
    const events = parseSSEEvents(writes);
    const stdoutEvent = events.find((e) => e.type === 'stdout');
    expect(stdoutEvent).toBeDefined();
    expect(stdoutEvent.text).toContain('PASS');
  });

  it('emits stderr events', async () => {
    spawn.mockReturnValue(makeMockChild({ stderr: 'Warning: deprecated API\n' }));
    const { writes } = await invokeSseRoute('post', '/run-tests', { suite: 'ui:unit' });
    const events = parseSSEEvents(writes);
    const stderrEvent = events.find((e) => e.type === 'stderr');
    expect(stderrEvent).toBeDefined();
    expect(stderrEvent.text).toContain('deprecated');
  });

  it('emits done event with exit code', async () => {
    spawn.mockReturnValue(makeMockChild({ exitCode: 0 }));
    const { writes } = await invokeSseRoute('post', '/run-tests', { suite: 'bff:auth' });
    const events = parseSSEEvents(writes);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent.exitCode).toBe(0);
  });

  it('stream ends with [DONE] sentinel', async () => {
    spawn.mockReturnValue(makeMockChild());
    const { writes } = await invokeSseRoute('post', '/run-tests', { suite: 'bff:unit' });
    expect(writes.join('')).toContain('[DONE]');
  });

  it('uses bff:unit suite by default when suite omitted', async () => {
    spawn.mockReturnValue(makeMockChild());
    const { writes } = await invokeSseRoute('post', '/run-tests', {});
    const events = parseSSEEvents(writes);
    const startEvent = events.find((e) => e.type === 'start');
    expect(startEvent.suite).toBe('bff:unit');
  });
});
