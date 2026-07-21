# "Decode my token" JWT-Verifier Demo Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Decode my token" chip, available in every real vertical, that calls the `jwt_decode_full` MCP tool (added in PR #654/#657) with the current session's own live bearer token, injected server-side.

**Architecture:** Chip click → `sendAsNl(message)` → BFF `/api/demo-agent/nl` → `parseHeuristic()` regex fast-path returns a structured action → client `dispatchNlResult` → `runAction("jwt_decode_demo")` → `callMcpTool("jwt_decode_full", {})` → BFF `/api/mcp/tool` (injects the session's own token into `params.token` here, since the browser never holds the raw token) → `demo_mcp_gateway` (already routes this tool, from PR #654) → `demo_mcp_jwt_verifier`.

**Tech Stack:** Express (demo_api_server), React (demo_api_ui), existing MCP tool/gateway plumbing (no changes to those layers — this plan is BFF + UI + config only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-jwt-decode-chip-design.md` (supersedes touch-point details below where they conflict with earlier assumptions in that doc — this plan reflects the corrected dispatch mechanism found during implementation research).
- One chip only (`jwt_decode_full`) — no chips for the other 4 jwt-verifier tools.
- No new "shared chips" mechanism — the chip entry is duplicated into each vertical's `manifest.json`, matching the existing per-vertical architecture.
- No `useCaseId` on the new chip (matches the existing `bk-direct` chip's precedent — `runAction` treats a missing `useCaseId` as `null` gracefully).
- Raw session token must never become a literal in any client-visible payload — it is filled in server-side, in the BFF, immediately before forwarding.
- REGRESSION_PLAN.md §0 emoji allowlist applies to any new UI copy (label text) — plain text only, no new emoji needed for this feature.

---

### Task 1: Register `jwt_decode_full` in scope-topology.json

**Files:**
- Modify: `scope-topology.json:257-260` (insert a new `tools.jwt_decode_full` entry immediately after the existing `sequential_think` entry)
- Regenerate: `docs/scope-topology.md` (a test enforces this stays in sync with the manifest)

**Interfaces:**
- Produces: `scopeTopology.toolScopes('jwt_decode_full')` → `['read']`, consumed automatically by `demo_api_server/services/mcpWebSocketClient.js`'s `MCP_TOOL_SCOPES` (derives from the manifest — no separate edit needed there) and by `demo_api_server/services/agentScopes.js`'s per-chip scope-set builder.

- [ ] **Step 1: Add the tool entry**

In `scope-topology.json`, the `tools` object currently reads (lines 257-260):
```json
    "sequential_think": {
      "requiredScopes": ["read"],
      "surface": "gateway"
    },
```
Insert immediately after it (same indentation, same style as `sequential_think`/`code_search`):
```json
    "jwt_decode_full": {
      "requiredScopes": ["read"],
      "surface": "gateway"
    },
```

- [ ] **Step 2: Regenerate the doc + validate**

Run from the repo root:
```bash
node demo_api_server/scripts/generate-scope-doc.js
```
Expected output: `Wrote docs/scope-topology.md`. Then confirm the JSON is still schema-valid:
```bash
node -e "
const Ajv = require('./demo_api_server/node_modules/ajv');
const ajv = new Ajv({allErrors:true, strict:false});
const schema = require('./scope-topology.schema.json');
const data = require('./scope-topology.json');
const validate = ajv.compile(schema);
console.log('SCHEMA_VALID:', validate(data));
"
```
Expected output: `SCHEMA_VALID: true`

- [ ] **Step 3: Run the regression suite**

```bash
cd demo_api_server && CI=true npx jest src/__tests__/scopeTopology.regression.test.js --testPathIgnorePatterns="/node_modules/" --forceExit
```
Expected: all tests pass, including "docs/scope-topology.md matches a fresh render of the manifest" and "cross-consumer scope equality" (this is the guard that would catch a `jwt_decode_full` scope drift).

- [ ] **Step 4: Commit**

```bash
git add scope-topology.json docs/scope-topology.md
git commit -m "feat(topology): register jwt_decode_full tool scope"
```

---

### Task 2: NL heuristic fast-path for "decode my jwt token"

**Files:**
- Modify: `demo_api_server/services/nlIntentParser.js` (insert a new fast-path immediately after the existing `mcp_tools` fast-path, around line 867-873)
- Test: `demo_api_server/src/__tests__/nlIntentParser.test.js`

**Interfaces:**
- Consumes: nothing new (pure regex match on the normalized message string `t`).
- Produces: `parseHeuristic("decode my jwt token")` → `{ kind: "banking", banking: { action: "jwt_decode_demo" } }` — this exact `action` string (`"jwt_decode_demo"`) is what Task 4's `runAction` switch case must match on.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_server/src/__tests__/nlIntentParser.test.js`, inside the existing `describe('nlIntentParser — banking intents', () => { ... })` block (this file already imports `parseHeuristic` and defines the `bank()` helper at the top — reuse it, do not redefine):
```js
  it('routes "decode my jwt token" → jwt_decode_demo', () => {
    expect(bank('decode my jwt token').banking.action).toBe('jwt_decode_demo');
  });

  it('routes "decode my token" → jwt_decode_demo', () => {
    expect(bank('decode my token').banking.action).toBe('jwt_decode_demo');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest src/__tests__/nlIntentParser.test.js -t "jwt_decode_demo" --testPathIgnorePatterns="/node_modules/" --forceExit
```
Expected: FAIL — `parseHeuristic` currently falls through to a different `kind` (education or none) for this message.

- [ ] **Step 3: Add the heuristic fast-path**

In `demo_api_server/services/nlIntentParser.js`, the existing `mcp_tools` fast-path (lines 867-873) reads:
```js
  if (
    /\b(list|show|get|what).*(mcp.*tools?|tools?.*available|available.*tools?)\b|\btools?\s*(list|available)\b|\bmcp\s+tools?\b/.test(
      t,
    )
  ) {
    return { kind: "banking", banking: { action: "mcp_tools" } };
  }
```
Insert immediately after it (before the "Account nickname" block that follows):
```js
  // JWT decode diagnostic chip — cross-vertical (not tied to any vertical's
  // data), so this fast-path runs unconditionally like mcp_tools above.
  if (/\bdecode\s+my\s+(jwt|token)\b/.test(t)) {
    return { kind: "banking", banking: { action: "jwt_decode_demo" } };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest src/__tests__/nlIntentParser.test.js --testPathIgnorePatterns="/node_modules/" --forceExit
```
Expected: PASS, full file (not just the new tests — confirms the new fast-path didn't shadow an earlier one, since it's inserted after `mcp_tools` and before `account_nickname`/others).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/nlIntentParser.js demo_api_server/src/__tests__/nlIntentParser.test.js
git commit -m "feat(nl): add \"decode my jwt token\" heuristic fast-path"
```

---

### Task 3: Inject the session's own token server-side in `/api/mcp/tool`

**Files:**
- Modify: `demo_api_server/server.js:1550-1554` (add `getSessionBearerForMcp` to the existing require)
- Modify: `demo_api_server/server.js:1833-1834` (inject into the `ctx.params` passed to `runMcpToolPipeline`)

**Interfaces:**
- Consumes: `getSessionBearerForMcp(req)` — already defined and exported in `demo_api_server/services/mcpWebSocketClient.js:83-87`, returns the session's raw access token string or `null`. No changes needed to that file.
- Produces: for `tool === 'jwt_decode_full'` requests with no explicit `params.token`, the token is auto-filled before `runMcpToolPipeline(ctx)` is called.

- [ ] **Step 1: Add the import**

In `demo_api_server/server.js`, the existing require (around line 1550-1554) reads:
```js
const {
    mcpCallTool,
    getSessionAccessToken,
    getMcpServerUrl
} = require('./services/mcpWebSocketClient');
```
Change to:
```js
const {
    mcpCallTool,
    getSessionAccessToken,
    getSessionBearerForMcp,
    getMcpServerUrl
} = require('./services/mcpWebSocketClient');
```

- [ ] **Step 2: Inject the token at ctx construction**

In the `POST /api/mcp/tool` handler, the `ctx` object construction (around line 1833-1834) currently reads:
```js
    const ctx = {
      tool, params, flowTraceId, startTime, req,
```
Change to:
```js
    const ctx = {
      tool,
      params: (tool === 'jwt_decode_full' && !(params && params.token))
        ? { ...(params || {}), token: getSessionBearerForMcp(req) }
        : params,
      flowTraceId, startTime, req,
```

- [ ] **Step 3: Verify with a manual request**

This route has no existing supertest-style unit test in the codebase to extend safely (it's a very large handler tested primarily via the live stack). Verify manually once Task 6's stack is up:
```bash
curl -s -X POST https://api.ping.demo:3001/api/mcp/tool \
  -H "Content-Type: application/json" \
  --cookie "<a valid logged-in session cookie>" \
  -d '{"tool":"jwt_decode_full","params":{}}' | python3 -m json.tool
```
Expected: a JSON body containing `result.header`, `result.payload`, `result.summary` — NOT a `tool_name_required` or auth error, and NOT an empty/null `token` validation error from the jwt-verifier server. (Full end-to-end verification happens in Task 6 — this step just confirms the injection line itself works before building the UI on top of it.)

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/server.js
git commit -m "feat(mcp-tool): auto-fill session token for jwt_decode_full calls"
```

---

### Task 4: Wire the chip's client-side dispatch (AIAgent.js + agentActions.js)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (new `case "jwt_decode_demo":` in the `runAction` switch, immediately after the existing `case "accounts":` block, before `case "mortgage_demo":`)
- Modify: `demo_api_ui/src/components/agentActions.js:36-40` (new entry in `ACTION_GROUPS.account`, for the chat-bubble label lookup)

**Interfaces:**
- Consumes: the `"jwt_decode_demo"` action string produced by Task 2's heuristic.
- Produces: nothing new consumed elsewhere — this is the dispatch terminus, `response` flows into the existing generic post-switch success/error rendering (`normalizeAgentToolResult`, `isAgentToolErrorResult`) already used by every other simple chip.

- [ ] **Step 1: Add the label entry**

In `demo_api_ui/src/components/agentActions.js`, the `account:` group's `sequential_think` entry (lines 35-40) reads:
```js
    {
      id: "sequential_think",
      label: "Think Through a Question",
      desc: "Reason step-by-step through a banking question or decision",
      rfcs: [],
    },
```
Insert immediately after it (before the `logout` entry that follows):
```js
    {
      id: "jwt_decode_demo",
      label: "Decode My JWT Token",
      desc: "Decode this session's own bearer token (header, claims, expiry)",
      rfcs: ["7519"],
    },
```

- [ ] **Step 2: Add the runAction case**

In `demo_api_ui/src/components/AIAgent.js`, the existing `"accounts"` case (lines 2668-2672) reads:
```js
        case "accounts":
          toast.update(toastId, { render: " Calling get_my_accounts…" });
          response = await getMyAccounts({ useCaseId, vertical });
          response = { ...response, result: enforceVerticalAccountTypes(response.result, terminology) };
          break;
```
Insert a new case immediately after its `break;`, before `case "mortgage_demo": {`:
```js
        case "jwt_decode_demo":
          toast.update(toastId, { render: " Calling jwt_decode_full…" });
          response = await callMcpTool("jwt_decode_full", {}, {
            useCaseId,
            vertical,
            onTokenEvent: (ev) => tokenChain?.appendTokenEvent(actionId, ev),
          });
          break;
```

- [ ] **Step 3: Build check**

```bash
cd demo_api_ui && npm run build
```
Expected: build succeeds with no new errors (this repo has no isolated unit-test harness for individual `AIAgent.js` switch cases — the build is the fast local signal; full behavior is verified in Task 6).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/agentActions.js
git commit -m "feat(ui): dispatch jwt_decode_demo action to jwt_decode_full tool"
```

---

### Task 5: Add the chip to every vertical's manifest

**Files:**
- Modify: `demo_api_server/config/verticals/banking/manifest.json:115` (insert after `"chips10": [`)
- Modify: `demo_api_server/config/verticals/retail/manifest.json:102`
- Modify: `demo_api_server/config/verticals/healthcare/manifest.json:121`
- Modify: `demo_api_server/config/verticals/government/manifest.json:77`
- Modify: `demo_api_server/config/verticals/investment/manifest.json:51`
- Modify: `demo_api_server/config/verticals/manufacturing/manifest.json:60`
- Modify: `demo_api_server/config/verticals/sporting-goods/manifest.json:120`
- Modify: `demo_api_server/config/verticals/university/manifest.json:77`
- Modify: `demo_api_server/config/verticals/workforce/manifest.json:97`

**Interfaces:**
- Consumes: `"jwt_decode_full"` (Task 1's registered tool name), `"jwt_decode_demo"` (Task 2's heuristic action / Task 4's runAction case — reached via the NL pipeline, not read directly from this JSON's `tool` field at dispatch time, but kept consistent with it for `agentScopes.js`'s scope-request builder, which DOES read `chip.tool`).
- Produces: a new chip visible in each vertical's chip rail.

Each vertical gets the same chip object, with only the `id` prefix changed to match that vertical's existing convention. Insert as the new first element of the `chips10` array (i.e. immediately after the `"chips10": [` line), in each file:

- [ ] **Step 1: banking** — insert after `demo_api_server/config/verticals/banking/manifest.json:115`:
```json
      { "id": "bk-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 2: retail** — insert after `demo_api_server/config/verticals/retail/manifest.json:102`:
```json
      { "id": "rt-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 3: healthcare** — insert after `demo_api_server/config/verticals/healthcare/manifest.json:121`:
```json
      { "id": "hc-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 4: government** — insert after `demo_api_server/config/verticals/government/manifest.json:77`:
```json
      { "id": "gv-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 5: investment** — insert after `demo_api_server/config/verticals/investment/manifest.json:51`:
```json
      { "id": "inv-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 6: manufacturing** — insert after `demo_api_server/config/verticals/manufacturing/manifest.json:60`:
```json
      { "id": "mf-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 7: sporting-goods** — insert after `demo_api_server/config/verticals/sporting-goods/manifest.json:120`:
```json
      { "id": "sg-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 8: university** — insert after `demo_api_server/config/verticals/university/manifest.json:77`:
```json
      { "id": "un-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 9: workforce** — insert after `demo_api_server/config/verticals/workforce/manifest.json:97`:
```json
      { "id": "wf-jwt", "label": "Decode my token", "message": "decode my jwt token", "mode": "both", "tool": "jwt_decode_full" },
```

- [ ] **Step 10: Validate all 9 files parse as valid JSON**

```bash
for v in banking retail healthcare government investment manufacturing sporting-goods university workforce; do
  python3 -c "import json; json.load(open('demo_api_server/config/verticals/$v/manifest.json')); print('$v OK')"
done
```
Expected: `<vertical> OK` for all 9.

- [ ] **Step 11: Run the full offline topology gate**

```bash
bash scripts/topology-verify.sh
```
Expected: `✅ topology:verify PASSED — scope-topology.json is in sync (offline checks).` (run from a location where `demo_api_server`, `demo_mcp_gateway`, `demo_authz_server`, and root `node_modules` are installed — inside a fresh worktree, symlink them from the main checkout per the `verify-ai-demo2` skill: `ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules demo_api_server/node_modules` etc., and remove the symlinks afterward.)

- [ ] **Step 12: Commit**

```bash
git add demo_api_server/config/verticals/*/manifest.json
git commit -m "feat(chips): add \"Decode my token\" chip to all verticals"
```

---

### Task 6: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Bring up the local stack with the demo-auth profile**

```bash
./run-docker.sh demo-auth start
```
Expected: `mcp-gateway` and `mcp-jwt-verifier` (from PR #654) both report healthy alongside the core services.

- [ ] **Step 2: Log in and click the chip**

Open `https://local.ping-devops.com:4000`, sign in, and in the banking vertical click "Decode My JWT Token" (or type "decode my jwt token" in the chat box).

Expected: the assistant reply shows the decoded token's `header` (algorithm, kid) and `payload` (subject, issuer, expiry) for the CURRENT logged-in session — not an error, not a canned/example token.

- [ ] **Step 3: Repeat in one other vertical**

Switch to any other vertical (e.g. retail) and repeat Step 2.

Expected: same behavior — confirms the chip works cross-vertically, not just in banking.

- [ ] **Step 4: Confirm no raw token leaks into the response body verbatim**

In the browser devtools Network tab, inspect the `/api/mcp/tool` response for the `jwt_decode_full` call.

Expected: the response contains decoded `header`/`payload` JSON objects, not a raw `eyJ...` compact JWT string anywhere in the body (confirms `scrubRawJwts` at `server.js:1731` doesn't need special-casing for this tool, and that the design's assumption about output shape was correct).

- [ ] **Step 5: Regression check**

```bash
cd demo_mcp_gateway && CI=true npx jest --forceExit --testPathIgnorePatterns="/node_modules/"
cd ../demo_api_server && CI=true npx jest --forceExit --testPathIgnorePatterns="/node_modules/"
```
Expected: same pass/fail counts as the pre-existing baseline (per the PR #654/#657 work, a handful of known-pre-existing failures unrelated to this change are expected — no NEW failures should appear).
