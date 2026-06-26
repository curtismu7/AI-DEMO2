import { useState } from 'react';
import './PingCliPage.css';

const CATEGORIES = [
  {
    title: 'Identity & Directory',
    commands: [
      { key: 'pingone_users_list',       label: 'List Users',              desc: 'pingcli pingone users list -O json' },
      { key: 'pingone_groups_list',      label: 'List Groups',             desc: 'pingcli pingone groups list -O json' },
      { key: 'pingone_populations_list', label: 'List Populations',        desc: 'pingcli pingone populations list -O json' },
    ],
  },
  {
    title: 'Applications & Resources',
    commands: [
      { key: 'pingone_apps_list',        label: 'List Applications',       desc: 'pingcli pingone applications list -O json' },
      { key: 'pingone_resources_list',   label: 'List Resources',          desc: 'pingcli pingone resources list -O json' },
      { key: 'pingone_roles_list',       label: 'List Built-in Roles',     desc: 'pingcli pingone roles -O json' },
    ],
  },
  {
    title: 'Authentication & MFA',
    commands: [
      { key: 'pingone_idps_list',        label: 'List Identity Providers', desc: 'pingcli pingone identity-providers list -O json' },
      { key: 'pingone_policies_list',    label: 'List Sign-On Policies',   desc: 'pingcli pingone sign-on-policies list -O json' },
      { key: 'pingone_mfa_policies_list',label: 'List MFA Policies',       desc: 'pingcli mfa device-authentication-policies list -O json' },
    ],
  },
  {
    title: 'Platform & Config',
    commands: [
      { key: 'pingone_envs_list',        label: 'List Environments',       desc: 'pingcli pingone environments list -O json' },
      { key: 'config_list_keys',         label: 'Config Keys',             desc: 'pingcli config list-keys' },
      { key: 'version',                  label: 'Version',                 desc: 'pingcli --version' },
    ],
  },
];

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function InstallSection() {
  const [copied, setCopied] = useState(null);

  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const trustCmd = 'brew trust pingidentity/tap';
  const brewCmd = 'brew install pingidentity/tap/pingcli';
  const verifyCmd = 'pingcli --version';

  return (
    <div className="pingcli-install">
      <h2>Installing PingCLI on a Ping Demo Machine</h2>
      <p>
        PingCLI is the official command-line tool for managing PingOne and related
        Ping Identity services. Install it via Homebrew in two steps:
      </p>

      <p><strong>1. Trust the Ping Identity tap</strong></p>
      <div className="pingcli-code-block">
        <code>{trustCmd}</code>
        <button className="pingcli-copy-btn" onClick={() => copy(trustCmd, 'trust')}>
          {copied === 'trust' ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p><strong>2. Install PingCLI</strong></p>
      <div className="pingcli-code-block">
        <code>{brewCmd}</code>
        <button className="pingcli-copy-btn" onClick={() => copy(brewCmd, 'brew')}>
          {copied === 'brew' ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p><strong>3. Verify the install</strong></p>
      <div className="pingcli-code-block">
        <code>{verifyCmd}</code>
        <button className="pingcli-copy-btn" onClick={() => copy(verifyCmd, 'verify')}>
          {copied === 'verify' ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p style={{ marginTop: 12 }}>
        After installing, run{' '}
        <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: 3 }}>
          pingcli init
        </code>{' '}
        to configure your PingOne environment credentials, then use the commands below to
        explore your tenant directly from the terminal.
      </p>
    </div>
  );
}

export default function PingCliPage() {
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);

  const run = async (commandKey) => {
    if (running) return;
    setRunning(commandKey);
    setResult(null);
    try {
      const res = await fetch('/api/admin/pingcli/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ commandKey }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ command: commandKey, output: err.message, exitCode: 1, error: err.message });
    } finally {
      setRunning(null);
    }
  };

  const statusClass = result
    ? result.exitCode === 0 ? 'ok' : 'err'
    : '';

  return (
    <div className="pingcli-page">
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
        PingCLI
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px' }}>
        The official CLI for PingOne administration. Click any command to run it live against
        your configured environment.
      </p>

      <InstallSection />

      {CATEGORIES.map(({ title, commands }) => (
        <div key={title}>
          <p className="pingcli-section-title">{title}</p>
          <div className="pingcli-command-grid">
            {commands.map(({ key, label, desc }) => (
              <button
                key={key}
                className={`pingcli-cmd-btn${result && running === null && result.command === desc ? ' active' : ''}`}
                disabled={running !== null}
                onClick={() => run(key)}
              >
                <div className="pingcli-cmd-label">{label}</div>
                <div className="pingcli-cmd-command">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {(running || result) && (
        <div className="pingcli-terminal">
          <div className="pingcli-terminal-header">
            <span className="pingcli-terminal-prompt">
              $ <span className="cmd-text">{running ? '...' : result?.command}</span>
            </span>
            {result && !running && (
              <span className={`pingcli-terminal-status ${statusClass}`}>
                {result.exitCode === 0 ? '✓ exit 0' : `✗ exit ${result.exitCode}`}
              </span>
            )}
          </div>
          <div className={`pingcli-terminal-body${running ? ' loading' : ''}`}>
            {running
              ? 'Running command…'
              : (result?.output || result?.error || '(no output)')}
          </div>
        </div>
      )}
    </div>
  );
}
