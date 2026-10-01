'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

class RunnerControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunnerControlError';
    this.code = code;
  }
}

function runnerServiceLabel(repository, runnerName) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(String(runnerName || ''))) return null;
  return `actions.runner.${repository.replace('/', '-')}.${runnerName}`;
}

function runLaunchctl(spawn, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('launchctl', args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      reject(new RunnerControlError('RUNNER_CONTROL_UNAVAILABLE', 'The local runner service could not be controlled.'));
      return;
    }
    let stdout = '';
    let settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new RunnerControlError('RUNNER_CONTROL_TIMEOUT', 'The local runner service did not respond in time.'));
    }, 10000);
    timer.unref?.();
    child.once('error', () => finish(new RunnerControlError('RUNNER_CONTROL_UNAVAILABLE', 'The local runner service could not be controlled.')));
    child.once('close', (code) => {
      if (code !== 0) return finish(new RunnerControlError('RUNNER_CONTROL_FAILED', 'The local runner service action failed.'));
      finish(null, stdout);
    });
  });
}

function parseServiceRows(output) {
  return String(output || '').split(/\r?\n/).map((line) => {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3 || columns[0] === 'PID') return null;
    return { pid: columns[0], label: columns.at(-1) };
  }).filter(Boolean);
}

// The runner's svc.sh leaves its plist behind when it stops (unloads) the service.
function launchAgentExists(label) {
  return fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`));
}

function createRunnerController({ spawn = nodeSpawn, platform = process.platform, serviceFileExists = launchAgentExists } = {}) {
  async function inspect(repository, runners) {
    const notLocal = (runner) => ({ ...runner, localControlAvailable: false, localPaused: false, localInstalled: false });
    if (platform !== 'darwin') return runners.map(notLocal);
    let services;
    try {
      services = parseServiceRows(await runLaunchctl(spawn, ['list']));
    } catch {
      return runners.map(notLocal);
    }
    return runners.map((runner) => {
      const label = runnerServiceLabel(repository, runner.name);
      const service = services.find((item) => item.label === label);
      return {
        ...runner,
        localControlAvailable: Boolean(service),
        localPaused: Boolean(service && service.pid === '-'),
        localInstalled: Boolean(service) || Boolean(label && serviceFileExists(label)),
      };
    });
  }

  async function perform(repository, runner, action) {
    if (platform !== 'darwin') throw new RunnerControlError('RUNNER_CONTROL_UNAVAILABLE', 'Runner controls are available only for a matching macOS launchd service.');
    if (!['pause', 'resume'].includes(action)) throw new RunnerControlError('RUNNER_ACTION', 'This runner action is not supported.');
    if (action === 'pause' && runner.busy) throw new RunnerControlError('RUNNER_BUSY', 'This runner is running a job. Wait until it is idle before pausing it.');
    if (action === 'pause' && runner.status !== 'online') throw new RunnerControlError('RUNNER_STATE', 'This runner is not online and ready to pause.');
    if (action === 'resume' && (!runner.localPaused || runner.busy)) throw new RunnerControlError('RUNNER_STATE', 'This runner is not paused locally.');

    const label = runnerServiceLabel(repository, runner.name);
    if (!label) throw new RunnerControlError('RUNNER_CONTROL_UNAVAILABLE', 'This runner does not have a safe local service identifier.');
    const services = parseServiceRows(await runLaunchctl(spawn, ['list']));
    if (!services.some((service) => service.label === label)) {
      throw new RunnerControlError('RUNNER_CONTROL_UNAVAILABLE', 'No matching local runner service is loaded.');
    }
    await runLaunchctl(spawn, [action === 'pause' ? 'stop' : 'start', label]);
    return { ok: true };
  }

  return { inspect, perform };
}

module.exports = { RunnerControlError, createRunnerController, runnerServiceLabel };
