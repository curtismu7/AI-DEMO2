'use strict';

/**
 * Specialist tasks, streaming and push: the opt-in lifecycle on top of the
 * unchanged one-Message SendMessage, and the webhook guard.
 */

const express = require('express');
const request = require('supertest');
const { createA2aProtocolRouter } = require('../services/a2aProtocolServer');
const { buildSpecialistAgentCard } = require('../services/a2aAgentCardService');
const {
  isPrivateAddress,
  assertPushUrlAllowed,
  createGuardedPushStore,
  pushEnabled,
} = require('../services/a2aPushGuard');
const { tenantHandle } = require('../services/a2aTenantService');

jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
const { validateToken } = require('../services/tokenValidationService');
jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pingone_ai_agent_client_id' ? 'generalist-agent' : ''),
}));

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const CFG = { getEffective: () => 'https://api.ping.demo:3001' };

function claimsFor(sub) {
  return {
    sub,
    aud: ['a2a-intermediate-purchase.ping.demo'],
    scope: 'agent:invoke:purchase',
    act: { client_id: 'generalist-agent' },
    a2a_tenant_id: 'tenant-tasks',
  };
}

function app() {
  const a = express();
  a.use(createA2aProtocolRouter({ configStore: CFG }));
  return a;
}

function rpc(sub, method, params, extra = (r) => r) {
  const claims = claimsFor(sub);
  validateToken.mockResolvedValueOnce(claims);
  return extra(
    request(app())
      .post('/retail')
      .set('Authorization', `Bearer ${fakeJwt(claims)}`)
      .set('A2A-Version', '1.0')
      .send({ jsonrpc: '2.0', id: `${method}-1`, method, params }),
  );
}

function userMessage(metadata, extra = {}) {
  return {
    message: {
      messageId: `m-${Math.random()}`,
      role: 'ROLE_USER',
      parts: [{ text: 'Retrieve my purchase history' }],
      metadata: { tenant: tenantHandle('tenant-tasks'), ...metadata },
      ...extra,
    },
  };
}

beforeEach(() => validateToken.mockReset());

describe('specialist task lifecycle (opt-in)', () => {
  test('a plain SendMessage still returns one Message, not a Task', async () => {
    const res = await rpc('user-plain', 'SendMessage', userMessage({}));
    expect(res.status).toBe(200);
    expect(res.body.result.message).toBeTruthy();
    expect(res.body.result.task).toBeUndefined();
  });

  test('metadata.task returns a Task whose artifact carries the tool result', async () => {
    const res = await rpc('user-task', 'SendMessage', userMessage({ task: true }));
    expect(res.status).toBe(200);
    const task = res.body.result.task;
    expect(task.id).toBeTruthy();
    expect(task.status.state).toMatch(/FAILED|COMPLETED/);
    expect(task.artifacts).toHaveLength(1);
    // No tool named, so the specialist refuses; the refusal is still the artifact.
    const payload = JSON.parse(task.artifacts[0].parts[0].text);
    expect(payload.toolError).toBe('not_authorized_for_skill');
    expect(task.status.state).toMatch(/FAILED/);
  });

  test('the task is durable, retrievable by its owner, and invisible to another user', async () => {
    const created = await rpc('user-owner', 'SendMessage', userMessage({ task: true }));
    const id = created.body.result.task.id;

    const mine = await rpc('user-owner', 'GetTask', { id });
    expect(mine.body.result?.id).toBe(id);

    const theirs = await rpc('user-other', 'GetTask', { id });
    expect(theirs.body.result).toBeUndefined();
    expect(theirs.body.error).toBeTruthy();
  });

  test('a follow-up in the same context is a new task in that context', async () => {
    const first = await rpc('user-follow', 'SendMessage', userMessage({ task: true }));
    const { id, contextId } = first.body.result.task;
    const second = await rpc('user-follow', 'SendMessage', userMessage({ task: true }, { contextId, referenceTaskIds: [id] }));
    expect(second.body.result.task.contextId).toBe(contextId);
    expect(second.body.result.task.id).not.toBe(id);
  });

  test('SendStreamingMessage streams the task, its artifact and a terminal status', async () => {
    const res = await rpc('user-stream', 'SendStreamingMessage', userMessage({ task: true }), (r) =>
      r.buffer(true).parse((response, cb) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => cb(null, text));
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = String(res.body)
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)));
    const kinds = events.map((e) => Object.keys(e.result || e)[0]);
    expect(kinds).toEqual(expect.arrayContaining(['task', 'artifactUpdate', 'statusUpdate']));
  });
});

describe('push registration over the wire', () => {
  const saved = process.env.A2A_PUSH_ALLOWED_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.A2A_PUSH_ALLOWED_HOSTS;
    else process.env.A2A_PUSH_ALLOWED_HOSTS = saved;
  });

  test('a callback to a host that is not allowlisted is refused', async () => {
    process.env.A2A_PUSH_ALLOWED_HOSTS = 'hooks.example.com';
    const created = await rpc('user-push', 'SendMessage', userMessage({ task: true }));
    const taskId = created.body.result.task.id;
    const res = await rpc('user-push', 'CreateTaskPushNotificationConfig', {
      taskId,
      url: 'https://169.254.169.254/latest/meta-data',
      token: 'tok',
    });
    expect(res.body.result).toBeUndefined();
    expect(res.body.error).toBeTruthy();
  });
});

describe('Agent Card capabilities', () => {
  const saved = process.env.A2A_PUSH_ALLOWED_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.A2A_PUSH_ALLOWED_HOSTS;
    else process.env.A2A_PUSH_ALLOWED_HOSTS = saved;
  });

  test('streaming is advertised; pushNotifications only with an allowlisted callback host', () => {
    delete process.env.A2A_PUSH_ALLOWED_HOSTS;
    expect(buildSpecialistAgentCard('banking', CFG).capabilities).toMatchObject({ streaming: true, pushNotifications: false });
    process.env.A2A_PUSH_ALLOWED_HOSTS = 'hooks.example.com';
    expect(pushEnabled()).toBe(true);
    expect(buildSpecialistAgentCard('banking', CFG).capabilities.pushNotifications).toBe(true);
  });
});

describe('push callback guard', () => {
  const hosts = ['hooks.example.com'];
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  test('classifies private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  test('accepts an allowlisted https host that resolves to a public address', async () => {
    await expect(assertPushUrlAllowed('https://hooks.example.com/cb', { hosts, lookup: publicLookup })).resolves.toBeInstanceOf(URL);
  });

  test.each([
    ['http://hooks.example.com/cb', 'must be https'],
    ['https://evil.example.net/cb', 'not on the allowlist'],
    ['not a url', 'not a valid URL'],
  ])('rejects %s', async (url, why) => {
    await expect(assertPushUrlAllowed(url, { hosts, lookup: publicLookup })).rejects.toThrow(why);
  });

  test('rejects an allowlisted host that resolves to a private address', async () => {
    const lookup = async () => [{ address: '10.0.0.5', family: 4 }];
    await expect(assertPushUrlAllowed('https://hooks.example.com/cb', { hosts, lookup })).rejects.toThrow('private address');
  });

  test('rejects an IP literal that is private, even when allowlisted', async () => {
    await expect(assertPushUrlAllowed('https://127.0.0.1/cb', { hosts: ['127.0.0.1'], lookup: publicLookup })).rejects.toThrow('private address');
  });

  test('a registered callback receives the task update through the guarded store', async () => {
    const { DefaultPushNotificationSender } = require('@a2a-js/sdk/server');
    const store = createGuardedPushStore(undefined, async (url) => url);
    const ctx = { user: { userName: 'u', tenantId: 't' } };
    await store.save('task-9', ctx, { id: 'c9', taskId: 'task-9', url: 'https://hooks.example.com/cb', token: 'tok-9', tenant: '', authentication: undefined });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    try {
      await new DefaultPushNotificationSender(store).send(
        { payload: { $case: 'statusUpdate', value: { taskId: 'task-9', contextId: 'c', status: undefined, metadata: undefined } } },
        ctx,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('https://hooks.example.com/cb');
      expect(JSON.stringify(fetchSpy.mock.calls[0][1].headers)).toContain('tok-9');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('the store refuses an unsafe callback and drops one that turns unsafe before sending', async () => {
    let safe = true;
    const check = async (url) => { if (!safe) throw new Error('private address'); return url; };
    const store = createGuardedPushStore(undefined, check);
    const ctx = { user: { userName: 'u', tenantId: 't' } };
    const config = { id: 'c1', taskId: 'task-1', url: 'https://hooks.example.com/cb', token: 'tok', tenant: '', authentication: undefined };
    await store.save('task-1', ctx, config);
    expect(await store.load('task-1', ctx)).toHaveLength(1);
    safe = false; // the host now resolves somewhere private (DNS rebinding)
    expect(await store.load('task-1', ctx)).toHaveLength(0);
    await expect(store.save('task-2', ctx, config)).rejects.toThrow('private address');
  });
});
