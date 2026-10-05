# Functional Footprint Skins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check for and use applicable skills (`regression-guard`, `generate-tests`, `verify-ai-demo2`) before editing.

**Goal:** Claude Terminal, VS Code and Claude Desktop skins accept a prompt, run the real Privilege agent via `/api/privilege-mcp/chat`, and render the reply and steps in their own idiom; the conversation survives a skin switch.

**Architecture:** One hook `usePrivilegeShellSession` (state moved out of `PrivilegeShellPanel` plus new `messages`/`thinking`/`send`) is called in `FootprintLiveShellPage`, which stays mounted across skin switches (single route `/demo/:shellSlug`). `PrivilegeShellPanel` becomes a dispatcher that renders one of three new view components by `skin`, or its existing body for `chatgpt`/`saas`.

**Tech Stack:** React 19, react-router, vitest + @testing-library/react (not jest), plain CSS.

**Spec:** `docs/superpowers/specs/2026-10-05-skin-shell-session-design.md`

## Global Constraints
- Cursor page `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` is NOT modified.
- Emoji allowlist only (REGRESSION_PLAN §0). Use HTML entities for glyphs like the bullet (`&#9679;`), no other emoji.
- New CSS: no colour/background/font-size literals except `var(--font-size-*)` (floor `--font-size-3xs`); take colour from the chrome via `inherit`/`currentColor`/`color-mix(in srgb, currentColor N%, transparent)`. No inline `style={{}}` for colour, background or font-size. Dark mode is never `prefers-color-scheme`.
- API calls go through `apiClient` (axios) at `/api/privilege-mcp/*`, as `PrivilegeShellPanel` does today.
- Run vitest only via `npm --prefix demo_api_ui run test:unit -- <path>` (never `npx vitest`; a worktree makes npx fetch the wrong major). First verify the runner lists your file; if `test:unit` ignores the path argument, use `cd demo_api_ui && node scripts/run-vitest-with-memory-guard.mjs --reporter=verbose <path>`.
- Stage explicitly (`git add <files>`); verify `git branch --show-current` is `worktree-skin-shell-session` before each commit. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Super Sports is the default vertical for any manual validation.

## Review Focus
- Empty/whitespace prompt: `send("   ")` posts nothing and adds no message.
- `/chat` 400 ("Set MCP URL first."): shown as an assistant error line, not thrown, phase unchanged.
- `/chat` 401: phase returns to `signed-out` with a system line (connect button reappears).
- `/chat` returns `authUrl`: navigates to it, no reply bubble claiming success.
- Reply lands after the skin changed mid-request: transcript keeps the user prompt and shows the reply (Task 5).
- Reply with no `steps`/`decision`/`execution`: renders content only, no crash.

---

### Task 0: Worktree test harness (no commit)

- [ ] **Step 1:** Link deps (worktree is not served, so no stub dir exists).

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/skin-shell-session/demo_api_ui
/bin/ls -d node_modules 2>&1 || ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules node_modules
```

- [ ] **Step 2:** Baseline: `npm --prefix demo_api_ui run test:unit -- src/components/aiFootprintMocks src/pages/__tests__/PrivilegeMcpClientPage.skinPicker.test.jsx` (run from the worktree root). Expected: PASS, and the output names `PrivilegeShellPanel.test.jsx` and `PrivilegeMcpClientPage.skinPicker.test.jsx`.

---

### Task 1: `usePrivilegeShellSession` hook; panel consumes it (no visible change)

**Files:**
- Create: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js`
- Create: `demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/PrivilegeShellPanel.test.jsx`
- Modify: `demo_api_ui/src/pages/FootprintLiveShellPage.jsx`

**Interfaces:**
- Produces `usePrivilegeShellSession()` returning:
  `{ phase: 'loading'|'signed-out'|'ready', scopes: string[], tools: object[], latestCall: {name,request,response,ok}|null, busy: boolean, notice: string, messages: Message[], thinking: boolean, connect(): Promise<void>, retryTools(): Promise<void>, signOut(): Promise<void>, runTool(name, argsStr): Promise<string>, send(text): Promise<void> }`
  where `Message = { id: number, role: 'user'|'assistant'|'system', content: string, steps: string[], decision: object|null, execution: object|null }`.
- Must be called inside a Router (uses `useLocation`, `useSearchParams`).
- `PrivilegeShellPanel({ skin, session })` — `session` is required after this task.

- [ ] **Step 1: Write the failing hook tests**

```jsx
// demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { usePrivilegeShellSession } from "../usePrivilegeShellSession";
import apiClient from "../../../services/apiClient";

vi.mock("../../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const wrapper = ({ children }) => (
  <MemoryRouter initialEntries={["/demo/coding-agent"]}>{children}</MemoryRouter>
);

async function ready() {
  apiClient.get.mockResolvedValue({
    data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "list_safes" }] },
  });
  const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  return hook;
}

describe("usePrivilegeShellSession.send", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores a blank prompt", async () => {
    const { result } = await ready();
    await act(() => result.current.send("   "));
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("posts the prompt and records user + assistant messages", async () => {
    const { result } = await ready();
    apiClient.post.mockResolvedValue({
      data: { reply: "Found 1 tool", steps: ["mcp_initialized"], decision: { tool: "list_safes" }, execution: { ok: true } },
    });
    await act(() => result.current.send("list safes"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/chat", { prompt: "list safes" });
    expect(result.current.messages).toMatchObject([
      { role: "user", content: "list safes" },
      { role: "assistant", content: "Found 1 tool", steps: ["mcp_initialized"], decision: { tool: "list_safes" }, execution: { ok: true } },
    ]);
    expect(result.current.thinking).toBe(false);
  });

  it("tolerates a reply with no steps, decision or execution", async () => {
    const { result } = await ready();
    apiClient.post.mockResolvedValue({ data: {} });
    await act(() => result.current.send("hi"));
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "Done.", steps: [], decision: null, execution: null });
  });

  it("shows a 400 as an assistant error line and keeps the phase", async () => {
    const { result } = await ready();
    apiClient.post.mockRejectedValue({ response: { status: 400, data: { error: "Set MCP URL first." } } });
    await act(() => result.current.send("hi"));
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "Error: Set MCP URL first." });
    expect(result.current.phase).toBe("ready");
  });

  it("returns to signed-out on a 401", async () => {
    const { result } = await ready();
    apiClient.post.mockRejectedValue({ response: { status: 401, data: { error: "Not authenticated." } } });
    await act(() => result.current.send("hi"));
    expect(result.current.phase).toBe("signed-out");
    expect(result.current.messages[1]).toMatchObject({ role: "system", content: "Sign in is required to access the gateway." });
  });

  it("navigates to authUrl instead of claiming a reply", async () => {
    const { result } = await ready();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    apiClient.post.mockResolvedValue({ data: { reply: "Please complete OAuth login first.", authUrl: "https://auth.example/a", steps: ["oauth_required"] } });
    await act(() => result.current.send("hi"));
    expect(assign).toHaveBeenCalledWith("https://auth.example/a");
    expect(result.current.messages[1]).toMatchObject({ role: "system", content: "Opening sign-in…" });
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (`Failed to resolve import "../usePrivilegeShellSession"`).

- [ ] **Step 3: Create the hook** — move the state, `listTools`, mount effect, `connect`, `runTool`, `retryTools`, `signOut` verbatim from `PrivilegeShellPanel.jsx` (lines for `useState`s, `listTools`, the `/state` `useEffect`, `connect`, `runTool`, `retryTools`, `signOut`), then add messages/send.

```js
// demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js
// Privilege MCP client session shared by every footprint costume: sign-in state,
// discovered tools, the latest tool run, and the chat transcript. Lives in
// FootprintLiveShellPage (one route for all skins) so a skin switch keeps it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";

const API_BASE = "/api/privilege-mcp";

export function errText(err) {
  return err?.response?.data?.error || err?.message || "Request failed";
}

export function usePrivilegeShellSession() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState("loading"); // loading | signed-out | ready
  const [scopes, setScopes] = useState([]);
  const [tools, setTools] = useState([]);
  const [latestCall, setLatestCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const [notice, setNotice] = useState(() => {
    if (searchParams.get("auth") !== "error") return "";
    return `OAuth failed: ${searchParams.get("reason") || "unknown"}`;
  });

  const listTools = useCallback(async () => {
    const { data } = await apiClient.post(`${API_BASE}/tools/list`);
    setTools(data.tools || []);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    apiClient
      .get(`${API_BASE}/state`)
      .then(async ({ data }) => {
        if (!alive) return;
        if (data.oauth?.scope) {
          setScopes(String(data.oauth.scope).split(" ").filter(Boolean));
        }
        if (!data.oauth?.authenticated) {
          setPhase("signed-out");
          return;
        }
        if (data.tools?.length) {
          setTools(data.tools);
          setPhase("ready");
          return;
        }
        await listTools();
      })
      .catch((err) => {
        if (!alive) return;
        setNotice(errText(err));
        setPhase("signed-out");
      });
    return () => {
      alive = false;
    };
  }, [listTools]);

  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await apiClient.post(`${API_BASE}/auth/start`, {
        returnTo: location.pathname,
      });
      window.location.assign(data.authUrl);
    } catch (err) {
      setNotice(errText(err));
      setBusy(false);
    }
  };

  const runTool = async (name, argsStr) => {
    const request = argsStr || "{}";
    try {
      const parsed = JSON.parse(request);
      const { data } = await apiClient.post(`${API_BASE}/tools/call`, {
        name,
        arguments: parsed,
      });
      const response = JSON.stringify(data, null, 2);
      setLatestCall({ name, request, response, ok: !data?.error && !data?.result?.isError });
      return response;
    } catch (err) {
      const response = JSON.stringify({ error: errText(err) }, null, 2);
      setLatestCall({ name, request, response, ok: false });
      return response;
    }
  };

  const retryTools = async () => {
    setBusy(true);
    setNotice("");
    try {
      await listTools();
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await apiClient.post(`${API_BASE}/auth/logout`);
    } catch {
      /* ignore — clear locally regardless */
    }
    setTools([]);
    setScopes([]);
    setLatestCall(null);
    setPhase("signed-out");
    setBusy(false);
  };

  const push = useCallback((role, content, extra = {}) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role, content, steps: [], decision: null, execution: null, ...extra },
    ]);
  }, []);

  const send = useCallback(
    async (text) => {
      const prompt = String(text || "").trim();
      if (!prompt) return;
      push("user", prompt);
      setThinking(true);
      try {
        const { data } = await apiClient.post(`${API_BASE}/chat`, { prompt });
        if (data.authUrl) {
          push("system", "Opening sign-in…");
          window.location.assign(data.authUrl);
          return;
        }
        push("assistant", data.reply || "Done.", {
          steps: data.steps || [],
          decision: data.decision || null,
          execution: data.execution || null,
        });
        if (data.tools) {
          setTools(data.tools);
          setPhase("ready");
        }
      } catch (err) {
        if (err?.response?.status === 401) {
          setPhase("signed-out");
          push("system", "Sign in is required to access the gateway.");
        } else {
          push("assistant", `Error: ${errText(err)}`);
        }
      } finally {
        setThinking(false);
      }
    },
    [push],
  );

  return {
    phase, scopes, tools, latestCall, busy, notice, messages, thinking,
    connect, retryTools, signOut, runTool, send,
  };
}
```

(`listTools` through `signOut` are cut from `PrivilegeShellPanel.jsx` and pasted here unchanged.)

- [ ] **Step 4: Refactor `PrivilegeShellPanel`** to `export function PrivilegeShellPanel({ skin = "vscode", session })`: delete the moved state/effects/functions and `errText`/`API_BASE`/unused imports; destructure `const { phase, scopes, tools, latestCall, busy, notice, connect, retryTools, signOut, runTool } = session;` and keep only `pvsTheme` local state and the JSX unchanged.

- [ ] **Step 5: Wire the page.** In `FootprintLiveShellPage.jsx` add `import { usePrivilegeShellSession } from "../components/aiFootprintMocks/usePrivilegeShellSession";`, call `const session = usePrivilegeShellSession();` after `useFootprintTheme()`, and render `<PrivilegeShellPanel skin={...} session={session} />`.

- [ ] **Step 6: Adapt the existing panel tests.** In `PrivilegeShellPanel.test.jsx` replace `renderPanel` with a harness so the 3 existing tests stay unchanged otherwise:

```jsx
import { usePrivilegeShellSession } from "../usePrivilegeShellSession";

function Harness({ skin }) {
  const session = usePrivilegeShellSession();
  return <PrivilegeShellPanel skin={skin} session={session} />;
}

function renderPanel(path = "/demo/coding-agent", skin = "coding") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness skin={skin} />
    </MemoryRouter>,
  );
}
```

Note: after Task 2 `skin="coding"` renders the terminal view, which would break these tests; change the harness default to `skin = "chatgpt"` here and the `/demo/chatgpt-desktop` path, keeping the legacy body under test. Update the `returnTo` expectation in the sign-in test to the path you pass.

- [ ] **Step 7: Run** hook tests + panel tests + skinPicker test. Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx demo_api_ui/src/components/aiFootprintMocks/__tests__/PrivilegeShellPanel.test.jsx demo_api_ui/src/pages/FootprintLiveShellPage.jsx
git commit -m "refactor(footprint): lift Privilege shell state into usePrivilegeShellSession, add chat send"
```

---

### Task 2: Shared parts + Terminal view (Claude Terminal skin)

**Files:**
- Create: `demo_api_ui/src/components/aiFootprintMocks/ShellParts.jsx`
- Create: `demo_api_ui/src/components/aiFootprintMocks/ShellTerminalView.jsx`
- Create: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css`
- Create: `demo_api_ui/src/components/aiFootprintMocks/__tests__/ShellViews.test.jsx`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx` (dispatch)

**Interfaces:**
- Consumes: `session` from Task 1.
- Produces `ShellGate({ session, children })`: renders notice, loading text, or the connect button (`Sign in with Privilege`, calls `session.connect`) per `session.phase`; renders `children` only when `phase === "ready"`.
- Produces `ShellPrompt({ session, placeholder, className })`: `<form>` with one text input (`aria-label="Prompt"`) and submit; on submit calls `session.send(value)` and clears; input and button disabled while `session.thinking`.
- Produces `ShellSteps({ steps })`: `<ul>` of step strings; renders nothing for `[]`.
- Produces `ShellTerminalView({ session })`, root `data-testid="pvs-terminal"`.

- [ ] **Step 1: Failing tests** (create `ShellViews.test.jsx`; Tasks 3 and 4 append to it). Use a plain session factory, no network:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { ShellTerminalView } from "../ShellTerminalView";

export const makeSession = (over = {}) => ({
  phase: "ready", scopes: [], tools: [], latestCall: null, busy: false, notice: "",
  messages: [], thinking: false,
  connect: vi.fn(), retryTools: vi.fn(), signOut: vi.fn(), runTool: vi.fn(), send: vi.fn(),
  ...over,
});

describe("ShellTerminalView", () => {
  it("submits the typed prompt via session.send and clears the box", () => {
    const session = makeSession();
    render(<ShellTerminalView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "find transfer scope checks" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("find transfer scope checks");
    expect(box).toHaveValue("");
  });

  it("renders user line, step lines and the reply", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Found 2 tools", steps: ["mcp_initialized", "tools_discovered:2"], decision: null, execution: { ok: true } },
      ],
    });
    render(<ShellTerminalView session={session} />);
    const log = screen.getByRole("log", { name: "Terminal" });
    expect(log).toHaveTextContent("list safes");
    expect(log).toHaveTextContent("tools_discovered:2");
    expect(log).toHaveTextContent("Found 2 tools");
    expect(log).toHaveTextContent('"ok": true');
  });

  it("offers sign-in when signed out and hides the prompt", () => {
    const session = makeSession({ phase: "signed-out" });
    render(<ShellTerminalView session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Privilege" }));
    expect(session.connect).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  });

  it("disables the prompt while a reply is pending", () => {
    render(<ShellTerminalView session={makeSession({ thinking: true })} />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (missing modules).

- [ ] **Step 3: Implement.**

```jsx
// ShellParts.jsx
import { useState } from "react";

export function ShellGate({ session, children }) {
  const { phase, notice, connect, busy } = session;
  return (
    <>
      {notice ? <div className="pvs-notice">{notice}</div> : null}
      {phase === "loading" ? <div className="pvs-empty">Checking Privilege session…</div> : null}
      {phase === "signed-out" ? (
        <div className="pvs-connect">
          <p>Connect this tool to the AI Agent Gateway to discover tools.</p>
          <button type="button" onClick={connect} disabled={busy}>Sign in with Privilege</button>
        </div>
      ) : null}
      {phase === "ready" ? children : null}
    </>
  );
}

export function ShellPrompt({ session, placeholder = "Ask the agent…", className = "" }) {
  const [value, setValue] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || session.thinking) return;
    session.send(value);
    setValue("");
  };
  return (
    <form className={`pvs-prompt ${className}`} onSubmit={submit}>
      <input
        aria-label="Prompt"
        value={value}
        placeholder={placeholder}
        disabled={session.thinking}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" disabled={session.thinking || !value.trim()}>Send</button>
    </form>
  );
}

export function ShellSteps({ steps }) {
  if (!steps?.length) return null;
  return <ul className="pvs-steps">{steps.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}</ul>;
}
```

```jsx
// ShellTerminalView.jsx
import { ShellGate, ShellPrompt } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellTerminalView({ session }) {
  const { messages, thinking } = session;
  return (
    <div className="pvs pvs--coding pvs-term" data-testid="pvs-terminal">
      <ShellGate session={session}>
        <div className="pvs-term__log" role="log" aria-label="Terminal">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="pvs-term__you">&gt; {m.content}</div>
            ) : (
              <div key={m.id} className={`pvs-term__out pvs-term__out--${m.role}`}>
                {m.steps.map((s, i) => (
                  <div key={`${i}-${s}`} className="pvs-term__tool">&#9679; {s}</div>
                ))}
                {m.execution ? <pre className="pvs-term__res">{JSON.stringify(m.execution, null, 2)}</pre> : null}
                <div>{m.content}</div>
              </div>
            ),
          )}
          {thinking ? <div className="pvs-term__tool">&#9679; thinking…</div> : null}
        </div>
        <ShellPrompt session={session} className="pvs-term__prompt" />
      </ShellGate>
    </div>
  );
}
```

```css
/* PrivilegeShellViews.css — shared by the three chat-capable costume views.
   Colour comes from the surrounding chrome (inherit/currentColor), never the
   page theme: costume variants set their own brightness. */
.pvs-prompt { display: flex; gap: 6px; }
.pvs-prompt input {
  flex: 1; min-width: 0; font: inherit; color: inherit; background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px; padding: 6px 8px;
}
.pvs-prompt button {
  font: inherit; color: inherit; background: color-mix(in srgb, currentColor 10%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px; padding: 6px 10px; cursor: pointer;
}
.pvs-prompt button:disabled, .pvs-prompt input:disabled { opacity: 0.5; cursor: default; }
.pvs-steps { margin: 0; padding-left: 16px; opacity: 0.75; font-size: var(--font-size-2xs); }

.pvs-term__log { flex: 1; min-height: 0; overflow-y: auto; font-family: ui-monospace, monospace; white-space: pre-wrap; }
.pvs-term__you { font-weight: 600; margin-top: 8px; }
.pvs-term__tool { opacity: 0.75; }
.pvs-term__res {
  margin: 2px 0 2px 12px; padding: 4px 6px; overflow-x: auto;
  border-left: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  font-size: var(--font-size-2xs);
}
.pvs-term__out--system { opacity: 0.7; font-style: italic; }
.pvs-term__prompt input { font-family: ui-monospace, monospace; }
```

- [ ] **Step 4: Dispatch in the panel.** At the top of `PrivilegeShellPanel` after destructuring, before the legacy `return`:

```jsx
if (skin === "coding") return <ShellTerminalView session={session} />;
```
plus `import { ShellTerminalView } from "./ShellTerminalView";`. Hooks (`useState` for `pvsTheme`) must stay above this early return — place the `if` after all hooks.

- [ ] **Step 5: Run** `ShellViews.test.jsx` + Task 1 tests. Expected PASS.

- [ ] **Step 6: Commit** (`git add` the 5 files above; message `feat(footprint): Claude Terminal skin runs the agent from a prompt line`).

---

### Task 3: VS Code view

**Files:**
- Create: `demo_api_ui/src/components/aiFootprintMocks/ShellVsCodeView.jsx`
- Modify: `PrivilegeShellViews.css`, `PrivilegeShellPanel.jsx` (add `if (skin === "vscode") return <ShellVsCodeView session={session} />;`), `__tests__/ShellViews.test.jsx`

**Interfaces:** Consumes `ShellGate`, `ShellPrompt`, `ShellSteps`, `ToolsTable` (`../privilege/ToolsTable`, props `tools`, `onExecute`). Produces `ShellVsCodeView({ session })`, root `data-testid="pvs-vscode"`: a chat panel (`role="log" aria-label="Chat"`), a collapsible Tools `<details>` containing `ToolsTable` wired to `session.runTool`, and a drawer `<section aria-label="Tool output">` listing the steps and execution JSON of every assistant message plus `latestCall`.

- [ ] **Step 1: Failing tests** (append to `ShellViews.test.jsx`):

```jsx
import { ShellVsCodeView } from "../ShellVsCodeView";

describe("ShellVsCodeView", () => {
  it("sends from the chat box", () => {
    const session = makeSession();
    render(<ShellVsCodeView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "list safes" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("list safes");
  });

  it("puts the reply in chat and steps + execution in the tool-output drawer", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Found 2 tools", steps: ["tools_discovered:2"], decision: null, execution: { ok: true } },
      ],
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("Found 2 tools");
    const drawer = screen.getByRole("region", { name: "Tool output" });
    expect(drawer).toHaveTextContent("tools_discovered:2");
    expect(drawer).toHaveTextContent('"ok": true');
  });

  it("shows the latest tool run from the Tools table in the drawer", () => {
    const session = makeSession({
      latestCall: { name: "list_safes", request: "{}", response: '{"safes":[]}', ok: true },
    });
    render(<ShellVsCodeView session={session} />);
    expect(screen.getByRole("region", { name: "Tool output" })).toHaveTextContent("list_safes");
  });
});
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement.**

```jsx
// ShellVsCodeView.jsx
import ToolsTable from "../privilege/ToolsTable";
import { ShellGate, ShellPrompt, ShellSteps } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellVsCodeView({ session }) {
  const { messages, thinking, tools, latestCall, runTool } = session;
  const withOutput = messages.filter((m) => m.role === "assistant" && (m.steps.length || m.execution));
  return (
    <div className="pvs pvs--vscode pvs-vsc" data-testid="pvs-vscode">
      <ShellGate session={session}>
        <div className="pvs-vsc__chat" role="log" aria-label="Chat">
          {messages.map((m) => (
            <div key={m.id} className={`pvs-vsc__msg pvs-vsc__msg--${m.role}`}>
              <strong>{m.role === "user" ? "You" : m.role === "assistant" ? "Copilot" : "System"}</strong>
              <div>{m.content}</div>
            </div>
          ))}
          {thinking ? <div className="pvs-vsc__msg">Working…</div> : null}
        </div>
        <ShellPrompt session={session} placeholder="Ask Copilot…" />
        {tools.length ? (
          <details className="pvs-vsc__tools">
            <summary>Tools ({tools.length})</summary>
            <ToolsTable tools={tools} onExecute={runTool} />
          </details>
        ) : null}
        <section className="pvs-vsc__drawer" aria-label="Tool output">
          <header>TOOL OUTPUT</header>
          {withOutput.map((m) => (
            <div key={m.id}>
              <ShellSteps steps={m.steps} />
              {m.execution ? <pre>{JSON.stringify(m.execution, null, 2)}</pre> : null}
            </div>
          ))}
          {latestCall ? (
            <div>
              <strong>{latestCall.name}</strong> {latestCall.ok ? "ok" : "error"}
              <pre>{latestCall.response}</pre>
            </div>
          ) : null}
        </section>
      </ShellGate>
    </div>
  );
}
```

CSS (append): `.pvs-vsc__chat { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }`, `.pvs-vsc__msg strong { font-size: var(--font-size-2xs); opacity: 0.7; }`, `.pvs-vsc__msg--user { align-self: flex-end; background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 6px; padding: 4px 8px; }`, `.pvs-vsc__drawer { border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent); max-height: 30%; overflow: auto; font-family: ui-monospace, monospace; font-size: var(--font-size-2xs); }`, `.pvs-vsc__drawer header { opacity: 0.6; padding: 2px 0; }`, `.pvs-vsc__drawer pre { margin: 2px 0; overflow-x: auto; }`.

- [ ] **Step 4: Dispatch line in panel; run tests (PASS); commit** `feat(footprint): VS Code skin chat panel with tool-output drawer`.

---

### Task 4: Claude Desktop view

**Files:** Create `ShellDesktopView.jsx`; modify `PrivilegeShellViews.css`, `PrivilegeShellPanel.jsx` (`if (skin === "claude-desktop") return <ShellDesktopView session={session} />;`), `__tests__/ShellViews.test.jsx`.

**Interfaces:** Produces `ShellDesktopView({ session })`, root `data-testid="pvs-desktop"`: message thread (`role="log" aria-label="Conversation"`); each assistant message with `decision` or `execution` renders a tool card `<article aria-label="Tool call">` (tool name from `decision.tool`, else "Tool call"; body = execution JSON) and a collapsed `<details><summary>Steps</summary>` with `ShellSteps`.

- [ ] **Step 1: Failing tests:**

```jsx
import { ShellDesktopView } from "../ShellDesktopView";

describe("ShellDesktopView", () => {
  it("renders a tool-call card for a decision/execution and the reply bubble", () => {
    const session = makeSession({
      messages: [
        { id: 1, role: "user", content: "list safes", steps: [], decision: null, execution: null },
        { id: 2, role: "assistant", content: "Here are the safes", steps: ["tools_discovered:2"], decision: { tool: "list_safes" }, execution: { ok: true } },
      ],
    });
    render(<ShellDesktopView session={session} />);
    const thread = screen.getByRole("log", { name: "Conversation" });
    expect(thread).toHaveTextContent("Here are the safes");
    const card = screen.getByRole("article", { name: "Tool call" });
    expect(card).toHaveTextContent("list_safes");
    expect(card).toHaveTextContent('"ok": true');
  });

  it("renders a plain reply with no card", () => {
    const session = makeSession({
      messages: [{ id: 1, role: "assistant", content: "Hi", steps: [], decision: null, execution: null }],
    });
    render(<ShellDesktopView session={session} />);
    expect(screen.queryByRole("article", { name: "Tool call" })).toBeNull();
  });

  it("sends from the message box", () => {
    const session = makeSession();
    render(<ShellDesktopView session={session} />);
    const box = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.submit(box.closest("form"));
    expect(session.send).toHaveBeenCalledWith("hello");
  });
});
```

- [ ] **Step 2: FAIL. Step 3: Implement.**

```jsx
// ShellDesktopView.jsx
import { ShellGate, ShellPrompt, ShellSteps } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellDesktopView({ session }) {
  const { messages, thinking } = session;
  return (
    <div className="pvs pvs--claude-desktop pvs-desk" data-testid="pvs-desktop">
      <ShellGate session={session}>
        <div className="pvs-desk__thread" role="log" aria-label="Conversation">
          {messages.map((m) => (
            <div key={m.id} className={`pvs-desk__msg pvs-desk__msg--${m.role}`}>
              {m.decision || m.execution ? (
                <article className="pvs-desk__card" aria-label="Tool call">
                  <header>{m.decision?.tool || "Tool call"}</header>
                  {m.execution ? <pre>{JSON.stringify(m.execution, null, 2)}</pre> : null}
                </article>
              ) : null}
              <div className="pvs-desk__bubble">{m.content}</div>
              {m.steps.length ? (
                <details><summary>Steps</summary><ShellSteps steps={m.steps} /></details>
              ) : null}
            </div>
          ))}
          {thinking ? <div className="pvs-desk__bubble">Thinking…</div> : null}
        </div>
        <ShellPrompt session={session} placeholder="Message Claude…" />
      </ShellGate>
    </div>
  );
}
```

CSS (append): `.pvs-desk__thread { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }`, `.pvs-desk__msg--user { align-self: flex-end; max-width: 80%; }`, `.pvs-desk__msg--user .pvs-desk__bubble { background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 12px; padding: 6px 12px; }`, `.pvs-desk__card { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px; padding: 6px 10px; margin-bottom: 6px; }`, `.pvs-desk__card header { font-weight: 600; font-size: var(--font-size-2xs); }`, `.pvs-desk__card pre { margin: 4px 0 0; overflow-x: auto; font-size: var(--font-size-2xs); }`.

- [ ] **Step 4: dispatch line; run tests (PASS); commit** `feat(footprint): Claude Desktop skin conversation thread with tool-call cards`.

---

### Task 5: Survive-a-switch test, TECH_DEBT, full gates

**Files:**
- Create: `demo_api_ui/src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx`
- Modify: `TECH_DEBT.md` (append one entry)

- [ ] **Step 1: Test** (should pass on first run because the hook lives in the page — a failing run means the hook was placed below the skin boundary):

```jsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FootprintLiveShellPage from "../FootprintLiveShellPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

it("keeps the transcript and lands a pending reply after a skin switch", async () => {
  apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "t" }] } });
  let resolveChat;
  apiClient.post.mockImplementation(() => new Promise((r) => { resolveChat = r; }));
  localStorage.clear();

  render(
    <MemoryRouter initialEntries={["/demo/coding-agent?v=claude-code"]}>
      <Routes>
        <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
      </Routes>
    </MemoryRouter>,
  );

  const box = await screen.findByRole("textbox", { name: "Prompt" });
  fireEvent.change(box, { target: { value: "list safes" } });
  fireEvent.submit(box.closest("form"));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/chat", { prompt: "list safes" }));

  // Switch to VS Code while the reply is still pending.
  fireEvent.change(screen.getByRole("combobox", { name: "Skin" }), { target: { value: "vscode:classic-dark" } });
  expect(await screen.findByTestId("pvs-vscode")).toBeInTheDocument();
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("list safes");

  await act(async () => resolveChat({ data: { reply: "Found 1 tool", steps: [] } }));
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("Found 1 tool");
});
```

- [ ] **Step 2: Run, verify PASS.** Then prove it fails without the fix: temporarily move the `usePrivilegeShellSession()` call into a child component, re-run, confirm FAIL, revert.

- [ ] **Step 3: TECH_DEBT entry** — append (match the file's existing entry format; read its tail first):
"Cursor page (`PrivilegeMcpClientPage.jsx` `sendChat`) and `usePrivilegeShellSession.send` both post `/api/privilege-mcp/chat` and normalize the reply separately; Cursor wasn't moved onto the hook to avoid regression risk on a protected page."

- [ ] **Step 4: Gates** (state which scope ran):
  - `npm --prefix demo_api_ui run test:unit` (UI changed; full unit suite) → paste result line.
  - `cd demo_api_ui && npm run build` → success.
  - Emoji/theming check: `grep -nP "[\x{1F300}-\x{1FAFF}]" demo_api_ui/src/components/aiFootprintMocks/Shell*.jsx demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css` → no output; and `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(|style=\{\{" demo_api_ui/src/components/aiFootprintMocks/Shell*.jsx demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css` → no output.

- [ ] **Step 5: Live drive** (after merge+deploy-live, or `npm run serve:worktree here` after checking its status). Pin `gen="$(npm run -s stack:generation)"`; open `https://local.ping-devops.com:4000/demo/coding-agent?v=claude-code`, sign in, send "list tools", switch to VS Code then Claude Desktop via the Skin dropdown, confirm transcript persists; `npm run -s stack:generation -- --check "$gen"` must exit 0 or the run is void. Read computed colours with `getComputedStyle` on each view's root, not the stylesheet.

- [ ] **Step 6: Commit** `test(footprint): transcript survives skin switch; docs(tech-debt): chat normalization duplicated`, push the branch, open ONE PR (`gh auth status` first), `gh pr checks --watch` once.
