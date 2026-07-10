const { execFile, spawn } = require('child_process');
const { Router } = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PINGCLI_BIN = process.env.PINGCLI_BIN || '/app/bin/pingcli';
const TIMEOUT_MS = 15000;

// pingcli persists its token store under $HOME/.pingcli. The container user
// (Dockerfile USER appuser, no ENV HOME) has no usable HOME, so every PingOne
// command fails with "token store is not configured" / "Authentication is not
// configured for this profile". Point HOME at a writable directory for every
// pingcli child process.
const PINGCLI_HOME = process.env.PINGCLI_HOME || os.tmpdir();

// Child env for every pingcli invocation: writable HOME, and PINGONE_* vars
// stripped so pingcli uses only our --config file, not the ambient container
// credentials (env vars take priority over the config file and conflict).
function pingcliEnv() {
  const env = { ...process.env, HOME: PINGCLI_HOME };
  delete env.PINGONE_ENVIRONMENT_ID;
  delete env.PINGONE_WORKER_CLIENT_ID;
  delete env.PINGONE_WORKER_CLIENT_SECRET;
  return env;
}

// Write a minimal pingcli config from env vars so the binary doesn't conflict
// with any host-mounted config or ambient env var credentials.
function getPingcliConfigPath() {
  const envId     = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId  = process.env.PINGONE_WORKER_CLIENT_ID;
  const secret    = process.env.PINGONE_WORKER_CLIENT_SECRET;
  if (!envId || !clientId || !secret) return null;

  const configPath = path.join(os.tmpdir(), 'pingcli-demo-config.yaml');
  // storage.type must be a real store (not "none"): pingcli 1.x resource commands
  // require a persisted token or they report "Authentication is not configured".
  // "file_system" writes ~/.pingcli/credentials, which works headless (no keychain).
  const yaml = `activeProfile: default
configModelVersion: 2
default:
    auth:
        storage:
            type: file_system
    service:
        pingOne:
            authentication:
                clientCredentials:
                    clientID: "${clientId}"
                    clientSecret: "${secret}"
                grantType: client_credentials
            enabled: true
            endpoint:
                environmentID: "${envId}"
                rootDomain: pingone.com
`;
  fs.writeFileSync(configPath, yaml, { mode: 0o600 });
  return configPath;
}

const PINGCLI_CONFIG = getPingcliConfigPath();
const configFlag = PINGCLI_CONFIG ? ['--config', PINGCLI_CONFIG] : [];

// Lazy one-time auth bootstrap. `pingcli pingone auth login` with a
// client_credentials config is fully non-interactive (verified locally:
// "Successfully authenticated with client credentials") and persists a token
// under $HOME/.pingcli/credentials, so subsequent PingOne commands succeed.
// A shared module-level promise means concurrent requests bootstrap once; it
// is reset on failure so a later request can retry.
let authBootstrapPromise = null;
function ensureAuthBootstrap() {
  if (!PINGCLI_CONFIG) return Promise.resolve({ ok: true });
  if (!authBootstrapPromise) {
    authBootstrapPromise = new Promise((resolve) => {
      execFile(
        PINGCLI_BIN,
        [...configFlag, 'pingone', 'auth', 'login'],
        { timeout: TIMEOUT_MS, env: pingcliEnv() },
        (err, stdout, stderr) => {
          if (err) {
            authBootstrapPromise = null;
            resolve({ ok: false, error: (stderr || stdout || err.message || '').trim() });
          } else {
            resolve({ ok: true });
          }
        }
      );
    });
  }
  return authBootstrapPromise;
}

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || '<environment-id>';
const envFlag = ['--environment-id', ENV_ID];

// Allow-list of safe read-only commands.
//
// runnable=true  → executed live server-side and streamed to the terminal pane.
// runnable=false → shown as a copy-to-run command only. These are env-scoped
//   PingOne resource commands: pingcli 1.x cannot run them with worker /
//   client-credentials auth because the PingOne SDK rejects a client configured
//   with both an access token and an environment ID ("API access token cannot be
//   set with client ID, client secret or environment ID"). Only environment-wide
//   commands like `environments list` (no --environment-id) run server-side.
//
// `label` is the exact, complete command a user can copy and run in their own
// terminal (no --config; that is server-internal). `args` is what we execute.
const COMMANDS = {
  pingone_users_list:        { label: `pingcli pingone users list --environment-id ${ENV_ID} -O json`,               args: [...configFlag, 'pingone', 'users', 'list', ...envFlag, '-O', 'json'],              runnable: false },
  pingone_apps_list:         { label: `pingcli pingone applications list --environment-id ${ENV_ID} -O json`,        args: [...configFlag, 'pingone', 'applications', 'list', ...envFlag, '-O', 'json'],       runnable: false },
  pingone_groups_list:       { label: `pingcli pingone groups list --environment-id ${ENV_ID} -O json`,              args: [...configFlag, 'pingone', 'groups', 'list', ...envFlag, '-O', 'json'],             runnable: false },
  pingone_populations_list:  { label: `pingcli pingone populations list --environment-id ${ENV_ID} -O json`,         args: [...configFlag, 'pingone', 'populations', 'list', ...envFlag, '-O', 'json'],        runnable: false },
  pingone_idps_list:         { label: `pingcli pingone identity-providers list --environment-id ${ENV_ID} -O json`,  args: [...configFlag, 'pingone', 'identity-providers', 'list', ...envFlag, '-O', 'json'], runnable: false },
  pingone_resources_list:    { label: `pingcli pingone resources list --environment-id ${ENV_ID} -O json`,           args: [...configFlag, 'pingone', 'resources', 'list', ...envFlag, '-O', 'json'],          runnable: false },
  pingone_roles_list:        { label: `pingcli pingone roles list --environment-id ${ENV_ID} -O json`,               args: [...configFlag, 'pingone', 'roles', 'list', ...envFlag, '-O', 'json'],              runnable: false },
  pingone_policies_list:     { label: `pingcli pingone sign-on-policies list --environment-id ${ENV_ID} -O json`,    args: [...configFlag, 'pingone', 'sign-on-policies', 'list', ...envFlag, '-O', 'json'],   runnable: false },
  pingone_mfa_policies_list: { label: `pingcli mfa mfa-device-policies list --environment-id ${ENV_ID} -O json`,     args: [...configFlag, 'mfa', 'mfa-device-policies', 'list', ...envFlag, '-O', 'json'],    runnable: false },

  pingone_envs_list:         { label: 'pingcli pingone environments list -O json',                                   args: [...configFlag, 'pingone', 'environments', 'list', '-O', 'json'],                   runnable: true, auth: true },
  config_list_keys:          { label: 'pingcli config list-keys',                                                    args: [...configFlag, 'config', 'list-keys'],                                            runnable: true },
  version:                   { label: 'pingcli --version',                                                           args: ['--version'],                                                                     runnable: true },
};

const router = Router();

router.post('/run', async (req, res) => {
  const { commandKey } = req.body;
  if (!commandKey) {
    return res.status(400).json({ error: 'missing_command_key' });
  }
  const cmd = COMMANDS[commandKey];
  if (!cmd) {
    return res.status(400).json({ error: 'unknown_command', commandKey });
  }
  if (!cmd.runnable) {
    return res.status(400).json({ error: 'copy_only_command', commandKey, command: cmd.label });
  }

  if (cmd.auth) {
    const boot = await ensureAuthBootstrap();
    if (!boot.ok) {
      return res.json({
        command: cmd.label,
        output: `⚠️ pingcli auth bootstrap failed:\n${boot.error}`,
        exitCode: 1,
      });
    }
  }

  execFile(PINGCLI_BIN, cmd.args, { timeout: TIMEOUT_MS, env: pingcliEnv() }, (err, stdout, stderr) => {
    const exitCode = err?.code ?? 0;
    const raw = stdout || stderr || '';
    let output;
    try {
      output = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      output = raw;
    }
    res.json({ command: cmd.label, output, exitCode, error: err?.message });
  });
});

router.get('/stream', async (req, res) => {
  const { commandKey } = req.query;
  if (!commandKey) {
    res.status(400).json({ error: 'missing_command_key' });
    return;
  }
  const cmd = COMMANDS[commandKey];
  if (!cmd) {
    res.status(400).json({ error: 'unknown_command', commandKey });
    return;
  }
  if (!cmd.runnable) {
    res.status(400).json({ error: 'copy_only_command', commandKey, command: cmd.label });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  send('meta', { command: cmd.label });

  if (cmd.auth) {
    const boot = await ensureAuthBootstrap();
    if (!boot.ok) {
      send('chunk', { text: `⚠️ pingcli auth bootstrap failed:\n${boot.error}\n` });
      send('done', { exitCode: 1 });
      res.end();
      return;
    }
  }

  const child = spawn(PINGCLI_BIN, cmd.args, { timeout: TIMEOUT_MS, env: pingcliEnv() });

  child.stdout.on('data', (chunk) => send('chunk', { text: chunk.toString() }));
  child.stderr.on('data', (chunk) => send('chunk', { text: chunk.toString() }));

  child.on('close', (code) => {
    send('done', { exitCode: code ?? 0 });
    res.end();
  });

  child.on('error', (err) => {
    send('done', { exitCode: 1, error: err.message });
    res.end();
  });

  req.on('close', () => child.kill());
});

// Installed pingcli version, e.g. { version: "1.1.0" }. Output line looks like
// "pingcli version 1.1.0 (commit: 80fe2c6...)" — possibly preceded by config
// bootstrap notices, so match anywhere in stdout rather than the first line.
router.get('/version', (_req, res) => {
  execFile(PINGCLI_BIN, ['--version'], { timeout: TIMEOUT_MS, env: pingcliEnv() }, (err, stdout) => {
    const match = /pingcli version (\S+)/.exec(stdout || '');
    if (match) {
      return res.json({ version: match[1] });
    }
    if (err && err.code === 'ENOENT') {
      return res.status(503).json({ error: 'pingcli binary not installed' });
    }
    res.status(503).json({ error: 'unable to determine pingcli version' });
  });
});

router.get('/commands', (_req, res) => {
  res.json(
    Object.entries(COMMANDS).map(([key, { label, runnable }]) => ({ key, label, runnable }))
  );
});

module.exports = router;
