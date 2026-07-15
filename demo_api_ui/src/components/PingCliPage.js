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
 * under data._embedded or root _embedded (raw management API / pingone api).
 */
function extractResultRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  const candidates = [];
  if (parsed.data && typeof parsed.data === 'object' && parsed.data._embedded) {
    candidates.push(parsed.data._embedded);
  }
  if (parsed._embedded && typeof parsed._embedded === 'object') {
    candidates.push(parsed._embedded);
  }
  for (const embedded of candidates) {
    const key = Object.keys(embedded).find((k) => Array.isArray(embedded[k]));
    if (key) return embedded[key];
  }
  return null;
}

/**
 * Parse JSON, tolerating leading/trailing CLI noise around a single object/array.
 */
export function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { /* continue */ }
  const startObj = raw.indexOf('{');
  const startArr = raw.indexOf('[');
  let start = -1;
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj;
  else if (startArr >= 0) start = startArr;
  if (start < 0) return null;
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
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

/** Build table columns/rows from a list of resource objects. */
function tableFromRows(dataRows, status = '', message = '') {
  const rows = dataRows.map(flattenResultRow);
  const present = new Set();
  for (const row of rows) for (const k of Object.keys(row)) present.add(k);
  const columns = PREFERRED_COLUMNS.filter((c) => present.has(c));
  for (const k of present) {
    if (columns.length >= MAX_COLUMNS) break;
    if (!columns.includes(k)) columns.push(k);
  }
  return {
    kind: 'table',
    status,
    message,
    columns: columns.slice(0, MAX_COLUMNS),
    rows,
  };
}

// Parse a pingcli JSON envelope into { status, message, columns, rows }.
// Supports data: [...] and data._embedded.<collection>: [...]. Exported for tests.
export function parsePingcliResults(raw) {
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const dataRows = extractResultRows(parsed);
  if (!dataRows) return null;
  // Prefer envelope metadata when present; do not require schemaVersion so
  // raw management-API JSON still becomes a table.
  const { kind: _k, ...table } = tableFromRows(
    dataRows,
    parsed.status || '',
    parsed.message || ''
  );
  return table;
}

/**
 * Turn flattened object fields into ordered key/value pairs for the form view.
 */
function objectToFormFields(obj) {
  const flat = flattenResultRow(obj);
  return Object.entries(flat).map(([key, value]) => ({
    key,
    value: value === null || value === undefined ? '' : String(value),
  }));
}

/**
 * Build an easy-read model from raw command output.
 * - kind: 'table' for list payloads
 * - kind: 'form' for a single object
 * Returns null only when the output is not JSON.
 */
export function buildReadableView(raw) {
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const dataRows = extractResultRows(parsed);
  if (dataRows) {
    return tableFromRows(dataRows, parsed.status || '', parsed.message || '');
  }

  // Envelope with a single resource object as data (not a list / _embedded).
  if (
    parsed.data
    && typeof parsed.data === 'object'
    && !Array.isArray(parsed.data)
    && !parsed.data._embedded
  ) {
    const fields = objectToFormFields(parsed.data);
    if (fields.length > 0) {
      return {
        kind: 'form',
        status: parsed.status || '',
        message: parsed.message || '',
        fields,
      };
    }
  }

  const fields = objectToFormFields(parsed);
  if (fields.length > 0) {
    return {
      kind: 'form',
      status: parsed.status || '',
      message: parsed.message || '',
      fields,
    };
  }

  // Valid JSON object/array with nothing flattenable — still offer Easy read
  // as a compact summary so the toggle is never mysteriously missing.
  return {
    kind: 'form',
    status: parsed.status || '',
    message: parsed.message || 'Structured JSON',
    fields: [{ key: 'type', value: Array.isArray(parsed) ? 'array' : 'object' }],
  };
}

// Cap for per-token JSON highlighting. PingOne list payloads (users/groups/apps)
// routinely exceed this once pretty-printed with _links — coloring every token
// injects tens of thousands of React nodes and can crash the render so the
// terminal flashes then vanishes. Above the cap we still pretty-print, but as a
// single text node.
const JSON_HIGHLIGHT_MAX_CHARS = 8000;

// Syntax-highlight a JSON string into an array of React nodes (colored <span>s
// interleaved with plain text). Returns null if the text is not valid JSON
// (e.g. mid-stream or plain-text output), so the caller falls back to raw text.
// React escapes all text content, so no HTML injection is possible.
export function tokenizeJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const pretty = JSON.stringify(parsed, null, 2);
  // Large payloads: pretty-print only (no per-token spans).
  if (pretty.length > JSON_HIGHLIGHT_MAX_CHARS) return [pretty];
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

/**
 * Shared copyable dark code row used by Install / Configure / How to run.
 */
function CodeCopyRow({ text, id, copied, onCopy }) {
  return (
    <div className="pingcli-code-block">
      <code>{text}</code>
      <button type="button" className="pingcli-copy-btn" onClick={() => onCopy(text, id)}>
        {copied === id ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
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
  const initCmd = 'pingcli init';
  const authCmd = 'pingcli pingone auth login';
  const configKeysCmd = 'pingcli config list-keys';
  const envsCmd = 'pingcli pingone environments list -O json';
  const usersCmd = 'pingcli pingone api environments/<environment-id>/users -O json';

  return (
    <>
      <div className="pingcli-install">
        <h2>1. Install PingCLI</h2>
        <p>
          PingCLI is the official command-line tool for managing PingOne and related
          Ping Identity services. On a Mac demo machine, install it with Homebrew:
        </p>

        <p><strong>Trust the Ping Identity tap</strong></p>
        <CodeCopyRow text={trustCmd} id="trust" copied={copied} onCopy={copy} />

        <p><strong>Install PingCLI</strong></p>
        <CodeCopyRow text={brewCmd} id="brew" copied={copied} onCopy={copy} />

        <p><strong>Verify the install</strong></p>
        <CodeCopyRow text={verifyCmd} id="verify" copied={copied} onCopy={copy} />

        <p><strong>Already installed? Upgrade</strong></p>
        <CodeCopyRow text={upgradeCmd} id="upgrade" copied={copied} onCopy={copy} />
      </div>

      <div className="pingcli-install">
        <h2>2. Configure and authenticate</h2>
        <p>
          Before any PingOne command works locally, you must write credentials and
          obtain a worker token. This demo host does those steps for you on each
          live Run; on your machine you run them yourself.
        </p>

        <p><strong>Initialize a profile (worker client credentials + environment)</strong></p>
        <CodeCopyRow text={initCmd} id="init" copied={copied} onCopy={copy} />
        <p className="pingcli-install-hint">
          Interactive wizard. Enter your PingOne environment ID, worker client ID,
          and worker client secret. Grant type: client credentials. Storage: file
          system (works headless; no keychain required).
        </p>

        <p><strong>Authenticate (get an access token)</strong></p>
        <CodeCopyRow text={authCmd} id="auth" copied={copied} onCopy={copy} />
        <p className="pingcli-install-hint">
          Non-interactive with client credentials. Persists a token under
          {' '}<code>~/.pingcli/credentials</code>. You must auth login once per
          profile (or again after the token expires).
        </p>

        <p><strong>Optional — confirm the profile sees your keys</strong></p>
        <CodeCopyRow text={configKeysCmd} id="keys" copied={copied} onCopy={copy} />
      </div>

      <div className="pingcli-install pingcli-howto">
        <h2>3. How to run commands</h2>

        <h3>Option A — Live on this page</h3>
        <ol className="pingcli-howto-list">
          <li>Pick a command card below (for example List Users or List Groups).</li>
          <li>Click <strong>Run</strong>. The demo uses its worker credentials, runs
            {' '}<code>pingcli pingone auth login</code> if needed, then streams the result.</li>
          <li>Review the <strong>What was needed to run this</strong> panel above the
            output — that is the same install → init → auth → command chain.</li>
          <li>Use <strong>Easy read</strong> for a table/form, or <strong>JSON</strong> for the raw payload.</li>
          <li>Use <strong>Copy</strong> on a card (or on a prereq step) to paste the same command into your own terminal.</li>
        </ol>

        <h3>Option B — In your own terminal</h3>
        <p>After install, init, and auth (sections 1–2), run catalog commands like:</p>
        <CodeCopyRow text={envsCmd} id="envs" copied={copied} onCopy={copy} />
        <p className="pingcli-install-hint">
          Environment-wide lists use the normal verb form.
        </p>
        <CodeCopyRow text={usersCmd} id="users" copied={copied} onCopy={copy} />
        <p className="pingcli-install-hint">
          Environment-scoped resources (users, groups, apps, …) use
          {' '}<code>pingcli pingone api …</code> with your environment ID. Replace
          {' '}<code>&lt;environment-id&gt;</code> with the ID from
          {' '}<code>environments list</code> (or from <code>pingcli init</code>).
          Always pass <code>-O json</code> for machine-readable output.
        </p>
        <p>
          Tip: every card below already shows the complete command with this
          demo&apos;s environment ID filled in — click Copy, then paste into your terminal
          after you have authenticated locally.
        </p>
      </div>
    </>
  );
}

export default function PingCliPage() {
  const [running, setRunning]     = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [cmdLabel, setCmdLabel]   = useState('');
  const [output, setOutput]       = useState('');
  const [exitCode, setExitCode]   = useState(null);
  const [prereqs, setPrereqs]     = useState([]);
  const [cmdMeta, setCmdMeta]     = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [copiedPrereq, setCopiedPrereq] = useState(null);
  // 'json' (raw) or 'easy' (table / form). Auto-switches to easy when a run
  // finishes with structured JSON the reader can present.
  const [viewMode, setViewMode]   = useState('json');
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

  /** Copy a prerequisite command string; flash "Copied!" on that step. */
  const copyPrereq = (index, text) => {
    copyToClipboard(text);
    setCopiedPrereq(index);
    setTimeout(() => setCopiedPrereq(null), 1500);
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
    setViewMode('json');
    // Seed prereqs from catalog immediately so the panel appears above the
    // response while the stream connects; SSE meta may refine the list.
    setPrereqs(Array.isArray(cmdMeta[commandKey]?.prereqs) ? cmdMeta[commandKey].prereqs : []);
    setCopiedPrereq(null);

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

        let payload;
        try {
          payload = JSON.parse(dataMatch[1]);
        } catch {
          // Skip a corrupt frame — do not wipe streamed output.
          return;
        }

        const type = eventMatch[1];
        if (type === 'meta') {
          setCmdLabel(payload.command);
          if (Array.isArray(payload.prereqs)) setPrereqs(payload.prereqs);
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
  const readable = (!running && output) ? buildReadableView(output) : null;
  // Show Easy read whenever finished output is JSON (readable is always non-null
  // for objects/arrays after buildReadableView's fallback).
  const canEasyRead = readable !== null;

  // When a run finishes with structured JSON, open Easy read so the table/form
  // is the default; user can flip back to JSON with the toolbar button.
  useEffect(() => {
    if (running !== null || exitCode === null || !output) return;
    if (buildReadableView(output)) setViewMode('easy');
  }, [running, exitCode, output]);

  /** Render the Easy read / JSON toggle (used above the output pane). */
  const viewToggle = canEasyRead ? (
    <div className="pingcli-view-bar" role="group" aria-label="Output view">
      <span className="pingcli-view-bar-label">View</span>
      <button
        type="button"
        className={`pingcli-view-btn${viewMode === 'easy' ? ' active' : ''}`}
        onClick={() => setViewMode('easy')}
      >
        Easy read
      </button>
      <button
        type="button"
        className={`pingcli-view-btn${viewMode === 'json' ? ' active' : ''}`}
        onClick={() => setViewMode('json')}
      >
        JSON
      </button>
    </div>
  ) : null;

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
        Setup is above (install → init → auth → run). Cards below execute live on
        this demo&apos;s worker credentials, or Copy the command into your own terminal
        after you authenticate locally.
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

      {showTerminal && prereqs.length > 0 && (
        <div className="pingcli-prereqs" aria-label="Steps required to run this command">
          <div className="pingcli-prereqs-header">
            <span className="pingcli-prereqs-title">What was needed to run this</span>
            <span className="pingcli-prereqs-meta">
              Install → configure → auth → command (as on your own machine)
            </span>
          </div>
          <ol className="pingcli-prereqs-list">
            {prereqs.map((step, i) => (
              <li key={`${step.title}-${i}`} className="pingcli-prereqs-step">
                <div className="pingcli-prereqs-step-top">
                  <span className="pingcli-prereqs-step-title">
                    <span className="pingcli-prereqs-num">{i + 1}</span>
                    {step.title}
                  </span>
                  {step.command && (
                    <button
                      type="button"
                      className="pingcli-cmd-copy"
                      title="Copy command"
                      onClick={() => copyPrereq(i, step.command)}
                    >
                      {copiedPrereq === i ? 'Copied!' : 'Copy'}
                    </button>
                  )}
                </div>
                {step.command && (
                  <code className="pingcli-prereqs-cmd">{step.command}</code>
                )}
                {step.note && <p className="pingcli-prereqs-note">{step.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {showTerminal && viewToggle}

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
          {viewMode === 'easy' && readable?.kind === 'table' && (
            <div className="pingcli-results pingcli-results-in-terminal">
              <div className="pingcli-results-header">
                <span className="pingcli-results-title">Table</span>
                <span className="pingcli-results-meta">
                  {readable.rows.length} item{readable.rows.length === 1 ? '' : 's'}
                  {readable.message ? ` · ${readable.message}` : ''}
                </span>
              </div>
              {readable.rows.length === 0 ? (
                <p className="pingcli-results-empty">No rows returned.</p>
              ) : (
                <div className="pingcli-results-scroll">
                  <table className="pingcli-results-table">
                    <thead>
                      <tr>
                        {readable.columns.map((c) => <th key={c}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {readable.rows.map((row, i) => (
                        <tr key={row.id ?? i}>
                          {readable.columns.map((c) => (
                            <td key={c}>
                              {row[c] === undefined || row[c] === null ? '—' : String(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {viewMode === 'easy' && readable?.kind === 'form' && (
            <div className="pingcli-form-view">
              <div className="pingcli-results-header">
                <span className="pingcli-results-title">Details</span>
                <span className="pingcli-results-meta">
                  {readable.message || (readable.status ? String(readable.status) : 'Key / value')}
                </span>
              </div>
              <dl className="pingcli-form-list">
                {readable.fields.map((f) => (
                  <div key={f.key} className="pingcli-form-row">
                    <dt>{f.key}</dt>
                    <dd>{f.value === '' ? '—' : f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {(viewMode === 'json' || !canEasyRead) && (() => {
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
