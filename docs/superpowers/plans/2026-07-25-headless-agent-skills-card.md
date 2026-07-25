# Agent Skills Card (Headless Demo — Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI Agent Skills" category to the `/pingcli` page with two cards — list agent skills (live) and install an agent skill (live into a sandboxed temp dir) — showcasing Ping's Agent Skills headless pillar.

**Architecture:** Extend the existing allow-list proxy. Backend adds two keys to the `COMMANDS` map in `routes/pingcli.js` and injects a throwaway `--output-dir` for the install command so it never writes a real `.claude/skills`. Frontend adds one entry to the `CATEGORIES` array in `PingCliPage.js`; all card wiring (Run/stream/Copy/collapse) is data-driven off that array plus `/commands`, so no other UI change is needed.

**Tech Stack:** Node/Express + `child_process.execFile`/`spawn` (backend), Jest + supertest (backend tests), React 19 `.js`/JSX + Vite (frontend).

## Global Constraints

- Work only in worktree `worktree-headless-agent-skills-card`; stage files explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit.
- Emoji allowlist only: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. This feature needs no new emoji.
- Both new commands MUST be `runnable: true` — existing test `commands` asserts `res.body.every((c) => c.runnable === true)`.
- Agent-skills commands need NO PingOne auth (local catalog): set no `auth` flag, and omit `configFlag` from their static `args` so `buildPrereqs` shows only Install + Run (no Configure/Authenticate steps).
- Card `label` strings must show the clean canonical command (no server-internal `--output-dir`), matching the route's existing "label ≠ internal args" convention.
- pingcli binary in-container: `pingcli` 1.2.0 at `/usr/local/bin/pingcli`. Verified live: `agent-skills list` → `pingcli-usage`; `agent-skills install pingcli-usage --output-dir <dir>` copies files.
- Run backend tests with CI settings (per project memory): `CI=true npx jest` with `maxWorkers` set, from the worktree, ignoring `.claude/worktrees` pollution.

---

### Task 1: Backend — add `agent_skills_list` and `agent_skills_install` to the pingcli route

**Files:**
- Modify: `demo_api_server/routes/pingcli.js` (add two `COMMANDS` entries + sandbox `--output-dir` injection)
- Test: `demo_api_server/tests/pingcli.route.test.js` (add a describe block)

**Interfaces:**
- Consumes: existing `COMMANDS` map, `resolveArgs(args)`, `pingcliEnv()`, `buildPrereqs(cmd)`, `PINGCLI_HOME`, the `/run`, `/stream`, `/commands` handlers.
- Produces: command keys `agent_skills_list` and `agent_skills_install`; a helper `withSandboxDir(cmd, args)` that appends `--output-dir <freshTempDir>` when `cmd.sandboxInstall` is truthy (used by `/run` and `/stream`).

- [ ] **Step 1: Write the failing tests**

Add this describe block to `demo_api_server/tests/pingcli.route.test.js`:

```js
describe('agent-skills commands', () => {
  it('lists both agent-skills commands as runnable, no auth', async () => {
    const res = await request(app).get('/api/admin/pingcli/commands');
    const list = res.body.find((c) => c.key === 'agent_skills_list');
    const install = res.body.find((c) => c.key === 'agent_skills_install');
    expect(list).toMatchObject({ runnable: true, auth: false });
    expect(install).toMatchObject({ runnable: true, auth: false });
    // No PingOne creds needed -> prereqs are just Install + Run.
    expect(list.prereqs.map((p) => p.title)).toEqual(['Install PingCLI', 'Run command']);
  });

  it('runs agent-skills list via execFile', async () => {
    execFile.mockClear();
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'agent_skills_list' });
    expect(res.status).toBe(200);
    expect(res.body.command).toBe('pingcli agent-skills list -O json');
    const args = execFile.mock.calls[execFile.mock.calls.length - 1][1];
    expect(args).toEqual(expect.arrayContaining(['agent-skills', 'list', '-O', 'json']));
  });

  it('injects a sandbox --output-dir for install but keeps the label clean', async () => {
    execFile.mockClear();
    const res = await request(app)
      .post('/api/admin/pingcli/run')
      .send({ commandKey: 'agent_skills_install' });
    expect(res.status).toBe(200);
    // Label a presenter copies must NOT leak the server-internal --output-dir.
    expect(res.body.command).toBe('pingcli agent-skills install pingcli-usage');
    const args = execFile.mock.calls[execFile.mock.calls.length - 1][1];
    expect(args).toEqual(expect.arrayContaining(['agent-skills', 'install', 'pingcli-usage']));
    const i = args.indexOf('--output-dir');
    expect(i).toBeGreaterThan(-1);
    expect(typeof args[i + 1]).toBe('string');
    expect(args[i + 1].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest tests/pingcli.route.test.js -t "agent-skills" --maxWorkers=2`
Expected: FAIL — `agent_skills_list`/`agent_skills_install` are `undefined` (commands not yet defined).

- [ ] **Step 3: Add the two COMMANDS entries**

In `demo_api_server/routes/pingcli.js`, add to the `COMMANDS` object (after `version:` or in a logical spot). Note: NO `configFlag`, NO `auth` — agent-skills is a local catalog:

```js
  agent_skills_list:    { label: 'pingcli agent-skills list -O json',
                          args: ['agent-skills', 'list', '-O', 'json'],
                          runnable: true },
  agent_skills_install: { label: 'pingcli agent-skills install pingcli-usage',
                          args: ['agent-skills', 'install', 'pingcli-usage'],
                          runnable: true, sandboxInstall: true },
```

- [ ] **Step 4: Add the `withSandboxDir` helper**

In `demo_api_server/routes/pingcli.js`, near `resolveArgs`, add:

```js
// Install writes files to <output-dir>/<skill-name>. Point it at a throwaway
// temp dir so the demo never mutates a real .claude/skills. Fresh dir per run.
function withSandboxDir(cmd, args) {
  if (!cmd.sandboxInstall) return args;
  const dir = fs.mkdtempSync(path.join(PINGCLI_HOME, 'agent-skills-'));
  return [...args, '--output-dir', dir];
}
```

- [ ] **Step 5: Apply the helper in `/run` and `/stream`**

In the `/run` handler, change the exec line from:

```js
  execFile(PINGCLI_BIN, resolveArgs(cmd.args), { timeout: TIMEOUT_MS, env: pingcliEnv() }, (err, stdout, stderr) => {
```
to:
```js
  execFile(PINGCLI_BIN, withSandboxDir(cmd, resolveArgs(cmd.args)), { timeout: TIMEOUT_MS, env: pingcliEnv() }, (err, stdout, stderr) => {
```

In the `/stream` handler, change:
```js
  const child = spawn(PINGCLI_BIN, resolveArgs(cmd.args), { timeout: TIMEOUT_MS, env: pingcliEnv() });
```
to:
```js
  const child = spawn(PINGCLI_BIN, withSandboxDir(cmd, resolveArgs(cmd.args)), { timeout: TIMEOUT_MS, env: pingcliEnv() });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/pingcli.route.test.js --maxWorkers=2`
Expected: PASS — all pre-existing tests plus the three new ones. (The existing `commands` test `every(c => c.runnable === true)` stays green because both new entries are `runnable: true`.)

- [ ] **Step 7: Live sanity check in the running container**

Run:
```bash
docker cp demo_api_server/routes/pingcli.js ai-demo-api-server:/app/routes/pingcli.js
docker exec ai-demo-api-server sh -lc 'BIN=/usr/local/bin/pingcli; export HOME=/tmp; D=$(mktemp -d); "$BIN" --config /tmp/pctest.yaml agent-skills install pingcli-usage --output-dir "$D" 2>&1 | tail -3; ls -R "$D" | head'
```
Expected: install succeeds and lists copied `pingcli-usage` files under the temp dir. Confirms `--config` (re-injected by `resolveArgs`) does not break agent-skills. (If the BFF runs `node --watch`, the copy reloads the route; otherwise `docker restart ai-demo-api-server`.)

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/routes/pingcli.js demo_api_server/tests/pingcli.route.test.js
git commit -m "feat(pingcli): add agent-skills list + sandboxed install commands"
```

---

### Task 2: Frontend — add the "AI Agent Skills" category card

**Files:**
- Modify: `demo_api_ui/src/components/PingCliPage.js` (append one entry to the `CATEGORIES` array, ~line 237-270)

**Interfaces:**
- Consumes: backend keys `agent_skills_list`, `agent_skills_install` from Task 1 (via `GET /api/admin/pingcli/commands`), the existing `CATEGORIES` shape `{ title, commands: [{ key, label, desc }] }`, and `labelForCommandKey`.
- Produces: a new collapsible "AI Agent Skills" section on `/pingcli`.

- [ ] **Step 1: Add the category**

In `demo_api_ui/src/components/PingCliPage.js`, append to the `CATEGORIES` array (after the `Platform & Config` object, keeping the closing `];`):

```js
  {
    title: 'AI Agent Skills',
    commands: [
      { key: 'agent_skills_list',    label: 'List Agent Skills',
        desc: 'pingcli agent-skills list -O json' },
      { key: 'agent_skills_install', label: 'Install Agent Skill',
        desc: 'pingcli agent-skills install pingcli-usage' },
    ],
  },
```

- [ ] **Step 2: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds with no errors (regression-guard requires the UI build to pass before the work is done).

- [ ] **Step 3: Live-verify in the browser**

The stack is already running (UI at `https://local.ping-devops.com:4000`, dev Vite HMR picks up the edit; if the running UI serves the main checkout, copy the file in per the docker-serves-main-checkout memory, or browse the worktree UI per the worktree-ui-live-verify memory). Sign in on `local.ping-devops.com:4000` (admin), open `/pingcli`, expand **AI Agent Skills**:
  - Click **List Agent Skills** → terminal pane streams JSON listing `pingcli-usage`, exit 0.
  - Click **Install Agent Skill** → streams a success message; no error. Card **Copy** yields exactly `pingcli agent-skills install pingcli-usage`.
  - Spot-check one existing card (e.g. List Applications) still returns live data (no regression).

Capture a screenshot of the expanded section for the PR.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/PingCliPage.js
git commit -m "feat(pingcli-ui): add AI Agent Skills category card"
```

---

## Self-Review

**1. Spec coverage:**
- Spec "add AI Agent Skills category, two cards" → Task 1 (backend keys) + Task 2 (CATEGORIES). ✅
- Spec "list live-runnable, no auth" → Task 1 Step 1/3 (`runnable:true`, no `auth`, prereqs Install+Run). ✅
- Spec "install = live sandboxed run, label clean, temp output-dir" → Task 1 Steps 3-5 + test in Step 1. ✅
- Spec success criteria "List streams real JSON `pingcli-usage`; Install no error, no real `.claude/skills` write; no regression; UI build passes" → Task 1 Step 7, Task 2 Steps 2-3. ✅
- Spec test plan (route jest asserts keys/labels; live browser; regression) → Task 1 tests + Task 2 Step 3. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has literal content. ✅

**3. Type consistency:** `withSandboxDir(cmd, args)` defined in Task 1 Step 4, used identically in Step 5. Command keys `agent_skills_list`/`agent_skills_install` consistent across backend, tests, and frontend. Label strings match verbatim between backend `label`, test assertions, and frontend `desc`. ✅
