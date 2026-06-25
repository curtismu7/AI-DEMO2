const { execFile } = require('child_process');
const { Router } = require('express');

const PINGCLI_BIN = '/opt/homebrew/bin/pingcli';
const TIMEOUT_MS = 15000;

// Allow-list of safe read-only commands.
const COMMANDS = {
  pingone_users_list:         { label: 'pingcli pingone users list -O json',            args: ['pingone', 'users', 'list', '-O', 'json'] },
  pingone_apps_list:          { label: 'pingcli pingone applications list -O json',     args: ['pingone', 'applications', 'list', '-O', 'json'] },
  pingone_envs_list:          { label: 'pingcli pingone environments list -O json',     args: ['pingone', 'environments', 'list', '-O', 'json'] },
  pingone_groups_list:        { label: 'pingcli pingone groups list -O json',           args: ['pingone', 'groups', 'list', '-O', 'json'] },
  pingone_populations_list:   { label: 'pingcli pingone populations list -O json',      args: ['pingone', 'populations', 'list', '-O', 'json'] },
  pingone_idps_list:          { label: 'pingcli pingone identity-providers list -O json', args: ['pingone', 'identity-providers', 'list', '-O', 'json'] },
  pingone_resources_list:     { label: 'pingcli pingone resources list -O json',        args: ['pingone', 'resources', 'list', '-O', 'json'] },
  pingone_roles_list:         { label: 'pingcli pingone roles -O json',                args: ['pingone', 'roles', '-O', 'json'] },
  pingone_policies_list:      { label: 'pingcli pingone sign-on-policies list -O json', args: ['pingone', 'sign-on-policies', 'list', '-O', 'json'] },
  pingone_mfa_policies_list:  { label: 'pingcli mfa device-authentication-policies list -O json', args: ['mfa', 'device-authentication-policies', 'list', '-O', 'json'] },
  config_list_keys:           { label: 'pingcli config list-keys',                     args: ['config', 'list-keys'] },
  version:                    { label: 'pingcli --version',                             args: ['--version'] },
};

const router = Router();

router.post('/run', (req, res) => {
  const { commandKey } = req.body;
  if (!commandKey) {
    return res.status(400).json({ error: 'missing_command_key' });
  }
  const cmd = COMMANDS[commandKey];
  if (!cmd) {
    return res.status(400).json({ error: 'unknown_command', commandKey });
  }

  execFile(PINGCLI_BIN, cmd.args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
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

router.get('/commands', (_req, res) => {
  res.json(
    Object.entries(COMMANDS).map(([key, { label }]) => ({ key, label }))
  );
});

module.exports = router;
