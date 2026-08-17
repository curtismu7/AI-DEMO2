# P1AZ Bulk Decision Requests — demo tab + advisory bulk pre-flight

> **Status: SHIPPED. Archival — no work remains.** Verified 2026-08-17:
> `demo_api_ui/src/components/BulkDecisionPanel.jsx` and
> `demo_api_ui/src/config/bulkDecisionBundles.js` provide the demo surface and
> its bundles; `demo_api_server/services/pingOneAuthorizeService.js` and
> `services/agentPreflightService.js` carry the bulk decision wiring, gated in
> `routes/featureFlags.js`.

## Context

PingOne Authorize supports a **bulk decision request**: up to 20 decision evaluations in a
single POST, returning one `correlationId` and an array of per-item verdicts.
([docs](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-evaluation/execute-a-bulk-decision-request.html))

The demo only ever issues **single** decision requests. Two gaps this closes:

1. **Demo legibility.** Policy behaviour is currently demonstrated one verdict at a time.
   A batch — an amount ladder $100→$50k, every agent tool at once, an ACR matrix — makes
   the *shape* of a policy visible in one screen, correlated by one `correlationId`.
2. **Real round-trips.** [agentPreflightService.js:48](../demo_api_server/services/agentPreflightService.js#L48)
   pre-flights **one** tool per call. An agent that wants to know "which of my N tools may I
   call right now?" needs N calls today. Bulk answers it in one (or ⌈N/20⌉).
3. **It replaces a mock-only hack with a real cloud capability.** The repo already answers
   "which of these tools are permitted?" — `DecisionContext: 'McpToolsList'` with the tool list
   JSON-stuffed into a single `CandidateTools` parameter
   ([pingAuthorizeGuard.ts:146-170](../demo_mcp_gateway/src/pingAuthorizeGuard.ts#L146-L170)),
   answered with `PermittedTools` / `DeniedTools` advice
   ([decision.js:436-457](../demo_authz_server/routes/decision.js#L436-L457)). That works **only
   against p1az-mock** — `CandidateTools` appears nowhere in `gen-authorize-snapshot.js`,
   because the snapshot DSL cannot parse a JSON array. The bulk API is the cloud-capable
   equivalent: N first-class decision requests, N first-class verdicts, no array-in-a-string.

### The one wire fact that shapes everything

Bulk uses the **same URL** as single — `POST /v1/environments/{envId}/decisionEndpoints/{id}`.
The *only* discriminator is the request header:

| | Content-Type |
|---|---|
| single | `application/json` |
| bulk | `application/vnd.pingidentity.decisionengine.authorize.bulk+json` |

Bulk body — shared `parameters` / `userContext` at top level, per-item overrides in
`decisionRequests[]`. Response: `{ summary:{requested,errors,successful}, correlationId, responses:[{id,decision,elapsedMicroseconds,statements[]}] }`.
Max **20** per call; over that returns `400`.

Today the Content-Type is hardcoded at
[pingOneAuthorizeService.js:338](../demo_api_server/services/pingOneAuthorizeService.js#L338).

### Decisions taken (confirmed with the user)

- Ship the demo tab **and** the bulk pre-flight.
- Test data from **all three** sources: canned bundles, generated from the live MCP tool
  list, and a free-form JSON editor.
- **Live PingOne only** — matches the existing console's `LIVE · calls real PingOne` badge.
  No `demo_authz_server` / p1az-mock bulk endpoint.

### Hard constraint — bulk pre-flight is ADVISORY, never an enforcement decision

`evaluateMcpFirstToolGate` is a `REGRESSION_PLAN.md` §1 protected path. The bulk pre-flight
**must not** become a second gate:

- It **narrows a list** (which tools to offer / grey out). It never grants a call.
- The real gate still runs unchanged on the actual tool invocation.
- It mints **no HITL challenges**. A bulk `HITL` result means "call single `/pre-flight` for
  this tool to get a challenge".
- The exchanged MCP token is **tool-bound** when RAR/TRAT are on
  ([agentMcpTokenService.js:83](../demo_api_server/services/agentMcpTokenService.js#L83) builds
  `authorization_details` from the tool name + params). A batch resolves one token, so RAR
  attributes are omitted from batch items. A bulk PERMIT can therefore still DENY at the real
  gate with `ff_rar` on — which is the safe direction, and exactly why this is advisory.

Gated by a new flag `ff_authorize_bulk_preflight`, default `'false'` — no behaviour change on merge.

---

## Part 0 — Preflight: protected-area discipline + one stale-doc fix

### 0a. Fix the stale `inspector-template` skill doc

[`.claude/skills/inspector-template/SKILL.md:150-152`](../.claude/skills/inspector-template/SKILL.md#L150-L152)
describes the page I'm about to extend, and **both** of its claims are wrong. Left as-is it
would mislead the very next person (or agent) to open it.

| Doc says | Code actually does |
|---|---|
| "5 output tabs (Decision, Response, Request, **Policy, Headers**)" | 4 tabs — Decision, Response, Request, **Form** ([PingOneAuthorizePage.jsx:640-645](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L640-L645)) |
| "`fullHeight={true}` (own route)" | `fullHeight={false}` — the shell is embedded mid-page under the endpoint picker ([:489](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L489)) |

Replace those three lines with the accurate description, and after Part 3 lands, extend the
tab list to include the new **Results / JSON** tabs so the doc stays true.

`AgentGatewayTester.jsx` is correctly documented (`fullHeight={false}`, verified at
[:439](../demo_api_ui/src/components/AgentGatewayTester.jsx#L439)) — leave it alone. There is a
read-only mirror of this skill at `~/.cache/learning-hub-mirror/...`; it is a cache, not a
source, so it is not edited.

### 0b. Protected-area checklist (`demo_api_ui` is `REGRESSION_PLAN.md` §1)

Discharge every one of these — they are gates, not suggestions:

1. **Worktree required.** A hard-block hook denies `Write`/`Edit` in the main checkout. Enter a
   worktree first; stage explicitly with `git add <files>`, never `git add -A`; confirm
   `git branch --show-current` before each commit.
2. **Invoke `regression-guard` and `inspector-template` before the first UI edit**, and state
   what will not break (the "What I will NOT break" section below is that statement).
3. **Emoji allowlist** — the project-wide set is `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. The new panel
   needs only `⚠️ ✅ ❌ ✕ ✓`; anything else is plain text, CSS, or semantic HTML.
4. **UI build gate** — `cd demo_api_ui && npm run build` exiting `0` is the §0 completion gate.
   A green test run alone does not satisfy it.
5. **vitest, not jest** — `demo_api_ui` uses `npm run test:unit` (vitest 3.2, jsdom). Do not
   add a jest config or jest-style globals to the new UI test. The **server** side is jest and
   needs `CI=true`.
6. **Manual click-through** — per the skill, a passing suite is not a substitute for clicking
   the page once. Covered by verification step 4 below.
7. **After merge**, run `scripts/sync-main-checkout.sh` — Docker bind-mounts the main checkout,
   so a GitHub merge alone leaves the running demo on stale code.

---

## Part 1 — BFF: bulk transport in `pingOneAuthorizeService.js`

File: [demo_api_server/services/pingOneAuthorizeService.js](../demo_api_server/services/pingOneAuthorizeService.js)

1. **Add a content-type parameter** to `_postDecisionWithAuth(url, body)` at
   [:335](../demo_api_server/services/pingOneAuthorizeService.js#L335) —
   `_postDecisionWithAuth(url, body, contentType = 'application/json')`. Default keeps every
   existing caller byte-identical, including the 401-refresh-retry.

2. **New `_postBulkDecisionEndpoint(endpointId, { sharedParameters, decisionRequests })`**,
   modelled on `_postDecisionEndpoint` at
   [:406](../demo_api_server/services/pingOneAuthorizeService.js#L406):
   - same URL builder, same `_evaluateWithBreaker` key `decision:${endpointId}` (one P1AZ
     outage trips one breaker, not two), same `_decisionError` mapping.
   - body `{ ...(sharedParameters ? { parameters: sharedParameters } : {}), decisionRequests }`.
   - reject `decisionRequests.length > 20` **before** the call with a typed error rather than
     letting PingOne 400.
   - **Per-item normalisation reuses the existing fail-closed helpers unchanged** —
     `_classifyRawObligations` (reads `statements[]`, which bulk items carry),
     `_normalizeDecision`, `_isPolicyNotFoundEffect`. Bulk verdicts get identical
     fail-closed semantics to single by construction.
   - **Index correlation guard (fail closed).** Request items carry no client-supplied id, so
     results correlate by array index. If `responses.length !== decisionRequests.length`, or
     `summary.errors > 0`, mark every unmatched index `DENY` with
     `reason: 'bulk_response_length_mismatch'` — never silently drop or shift.
   - returns `{ correlationId, summary, results: [{ index, decision, stepUpRequired, hitlRequired, consentRequired, policyNotFound, decisionId, elapsedMicroseconds, raw }], _debug:{request,response} }`
     with `_debug.request.contentType` set to the bulk media type so the Inspector's Request
     tab shows the real header.

3. **Chunking helper** `evaluateDecisionEndpointBulk(endpointId, decisionRequests, sharedParameters)`
   — public export next to `evaluateDecisionEndpoint` at
   [:1170](../demo_api_server/services/pingOneAuthorizeService.js#L1170). Splits into batches of
   20 and concatenates results preserving global index. One `correlationId` per chunk,
   returned as an array.

## Part 2 — BFF route

File: [demo_api_server/routes/authorize.js](../demo_api_server/routes/authorize.js)

`POST /api/authorize/evaluate-endpoint-bulk`, mirroring `/evaluate-endpoint` at
[:768](../demo_api_server/routes/authorize.js#L768) — same `authenticateToken`, same
`_requireWorker(res)` 409, same `logEvent` tagging, same `{ error }` response convention.

```
req  { endpointId, sharedParameters?, decisionRequests: [{ label?, parameters }], useCaseId? }
res  { ok, correlationId, summary, results[], endpointId, pingoneRequest, pingoneResponse }
```

Validation: `endpointId` required; `decisionRequests` must be a non-empty array; each
`.parameters` must be a plain object; `length <= 20` unless an explicit `chunk: true`.
`label` is UI-only — stripped before the PingOne call, re-attached to results by index.

Log one `authorize` event per batch (not per item) with `{ bulk: true, count, correlationId }`
so Recent Decisions / activity log don't get flooded.

## Part 3 — UI: "Bulk Decisions" tab on the P1AZ Inspector

File: [demo_api_ui/src/components/PingOneAuthorizePage.jsx](../demo_api_ui/src/components/PingOneAuthorizePage.jsx)

- Append `'bulk'` to the `TABS` whitelist at
  [:810](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L810), add one
  `<span style={S.tab(tab === 'bulk')} onClick={() => setTab('bulk')}>Bulk Decisions</span>`
  to the tab bar at [:920-926](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L920-L926),
  and one `{tab === 'bulk' && <BulkDecisionPanel ... />}` branch at
  [:928](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L928). URL-driven via
  `?tab=bulk`, same `setTab` helper.

- **New component `demo_api_ui/src/components/BulkDecisionPanel.jsx`**, built on the shared
  inspector set — [InspectorShell.jsx:39](../demo_api_ui/src/components/shared/InspectorShell.jsx#L39)
  + [InspectorTabs.jsx](../demo_api_ui/src/components/shared/InspectorTabs.jsx) + `JsonHighlight`,
  matching `EvaluatePanel`'s `fullHeight={false}` embedded usage at
  [:485](../demo_api_ui/src/components/PingOneAuthorizePage.jsx#L485). Invoke the
  `inspector-template` skill before writing it.

  | Column | Content |
  |---|---|
  | left | Bundle list — the canned batches; click loads into the editor |
  | middle | Batch editor: shared-parameters block, then N rows (`label` + parameters), item counter `n/20` with the over-cap state disabling Run; "Add row" / "Remove" / "Load MCP tools" |
  | right | `InspectorTabs`: **Results** (verdict table), **Response** (verbatim bulk JSON), **Request** (verbatim body + the bulk `Content-Type`), **JSON** (free-form editor for the whole `decisionRequests` array) |

  Results table columns: `#`, `Label`, `Decision` badge (reuse `S.dBadge` / `DECISION_ICON`),
  `Step-up`, `Consent`, `Elapsed µs`, `Decision ID`. Header strip shows
  `correlationId` + `summary.requested/successful/errors`.

- **Test data — all three sources**
  1. *Canned bundles* — new `demo_api_ui/src/config/bulkDecisionBundles.js`, seeded from the
     server's authoritative defaults `PRESET_BASE_DEFAULTS` at
     [policyTestCaseSolver.js:24-56](../demo_api_server/services/policyTestCaseSolver.js#L24-L56)
     so the bundles can't drift from the single-request presets:
     - **Amount ladder** — 8 × `transaction` preset, `Amount` 100 / 499 / 500 / 1000 / 2000 / 2001 / 10000 / 50000, shared `TransactionType: 'transfer'`, `UserId`
     - **ACR matrix** — 6 items, `Amount` × `Acr` ∈ {`''`, `Multi_Factor`}
     - **MCP tool sweep** — `mcp` preset, one item per banking tool
     - **Confused deputy** — `ResourceOwnerId` matching vs mismatched (mirrors UC13)
  2. *Generated from live MCP tools* — "Load MCP tools" button fetches
     `GET /api/mcp/inspector/tools` (`{ tools:[{name}] }`, same call
     [MockAuthzRulesPage.jsx:493](../demo_api_ui/src/components/MockAuthzRulesPage.jsx#L493)
     already makes) and builds one row per tool from the `mcp` preset base with
     `ToolName` overridden; truncates to 20 with a visible "showing first 20 of N" note.
  3. *Free-form JSON* — the **JSON** tab: textarea over the whole `decisionRequests` array,
     parse errors shown inline, cap enforced client-side before Run.

- HTTP via `bffAxios` (what this page already uses), not `apiClient`.
- Nav: no new entry — the tab lives under the existing **P1AZ Inspector** items at
  [AdminSideNav.jsx:505](../demo_api_ui/src/components/AdminSideNav.jsx#L505) and
  [:609](../demo_api_ui/src/components/AdminSideNav.jsx#L609). Add `searchAlias` "bulk decision"
  to those two entries only if search discovery matters.

## Part 4 — Advisory bulk pre-flight

**Pure extraction first, no logic change.** `evaluateMcpFirstToolGate` at
[mcpToolAuthorizationService.js:476](../demo_api_server/services/mcpToolAuthorizationService.js#L476)
assembles ~100 lines of "token + context facts" before it decides. Split that into an exported
`buildMcpFirstToolGateInputs({ req, tool, agentToken, userSub, userAcr, toolParams })` and have
`evaluateMcpFirstToolGate` call it. Same for the parameter map inside
`evaluateMcpToolDelegation` at
[pingOneAuthorizeService.js:579-630](../demo_api_server/services/pingOneAuthorizeService.js#L579-L630)
→ exported `buildMcpDelegationParameters(opts)`, with `evaluateMcpToolDelegation` becoming
`return _postDecisionEndpoint(endpointId, buildMcpDelegationParameters(opts))`.

Both extractions exist so the bulk path and the real gate build **the same parameters from the
same code** — the file's own C1 comments warn that two evaluations of one call seeing different
inputs is the failure mode to avoid.

Then:

- `agentPreflightService.evaluateBatch({ req, tools: [{ tool, params }] })` —
  resolve the MCP token **once**, build one parameters object per tool via the extracted
  builders, hoist the invariant attributes (`ActClientId`, `TokenAudience`, `McpResourceUri`,
  `UserId`, token claims…) into the bulk `parameters` block and leave only
  `ToolName` / `Amount` / `TransactionType` / `ResourceOwnerId` per item, then one
  `evaluateDecisionEndpointBulk` call.
- Every result stamped `advisory: true`. No HITL challenge minted; `HITL` / `STEP_UP` results
  carry `nextStep: 'preflight'`.
- Route `POST /api/authorize/pre-flight-bulk` next to `/pre-flight` at
  [authorize.js:1035](../demo_api_server/routes/authorize.js#L1035); body `{ tools: [...] }`.
  Returns `404` when `ff_authorize_bulk_preflight !== 'true'`.
- Flag registered in **both** places the repo requires:
  1. `configStore` DEFS at [configStore.js:285-310](../demo_api_server/services/configStore.js#L285-L310)
     — `ff_authorize_bulk_preflight: { public: true, default: 'false' }`
  2. `FLAG_REGISTRY` at [routes/featureFlags.js:33](../demo_api_server/routes/featureFlags.js#L33),
     category **PingOne Authorize** (alongside `ff_authorize_mcp_first_tool` at `:69`) — this is
     what makes it appear and toggle in the Feature Flags UI.

  Not a use-case chip, so no `requiredDemoFlags.js` entry needed.

### Relationship to the existing `McpToolsList` / `CandidateTools` path

Once bulk pre-flight is proven, `guardToolsList`
([pingAuthorizeGuard.ts:146](../demo_mcp_gateway/src/pingAuthorizeGuard.ts#L146)) could be backed
by it and get real-cloud per-tool verdicts instead of mock-only advice. **Out of scope here** —
noted so the two don't get built as rivals.

---

## Files

**New**
- `demo_api_ui/src/components/BulkDecisionPanel.jsx` (+ `__tests__/BulkDecisionPanel.test.jsx`)
- `demo_api_ui/src/config/bulkDecisionBundles.js`
- `demo_api_server/src/__tests__/pingOneAuthorizeBulk.test.js`
- `demo_api_server/src/__tests__/agentPreflightBulkParity.test.js`

**Modified**
- `.claude/skills/inspector-template/SKILL.md` — correct the two stale claims at `:150-152` (Part 0a)
- `demo_api_server/services/pingOneAuthorizeService.js` — content-type param, `_postBulkDecisionEndpoint`, `evaluateDecisionEndpointBulk`, `buildMcpDelegationParameters` extraction, exports
- `demo_api_server/routes/authorize.js` — `/evaluate-endpoint-bulk`, `/pre-flight-bulk`
- `demo_api_server/services/mcpToolAuthorizationService.js` — `buildMcpFirstToolGateInputs` extraction + export
- `demo_api_server/services/agentPreflightService.js` — `evaluateBatch`
- `demo_api_server/services/configStore.js` — `ff_authorize_bulk_preflight` default
- `demo_api_server/routes/featureFlags.js` — `FLAG_REGISTRY` entry for the same flag
- `demo_api_ui/src/components/PingOneAuthorizePage.jsx` — `TABS`, tab span, render branch

**Untouched by design:** `demo_authz_server/`, `simulatedAuthorizeService.js`, `ping-gateway/`,
`demo_mcp_gateway/`, every transaction/MCP enforcement call site.

### Explicitly out of scope (found, deliberately not done)

- **Merging the two decision round-trips per MCP tool call** —
  [mcpToolAuthorizationService.js:1055](../demo_api_server/services/mcpToolAuthorizationService.js#L1055)
  (`evaluateMcpToolDelegation`) then `:385` `_applyTransactionPolicy` → `evaluateTransaction`.
  Bulk cannot merge them: they hit **two different decision endpoints**
  (`authorize_mcp_decision_endpoint_id` vs `authorize_decision_endpoint_id`), and bulk batches
  within one endpoint.
- **`verifyAuthorizeCloudParity.js:139-161`** — ~9 rules × up to 2 probes, hand-throttled with
  `sleep(1400)` between each because of PingOne rate limits. The single best bulk win in the
  repo (~25 s of sleeps collapse to a couple of calls), but it's a script, not the demo. Good
  cheap follow-on once `evaluateDecisionEndpointBulk` exists.
- Backing `guardToolsList` with bulk (see above).

---

## What I will NOT break (REGRESSION_PLAN §1)

- `evaluateMcpFirstToolGate` decision behaviour — extraction only; a parity test asserts the
  pre/post parameters object is byte-identical for a fixed input.
- The single `/evaluate-endpoint` path — `_postDecisionWithAuth`'s new argument defaults to
  today's `'application/json'`.
- Fail-closed normalisation — bulk items go through the *same* `_normalizeDecision` /
  `_classifyRawObligations`; a length mismatch is `DENY`, never a skip.
- HITL / step-up enforcement — bulk mints no challenges and grants nothing.
- Emoji allowlist (`⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`) — the new UI uses only `⚠️ ✅ ❌ ✕ ✓`.
- All modals (if any) via `DraggableModal`; toasts via `utils/appToast`; HTTP via the
  page's existing `bffAxios`.
- The `console` / `guided` / `mockRules` / `scopes` / `snapshot` tabs and their `?tab=`
  deep links — `'bulk'` is appended to `TABS`, nothing reordered or renamed.

## Verification

Work in a git worktree (hard-blocked otherwise). Success = every line below green.

1. **Server unit**
   ```
   cd demo_api_server && CI=true npm test -- --forceExit
   ```
   New assertions: bulk `Content-Type` is exactly
   `application/vnd.pingidentity.decisionengine.authorize.bulk+json`; single path still sends
   `application/json`; 21 items rejected before any fetch; a 3-request/2-response reply yields
   index 2 = `DENY`; a `statements[].code` of `STEP_UP` on item 1 only sets `stepUpRequired` on
   item 1; parity test on the two extractions.

2. **Revert-to-RED proof** — after the extraction tests pass, restore the pre-extraction
   `evaluateMcpFirstToolGate` body and confirm the parity test *fails*. An extraction test that
   passes against both versions proves nothing.

3. **UI** — vitest, not jest. `npm run build` exiting `0` is the §0 gate; the test run alone
   does not satisfy it.
   ```
   cd demo_api_ui && npm run test:unit && npm run build
   ```

4. **Live end-to-end** — stack up (`./run-docker.sh`), sign in at
   `https://local.ping-devops.com:4000`, open **P1AZ Inspector → Bulk Decisions**:
   - Load **Amount ladder**, Run → 8 rows, verdicts flipping PERMIT→STEP_UP→DENY across the
     thresholds, one shared `correlationId`, `summary.successful` = 8.
   - **Request** tab shows the bulk media type verbatim.
   - Click **Load MCP tools** → rows match `GET /api/mcp/inspector/tools`.
   - Paste 21 items into the JSON tab → Run is disabled with the cap message.
   - Cross-check: run one ladder item through the existing **Live / Simulated Console**
     (`/evaluate-endpoint`) and confirm the verdict matches the bulk row. **This is the real
     proof** that bulk and single agree.
   - `docker logs demo-api-server | grep 'BFF→P1AZ'` shows **one** POST for the batch.
   - Regression sweep on the tabs I did not touch: `?tab=console`, `?tab=guided`,
     `?tab=mockRules`, `?tab=scopes`, `?tab=snapshot` each still deep-link and render.

   This click-through is what discharges the `inspector-template` skill's rule 5 — a green
   suite is not a substitute for it.

5. **Bulk pre-flight** — set `ff_authorize_bulk_preflight=true`, `POST
   /api/authorize/pre-flight-bulk` with the banking tool list, and diff each verdict against
   per-tool `POST /api/authorize/pre-flight`. Any disagreement other than RAR-attributable ones
   is a bug. With the flag off, the route must `404` and `/pre-flight` must be unchanged.

6. **Stale-doc fix verified** — re-read
   [SKILL.md:150-152](../.claude/skills/inspector-template/SKILL.md#L150-L152) and confirm the tab
   list and `fullHeight` value match the shipped code, including the new tabs from Part 3.

---

## Status

This is a **plan document only** — no code from Parts 1-4 has been implemented yet. It is
committed here so the design is reviewable before implementation begins on a separate branch.
