# PingCLI Demo UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished demo page at `/pingcli` that showcases PingCLI with curated runnable commands, displays each command string, streams/shows the output, and includes an installation section for the PingCLI.

**Architecture:** A new React page (`PingCliPage`) rendered at `/pingcli` within the existing admin-authenticated routing shell. A new Express route (`/api/admin/pingcli/run`) shells out `pingcli` with a fixed allow-list of safe read-only commands and streams stdout/stderr back as newline-delimited JSON. The UI groups commands by category, lets the user click to run, and renders output in a terminal-style pane.

**Tech Stack:** React 19 (JSX in .js files), Express.js, `child_process.spawn`, react-router-dom, CSS modules (inline style objects matching existing page pattern)

## Global Constraints

- `pingcli` binary is at `/opt/homebrew/bin/pingcli` on macOS; route must use full path for safety
- All commands in the allow-list must be read-only (no `create`, `delete`, `apply`, `replace`)
- The API route lives at `/api/admin/pingcli/run` and is gated by the existing `authenticateToken` middleware
- Frontend file in `demo_api_ui/src/components/` as `PingCliPage.js` (`.js` not `.jsx` — existing project convention)
- CSS as `demo_api_ui/src/components/PingCliPage.css`
- Route registered in `demo_api_ui/src/App.js` alongside `SnapshotImport` (same auth pattern)
- Nav item added to `demo_api_ui/src/components/AdminSideNav.jsx` under the "Platform Tools" group
- Backend route file at `demo_api_server/routes/pingcli.js`
- Mounted in `demo_api_server/server.js` alongside `adminRoutes`
- Output format flag: always pass `-O json` so output is machine-readable JSON, parsed and pretty-printed in UI
- No streaming — use `execFile` with a 15-second timeout; full output returned as one JSON response

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `demo_api_server/routes/pingcli.js` | **Create** | Express router — allow-listed command runner |
| `demo_api_server/server.js` | **Modify** | Mount `/api/admin/pingcli` route |
| `demo_api_ui/src/components/PingCliPage.js` | **Create** | React page — install instructions + command runner UI |
| `demo_api_ui/src/components/PingCliPage.css` | **Create** | Terminal-style CSS for the page |
| `demo_api_ui/src/App.js` | **Modify** | Add import + `/pingcli` route (same pattern as `/snapshot-import`) |
| `demo_api_ui/src/components/AdminSideNav.jsx` | **Modify** | Add "PingCLI Demo" nav item |

---

### Task 1: Backend — pingcli route

**Files:**
- Create: `demo_api_server/routes/pingcli.js`

**Interfaces:**
- Consumes: `authenticateToken` middleware (applied at mount point in `server.js`, not in this file)
- Produces: `POST /api/admin/pingcli/run` → `{ command: string, output: string, exitCode: number, error?: string }`

- [ ] **Step 1: Write the test**

Create `demo_api_server/__tests__/pingcli.route.test.js`:

```js
const request = require('supertest');
const express = require('express');
const pingcliRoutes = require('../routes/pingcli');

// Stub child_process so we don't shell out in tests
jest.mock('child_process', () => ({
  execFile: jest.fn((_bin, _args, _opts, cb) => {
    cb(null, '{"data":[]}', '');
  }),
}));

const app = express();
app.use(express.json());
app.use('/api/admin/pingcli', pingcliRoutes);

describe('POST /api/admin/pingcli/run', () => {
  it('returns 400 for disallowed command', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'not-a-real-key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_command');
  });

  it('runs an allowed command and returns output', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'pingone_users_list' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: expect.any(String), output: expect.any(String) });
  });

  it('returns 400 if commandKey is missing', async () => {
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npx jest __tests__/pingcli.route.test.js --no-coverage 2>&1 | tail -20
```
Expected: `FAIL` — `Cannot find module '../routes/pingcli'`

- [ ] **Step 3: Create the route**

Create `demo_api_server/routes/pingcli.js`:

```js
const { execFile } = require('child_process');
const { Router } = require('express');

const PINGCLI_BIN = '/opt/homebrew/bin/pingcli';
const TIMEOUT_MS = 15000;

// Allow-list of safe read-only commands.
// Key → argv array (excluding the binary itself).
// All commands use -O json for structured output.
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
    // Try to pretty-print JSON output; fall back to raw string
    let output;
    try {
      output = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      output = raw;
    }
    res.json({ command: cmd.label, output, exitCode, error: err?.message });
  });
});

// Expose the command catalog so the UI can render buttons without hardcoding
router.get('/commands', (_req, res) => {
  res.json(
    Object.entries(COMMANDS).map(([key, { label }]) => ({ key, label }))
  );
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npx jest __tests__/pingcli.route.test.js --no-coverage 2>&1 | tail -20
```
Expected: `PASS` — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/pingcli.js demo_api_server/__tests__/pingcli.route.test.js
git commit -m "feat: add pingcli command proxy route with allow-list"
```

---

### Task 2: Mount route in server.js

**Files:**
- Modify: `demo_api_server/server.js:107-135` (import block) and the route mounting section ~line 915

**Interfaces:**
- Consumes: `authenticateToken` from `demo_api_server/middleware/auth.js`
- Produces: `/api/admin/pingcli/*` endpoints gated by admin auth

- [ ] **Step 1: Add import**

In `demo_api_server/server.js`, find the line:
```js
const adminRoutes = require('./routes/admin');
```
Add immediately after it:
```js
const pingcliRoutes = require('./routes/pingcli');
```

- [ ] **Step 2: Mount the route**

Find in `server.js`:
```js
app.use('/api/admin/config', adminConfigRoutes);
```
Add immediately before it:
```js
app.use('/api/admin/pingcli', authenticateToken, pingcliRoutes);
```

- [ ] **Step 3: Verify server starts**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && node -e "require('./server')" 2>&1 | head -5
```
Expected: No syntax errors (process will attempt to start; ctrl-C or timeout is fine)

- [ ] **Step 4: Smoke test the commands endpoint (server running)**

```bash
curl -s http://localhost:3001/api/admin/pingcli/commands | python3 -m json.tool | head -20
```
Expected: JSON array of `{ key, label }` objects (auth is bypassed in dev or use a valid session cookie)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/server.js
git commit -m "feat: mount /api/admin/pingcli route with authenticateToken guard"
```

---

### Task 3: PingCliPage CSS

**Files:**
- Create: `demo_api_ui/src/components/PingCliPage.css`

**Interfaces:**
- Produces: CSS classes consumed by `PingCliPage.js`

- [ ] **Step 1: Write the CSS**

Create `demo_api_ui/src/components/PingCliPage.css`:

```css
.pingcli-page {
  max-width: 900px;
  margin: 24px auto;
  padding: 0 24px 40px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── Install section ─────────────────────────────────── */
.pingcli-install {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 32px;
}

.pingcli-install h2 {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 12px;
}

.pingcli-install p {
  font-size: 13px;
  color: #475569;
  margin: 0 0 10px;
  line-height: 1.6;
}

.pingcli-code-block {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 12px 16px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  margin: 8px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pingcli-code-block code {
  flex: 1;
}

.pingcli-copy-btn {
  background: #334155;
  color: #cbd5e1;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.pingcli-copy-btn:hover {
  background: #475569;
  color: #f1f5f9;
}

/* ── Command categories ──────────────────────────────── */
.pingcli-section-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin: 28px 0 12px;
}

.pingcli-command-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}

.pingcli-cmd-btn {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.pingcli-cmd-btn:hover:not(:disabled) {
  border-color: #c026d3;
  box-shadow: 0 0 0 3px rgba(192, 38, 211, 0.08);
}

.pingcli-cmd-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.pingcli-cmd-btn.active {
  border-color: #c026d3;
  background: #fdf4ff;
}

.pingcli-cmd-label {
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
}

.pingcli-cmd-command {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Terminal output pane ────────────────────────────── */
.pingcli-terminal {
  margin-top: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.pingcli-terminal-header {
  background: #1e293b;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pingcli-terminal-prompt {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #94a3b8;
}

.pingcli-terminal-prompt span.cmd-text {
  color: #7dd3fc;
  font-weight: 600;
}

.pingcli-terminal-status {
  font-size: 11px;
  color: #64748b;
}

.pingcli-terminal-status.ok   { color: #4ade80; }
.pingcli-terminal-status.err  { color: #f87171; }

.pingcli-terminal-body {
  background: #0f172a;
  color: #e2e8f0;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.7;
  padding: 16px;
  min-height: 160px;
  max-height: 480px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.pingcli-terminal-body.loading {
  color: #64748b;
  font-style: italic;
}
```

- [ ] **Step 2: Verify file exists**

```bash
ls -la /Users/cmuir/Development/AI-DEMO2/demo_api_ui/src/components/PingCliPage.css
```
Expected: file listed with nonzero size

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/PingCliPage.css
git commit -m "feat: add PingCliPage CSS"
```

---

### Task 4: PingCliPage React component

**Files:**
- Create: `demo_api_ui/src/components/PingCliPage.js`

**Interfaces:**
- Consumes: `POST /api/admin/pingcli/run` → `{ command, output, exitCode, error? }`
- Produces: default export `PingCliPage` React component (no props required)

- [ ] **Step 1: Write the component**

Create `demo_api_ui/src/components/PingCliPage.js`:

```js
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

  const brewCmd = 'brew install pingidentity/tap/pingcli';
  const trustCmd = 'brew trust pingidentity/tap';
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
        After installing, run <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: 3 }}>pingcli init</code> to
        configure your PingOne environment credentials, then use the commands below to
        explore your tenant directly from the terminal.
      </p>
    </div>
  );
}

export default function PingCliPage() {
  const [running, setRunning] = useState(null);   // commandKey currently executing
  const [result, setResult] = useState(null);     // { command, output, exitCode, error }

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
        The official CLI for PingOne administration. Click any command to run it live against your configured environment.
      </p>

      <InstallSection />

      {CATEGORIES.map(({ title, commands }) => (
        <div key={title}>
          <p className="pingcli-section-title">{title}</p>
          <div className="pingcli-command-grid">
            {commands.map(({ key, label, desc }) => (
              <button
                key={key}
                className={`pingcli-cmd-btn${result && running === null && result.command && result.command.startsWith(desc.split(' ').slice(0, 3).join(' ')) ? ' active' : ''}`}
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
```

- [ ] **Step 2: Verify no JSX/import errors**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && node -e "
const { build } = require('esbuild');
build({ entryPoints: ['src/components/PingCliPage.js'], bundle: false, write: false, loader: { '.js': 'jsx' } })
  .then(() => console.log('OK'))
  .catch(e => { console.error(e.message); process.exit(1); });
"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/PingCliPage.js
git commit -m "feat: add PingCliPage component with install guide and command runner"
```

---

### Task 5: Register route in App.js

**Files:**
- Modify: `demo_api_ui/src/App.js`

**Interfaces:**
- Consumes: `PingCliPage` default export from `./components/PingCliPage`
- Produces: `/pingcli` route rendered inside the admin auth shell (same pattern as `/snapshot-import`)

- [ ] **Step 1: Add import**

In `demo_api_ui/src/App.js`, find the import block containing:
```js
import SnapshotImport from "./pages/SnapshotImport";
```
Add immediately after it:
```js
import PingCliPage from "./components/PingCliPage";
```

- [ ] **Step 2: Add the route**

In `demo_api_ui/src/App.js`, find the block:
```js
                <Route
                  path="/snapshot-import"
                  element={
                    loading ? null : user ? (
                      <>
                        <AdminSideNav user={user} />
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <SnapshotImport />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
```
Add immediately after it:
```js
                <Route
                  path="/pingcli"
                  element={
                    loading ? null : user ? (
                      <>
                        <AdminSideNav user={user} />
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <PingCliPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
```

- [ ] **Step 3: Verify no build errors**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npx vite build 2>&1 | tail -15
```
Expected: build completes without errors

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/App.js
git commit -m "feat: register /pingcli route in App.js"
```

---

### Task 6: Add nav item in AdminSideNav

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`

**Interfaces:**
- Consumes: nav item object shape `{ label, path, icon }`
- Produces: "PingCLI Demo" link visible in the admin sidebar under the same tools group as "Snapshot Import"

- [ ] **Step 1: Add the nav item**

In `demo_api_ui/src/components/AdminSideNav.jsx`, find the existing block:
```js
        {
          label: "Snapshot Import",
          path: "/snapshot-import",
          icon: "file",
        },
```
Add immediately after it:
```js
        {
          label: "PingCLI Demo",
          path: "/pingcli",
          icon: "tool",
        },
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && node -e "
const { build } = require('esbuild');
build({ entryPoints: ['src/components/AdminSideNav.jsx'], bundle: false, write: false, loader: { '.jsx': 'jsx' } })
  .then(() => console.log('OK'))
  .catch(e => { console.error(e.message); process.exit(1); });
"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat: add PingCLI Demo link to AdminSideNav"
```

---

### Task 7: End-to-end smoke test in browser

**Files:**
- No file changes — verification only

- [ ] **Step 1: Start the dev stack**

```bash
cd /Users/cmuir/Development/AI-DEMO2 && docker compose up demo_api_server demo_api_ui -d 2>&1 | tail -5
```
Or use the local dev server:
```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npm start &
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && node server.js &
```

- [ ] **Step 2: Open the page**

Navigate to `http://localhost:4000/pingcli` (or `https://api.ping.demo:4000/pingcli`).

Expected:
- Page loads without errors
- "Installing PingCLI on a Ping Demo Machine" section is visible with 3 copy-able code blocks
- 4 category sections of command buttons are rendered
- No terminal pane visible yet

- [ ] **Step 3: Click a command button**

Click "List Users".

Expected:
- Terminal pane appears below the command grid
- Header shows `$ pingcli pingone users list -O json`
- "Running command…" appears briefly
- Output renders as pretty-printed JSON (or an auth error if PingOne credentials are not configured — that is expected)
- Exit code shown in header (`✓ exit 0` or `✗ exit 1`)

- [ ] **Step 4: Click "Version"**

Click the "Version" button.

Expected:
- Terminal clears previous result
- Shows `pingcli version X.Y.Z` (plain text, not JSON)
- Exit code `✓ exit 0`

- [ ] **Step 5: Test copy buttons**

Click "Copy" next to the Homebrew install command.

Expected: button briefly shows "Copied!" and the text `brew install pingidentity/tap/pingcli` is in the clipboard.

- [ ] **Step 6: Navigate away and back**

Click another nav item, then click "PingCLI Demo" in the sidebar.

Expected: page loads cleanly, terminal pane is reset (no stale result from previous visit).

---

## Self-Review

**Spec coverage:**
- Install section on the page: Task 4 `InstallSection` component ✓
- Shows the command string: terminal header `$ <cmd>` ✓
- Runs commands: `POST /api/admin/pingcli/run` ✓
- Shows results: terminal body pane ✓
- How to install on ping machine: `InstallSection` with brew steps + `pingcli init` note ✓
- Nav item for discoverability: Task 6 ✓
- Auth-gated (admin only): `authenticateToken` at mount point ✓

**Placeholder scan:** No TBDs, no "add appropriate…" phrases, no "similar to Task N" references.

**Type/name consistency:**
- `commandKey` used in route body and frontend fetch consistently
- `COMMANDS` map in route returns `{ command, output, exitCode, error }` — consumed as `result.command`, `result.output`, `result.exitCode`, `result.error` in component ✓
- CSS class names referenced in component exactly match classes defined in CSS ✓
