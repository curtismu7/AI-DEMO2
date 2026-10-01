'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createRunnerController, runnerServiceLabel } = require('./runner-control');

function fakeSpawner(handler) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      const result = handler({ command, args, options });
      child.stdout.end(result.stdout || '');
      child.stderr.end(result.stderr || '');
      child.emit('close', result.code ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

const repository = 'cmuir_pingcorp/AI-DEMO2';
const runner = { id: 23, name: 'cmuir-dev-mac', status: 'online', busy: false, labels: ['self-hosted'] };
const label = 'actions.runner.cmuir_pingcorp-AI-DEMO2.cmuir-dev-mac';

test('runnerServiceLabel derives only the exact repository-scoped launchd label', () => {
  assert.equal(runnerServiceLabel(repository, 'cmuir-dev-mac'), label);
  assert.equal(runnerServiceLabel(repository, 'runner;shutdown'), null);
  assert.equal(runnerServiceLabel('../other/repository', 'runner'), null);
});

test('inspect marks a matching launchd runner available and reports paused state', async () => {
  const { spawn } = fakeSpawner(({ args }) => ({
    stdout: args[0] === 'list' ? `PID\tStatus\tLabel\n-\t0\t${label}\n` : '',
  }));
  const controller = createRunnerController({ spawn, platform: 'darwin', serviceFileExists: () => true });

  assert.deepEqual(await controller.inspect(repository, [runner]), [{
    ...runner,
    localControlAvailable: true,
    localPaused: true,
    localInstalled: true,
  }]);
});

test('inspect tells a runner stopped on this Mac apart from one hosted elsewhere', async () => {
  const { spawn } = fakeSpawner(() => ({ stdout: 'PID\tStatus\tLabel\n' }));
  const controller = createRunnerController({ spawn, platform: 'darwin', serviceFileExists: (name) => name === label });
  const remote = { ...runner, id: 24, name: 'cmuir-air' };

  assert.deepEqual(await controller.inspect(repository, [runner, remote]), [
    { ...runner, localControlAvailable: false, localPaused: false, localInstalled: true },
    { ...remote, localControlAvailable: false, localPaused: false, localInstalled: false },
  ]);
});

test('pause stops only an idle matching runner service', async () => {
  const { spawn, calls } = fakeSpawner(({ args }) => ({
    stdout: args[0] === 'list' ? `1982\t0\t${label}\n` : '',
  }));
  const controller = createRunnerController({ spawn, platform: 'darwin' });

  await controller.perform(repository, runner, 'pause');

  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ['launchctl', ['list']],
    ['launchctl', ['stop', label]],
  ]);
  assert.ok(calls.every((call) => call.options.shell === false));
});

test('pause refuses a runner GitHub reports as busy', async () => {
  const { spawn, calls } = fakeSpawner(() => ({ stdout: `1982\t0\t${label}\n` }));
  const controller = createRunnerController({ spawn, platform: 'darwin' });

  await assert.rejects(controller.perform(repository, { ...runner, busy: true }, 'pause'), { code: 'RUNNER_BUSY' });
  assert.deepEqual(calls.map((call) => call.args), []);
});

test('resume starts only a runner that is locally paused', async () => {
  const pausedRunner = { ...runner, status: 'offline', localPaused: true };
  const { spawn, calls } = fakeSpawner(({ args }) => ({
    stdout: args[0] === 'list' ? `-\t0\t${label}\n` : '',
  }));
  const controller = createRunnerController({ spawn, platform: 'darwin' });

  await controller.perform(repository, pausedRunner, 'resume');

  assert.deepEqual(calls.map((call) => call.args), [['list'], ['start', label]]);
});

test('resume refuses an offline runner that was not paused by this dashboard', async () => {
  const { spawn, calls } = fakeSpawner(() => ({ stdout: `1982\t0\t${label}\n` }));
  const controller = createRunnerController({ spawn, platform: 'darwin' });

  await assert.rejects(controller.perform(repository, { ...runner, status: 'offline' }, 'resume'), { code: 'RUNNER_STATE' });
  assert.equal(calls.length, 0);
});

test('runner control is unavailable on non-macOS hosts', async () => {
  const { spawn, calls } = fakeSpawner(() => ({ stdout: '' }));
  const controller = createRunnerController({ spawn, platform: 'linux' });

  assert.deepEqual(await controller.inspect(repository, [runner]), [{
    ...runner,
    localControlAvailable: false,
    localPaused: false,
    localInstalled: false,
  }]);
  await assert.rejects(controller.perform(repository, runner, 'pause'), { code: 'RUNNER_CONTROL_UNAVAILABLE' });
  assert.equal(calls.length, 0);
});
