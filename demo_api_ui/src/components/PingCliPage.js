import { useState, useRef, useEffect } from 'react';
import './PingCliPage.css';

// Fallback runnable set when GET /commands hasn't loaded yet. Server catalog is
// the source of truth; since pingcli >= 1.2.0 every allow-listed command runs
// live, treat unknown catalog keys as runnable too.
const RUNNABLE = new Set([
  'pingone_users_list',
  'pingone_apps_list',
  'pingone_groups_list',
  'pingone_populations_list',
  'pingone_idps_list',
  'pingone_resources_list',
  'pingone_roles_list',
  'pingone_policies_list',
  'pingone_mfa_policies_list',
  'pingone_envs_list',
  'config_list_keys',
  'version',
]);

// Client-side cap on how long a streamed run may take before it is aborted.
const RUN_TIMEOUT_MS = 30000;

// Preferred column order for the friendly results table. Only columns present
// in the data are used; remaining slots fill with the first other primitive
// fields found (up to MAX_COLUMNS).
const PREFERRED_COLUMNS = ['name', 'username', 'email', 'id', 'type', 'region', 'enabled', 'description'];
const MAX_COLUMNS = 6;

/**
 * Unwrap pingcli / management-API list payloads into a plain array.
 * Prefer a top-level data array (environments list); else take the first array
 * under data._embedded (pingone api responses).
 */
function extractResultRows(parsed) {
  if (Array.isArray(parsed.data)) return parsed.data;
  const embedded = parsed.data && typeof parsed.data === 'object' ? parsed.data._embedded : null;
  if (!embedded || typeof embedded !== 'object') return null;
  const key = Object.keys(embedded).find((k) => Array.isArray(embedded[k]));
  return key ? embedded[key] : null;
}

/**
 * Flatten one list item for the results table (drop _links / nested objects;
 * promote name.formatted when present).
 */
function flattenResultRow(item) {
  const flat = {};
  if (!item || typeof item !== 'object') return flat;
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith('_')) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      flat[k] = v;
      continue;
    }
    if (k === 'name' && typeof v === 'object' && typeof v.formatted === 'string') {
      flat.name = v.formatted;
    }
  }
  return flat;
}

// Parse a pingcli JSON envelope into { status, message, columns, rows }.
// Supports data: [...] and data._embedded.<collection>: [...]. Exported for tests.
export function parsePingcliResults(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !parsed.schemaVersion) {
    return null;
  }
  const dataRows = extractResultRows(parsed);
  if (!dataRows) return null;
  const rows = dataRows.map(flattenResultRow);
  const present = new Set();
  for (const row of rows) for (const k of Object.keys(row)) present.add(k);
  const columns = PREFERRED_COLUMNS.filter((c) => present.has(c));
  for (const k of present) {
    if (columns.length >= MAX_COLUMNS) break;
    if (!columns.includes(k)) columns.push(k);
  }
  return {
    status: parsed.status || '',
    message: parsed.message || '',
    columns: columns.slice(0, MAX_COLUMNS),
    rows,
  };
}

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
      { key: 'pingone_users_list',       label: 'List Users',              desc: 'pingcli pingone api environments/<env>/users -O json' },
      { key: 'pingone_groups_list',      label: 'List Groups',             desc: 'pingcli pingone api environments/<env>/groups -O json' },
      { key: 'pingone_populations_list', label: 'List Populations',        desc: 'pingcli pingone api environments/<env>/populations -O json' },
    ],
  },
  {
    title: 'Applications & Resources',
    commands: [
      { key: 'pingone_apps_list',      label: 'List Applications',       desc: 'pingcli pingone api environments/<env>/applications -O json' },
      { key: 'pingone_resources_list', label: 'List Resources',          desc: 'pingcli pingone api environments/<env>/resources -O json' },
      { key: 'pingone_roles_list',     label: 'List Built-in Roles',     desc: 'pingcli pingone api roles -O json' },
    ],
  },
  {
    title: 'Authentication & MFA',
    commands: [
      { key: 'pingone_idps_list',         label: 'List Identity Providers', desc: 'pingcli pingone api environments/<env>/identityProviders -O json' },
      { key: 'pingone_policies_list',     label: 'List Sign-On Policies',   desc: 'pingcli pingone api environments/<env>/signOnPolicies -O json' },
      { key: 'pingone_mfa_policies_list', label: 'List MFA Policies',       desc: 'pingcli pingone api environments/<env>/deviceAuthenticationPolicies -O json' },
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

    // Tracks whether we applied an SSE `done` event. If the stream ends without
    // one (common when the final frame sits in the SSE buffer and is never
    // flushed), exitCode stays null and the terminal unmounts the moment
    // `running` clears — JSON flashes then disappears.
    let sawDone = false;

    try {
      const res = await fetch(
        `/api/admin/pingcli/stream?commandKey=${encodeURIComponent(commandKey)}`,
        { credentials: 'include', signal: controller.signal }
      );

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        setOutput(text || `HTTP ${res.status}`);
        setExitCode(1);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      /** Apply one SSE event block (event: / data: pair). */
      const applySseBlock = (block) => {
        const eventMatch = block.match(/^event: (\w+)/m);
        const dataMatch  = block.match(/^data: (.+)/m);
        if (!eventMatch || !dataMatch) return;

        const type = eventMatch[1];
        const payload = JSON.parse(dataMatch[1]);

        if (type === 'meta') {
          setCmdLabel(payload.command);
        } else if (type === 'chunk') {
          setOutput((prev) => prev + payload.text);
        } else if (type === 'done') {
          sawDone = true;
          if (payload.error) setOutput((prev) => prev || payload.error);
          setExitCode(payload.exitCode ?? 0);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop();
        for (const block of events) applySseBlock(block);
      }

      // Flush TextDecoder + any trailing SSE frame that lacked a final \n\n
      // in an intermediate chunk (the `done` event is often exactly this).
      buf += decoder.decode();
      if (buf.trim()) {
        for (const block of buf.split('\n\n')) applySseBlock(block);
      }
      if (!sawDone) setExitCode(0);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (timedOut) {
          setOutput((prev) => `${prev}${prev ? '\n' : ''}⚠️ Command timed out after ${RUN_TIMEOUT_MS / 1000} seconds.`);
          setExitCode(1);
        } else if (!sawDone) {
          // Aborted for another reason mid-stream — keep any streamed output.
          setExitCode((code) => (code === null ? 1 : code));
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

  // Keep the pane up while streaming, after a finished run, or whenever we
  // already have output (belt-and-suspenders if exitCode never lands).
  const showTerminal = running !== null || exitCode !== null || output !== '';
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
        Click Run to execute live against this demo&apos;s PingOne worker
        credentials, or Copy to paste the same command into your own terminal.
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
                  className={`pingcli-cmd-btn${activeKey === key ? ' active' : ''}${running === key ? ' running' : ''}`}
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
                  <button
                    type="button"
                    className="pingcli-cmd-run"
                    disabled={!runnable || running !== null}
                    onClick={() => run(key)}
                  >
                    {running === key ? 'Running…' : 'Run ▸'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {showTerminal && !running && exitCode === 0 && (() => {
        const results = output ? parsePingcliResults(output) : null;
        if (!results || results.status !== 'success' || results.rows.length === 0) return null;
        return (
          <div className="pingcli-results">
            <div className="pingcli-results-header">
              <span className="pingcli-results-title">Results</span>
              <span className="pingcli-results-meta">
                {results.rows.length} item{results.rows.length === 1 ? '' : 's'}
                {results.message ? ` · ${results.message}` : ''}
              </span>
            </div>
            <div className="pingcli-results-scroll">
              <table className="pingcli-results-table">
                <thead>
                  <tr>
                    {results.columns.map((c) => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((row, i) => (
                    <tr key={row.id ?? i}>
                      {results.columns.map((c) => (
                        <td key={c}>{row[c] === undefined || row[c] === null ? '—' : String(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

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
