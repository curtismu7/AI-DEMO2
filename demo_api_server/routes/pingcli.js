const { execFile, spawn } = require('child_process');
const { Router } = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Resolution order: explicit override → image-baked Linux build (the Dockerfile
// downloads it to /usr/local/bin because the ./demo_api_server:/app dev bind
// mount shadows /app/bin with the repo's macOS Mach-O binary, which cannot exec
// in the container) → repo binary (native macOS runs via run.sh).
const PINGCLI_BIN =
  process.env.PINGCLI_BIN ||
  (fs.existsSync('/usr/local/bin/pingcli')
    ? '/usr/local/bin/pingcli'
    : path.join(__dirname, '..', 'bin', 'pingcli'));
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

/**
 * Resolve (or refresh) the --config flag at call time. Module-load may run
 * before dotenv / configStore populate PINGONE_* — baking a null configFlag
 * into COMMANDS.args then made every live Run fail with
 * "Authentication is not configured for this profile".
 */
function resolveConfigFlag() {
  const cfg = getPingcliConfigPath();
  return cfg ? ['--config', cfg] : [];
}

/** Strip a baked --config pair from args and re-inject a fresh one. */
function resolveArgs(args) {
  const without = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') {
      i += 1;
      continue;
    }
    without.push(args[i]);
  }
  return [...resolveConfigFlag(), ...without];
}

// Install writes files to <output-dir>/<skill-name>. Point it at a throwaway
// temp dir so the demo never mutates a real .claude/skills. Fresh dir per run.
function withSandboxDir(cmd, args) {
  if (!cmd.sandboxInstall) return args;
  const dir = fs.mkdtempSync(path.join(PINGCLI_HOME, 'agent-skills-'));
  return [...args, '--output-dir', dir];
}

// Lazy one-time auth bootstrap. `pingcli pingone auth login` with a
// client_credentials config is fully non-interactive (verified locally:
// "Successfully authenticated with client credentials") and persists a token
// under $HOME/.pingcli/credentials, so subsequent PingOne commands succeed.
// A shared module-level promise means concurrent requests bootstrap once; it
// is reset on failure so a later request can retry.
let authBootstrapPromise = null;
function ensureAuthBootstrap() {
  const cfgFlag = resolveConfigFlag();
  if (cfgFlag.length === 0) {
    return Promise.resolve({
      ok: false,
      error:
        'PingOne worker credentials not configured. Set PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, and PINGONE_WORKER_CLIENT_SECRET.',
    });
  }
  if (!authBootstrapPromise) {
    authBootstrapPromise = new Promise((resolve) => {
      execFile(
        PINGCLI_BIN,
        [...cfgFlag, 'pingone', 'auth', 'login'],
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

// Env-scoped resource subcommands (`pingone users list --environment-id …`) still
// fail with worker client-credentials in pingcli 1.2.0 — the PingOne SDK rejects
// a client configured with both an access token and an environment ID. Use
// `pingone api <uri>` instead: that path works after `pingone auth login` and
// returns the same management-API JSON (under data._embedded.*).
//
// auth=true → run ensureAuthBootstrap() first. Labels match what we execute
// (no --config; that is server-internal) so Copy works with worker auth too.
function apiCmd(uri) {
  return {
    label: `pingcli pingone api ${uri} -O json`,
    args: [...configFlag, 'pingone', 'api', uri, '-O', 'json'],
    runnable: true,
    auth: true,
  };
}

const envApi = (resource) => apiCmd(`environments/${ENV_ID}/${resource}`);

const COMMANDS = {
  pingone_users_list:        envApi('users'),
  pingone_apps_list:         envApi('applications'),
  pingone_groups_list:       envApi('groups'),
  pingone_populations_list:  envApi('populations'),
  pingone_idps_list:         envApi('identityProviders'),
  pingone_resources_list:    envApi('resources'),
  pingone_roles_list:        apiCmd('roles'),
  pingone_policies_list:     envApi('signOnPolicies'),
  pingone_mfa_policies_list: envApi('deviceAuthenticationPolicies'),

  pingone_envs_list:         { label: 'pingcli pingone environments list -O json',                                   args: [...configFlag, 'pingone', 'environments', 'list', '-O', 'json'],                   runnable: true, auth: true },
  config_list_keys:          { label: 'pingcli config list-keys',                                                    args: [...configFlag, 'config', 'list-keys'],                                            runnable: true },
  version:                   { label: 'pingcli --version',                                                           args: ['--version'],                                                                     runnable: true },

  agent_skills_list:    { label: 'pingcli agent-skills list -O json',
                          args: ['agent-skills', 'list', '-O', 'json'],
                          runnable: true },
  agent_skills_install: { label: 'pingcli agent-skills install pingcli-usage',
                          args: ['agent-skills', 'install', 'pingcli-usage'],
                          runnable: true, sandboxInstall: true },
};

/**
 * Ordered setup steps a local operator needs before this command can succeed.
 * Shown above the streamed response so the demo teaches init + auth.
 */
function buildPrereqs(cmd) {
  const steps = [
    {
      title: 'Install PingCLI',
      command: 'brew install pingidentity/tap/pingcli',
      note: 'Already installed on this demo host.',
    },
  ];
  if (cmd.auth || (Array.isArray(cmd.args) && cmd.args.includes('--config'))) {
    steps.push({
      title: 'Configure credentials',
      command: 'pingcli init',
      note: 'Interactive setup. This demo generates a worker client-credentials config automatically.',
    });
  }
  if (cmd.auth) {
    steps.push({
      title: 'Authenticate',
      command: 'pingcli pingone auth login',
      note: 'Obtains a worker access token (non-interactive with client credentials).',
    });
  }
  steps.push({
    title: 'Run command',
    command: cmd.label,
    note: 'Live invocation — output streams below.',
  });
  return steps;
}

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

  execFile(PINGCLI_BIN, withSandboxDir(cmd, resolveArgs(cmd.args)), { timeout: TIMEOUT_MS, env: pingcliEnv() }, (err, stdout, stderr) => {
    let exitCode = typeof err?.code === 'number' ? err.code : (err ? 1 : 0);
    const raw = stdout || stderr || '';
    let output;
    try {
      const parsed = JSON.parse(raw);
      output = JSON.stringify(parsed, null, 2);
      // pingcli often exits 0 with status:"error" in the JSON envelope.
      if (parsed && parsed.status === 'error' && exitCode === 0) exitCode = 1;
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

  send('meta', {
    command: cmd.label,
    auth: Boolean(cmd.auth),
    prereqs: buildPrereqs(cmd),
  });

  if (cmd.auth) {
    const boot = await ensureAuthBootstrap();
    if (!boot.ok) {
      send('chunk', { text: `⚠️ pingcli auth bootstrap failed:\n${boot.error}\n` });
      send('done', { exitCode: 1 });
      res.end();
      return;
    }
  }

  const child = spawn(PINGCLI_BIN, withSandboxDir(cmd, resolveArgs(cmd.args)), { timeout: TIMEOUT_MS, env: pingcliEnv() });

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
    Object.entries(COMMANDS).map(([key, cmd]) => ({
      key,
      label: cmd.label,
      runnable: cmd.runnable,
      auth: Boolean(cmd.auth),
      prereqs: buildPrereqs(cmd),
    }))
  );
});

module.exports = router;
