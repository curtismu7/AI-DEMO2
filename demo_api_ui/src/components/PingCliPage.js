import { useState, useRef, useEffect } from 'react';
import './PingCliPage.css';

// Commands that execute live server-side. Everything else is env-scoped and is
// copy-to-run only (pingcli 1.x cannot run those with worker credentials). This
// is a fallback for when GET /commands hasn't loaded yet; the server response is
// the source of truth.
const RUNNABLE = new Set(['pingone_envs_list', 'config_list_keys', 'version']);

// Client-side cap on how long a streamed run may take before it is aborted.
const RUN_TIMEOUT_MS = 30000;

// Syntax-highlight a JSON string into an array of React nodes (colored <span>s
// interleaved with plain text). Returns null if the text is not valid JSON
// (e.g. mid-stream or plain-text output), so the caller falls back to raw text.
// React escapes all text content, so no HTML injection is possible.
function tokenizeJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const pretty = JSON.stringify(parsed, null, 2);
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes = [];
  let last = 0;
  let i = 0;
  for (let match = re.exec(pretty); match !== null; match = re.exec(pretty)) {
    if (match.index > last) nodes.push(pretty.slice(last, match.index));
    const tok = match[0];
    let cls = 'j-num';
    if (tok[0] === '"') cls = /:$/.test(tok) ? 'j-key' : 'j-str';
    else if (tok === 'true' || tok === 'false') cls = 'j-bool';
    else if (tok === 'null') cls = 'j-null';
    nodes.push(<span key={i++} className={cls}>{tok}</span>);
    last = match.index + tok.length;
  }
  if (last < pretty.length) nodes.push(pretty.slice(last));
  return nodes;
}

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
      { key: 'pingone_apps_list',      label: 'List Applications',       desc: 'pingcli pingone applications list -O json' },
      { key: 'pingone_resources_list', label: 'List Resources',          desc: 'pingcli pingone resources list -O json' },
      { key: 'pingone_roles_list',     label: 'List Built-in Roles',     desc: 'pingcli pingone roles -O json' },
    ],
  },
  {
    title: 'Authentication & MFA',
    commands: [
      { key: 'pingone_idps_list',         label: 'List Identity Providers', desc: 'pingcli pingone identity-providers list -O json' },
      { key: 'pingone_policies_list',     label: 'List Sign-On Policies',   desc: 'pingcli pingone sign-on-policies list -O json' },
      { key: 'pingone_mfa_policies_list', label: 'List MFA Policies',       desc: 'pingcli mfa device-authentication-policies list -O json' },
    ],
  },
  {
    title: 'Platform & Config',
    commands: [
      { key: 'pingone_envs_list', label: 'List Environments', desc: 'pingcli pingone environments list -O json' },
      { key: 'config_list_keys',  label: 'Config Keys',       desc: 'pingcli config list-keys' },
      { key: 'version',           label: 'Version',           desc: 'pingcli --version' },
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
  const upgradeCmd = 'brew upgrade pingidentity/tap/pingcli';

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

      <p><strong>Already installed? Upgrade to the latest version</strong></p>
      <div className="pingcli-code-block">
        <code>{upgradeCmd}</code>
        <button className="pingcli-copy-btn" onClick={() => copy(upgradeCmd, 'upgrade')}>
          {copied === 'upgrade' ? 'Copied!' : 'Copy'}
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
  const [running, setRunning]     = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [cmdLabel, setCmdLabel]   = useState('');
  const [output, setOutput]       = useState('');
  const [exitCode, setExitCode]   = useState(null);
  const [cmdMeta, setCmdMeta]     = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [installedVersion, setInstalledVersion] = useState(null);
  const abortRef = useRef(null);

  // Show the installed pingcli version in the page header.
  useEffect(() => {
    fetch('/api/admin/pingcli/version', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.version) setInstalledVersion(data.version);
      })
      .catch(() => {});
  }, []);

  // Load the server's command catalog (full copyable command strings + which
  // commands run live). Falls back to the hardcoded cards if this fails.
  useEffect(() => {
    fetch('/api/admin/pingcli/commands', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const map = {};
        for (const c of list) map[c.key] = c;
        setCmdMeta(map);
      })
      .catch(() => {});
  }, []);

  const copyCmd = (key, text) => {
    copyToClipboard(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const run = async (commandKey) => {
    if (running) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(commandKey);
    setActiveKey(commandKey);
    setCmdLabel('');
    setOutput('');
    setExitCode(null);

    // Overall client-side timeout: abort a hung/buffered stream so the Run
    // buttons are never left permanently disabled.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RUN_TIMEOUT_MS);

    try {
      const res = await fetch(
        `/api/admin/pingcli/stream?commandKey=${encodeURIComponent(commandKey)}`,
        { credentials: 'include', signal: controller.signal }
      );

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop();

        for (const block of events) {
          const eventMatch = block.match(/^event: (\w+)/m);
          const dataMatch  = block.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;

          const type = eventMatch[1];
          const payload = JSON.parse(dataMatch[1]);

          if (type === 'meta') {
            setCmdLabel(payload.command);
          } else if (type === 'chunk') {
            setOutput((prev) => prev + payload.text);
          } else if (type === 'done') {
            if (payload.error) setOutput((prev) => prev || payload.error);
            setExitCode(payload.exitCode);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (timedOut) {
          setOutput((prev) => `${prev}${prev ? '\n' : ''}⚠️ Command timed out after ${RUN_TIMEOUT_MS / 1000} seconds.`);
          setExitCode(1);
        }
      } else {
        setOutput(err.message);
        setExitCode(1);
      }
    } finally {
      clearTimeout(timer);
      setRunning((r) => (r === commandKey ? null : r));
    }
  };

  const showTerminal = running !== null || exitCode !== null;
  const statusClass  = exitCode === 0 ? 'ok' : exitCode !== null ? 'err' : '';

  return (
    <div className="pingcli-page">
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
        PingCLI
      </h1>
      {installedVersion && (
        <p style={{ fontSize: 13, fontWeight: 600, color: '#475569', margin: '0 0 6px' }}>
          Installed: v{installedVersion}
        </p>
      )}
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px' }}>
        The official CLI for PingOne administration. Click any command to run it live against
        your configured environment.
      </p>

      <InstallSection />

      <p className="pingcli-run-note">
        Environment-wide commands run live below. Environment-scoped commands (a
        specific environment&apos;s users, apps, groups&hellip;) show a ready-to-run
        command you can copy into your own terminal.
      </p>

      {CATEGORIES.map(({ title, commands }) => (
        <div key={title}>
          <p className="pingcli-section-title">{title}</p>
          <div className="pingcli-command-grid">
            {commands.map(({ key, label, desc }) => {
              const meta = cmdMeta[key] || {};
              const runnable = meta.runnable ?? RUNNABLE.has(key);
              const copyText = meta.label || desc;
              return (
                <div
                  key={key}
                  className={`pingcli-cmd-btn${activeKey === key ? ' active' : ''}${running === key ? ' running' : ''}${runnable ? '' : ' copy-only'}`}
                >
                  <div className="pingcli-cmd-top">
                    <span className="pingcli-cmd-label">
                      {running === key && <span className="pingcli-spinner" />}
                      {label}
                    </span>
                    <button
                      type="button"
                      className="pingcli-cmd-copy"
                      title="Copy command"
                      onClick={() => copyCmd(key, copyText)}
                    >
                      {copiedKey === key ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="pingcli-cmd-command" title={copyText}>{copyText}</div>
                  {runnable ? (
                    <button
                      type="button"
                      className="pingcli-cmd-run"
                      disabled={running !== null}
                      onClick={() => run(key)}
                    >
                      {running === key ? 'Running…' : 'Run ▸'}
                    </button>
                  ) : (
                    <span className="pingcli-cmd-hint">Copy &amp; run in your terminal</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {showTerminal && (
        <div className="pingcli-terminal">
          <div className="pingcli-terminal-header">
            <span className="pingcli-terminal-prompt">
              $ <span className="cmd-text">{cmdLabel || '…'}</span>
            </span>
            {exitCode !== null && (
              <span className={`pingcli-terminal-status ${statusClass}`}>
                {exitCode === 0 ? '✓ exit 0' : `✗ exit ${exitCode}`}
              </span>
            )}
          </div>
          {(() => {
            const tokens = output ? tokenizeJson(output) : null;
            if (tokens) {
              return <div className="pingcli-terminal-body">{tokens}</div>;
            }
            return (
              <div className={`pingcli-terminal-body${running ? ' loading' : ''}`}>
                {output || (running ? 'Running…' : '(no output)')}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
