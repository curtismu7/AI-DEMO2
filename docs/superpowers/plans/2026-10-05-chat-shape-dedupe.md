# Chat Message-Shape De-duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check for and use applicable skills (`regression-guard`, `generate-tests`, `verify-ai-demo2`) before editing.

**Goal:** The Cursor page's `sendChat` and the footprint skins' `send` build their chat messages (LLM reply, LLM denial, `/chat` reply) from one shared module instead of duplicating the shapes, with zero behaviour change on either side.

**Architecture:** Pin the Cursor page's current `sendChat` output with characterization tests first (none exist). Add a small pure module `privilegeChat.js` that owns the message shapes. Cursor (protected, own commit) and then the skins adopt it. Control flow (page state / auth-challenge modal vs session phases / `connect()`) intentionally stays per-surface; the generic LLM error wording stays different per surface.

**Tech Stack:** React 19, vitest + @testing-library/react (not jest).

**Spec:** the approved design in the conversation ("What's actually duplicated" table); tech-debt entries `2026-10-05 — Privilege chat reply normalization…` and `2026-10-05 — Cursor LLM send and the shell hook's LLM send…` in `TECH_DEBT.md`.

## Global Constraints
- Work only in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/chat-shape-dedupe` (branch `worktree-chat-shape-dedupe`); never `cd` to the main checkout. `demo_api_ui/node_modules` is already symlinked.
- **Git is broken on this machine** (`/usr/bin/git` needs the Xcode license). Run EVERY git command through the wrapper `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/3d5609b9-139e-4e3f-baf6-adfa42e5196c/scratchpad/xgit.sh <git args>` (e.g. `…/xgit.sh status --short`). One git invocation per Bash call; no `$VAR` git forms. Stage files explicitly (`add <files>`), never `add -A`; check `…/xgit.sh rev-parse --abbrev-ref HEAD` prints `worktree-chat-shape-dedupe` before each commit.
- **Run tests with the project's own vitest, not the npm wrapper** (its memory guard dies on `ps` here): `cd demo_api_ui && ./node_modules/.bin/vitest run <paths relative to demo_api_ui>`. Redirect output to a file and read it; never conclude from a piped exit status.
- Commit trailer must be LITERALLY `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` whatever model you are.
- `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` is protected (REGRESSION_PLAN §0-§1): behaviour-preserving edits only, each in its own commit, no drive-by cleanup, every existing `PrivilegeMcpClientPage.*` test passes UNMODIFIED.
- Emoji allowlist only (`⚠️` and `❌` are allowed). No new CSS in this plan.
- Super Sports is the default vertical for any manual validation.

## Review Focus
- Every message the Cursor page produces for the LLM success / denial / `/chat` reply paths is byte-identical before and after (content AND extra object).
- A denial from the skins' axios-shaped errors (`err.response.data.{code,reason,provider,route}`) still reads exactly `⚠️ Privilege denied this call. <reason>` with the same step string.
- The skins' generic LLM error (`Error: <msg>`, no steps) and Cursor's (`❌ <msg>` + `<provider> · call failed` step) are NOT changed.
- The skins' message objects keep `steps`, `decision`, `execution`; extra keys must not break any skin view or test.

---

### Task 1: Characterization tests for Cursor's `sendChat` (green on the UNMODIFIED page)

**Files:**
- Create: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.chatSend.test.jsx`

**Interfaces:** none (tests only). Do NOT edit `PrivilegeMcpClientPage.jsx` or any existing test.

Read `PrivilegeMcpClientPage.noAutoDiscover.test.jsx` and `PrivilegeMcpClientPage.gatewaySwitch.test.jsx` first and copy their harness style (global `fetch` mock returning `{ok, status, text: async () => JSON}`; `MemoryRouter`; `apiClient` mocked with never-resolving get/post). Facts about the page (from `PrivilegeMcpClientPage.jsx` `sendChat`, ~L1344):
- Composer: `<textarea placeholder="Ask the agent... (Cmd+Enter to send)">` and a send button `aria-label="Send message"` in the Agent Chat tab (Demo view, default). Messages render as `.cur-msg` with a `cur-msg--user|assistant|system` modifier.
- The Path `<select aria-label="Connection path">` (value `llm:anthropic` etc.) lives in the connection rail; choosing an `llm:` value only sets `llmPath` (no `/config` write).
- LLM branch: `POST /api/privilege-mcp/llm/call {provider, prompt}`. Success -> assistant message `data.reply` with step `` `${provider} · ${route} · ${latencyMs} ms` ``. A rejected call with `code === 'llm_policy_denied'` -> `⚠️ Privilege denied this call. <reason||message>` with step `` `${provider||llmPath} · ${route||''} · denied by policy` ``. Any other error -> `❌ <message>` with step `` `${llmPath} · call failed` ``.
- MCP branch: `POST /api/privilege-mcp/config` (body = config) then `POST /api/privilege-mcp/chat {prompt}`. Reply -> assistant `data.reply || 'Done.'` with extra `{available_tools, suggested_tools, policy, decision, execution, steps}`; a thrown error that is not an auth challenge -> `Error: <message>`.
- Find how `steps` and the text render in the message list (read lines ~2393-2425) and assert on what is rendered; assert on the exact content strings above.

- [ ] **Step 1:** Write tests, each one with its own `fetch` routing for `/state` (authenticated, `gatewayMode: "privilege"`, a `config.mcpUrl`, `presets: []`, `tools: []`), `/llm/config` (`{gatewayUrl:"https://llm.example"}`), `/config`, `/chat`, `/llm/call`:
  1. LLM success: choose `Connection path` = `llm:anthropic`, send "hello"; assistant shows `hi from claude` and the step `anthropic · /v1/x · 12 ms`; `/chat` and `/config` were never called.
  2. LLM denial: `/llm/call` answers `403 {error:"denied", code:"llm_policy_denied", reason:"blocked by policy", provider:"anthropic", route:"/v1/x"}`; assistant shows `⚠️ Privilege denied this call. blocked by policy` and the step `anthropic · /v1/x · denied by policy`.
  3. LLM other error: `/llm/call` answers `502 {error:"bad gateway"}`; assistant shows `❌ bad gateway` and the step `anthropic · call failed`.
  4. `/chat` reply: `/chat` answers `{reply:"Found 2 tools", tools:[{name:"a"},{name:"b"}], steps:["mcp_initialized"], decision:{tool:"a", outcome:"ALLOWED"}, execution:{ok:true}}`; assistant shows `Found 2 tools`; the request body to `/chat` is `{prompt:"hello"}`.
  5. `/chat` default text: `/chat` answers `{}`; assistant shows `Done.`.
  6. `/chat` failure: `/chat` answers `500 {error:"boom"}`; assistant shows `Error: boom`.
- [ ] **Step 2:** Run the new file against the UNMODIFIED page: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/PrivilegeMcpClientPage.chatSend.test.jsx > <file> 2>&1` — all 6 PASS. If one fails because the test is wrong, fix the TEST (never the page) until it describes current behaviour; report any behaviour you found surprising.
- [ ] **Step 3:** Prove the tests bite: temporarily change one literal in the page (e.g. `'Done.'` -> `'Done!'` and the denial text), confirm those tests FAIL, restore (`git diff` on the page must be empty afterwards).
- [ ] **Step 4:** Commit only the new test file: `test(privilege): characterize Cursor sendChat message output (LLM reply/denial/error, /chat reply)`.

---

### Task 2: Shared message-shape module

**Files:**
- Create: `demo_api_ui/src/components/privilege/privilegeChat.js`
- Create: `demo_api_ui/src/components/privilege/__tests__/privilegeChat.test.js`

**Interfaces:**
- Produces named exports: `LLM_POLICY_DENIED` (`'llm_policy_denied'`), `chatReplyMessage(data) -> { content: string, extra: { available_tools: string[], suggested_tools: any[], policy: any|null, decision: any|null, execution: any|null, steps: any[] } }`, `llmReplyMessage(provider, data) -> { content: any, extra: { steps: [string] } }`, `llmDenialMessage(provider, details) -> { content: string, extra: { steps: [string] } }` where `details` is any object with optional `reason`, `message`, `provider`, `route`.

- [ ] **Step 1: Failing tests**

```js
// demo_api_ui/src/components/privilege/__tests__/privilegeChat.test.js
import { chatReplyMessage, llmReplyMessage, llmDenialMessage, LLM_POLICY_DENIED } from "../privilegeChat";

describe("chatReplyMessage", () => {
  it("shapes a full /chat reply", () => {
    const data = {
      reply: "Found 2 tools",
      tools: [{ name: "a" }, { name: "b" }],
      suggested_tools: [{ name: "a" }],
      policy: { total: 2 },
      decision: { tool: "a", outcome: "ALLOWED" },
      execution: { ok: true },
      steps: ["mcp_initialized"],
    };
    expect(chatReplyMessage(data)).toEqual({
      content: "Found 2 tools",
      extra: {
        available_tools: ["a", "b"],
        suggested_tools: [{ name: "a" }],
        policy: { total: 2 },
        decision: { tool: "a", outcome: "ALLOWED" },
        execution: { ok: true },
        steps: ["mcp_initialized"],
      },
    });
  });

  it("defaults every field for an empty reply", () => {
    expect(chatReplyMessage({})).toEqual({
      content: "Done.",
      extra: { available_tools: [], suggested_tools: [], policy: null, decision: null, execution: null, steps: [] },
    });
  });
});

describe("llmReplyMessage", () => {
  it("carries the reply and a route/latency step", () => {
    expect(llmReplyMessage("anthropic", { reply: "hi", route: "/v1/x", latencyMs: 12 })).toEqual({
      content: "hi",
      extra: { steps: ["anthropic · /v1/x · 12 ms"] },
    });
  });
});

describe("llmDenialMessage", () => {
  it("speaks the denial with the reason and the denying route", () => {
    expect(llmDenialMessage("anthropic", { reason: "blocked by policy", provider: "anthropic", route: "/v1/x" })).toEqual({
      content: "⚠️ Privilege denied this call. blocked by policy",
      extra: { steps: ["anthropic · /v1/x · denied by policy"] },
    });
  });

  it("falls back to the message, the lane's provider and an empty route", () => {
    expect(llmDenialMessage("google", { message: "nope" })).toEqual({
      content: "⚠️ Privilege denied this call. nope",
      extra: { steps: ["google ·  · denied by policy"] },
    });
  });

  it("exposes the denial code both surfaces match on", () => {
    expect(LLM_POLICY_DENIED).toBe("llm_policy_denied");
  });
});
```

- [ ] **Step 2: Run, verify FAIL (unresolved import).**
- [ ] **Step 3: Implement**

```js
// demo_api_ui/src/components/privilege/privilegeChat.js
// Message shapes for the Privilege chat, shared by the Cursor page and the footprint
// skins so a change to the /chat or /llm/call reply or denial format is made once.
// Pure: no state, no network. Control flow stays with each caller.

export const LLM_POLICY_DENIED = 'llm_policy_denied';

/** A /chat reply as an assistant message. */
export function chatReplyMessage(data) {
  return {
    content: data.reply || 'Done.',
    extra: {
      available_tools: (data.tools || []).map((t) => t.name),
      suggested_tools: data.suggested_tools || [],
      policy: data.policy || null,
      decision: data.decision || null,
      execution: data.execution || null,
      steps: data.steps || [],
    },
  };
}

/** A successful /llm/call as an assistant message. */
export function llmReplyMessage(provider, data) {
  return { content: data.reply, extra: { steps: [`${provider} · ${data.route} · ${data.latencyMs} ms`] } };
}

/**
 * A Privilege policy denial of an LLM prompt. A denial is the demo, so it is spoken in
 * the transcript rather than thrown. `details` is any object with optional
 * reason/message/provider/route.
 */
export function llmDenialMessage(provider, details) {
  return {
    content: `⚠️ Privilege denied this call. ${details.reason || details.message}`,
    extra: { steps: [`${details.provider || provider} · ${details.route || ''} · denied by policy`] },
  };
}
```

- [ ] **Step 4:** Run the new test file (all PASS) and `src/components/__tests__/themingRatchet.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js` (the `⚠️`/`·` must pass the emoji ratchet; if `·` or `⚠️` is flagged, report instead of changing the ratchet).
- [ ] **Step 5:** Commit: `feat(privilege): shared chat/LLM message shapes (privilegeChat.js)`.

---

### Task 3: Cursor adopts the shared shapes (behaviour unchanged, own commit)

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY.

**Interfaces:** Consumes `chatReplyMessage`, `llmReplyMessage`, `llmDenialMessage`, `LLM_POLICY_DENIED` from `../components/privilege/privilegeChat`.

- [ ] **Step 1:** Baseline: run `PrivilegeMcpClientPage.chatSend.test.jsx` and the whole `src/pages/__tests__/PrivilegeMcpClientPage` family; record counts (must be all green; family previously 105 tests / 24 files, plus the 6 new).
- [ ] **Step 2:** In `sendChat` replace exactly these three object-building sites (leave every other statement, comment and the generic-error branch untouched):

```js
// LLM success
const data = await api('/llm/call', { method: 'POST', body: { provider: llmPath, prompt } });
const m = llmReplyMessage(llmPath, data);
appendChat('assistant', m.content, m.extra);
```
```js
// LLM denial (the generic `❌ ${err.message}` branch stays exactly as it is)
if (err.code === LLM_POLICY_DENIED) {
  const m = llmDenialMessage(llmPath, err);
  appendChat('assistant', m.content, m.extra);
} else {
  appendChat('assistant', `❌ ${err.message}`, { steps: [`${llmPath} · call failed`] });
}
```
```js
// /chat reply (the authUrl branch above it stays as it is)
const m = chatReplyMessage(data);
appendChat('assistant', m.content, m.extra);
```
  and add the import next to the existing `privilegeRouting` import. Do not touch `if (data.tools) { ... }`, `recordResult`, `handleAuthChallenge` or anything else.
- [ ] **Step 3:** Re-run the same tests: identical counts, zero test edits (`git diff --stat` shows ONE file). Run `cd demo_api_ui && npm run build` (redirect, read).
- [ ] **Step 4:** Commit only `PrivilegeMcpClientPage.jsx`: `refactor(privilege): Cursor sendChat builds messages via privilegeChat (no behaviour change)`.

---

### Task 4: Skins adopt the shared shapes; TECH_DEBT

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js` (the `send` function)
- Modify: `TECH_DEBT.md`

**Interfaces:** Consumes the Task 2 module. The session's `push(role, content, extra)` is unchanged.

- [ ] **Step 1:** In `send`, replace:
  - the LLM success `push("assistant", data.reply, { steps: [...] })` with `const m = llmReplyMessage(routing.llmPath, data); push("assistant", m.content, m.extra);`
  - the denial branch: `const d = err?.response?.data || {}; if (d.code === LLM_POLICY_DENIED) { const m = llmDenialMessage(routing.llmPath, { ...d, message: errText(err) }); push("assistant", m.content, m.extra); } else { push("assistant", `Error: ${errText(err)}`); }` (generic error line unchanged);
  - the `/chat` success `push("assistant", data.reply || "Done.", { steps, decision, execution })` with `const m = chatReplyMessage(data); push("assistant", m.content, m.extra);` (the `if (data.tools) {...}` block after it is unchanged).
  Add the import. Nothing else in the file changes.
- [ ] **Step 2:** Run (project vitest, redirected, read): `src/components/aiFootprintMocks src/components/privilege src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx src/pages/__tests__/AiFootprintShellPages.test.js src/pages/__tests__/PrivilegeMcpClientPage` plus the ratchets `src/components/__tests__/themingRatchet.test.js src/components/__tests__/testConventionsRatchet.test.js src/__tests__/uiRegression.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js`; then `cd demo_api_ui && npm run build`. All green with ZERO edits to existing tests. If a skin test fails only because of the extra keys on a message (`toEqual` on a whole message), report it — do not weaken tests.
- [ ] **Step 3:** `TECH_DEBT.md`: read the two entries (`### [ ] 2026-10-05 — Privilege chat reply normalization is duplicated…` and `### [ ] 2026-10-05 — Cursor LLM send and the shell hook's LLM send are duplicated`). Tick each box (`[x]`) and append a RESOLVED block (match the file's convention: branch name, what the issue turned out to be, what the fix was) saying exactly: the duplicated part was the message SHAPES (reply, denial, step strings), now in `components/privilege/privilegeChat.js` used by both surfaces; the send control flow (page state + auth-challenge modal vs session phases + `connect()`) and the generic LLM error wording (`❌ <msg>` + "call failed" step on Cursor vs `Error: <msg>` on the skins) were deliberately left per-surface and are NOT unified.
- [ ] **Step 4:** Commit the hook + TECH_DEBT (two commits are fine): `refactor(footprint): skins build chat messages via privilegeChat`, `docs(tech-debt): resolve chat-shape duplication entries`. Do NOT push, open a PR, merge or deploy.
