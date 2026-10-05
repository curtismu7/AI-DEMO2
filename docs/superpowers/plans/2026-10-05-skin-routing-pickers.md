# Skin Path / Door / Tools Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check for and use applicable skills (`regression-guard`, `generate-tests`, `verify-ai-demo2`) before editing.

**Goal:** The Claude Terminal, VS Code and Claude Desktop skins let the user pick Path (MCP + LLM), Door and a tool without typing, backed by the same server state as the Cursor page.

**Architecture:** Shared definitions move to a pure module `privilegeRouting.js`. The server-facing routing state and the optimistic `/config` switch move to a hook `usePrivilegeRouting({ request })` used by BOTH the Cursor page (behaviour unchanged) and `usePrivilegeShellSession` (skins). Skin views render a shared `ShellRoutingBar` and `ShellToolsList`.

**Tech Stack:** React 19, vitest + @testing-library/react (not jest), plain CSS.

**Spec:** `docs/superpowers/specs/2026-10-05-skin-routing-pickers-design.md`

## Global Constraints
- Run from the worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/skin-routing-pickers` (branch `worktree-skin-routing-pickers`); never `cd` to the main checkout. Link deps once: `/bin/ls -d demo_api_ui/node_modules 2>&1 || ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules`.
- Run vitest ONLY via `npm --prefix demo_api_ui run test:unit -- <path>` with `<path>` RELATIVE TO `demo_api_ui` (e.g. `src/pages/__tests__/X.test.jsx`). Never `npx vitest`. Redirect long runs to a file and read it; never conclude from a piped exit status.
- Existing Cursor tests `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.*` must pass UNMODIFIED after Tasks 1 and 3.
- `PrivilegeMcpClientPage.jsx` is a protected surface (REGRESSION_PLAN §0-§1): behaviour-preserving edits only, each in its own commit, no drive-by cleanup.
- Emoji allowlist only (`⚠️` is allowed; use HTML entities like `&#9679;` for other glyphs). New CSS: no colour/background/font-size literals except `var(--font-size-*)` and `var(--th-*)`/`var(--font-mono)` tokens that exist in `demo_api_ui/src/index.css` (grep first); otherwise `inherit`/`currentColor`/`color-mix(in srgb, currentColor N%, transparent)`. No inline `style={{}}` for colour/background/font-size. No `monospace` literal. No `prefers-color-scheme`.
- Stage files explicitly (never `git add -A`); `git branch --show-current` must print `worktree-skin-routing-pickers` before each commit. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- API paths are under `/api/privilege-mcp/*` (skins use `apiClient`; Cursor uses its own `api()` which prefixes the same base).
- Super Sports is the default vertical for any manual validation.

## Review Focus
- `/config` fails during a path switch: mode AND config roll back; skin shows `Gateway switch failed: <msg>`.
- Door switch to a door the user never signed into (`destinationAuthenticated: false`): skin shows the sign-in gate with no redirect and no stale tools.
- LLM path active: `/chat` is NOT called, `/config` is NOT written, tools are hidden with a note, a denied prompt reads as a denial not a crash.
- `direct` mode lists only the four direct door names; a mode with zero presets shows the current door name as text, not an empty select.
- Switching while a switch is in flight: both selects are disabled (no double POST).
- Cursor page: every `PrivilegeMcpClientPage.*` test passes unmodified (door picker, gateway switch, re-auth, presets).

---

### Task 1: Shared pure module `privilegeRouting.js`; Cursor imports it

**Files:**
- Create: `demo_api_ui/src/components/privilege/privilegeRouting.js`
- Create: `demo_api_ui/src/components/privilege/__tests__/privilegeRouting.test.js`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` (remove local `doorName` ~L51-60, `GATEWAY_MODES` ~L221, `LLM_PATHS` ~L248; add one import; use `doorsForMode` in `sameGatewayDoors` ~L1387)

**Interfaces:**
- Produces (all named exports): `doorName(mcpUrl: string): string|null`, `GATEWAY_MODES`, `LLM_PATHS`, `DIRECT_DOOR_NAMES: Set<string>`, `doorsForMode(presets: {mode,url,clientId}[], mode: string): string[]`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/components/privilege/__tests__/privilegeRouting.test.js
import { doorName, doorsForMode, GATEWAY_MODES, LLM_PATHS } from "../privilegeRouting";

describe("doorName", () => {
  it("reads the door from facade and gateway URLs", () => {
    expect(doorName("https://api.ping.demo:3001/mcp-facade/opensearch/mcp")).toBe("opensearch");
    expect(doorName("https://gw.example/privilege-gateway/banking/mcp")).toBe("banking");
  });
  it("returns null for junk", () => {
    expect(doorName("not a url")).toBeNull();
    expect(doorName("")).toBeNull();
  });
});

describe("doorsForMode", () => {
  const presets = [
    { mode: "privilege", url: "https://gw.example/privilege-gateway/banking/mcp" },
    { mode: "privilege", url: "https://gw.example/privilege-gateway/other/mcp" },
    { mode: "direct", url: "https://api.ping.demo:3001/mcp-facade/opensearch/mcp" },
    { mode: "direct", url: "https://api.ping.demo:3001/mcp-facade/weird/mcp" },
    { mode: "facade", url: "https://api.ping.demo:3001/mcp-facade/banking/mcp" },
  ];
  it("returns only the selected mode's doors", () => {
    expect(doorsForMode(presets, "privilege")).toHaveLength(2);
    expect(doorsForMode(presets, "facade")).toEqual(["https://api.ping.demo:3001/mcp-facade/banking/mcp"]);
  });
  it("limits direct mode to the four direct door names", () => {
    expect(doorsForMode(presets, "direct")).toEqual(["https://api.ping.demo:3001/mcp-facade/opensearch/mcp"]);
  });
  it("returns [] for no presets or an unknown mode", () => {
    expect(doorsForMode([], "privilege")).toEqual([]);
    expect(doorsForMode(presets, "nope")).toEqual([]);
  });
});

describe("constants", () => {
  it("keeps the three MCP modes and three LLM paths", () => {
    expect(Object.keys(GATEWAY_MODES)).toEqual(["direct", "privilege", "facade"]);
    expect(Object.keys(LLM_PATHS)).toEqual(["anthropic", "google", "openai"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (`npm --prefix demo_api_ui run test:unit -- src/components/privilege/__tests__/privilegeRouting.test.js`): cannot resolve `../privilegeRouting`.

- [ ] **Step 3: Create the module by MOVING code, not retyping it.** Cut `doorName`, `GATEWAY_MODES` and `LLM_PATHS` (including their leading comments) verbatim out of `PrivilegeMcpClientPage.jsx` into the new file, add `export` to each, then append:

```js
// The four direct-path doors (mirrors mcpFacade.js DOORS): a same-origin preset
// from another path must not appear in Direct's door list.
export const DIRECT_DOOR_NAMES = new Set(['banking', 'opensearch', 'brave', 'pingone-admin']);

export function doorsForMode(presets, mode) {
  return (presets || [])
    .filter((p) => p.mode === mode)
    .filter((p) => mode !== 'direct' || DIRECT_DOOR_NAMES.has(doorName(p.url)))
    .map((p) => p.url);
}
```

- [ ] **Step 4: Cursor imports.** In `PrivilegeMcpClientPage.jsx` add `import { doorName, GATEWAY_MODES, LLM_PATHS, DIRECT_DOOR_NAMES, doorsForMode } from '../components/privilege/privilegeRouting';` (match the file's import ordering/quote style). In `sameGatewayDoors` (~L1387) delete the local `const directDoorNames = new Set([...]);` and replace the `fromPresets` chain with:

```js
    const fromPresets = doorsForMode(presets, gatewayMode);
```
(If `DIRECT_DOOR_NAMES` ends up unused in the page, do not import it.)

- [ ] **Step 5: Run** the new test (PASS) and ALL Cursor tests: `npm --prefix demo_api_ui run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.doorPicker.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.gatewaySwitch.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.doorSwitchReauth.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.gatewayPresets.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.persistedDoors.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.silentAutoConnect.test.jsx src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx` then the whole family with `src/pages/__tests__/PrivilegeMcpClientPage` as the path prefix if the runner accepts it (otherwise list the files). Expected: all PASS, none edited.

- [ ] **Step 6: Commit** (stage the 3 files): `refactor(privilege): share doorName/GATEWAY_MODES/LLM_PATHS/doorsForMode between Cursor and skins`.

---

### Task 2: `usePrivilegeRouting` hook

**Files:**
- Create: `demo_api_ui/src/components/privilege/usePrivilegeRouting.js`
- Create: `demo_api_ui/src/components/privilege/__tests__/usePrivilegeRouting.test.jsx`

**Interfaces:**
- Consumes: `doorName` from `./privilegeRouting`.
- Produces `usePrivilegeRouting({ request })` where `request(path: string, opts?: {method?: string, body?: object}): Promise<any>` (path like `/config`, no base). Returns:
  `{ gatewayMode, setGatewayMode, config, setConfig, gatewayConfigs, setGatewayConfigs, presets, setPresets, llmPath, setLlmPath, llmGatewayUrl, setLlmGatewayUrl, loaded, hydrate(state), selectPath(key), selectDoor(url) }`
  - `hydrate(s)`: sets `gatewayMode` (`s.gatewayMode || 'privilege'`), `config` (`s.config` if present), `gatewayConfigs` (`s.gatewayConfigs || {direct:{},privilege:{},facade:{}}`), `presets` (array or `[]`), `loaded=true`.
  - `selectPath(key)`: `llm:<p>` -> `setLlmPath(p)`, returns `{ ok: true, llm: true }`, no request. MCP key -> clears `llmPath`, optimistic `setGatewayMode`/`setConfig` (keeps the same door name across modes via a matching preset, merges `gatewayConfigs[key]`), `POST /config {...nextConfig, gatewayMode: key}`; success -> `setGatewayConfigs(saved.gatewayConfigs || previous)`, returns `{ ok: true, saved, nextConfig }`; failure -> rolls mode+config back, returns `{ ok: false, error }` (raw error).
  - `selectDoor(url)`: `POST /config {...config, mcpUrl: url, clientId: preset?.clientId || config.clientId}` (clientId replaced only when a preset matches); success -> `setConfig(next)`, returns `{ ok: true, saved, next }`; failure -> `{ ok: false, error }`, config untouched.

- [ ] **Step 1: Write the failing tests**

```jsx
// demo_api_ui/src/components/privilege/__tests__/usePrivilegeRouting.test.jsx
import { act, renderHook } from "@testing-library/react";
import { usePrivilegeRouting } from "../usePrivilegeRouting";

const PRIV_A = "https://gw.example/privilege-gateway/banking/mcp";
const PRIV_B = "https://gw.example/privilege-gateway/other/mcp";
const FAC_A = "https://api.ping.demo:3001/mcp-facade/banking/mcp";
const STATE = {
  gatewayMode: "privilege",
  config: { mcpUrl: PRIV_A, clientId: "c1" },
  presets: [
    { mode: "privilege", url: PRIV_A, clientId: "c1" },
    { mode: "privilege", url: PRIV_B, clientId: "c2" },
    { mode: "facade", url: FAC_A, clientId: "cf" },
  ],
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
};

function setup(request) {
  const hook = renderHook(() => usePrivilegeRouting({ request }));
  act(() => hook.result.current.hydrate(STATE));
  return hook;
}

describe("usePrivilegeRouting", () => {
  it("hydrates mode, config, presets and marks loaded", () => {
    const { result } = setup(vi.fn());
    expect(result.current.gatewayMode).toBe("privilege");
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
    expect(result.current.presets).toHaveLength(3);
    expect(result.current.loaded).toBe(true);
  });

  it("selectPath keeps the same door across modes and posts /config", async () => {
    const request = vi.fn().mockResolvedValue({ gatewayConfigs: { direct: {}, privilege: {}, facade: {} } });
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectPath("facade"); });
    expect(out.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("/config", {
      method: "POST",
      body: expect.objectContaining({ gatewayMode: "facade", mcpUrl: FAC_A, clientId: "cf" }),
    });
    expect(result.current.gatewayMode).toBe("facade");
    expect(result.current.config.mcpUrl).toBe(FAC_A);
  });

  it("rolls mode and config back when /config fails", async () => {
    const boom = new Error("nope");
    const { result } = setup(vi.fn().mockRejectedValue(boom));
    let out;
    await act(async () => { out = await result.current.selectPath("facade"); });
    expect(out).toEqual({ ok: false, error: boom });
    expect(result.current.gatewayMode).toBe("privilege");
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
  });

  it("an LLM path sets llmPath only — no request", async () => {
    const request = vi.fn();
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectPath("llm:anthropic"); });
    expect(out).toEqual({ ok: true, llm: true });
    expect(result.current.llmPath).toBe("anthropic");
    expect(request).not.toHaveBeenCalled();
  });

  it("an MCP path clears an active LLM path", async () => {
    const { result } = setup(vi.fn().mockResolvedValue({}));
    await act(async () => { await result.current.selectPath("llm:openai"); });
    await act(async () => { await result.current.selectPath("privilege"); });
    expect(result.current.llmPath).toBe("");
  });

  it("selectDoor posts the preset's mcpUrl + clientId and updates config on success", async () => {
    const request = vi.fn().mockResolvedValue({ oauth: { destinationAuthenticated: true } });
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectDoor(PRIV_B); });
    expect(out.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("/config", {
      method: "POST",
      body: expect.objectContaining({ mcpUrl: PRIV_B, clientId: "c2" }),
    });
    expect(result.current.config.mcpUrl).toBe(PRIV_B);
  });

  it("selectDoor leaves config untouched on failure", async () => {
    const boom = new Error("nope");
    const { result } = setup(vi.fn().mockRejectedValue(boom));
    let out;
    await act(async () => { out = await result.current.selectDoor(PRIV_B); });
    expect(out).toEqual({ ok: false, error: boom });
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (missing module).

- [ ] **Step 3: Implement**

```js
// demo_api_ui/src/components/privilege/usePrivilegeRouting.js
// Server-facing routing state shared by the Cursor page and the footprint
// skins: which path (MCP mode or LLM lane), which door, and the optimistic
// /config switch with rollback. Page-only follow-ups (sign-in modal, overlay,
// silent re-auth) stay with the caller; this returns what they need.
import { useCallback, useState } from 'react';
import { doorName } from './privilegeRouting';

const DEFAULT_CONFIG = {
  mcpUrl: '',
  clientId: '',
  scopes: 'openid profile email offline_access',
  llmUrl: 'http://127.0.0.1:11434',
  llmModel: 'llama3.2:1b',
};
const EMPTY_GATEWAY_CONFIGS = { direct: {}, privilege: {}, facade: {} };

export function usePrivilegeRouting({ request }) {
  const [gatewayMode, setGatewayMode] = useState('privilege');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [gatewayConfigs, setGatewayConfigs] = useState(EMPTY_GATEWAY_CONFIGS);
  const [presets, setPresets] = useState([]);
  // '' = an MCP path is active; non-empty = chat goes to that LLM lane.
  const [llmPath, setLlmPath] = useState('');
  const [llmGatewayUrl, setLlmGatewayUrl] = useState('');
  const [loaded, setLoaded] = useState(false);

  const hydrate = useCallback((s) => {
    setGatewayMode(s.gatewayMode || 'privilege');
    if (s.config) setConfig(s.config);
    setGatewayConfigs(s.gatewayConfigs || EMPTY_GATEWAY_CONFIGS);
    setPresets(Array.isArray(s.presets) ? s.presets : []);
    setLoaded(true);
  }, []);

  const selectPath = useCallback(async (key) => {
    if (key.startsWith('llm:')) {
      setLlmPath(key.slice(4));
      return { ok: true, llm: true };
    }
    // Keep the selected app across paths when the destination has a matching
    // door; otherwise a path switch silently lands on a different app's policy.
    const selectedDoor = doorName(config.mcpUrl);
    const matchingDoor = selectedDoor && presets.find(
      (p) => p.mode === key && doorName(p.url) === selectedDoor,
    );
    const nextConfig = {
      ...config,
      ...(gatewayConfigs[key] || {}),
      ...(matchingDoor ? { mcpUrl: matchingDoor.url, clientId: matchingDoor.clientId || '' } : {}),
    };
    const prevMode = gatewayMode;
    const prevConfig = config;
    setLlmPath('');
    setGatewayMode(key);
    setConfig(nextConfig);
    try {
      const saved = await request('/config', { method: 'POST', body: { ...nextConfig, gatewayMode: key } });
      setGatewayConfigs(saved?.gatewayConfigs || gatewayConfigs);
      return { ok: true, saved, nextConfig };
    } catch (error) {
      // The mode was set optimistically; leaving it would claim a mode the
      // server never accepted.
      setGatewayMode(prevMode);
      setConfig(prevConfig);
      return { ok: false, error };
    }
  }, [config, gatewayConfigs, gatewayMode, presets, request]);

  const selectDoor = useCallback(async (mcpUrl) => {
    const preset = presets.find((p) => p.url === mcpUrl);
    const next = { ...config, mcpUrl, ...(preset ? { clientId: preset.clientId || '' } : {}) };
    try {
      const saved = await request('/config', { method: 'POST', body: next });
      setConfig(next);
      return { ok: true, saved, next };
    } catch (error) {
      return { ok: false, error };
    }
  }, [config, presets, request]);

  return {
    gatewayMode, setGatewayMode,
    config, setConfig,
    gatewayConfigs, setGatewayConfigs,
    presets, setPresets,
    llmPath, setLlmPath,
    llmGatewayUrl, setLlmGatewayUrl,
    loaded, hydrate, selectPath, selectDoor,
  };
}
```

- [ ] **Step 4: Run tests, expect 7/7 PASS. Step 5: Commit** `feat(privilege): usePrivilegeRouting hook (path/door state + optimistic /config switch)`.

---

### Task 3: Cursor page adopts `usePrivilegeRouting` (behaviour unchanged)

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY. Do not edit any Cursor test.

**Interfaces:**
- Consumes `usePrivilegeRouting` (Task 2) with `{ request: api }` where `api` is the page's existing fetch helper (~L141; it takes `(path, {method, body})` and returns parsed JSON, throwing an `Error` with `.status`, `.code`, `.reason`).

- [ ] **Step 1: Baseline.** Run the full `PrivilegeMcpClientPage.*` test family now and record the pass count in your report (must be all green before you touch anything).

- [ ] **Step 2: Replace six state declarations** (L337, L342, L344, L350, L355, L356) with one hook call placed where `config` was:

```js
  const {
    config, setConfig,
    gatewayMode, setGatewayMode,
    llmPath, setLlmPath,
    llmGatewayUrl, setLlmGatewayUrl,
    gatewayConfigs, setGatewayConfigs,
    presets, setPresets,
    selectPath, selectDoor,
  } = usePrivilegeRouting({ request: api });
```
Keep `gatewayStateLoaded`, `clientHints`, `gatewaySession` and every other state exactly as is. Add `import { usePrivilegeRouting } from '../components/privilege/usePrivilegeRouting';`. All other call sites (`setConfig(...)`, `setGatewayMode(...)`, the `/state` effect, the `/llm/config` effect, the form inputs) compile unchanged because the setters keep their names. Do NOT use `hydrate`/`loaded` in Cursor.

- [ ] **Step 3: `switchGatewayMode`** (~L975). Keep the early return, the `forceReauth` handling, and everything from `const destinationAuthenticated = ...` onward byte-for-byte. Replace ONLY the block from `const savedConfig = ...` through the `catch (err) { ... return msg; }` wrapper's optimistic/POST/rollback parts as follows:

```js
  const switchGatewayMode = async (nextMode, { forceReauth = false } = {}) => {
    if (nextMode === gatewayMode && !forceReauth) return;
    // page-only resets that used to sit between the optimistic update and the POST
    setTools([]);
    setSelectedTool(null);
    setBlockedDetail(null);
    setShowBlockedModal(false);
    const result = await selectPath(nextMode);
    if (!result.ok) {
      clearSwitching();
      const msg = `Gateway switch failed: ${result.error.message}`;
      appendChat('system', msg);
      return msg;
    }
    const { saved, nextConfig } = result;
    savedMcpUrlRef.current = nextConfig.mcpUrl;
    try {
      // ... the ORIGINAL post-POST body, unchanged, starting at
      // `const destinationAuthenticated = saved.oauth?.destinationAuthenticated ?? saved.oauth?.authenticated;`
      // through the final `setAuthenticated(false); setTools([]); setSelectedTool(null);`
    } catch (err) {
      // original catch minus the rollback lines (the hook already rolled back)
      clearSwitching();
      const msg = `Gateway switch failed: ${err.message}`;
      appendChat('system', msg);
      return msg;
    }
  };
```
The inner `try` keeps the original silent-auth/`startAuthRedirect` logic verbatim (it previously lived in the same `try`); an error there must still produce `Gateway switch failed: <message>` and `clearSwitching()`, but must NOT roll mode/config back (a thrown redirect error never rolled back the saved mode before? It did, via the shared catch: preserve that: on an error thrown AFTER a successful POST the original code ran `setGatewayMode(prevMode); setConfig(prevConfig);`). To keep behaviour identical, capture `const prevMode = gatewayMode; const prevConfig = config;` before calling `selectPath` and call `setGatewayMode(prevMode); setConfig(prevConfig);` in that inner catch.

- [ ] **Step 4: `switchDoor`** (~L1276). Replace the `api('/config', ...)` + `setConfig(next)` pair:

```js
  const switchDoor = async (mcpUrl) => {
    const result = await selectDoor(mcpUrl);
    if (!result.ok) {
      appendChat('system', `Failed to switch door: ${result.error.message}`);
      return;
    }
    const { saved } = result;
    try {
      setShowBlockedModal(false);
      appendChat('system', `Switched to door: ${doorName(mcpUrl) || mcpUrl}`);
      // ... the ORIGINAL remaining body unchanged, from `const destinationAuthenticated = ...` to the last setTools/setSelectedTool
    } catch (err) {
      appendChat('system', `Failed to switch door: ${err.message}`);
    }
  };
```
(The original `throw err` inside the silent-auth catch is preserved and now lands in this catch, matching the old behaviour.)

- [ ] **Step 5: Run** the full `PrivilegeMcpClientPage.*` family; expect the same pass count as Step 1, zero test edits (`git diff --stat` must show only `PrivilegeMcpClientPage.jsx`). Also run `src/components/privilege` tests and `npm --prefix demo_api_ui run build` (redirect to a file; read it).

- [ ] **Step 6: Commit** (stage only `PrivilegeMcpClientPage.jsx`): `refactor(privilege): Cursor page uses usePrivilegeRouting for path/door switching (no behaviour change)`.

---

### Task 4: Skin session composes routing; LLM send path

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx`

**Interfaces:**
- Consumes `usePrivilegeRouting` (Task 2).
- Produces additions to the session object: `routing` (`{ gatewayMode, config, presets, llmPath, llmGatewayUrl, loaded }`), `pickPath(key): Promise<void>`, `pickDoor(url): Promise<void>`. `send` posts `/llm/call` when `routing.llmPath` is set. Everything else in the session is unchanged.
- Behaviour of `pickPath`/`pickDoor` after a successful `/config`: `tools` cleared; destination authenticated (`saved.oauth.destinationAuthenticated ?? saved.oauth.authenticated`) -> `listTools()` (failure -> `notice`); not authenticated -> `phase = 'signed-out'`. A failure sets `notice` to `Gateway switch failed: <errText>` (path) or `Failed to switch door: <errText>` (door). An `llm:` key changes nothing else. `busy` is true while a switch is in flight.

- [ ] **Step 1: Failing tests** (append to `usePrivilegeShellSession.test.jsx`; reuse its existing `wrapper`/`apiClient` mock; add):

```jsx
const PRIV_A = "https://gw.example/privilege-gateway/banking/mcp";
const PRIV_B = "https://gw.example/privilege-gateway/other/mcp";

async function readyRouted() {
  apiClient.get.mockImplementation((url) =>
    url.endsWith("/llm/config")
      ? Promise.resolve({ data: { gatewayUrl: "https://llm.example" } })
      : Promise.resolve({
          data: {
            oauth: { authenticated: true, scope: "openid" },
            tools: [{ name: "list_safes" }],
            gatewayMode: "privilege",
            config: { mcpUrl: PRIV_A, clientId: "c1" },
            presets: [
              { mode: "privilege", url: PRIV_A, clientId: "c1" },
              { mode: "privilege", url: PRIV_B, clientId: "c2" },
            ],
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
          },
        }),
  );
  const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  return hook;
}

describe("usePrivilegeShellSession routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads routing state from /state", async () => {
    const { result } = await readyRouted();
    expect(result.current.routing.gatewayMode).toBe("privilege");
    expect(result.current.routing.presets).toHaveLength(2);
  });

  it("pickDoor posts /config, clears tools, then lists tools when authenticated", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockImplementation((url) =>
      url.endsWith("/config")
        ? Promise.resolve({ data: { oauth: { destinationAuthenticated: true } } })
        : Promise.resolve({ data: { tools: [{ name: "other_tool" }] } }),
    );
    await act(() => result.current.pickDoor(PRIV_B));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/privilege-mcp/config",
      expect.objectContaining({ mcpUrl: PRIV_B, clientId: "c2" }),
    );
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/tools/list");
    expect(result.current.tools).toEqual([{ name: "other_tool" }]);
    expect(result.current.phase).toBe("ready");
  });

  it("pickDoor to an unauthenticated door shows the sign-in gate with no tools", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockResolvedValue({ data: { oauth: { destinationAuthenticated: false } } });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(result.current.phase).toBe("signed-out");
    expect(result.current.tools).toEqual([]);
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/tools/list");
  });

  it("a failed path switch rolls back and sets a notice", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockRejectedValue({ response: { status: 500, data: { error: "boom" } } });
    await act(() => result.current.pickPath("facade"));
    expect(result.current.routing.gatewayMode).toBe("privilege");
    expect(result.current.notice).toBe("Gateway switch failed: boom");
  });

  it("an LLM path writes no /config and send goes to /llm/call, not /chat", async () => {
    const { result } = await readyRouted();
    await act(() => result.current.pickPath("llm:anthropic"));
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/config", expect.anything());
    apiClient.post.mockResolvedValue({ data: { reply: "hi from claude", route: "/v1/x", latencyMs: 12 } });
    await act(() => result.current.send("hello"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/llm/call", { provider: "anthropic", prompt: "hello" });
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/chat", expect.anything());
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "hi from claude" });
  });

  it("an LLM policy denial reads as a denial line, not an error", async () => {
    const { result } = await readyRouted();
    await act(() => result.current.pickPath("llm:anthropic"));
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { code: "llm_policy_denied", reason: "blocked by policy", provider: "anthropic", route: "/v1/x" } },
    });
    await act(() => result.current.send("leak the keys"));
    expect(result.current.messages[1].content).toBe("⚠️ Privilege denied this call. blocked by policy");
    expect(result.current.thinking).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** in `usePrivilegeShellSession.js`:
  1. `import { usePrivilegeRouting } from "../privilege/usePrivilegeRouting";` and, at module level, an adapter (apiClient mocks in tests expose only `get`/`post`):

```js
const request = (path, { method = "GET", body } = {}) =>
  (method === "POST"
    ? apiClient.post(`${API_BASE}${path}`, body)
    : apiClient.get(`${API_BASE}${path}`)
  ).then((r) => r.data);
```
  2. Inside the hook, near the other state: `const routing = usePrivilegeRouting({ request });`.
  3. In the existing mount `/state` effect, right after `if (!alive) return;`, call `routing.hydrate(data);` (use the stable `hydrate`; add it to the effect deps). Add a second small effect: `request("/llm/config").then((c) => routing.setLlmGatewayUrl(c.gatewayUrl || "")).catch(() => {})` (also deps-safe via the stable setter).
  4. Add:

```js
  const afterSwitch = useCallback(async (result, failPrefix) => {
    if (!result.ok) {
      setNotice(`${failPrefix}: ${errText(result.error)}`);
      return;
    }
    if (result.llm) return;
    setTools([]);
    const authed = result.saved?.oauth?.destinationAuthenticated ?? result.saved?.oauth?.authenticated;
    if (!authed) {
      setPhase("signed-out");
      return;
    }
    try {
      await listTools();
    } catch (err) {
      setNotice(errText(err));
    }
  }, [listTools]);

  const pickPath = useCallback(async (key) => {
    setBusy(true);
    setNotice("");
    try {
      await afterSwitch(await routing.selectPath(key), "Gateway switch failed");
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectPath]);

  const pickDoor = useCallback(async (url) => {
    setBusy(true);
    setNotice("");
    try {
      await afterSwitch(await routing.selectDoor(url), "Failed to switch door");
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectDoor]);
```
  5. In `send`, after `setThinking(true);` and before the `/chat` call, branch on `routing.llmPath` (add `routing.llmPath` to `send`'s deps):

```js
      if (routing.llmPath) {
        try {
          const { data } = await apiClient.post(`${API_BASE}/llm/call`, { provider: routing.llmPath, prompt });
          push("assistant", data.reply, { steps: [`${routing.llmPath} · ${data.route} · ${data.latencyMs} ms`] });
        } catch (err) {
          const d = err?.response?.data || {};
          if (d.code === "llm_policy_denied") {
            push("assistant", `⚠️ Privilege denied this call. ${d.reason || errText(err)}`, {
              steps: [`${d.provider || routing.llmPath} · ${d.route || ""} · denied by policy`],
            });
          } else {
            push("assistant", `Error: ${errText(err)}`);
          }
        } finally {
          setThinking(false);
        }
        return;
      }
```
  (Place it inside the existing function so the early `return` leaves the MCP path untouched.) 6. Return `routing: { gatewayMode, config, presets, llmPath, llmGatewayUrl, loaded }` (picked from the hook result), `pickPath`, `pickDoor` in the session object.

- [ ] **Step 4: Run** the session hook tests (old + new all PASS), `PrivilegeShellPanel.test.jsx`, `ShellViews.test.jsx` (their `makeSession` objects don't need routing yet). **Step 5: Commit** `feat(footprint): skin session composes usePrivilegeRouting; LLM path send`.

---

### Task 5: Shared routing UI + VS Code view

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/ShellParts.jsx` (add `ShellRoutingBar`, `ShellToolsList`, `ShellLatestCall`)
- Modify: `demo_api_ui/src/components/aiFootprintMocks/ShellVsCodeView.jsx`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/ShellViews.test.jsx` (extend `makeSession` with routing defaults; add tests)

**Interfaces:**
- Consumes the session additions from Task 4 and `doorName`, `doorsForMode`, `GATEWAY_MODES`, `LLM_PATHS` from `../privilege/privilegeRouting`, `ToolsTable` default export from `../privilege/ToolsTable`.
- Produces:
  - `ShellRoutingBar({ session })`: two `<select>`s. Path: `aria-label="Connection path"`, value `llm:<p>` or the mode key, optgroups "MCP path (tools)" (Direct/Privilege/Façade) and "LLM path (prompt)" (Anthropic/Google/OpenAI), `onChange -> session.pickPath(value)`. Door: `aria-label="MCP backend (door)"`, options from `doorsForMode(routing.presets, routing.gatewayMode)` labelled `doorName(url) || url`, value `routing.config.mcpUrl`, `onChange -> session.pickDoor`; if no doors, render `doorName(routing.config.mcpUrl) || "—"` as text. Both disabled while `session.busy || !routing.loaded`.
  - `ShellToolsList({ session, collapsible = false })`: if `routing.llmPath` -> `<p className="pvs-note">Tools apply to MCP paths.</p>`; else `ToolsTable tools={session.tools} onExecute={session.runTool}` when tools exist, otherwise `<div className="pvs-empty">No tools loaded.</div>` plus a `Load tools` button (`session.retryTools`). `collapsible` wraps it in `<details open><summary>Tools (N)</summary>…</details>`.
  - `ShellLatestCall({ latestCall })`: `null` -> nothing; else `<section aria-label="Latest tool run">` with the tool name, `Success`/`Error`, and `Request`/`Result` `<pre>`s.
- `ShellVsCodeView` renders `ShellRoutingBar` above the chat, `ShellToolsList collapsible` (open) between chat and prompt, and keeps its Tool-output drawer (its inline `latestCall` block may be replaced by `ShellLatestCall`).

- [ ] **Step 1: Failing tests** — in `ShellViews.test.jsx` extend `makeSession` defaults with:

```js
  pickPath: vi.fn(), pickDoor: vi.fn(),
  routing: { gatewayMode: "privilege", config: { mcpUrl: "https://gw.example/privilege-gateway/banking/mcp" }, presets: [
    { mode: "privilege", url: "https://gw.example/privilege-gateway/banking/mcp" },
    { mode: "privilege", url: "https://gw.example/privilege-gateway/other/mcp" },
  ], llmPath: "", llmGatewayUrl: "", loaded: true },
```
and add (VS Code view, new `describe`):

```jsx
describe("routing bar + tools (VS Code)", () => {
  it("lists the three MCP paths and three LLM paths and calls pickPath", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const path = screen.getByRole("combobox", { name: "Connection path" });
    expect(within(path).getAllByRole("option").map((o) => o.textContent)).toEqual(
      ["Direct", "Privilege", "Façade", "Anthropic", "Google", "OpenAI"]);
    fireEvent.change(path, { target: { value: "facade" } });
    expect(session.pickPath).toHaveBeenCalledWith("facade");
  });

  it("lists this mode's doors by name and calls pickDoor", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const door = screen.getByRole("combobox", { name: "MCP backend (door)" });
    expect(within(door).getAllByRole("option").map((o) => o.textContent)).toEqual(["banking", "other"]);
    fireEvent.change(door, { target: { value: "https://gw.example/privilege-gateway/other/mcp" } });
    expect(session.pickDoor).toHaveBeenCalledWith("https://gw.example/privilege-gateway/other/mcp");
  });

  it("disables both selects while a switch is in flight", () => {
    render(<ShellVsCodeView session={makeSession({ busy: true })} />);
    expect(screen.getByRole("combobox", { name: "Connection path" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "MCP backend (door)" })).toBeDisabled();
  });

  it("shows the current door as text when the mode has no presets", () => {
    const session = makeSession({ routing: { ...makeSession().routing, presets: [] } });
    render(<ShellVsCodeView session={session} />);
    expect(screen.queryByRole("combobox", { name: "MCP backend (door)" })).toBeNull();
    expect(screen.getByText("banking")).toBeInTheDocument();
  });

  it("shows tools by default and runs one via runTool", async () => {
    const session = makeSession({
      tools: [{ name: "list_safes", description: "d", inputSchema: { properties: {} } }],
      runTool: vi.fn().mockResolvedValue("{}"),
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByText("list_safes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(session.runTool).toHaveBeenCalledWith("list_safes", expect.any(String)));
  });

  it("hides tools on an LLM path with a note", () => {
    const session = makeSession({
      tools: [{ name: "list_safes", inputSchema: { properties: {} } }],
      routing: { ...makeSession().routing, llmPath: "anthropic" },
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.queryByText("list_safes")).toBeNull();
    expect(screen.getByText("Tools apply to MCP paths.")).toBeInTheDocument();
  });

  it("offers Load tools when none are loaded", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Load tools" }));
    expect(session.retryTools).toHaveBeenCalled();
  });
});
```
(Add `within`, `waitFor` to the test file's testing-library import.)

- [ ] **Step 2: Run to verify FAIL. Step 3: Implement** the three components in `ShellParts.jsx`:

```jsx
import ToolsTable from "../privilege/ToolsTable";
import { doorName, doorsForMode } from "../privilege/privilegeRouting";

export function ShellRoutingBar({ session }) {
  const { routing, busy, pickPath, pickDoor } = session;
  const off = busy || !routing.loaded;
  const doors = doorsForMode(routing.presets, routing.gatewayMode);
  return (
    <div className="pvs-routing">
      <label>
        <span>Path</span>
        <select
          aria-label="Connection path"
          value={routing.llmPath ? `llm:${routing.llmPath}` : routing.gatewayMode}
          disabled={off}
          onChange={(e) => pickPath(e.target.value)}
        >
          <optgroup label="MCP path (tools)">
            <option value="direct">Direct</option>
            <option value="privilege">Privilege</option>
            <option value="facade">Façade</option>
          </optgroup>
          <optgroup label="LLM path (prompt)">
            <option value="llm:anthropic">Anthropic</option>
            <option value="llm:google">Google</option>
            <option value="llm:openai">OpenAI</option>
          </optgroup>
        </select>
      </label>
      <label>
        <span>Door</span>
        {doors.length ? (
          <select
            aria-label="MCP backend (door)"
            value={routing.config.mcpUrl || ""}
            disabled={off}
            onChange={(e) => pickDoor(e.target.value)}
          >
            {doors.map((url) => <option key={url} value={url}>{doorName(url) || url}</option>)}
          </select>
        ) : (
          <span>{doorName(routing.config.mcpUrl) || "—"}</span>
        )}
      </label>
    </div>
  );
}

export function ShellToolsList({ session, collapsible = false }) {
  const { routing, tools, runTool, retryTools, busy } = session;
  let body;
  if (routing.llmPath) {
    body = <p className="pvs-note">Tools apply to MCP paths.</p>;
  } else if (tools.length) {
    body = <ToolsTable tools={tools} onExecute={runTool} />;
  } else {
    body = (
      <div className="pvs-empty">
        No tools loaded.{" "}
        <button type="button" onClick={retryTools} disabled={busy}>Load tools</button>
      </div>
    );
  }
  if (!collapsible) return <div className="pvs-tools">{body}</div>;
  return (
    <details className="pvs-tools" open>
      <summary>Tools ({routing.llmPath ? 0 : tools.length})</summary>
      {body}
    </details>
  );
}

export function ShellLatestCall({ latestCall }) {
  if (!latestCall) return null;
  return (
    <section className="pvs-latest" aria-label="Latest tool run">
      <header>
        <strong>{latestCall.name}</strong> {latestCall.ok ? "Success" : "Error"}
      </header>
      <div><span>Request</span><pre>{latestCall.request}</pre></div>
      <div><span>Result</span><pre>{latestCall.response}</pre></div>
    </section>
  );
}
```
(`ToolsTable` is a default export; if the "Run" button label differs, adjust the test to `ToolsTable.jsx`'s actual label.) CSS (append to `PrivilegeShellViews.css`; colours via `currentColor`/`color-mix` only): `.pvs-routing { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }`, `.pvs-routing label { display:flex; gap:6px; align-items:center; }`, `.pvs-routing select { font:inherit; color:inherit; background:transparent; border:1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius:4px; padding:3px 6px; max-width:100%; }`, `.pvs-routing select:disabled { opacity:0.5; }`, `.pvs-tools { max-height:35%; overflow:auto; }`, `.pvs-note { opacity:0.7; margin:0; }`, `.pvs-latest { border-top:1px solid color-mix(in srgb, currentColor 30%, transparent); font-size:var(--font-size-2xs); } .pvs-latest pre { margin:2px 0; overflow-x:auto; }`. Note: `<select>` option backgrounds follow the OS in dark chrome; do not add colour literals.
  Then `ShellVsCodeView.jsx`: import and render `<ShellRoutingBar session={session} />` first inside `ShellGate`, replace the inline `<details className="pvs-vsc__tools">…ToolsTable…</details>` with `<ShellToolsList session={session} collapsible />`, and replace the drawer's inline `latestCall` block with `<ShellLatestCall latestCall={latestCall} />` (the existing "Tool output" drawer test that expects the tool name in the drawer must still pass).

- [ ] **Step 4: Run** `ShellViews.test.jsx` + the Task 1-4 tests; all PASS. **Step 5: Commit** `feat(footprint): VS Code skin shows Path, Door and tools without typing`.

---

### Task 6: Terminal and Claude Desktop views

**Files:**
- Modify: `ShellTerminalView.jsx`, `ShellDesktopView.jsx`, `PrivilegeShellViews.css`, `__tests__/ShellViews.test.jsx` (all under `demo_api_ui/src/components/aiFootprintMocks/`)

**Interfaces:** Consumes `ShellRoutingBar`, `ShellToolsList`, `ShellLatestCall` from Task 5. Placement: Terminal — bar as the first row inside `ShellGate`, then the log, then `ShellToolsList collapsible`, then `ShellLatestCall`, then the prompt. Desktop — bar as the first row (thread header), then the thread, then `ShellToolsList collapsible`, then `ShellLatestCall`, then the prompt.

- [ ] **Step 1: Failing tests** (same shape as Task 5's, one `describe` per view): for each of `ShellTerminalView` and `ShellDesktopView` assert (a) the `Connection path` and `MCP backend (door)` comboboxes are present and `pickPath`/`pickDoor` are called on change, (b) a tool from `session.tools` is visible and `Run` calls `session.runTool`, (c) with `latestCall: { name: "list_safes", request: "{}", response: '{"ok":true}', ok: true }` the region `Latest tool run` contains `list_safes` and `Success`, (d) the prompt textbox still sends via `session.send`.

- [ ] **Step 2: Run to verify FAIL. Step 3: Implement** the placements above (imports from `./ShellParts`; no new CSS beyond Task 5's classes unless a view needs a spacing rule using `gap` only). **Step 4: Run** `ShellViews.test.jsx` + all Task 1-5 tests (PASS). **Step 5: Commit** `feat(footprint): Terminal and Claude Desktop skins show Path, Door and tools`.

---

### Task 7: Survive-a-switch regression, TECH_DEBT, gates

**Files:**
- Modify: `demo_api_ui/src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx` (add one test)
- Modify: `TECH_DEBT.md` (read its tail; match the dated `###` entry format)

- [ ] **Step 1: Test** — in the existing file, add: render the page on the coding skin with `/state` returning routing data (`gatewayMode:"privilege"`, two presets, config), `pickPath("llm:anthropic")` via changing the `Connection path` select, switch skin to VS Code (Skin dropdown, value `vscode:classic-dark`), and assert the VS Code view's `Connection path` select still has value `llm:anthropic` and `/config` was never posted. It must fail if the routing state were held below the skin boundary (prove it by temporarily moving the `usePrivilegeShellSession()` call into a child component; restore).
- [ ] **Step 2: TECH_DEBT entries:** (a) Cursor `sendChat`'s LLM branch and `usePrivilegeShellSession.send`'s LLM branch both post `/llm/call` and format denials separately; (b) silent `prompt=none` re-auth, re-arm and door probing remain Cursor-only (the skins use the explicit sign-in gate).
- [ ] **Step 3: Gates** (redirect to files, read them): scoped run of `src/components/aiFootprintMocks src/components/privilege src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx src/pages/__tests__/AiFootprintShellPages.test.js` and the full `PrivilegeMcpClientPage.*` family; then full `npm --prefix demo_api_ui run test:unit` and `cd demo_api_ui && npm run build`. Repo ratchets (light-only stylesheet pin, no-`monospace`, themingRatchet) must stay green without raising any pin. Grep gates: no emoji outside the allowlist and no colour/background literals or inline colour styles in the new/changed `Shell*.jsx` and `PrivilegeShellViews.css`.
- [ ] **Step 4: Commit** `test(footprint): routing survives skin switch; docs(tech-debt): Cursor-only re-auth and LLM send duplication`. Do NOT push, open a PR, merge or deploy; those are the controller's call.
