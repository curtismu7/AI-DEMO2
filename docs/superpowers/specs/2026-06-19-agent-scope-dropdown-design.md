# Agent Scope Dropdown + Authorize Fallback — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Area:** Agent "Actions" popout — scope control, chip greying, Authorize resilience

## Problem

The agent **Actions** popout (the dropdown with the agent action chips) has four user-visible problems and one underlying resilience gap:

1. The **Agent scope** control ("Read only / Read + Write") is unstyled and reads as developer jargon — users don't know what it controls.
2. The popout is too small — content and tooltips clip at the bottom edge.
3. Chips grey out for **three different reasons** that all look identical, so it's never clear *why* a chip is disabled. The case in the reported screenshot is "Authorize unreachable," shown as a generic disabled chip with the tooltip *"Agent permissions unavailable — couldn't reach Authorize."*
4. The "Authorize unreachable" greying happens because the tool-list path has **no fallback**: when the PingOne Authorize decision fails, the gateway fails closed and every tool-backed chip greys out.

## Root-Cause Findings (from code + live diagnosis)

- **Unstyled control:** [ScopePicker.jsx](../../../demo_api_ui/src/components/ScopePicker.jsx) emits `.scope-picker`, `.scope-picker__label`, `.scope-picker__select`, and the row wrapper `.agent-scope-picker-row` — **none of these classes are defined in any CSS file.** It renders as a raw browser `<select>`.
- **Popout sizing:** [AIAgent.css `.ba-actions-popout`](../../../demo_api_ui/src/components/AIAgent.css) is `width: 320px; max-height: 380px` — clips the last chip and tooltips.
- **Three greying causes** in [BankingChips.jsx](../../../demo_api_ui/src/components/BankingChips.jsx) `chipPermState` / render:
  - `unverified` — tool-list fetch failed (`toolsError`), so a tool can't be verified → disabled (avoids a doomed click). **This is the screenshot case.**
  - `denied` — read-only scope blocks a write-backed chip (already shows 🔒).
  - `llmDisabled` — LLM-only chip with no LLM provider available.
- **No fallback in the tool-list path:** [demoAgentRoutes.js `POST /tools`](../../../demo_api_server/routes/demoAgentRoutes.js) → `resolveAvailableTools` → gateway. On any downstream failure it returns a 502, which drives `toolsError` → everything greys. The existing `authorize_failover_mode: 'fallback_simulated'` logic protects the *transaction* and *MCP-call* paths only — **not tool discovery.**
- **CRITICAL — discovery vs tool-call use DIFFERENT gateways:**
  - **Tool discovery (`tools/list`, what greys the chips)** goes over **WebSocket** to the **Node gateway** — [agentGatewayClient.js:280](../../../demo_api_server/services/agentGatewayClient.js#L280) → `mcpListTools` → `getMcpGatewayWsUrl()` (derived from `MCP_GATEWAY_HTTP_URL`, i.e. `mcp-gateway:3005`). The Node gateway evaluates Authorize via [PingOneAuthorizeClient.ts `evaluate()`](../../../demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts#L157), which POSTs to its single `PINGAUTHORIZE_ENDPOINT`. In the running container that endpoint is **`http://authz-server:9001` — the demo authz server itself.** So **discovery already runs on the demo authz server in this deployment; cloud PingOne Authorize is not in the discovery path here.**
  - **Tool calls** go over **HTTP** to **PingGateway (IG, :3036)** when `FF_MCP_GATEWAY_PINGGATEWAY=true` → [p1az-decision.groovy](../../../ping-gateway/scripts/groovy/p1az-decision.groovy), which picks mock (`P1AZ_MOCK_BASE`) vs real cloud (`P1AZ_REAL_BASE`) by the `X-Authz-Simulated` header the BFF stamps (= `ff_authorize_simulated`).
- **Neither gateway has real→mock failover.** Both **fail closed** on a real-backend exception/5xx: the Node client returns `{ decision: 'DENY', reason: 'Authorization service unavailable' }` ([PingOneAuthorizeClient.ts:213-217](../../../demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts#L213)); the groovy denies with `FORBIDDEN` ([p1az-decision.groovy:293-297](../../../ping-gateway/scripts/groovy/p1az-decision.groovy#L293)).
- **Consequence for the reported symptom:** because discovery already uses the demo authz server here, the greyed chips in the screenshot were **almost certainly a transient blip** — the discovery WebSocket to the Node gateway, the RFC 8693 token exchange, or the Node gateway → `authz-server:9001` hop failing during the deploy — **not** a cloud-Authorize outage. A cloud→mock failover would not change that path in this deployment.
- **Where real→mock failover *does* matter:** a **real-mode** deployment whose gateway is pointed at cloud PingOne Authorize (Node gateway `PINGAUTHORIZE_ENDPOINT` = cloud decision URL, or PingGateway in `X-Authz-Simulated: false`). There a cloud outage genuinely fails closed today, and the failover keeps the demo working.

## Goals

1. Make the scope control legible (styled + explained) without removing its teaching value.
2. Stop the popout from clipping.
3. Make each of the three grey states visually and textually distinct.
4. Add **self-healing, per-fetch failover** from real PingOne Authorize to the demo authorize server so the "Authorize unreachable" greying stops happening in the normal case — leaving the grey state only for the rare "both down / gateway unreachable" case.
5. Tell the user, once per session, when the demo authorize server is handling decisions because PingOne Authorize was unreachable.

## Non-Goals

- Changing the underlying scope boolean (`agentAllowWrite`) or the chip→routing→MCP pipeline (skip-proof contract is invariant).
- Changing the Authorize decision contract / request-response shape (keeps `authz-server-parity` intact).
- A sticky, session-wide engine switch (we chose self-healing per-fetch instead).
- Investigating cloud PingOne Authorize availability itself.

## Design

### Part 1 — Scope control copy (keep labels, add explainer)

- **Keep** the option labels `Read only` / `Read + Write` and the **Agent scope** label (preserves the teaching vocabulary).
- **Add** a single high-contrast helper line beneath the control:
  > *Controls the OAuth scopes in the agent's token. "Read only" greys out write actions via PingOne Authorize.*
- Helper text uses a solid, high-contrast color — **no low-contrast/muted hint text** (per `feedback_no_muted_modal_text`).
- No behavioral change; `ScopePicker` still emits a boolean via `onChange`.

### Part 2 — Style the scope control

- Add a real CSS block (in `BankingChips.css`, co-located with the popout's other chip styles, or a dedicated `ScopePicker.css`) for `.agent-scope-picker-row`, `.scope-picker`, `.scope-picker__label`, `.scope-picker__select`, and `.scope-picker__hint`.
- Use the popout's existing design tokens (`--ba-surface`, `--ba-border`, `--ba-text`, `--ba-bg`) so it matches light/dark panel modes.
- Layout: a padded full-width row inside the popout; the label above a properly-styled select (or segmented control) with a visible focus ring. The control fills the popout width rather than floating inline.

### Part 3 — Popout sizing

- In `.ba-actions-popout`: widen from `320px` to **~360px** and raise `max-height` from `380px` to **~70vh** (keep `overflow-y: auto`).
- Verify the scope row + full chip grid + a bottom tooltip no longer clip at the smallest supported viewport.

### Part 4 — Distinct grey states

In `BankingChips.jsx`, give each disabled cause a distinct affordance + tooltip (already partly present):

| Cause | State flag | Affordance | Tooltip |
|-------|-----------|-----------|---------|
| Scope-denied (read-only blocks write) | `denied` | 🔒 (existing) + dashed border | "Denied by Authorize: <reason>" (existing) |
| LLM-only, no provider | `llmDisabled` | "LLM" badge styling | "Needs an LLM — switch to Ollama, Anthropic, or Helix mode" (existing) |
| Authorize unreachable (both down) | `unverified` | ⚠ warning affordance (new, distinct from 🔒) | "Authorize unavailable — couldn't reach PingOne or the demo authorize server. Retry shortly." (reworded so it's clearly the both-down edge case) |

The `unverified` state remains a real, intentional last resort — it just becomes rare once Part 5a lands, and is now visually distinct from a scope denial.

### Part 5a — Discovery resilience (fixes the actual greyed-chips symptom)

This is backend-agnostic: it makes the tool-list fetch survive a transient failure of the discovery leg (WS to the Node gateway, RFC 8693 exchange, or the Node gateway → authz-server hop), which is what actually greyed the chips in this deployment.

**BFF — `resolveAvailableTools` / `POST /tools`:**
- On a discovery failure that is **not** `need_auth` (i.e. not a 401/session-expired — those must still surface so the user re-authenticates), **retry once** after a short backoff before giving up.
- If the retry also fails, return a **degraded** response: the local tools catalog ([agentGatewayClient.js `getLocalToolsCatalog()`](../../../demo_api_server/services/agentGatewayClient.js)) with every tool marked `permitted: true` and a new top-level flag `degraded: true` + `degradedReason: 'discovery_unreachable'`, HTTP 200. This keeps chips usable instead of greying them all. (Local catalog is unfiltered by scope — acceptable in degraded mode; the per-call Authorize at click time still gates writes.)
- 401/`need_auth` continues to return the existing 401 shape (no degraded fallback).

**UI — `AIAgent.js` / `fetchAgentTools`:**
- `fetchAgentTools` returns the new `degraded` / `degradedReason` fields.
- When `degraded` is true, set a `degradedAuthz` state instead of `agentToolsError`, drive the once-per-session modal + badge (see Part 5c), and treat the catalog tools as permitted so chips render normally.

### Part 5b — Real→mock Authorize failover in the gateways (the "P1 fails → demo authz" concept)

Only bites in **real mode** (gateway pointed at cloud PingOne Authorize). Keeps a real-mode demo working when cloud Authorize is unreachable.

**Node gateway — [PingOneAuthorizeClient.ts `evaluate()`](../../../demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts#L157):**
- Add a config field `pingAuthorizeMockBase` (env `PINGAUTHORIZE_MOCK_BASE`, e.g. `http://authz-server:9001`).
- In the `catch` (currently returns `{ decision: 'DENY', reason: 'Authorization service unavailable' }`) **and** on a 5xx response: if `pingAuthorizeMockBase` is set **and differs from** `pingAuthorizeEndpoint` (i.e. the primary is *not already* the mock), **retry the same decision against the mock base** and return its decision with `engine: 'mock-failover'`.
- If the primary endpoint already *is* the mock (this deployment), there is nothing to fail over to → keep failing closed (`engine: 'mock'`).
- Add `engine?: 'real' | 'mock' | 'mock-failover'` to `AuthzDecision`; the WS transport surfaces it in the `tools/list` result `_meta` so the BFF can read it.
- A real `200 + DENY` is a valid decision — **do not** fail over on it.

**PingGateway — `p1az-decision.groovy`:**
- In the decision `try` block, when `simulated == false` (real backend) and the call fails (`r.code == 0` httpPost exception, or `r.code >= 500`): **retry against `P1AZ_MOCK_BASE`**, set `outcome` from the mock, and tag the audit trail `backend: 'mock-failover'`.
- If the mock also fails → keep the existing fail-closed `DENY`.
- A real `200 + DENY` is valid — **do not** fail over on it. Worker-token 401 refresh-and-retry is unchanged.

### Part 5c — Once-per-session modal + badge (shared by 5a and 5b)

- When the session first enters a degraded/failover state (Part 5a `degraded`, or a Part 5b `mock-failover` engine seen on any response), show a **dismissible modal once per session**:
  > **Using the demo authorize server.** PingOne Authorize was unreachable, so authorization decisions are being handled by the local demo authorize server. Functionality is unaffected; decisions may differ from production policy.
- While degraded, show a small **persistent badge** in the Actions popout (e.g. "Demo Authorize") so the state is discoverable after the modal is dismissed.
- Self-healing: the next successful non-degraded fetch clears the state and drops the badge (the modal does not reappear that session).
- Modal copy uses solid high-contrast colors (no muted hint text).

## Behavior After This Change

- **Discovery healthy (any backend):** unchanged — chips populate, no modal.
- **Discovery leg blips (WS / exchange / authz-server hop):** BFF retries once; if still failing, returns the local catalog with `degraded: true` → chips stay usable; user sees the modal once + a badge. Self-healing — the next successful fetch clears it.
- **Real mode, cloud PingOne Authorize unreachable (Part 5b):** the gateway fails over to the demo authz server per request; chips/calls keep working; `engine/backend: 'mock-failover'` surfaces → modal once + badge.
- **Both backends down / session expired:** discovery 401 → existing re-auth prompt; or, if both the gateway and its mock are unreachable, the local-catalog degraded path still renders chips (worst case a click is later denied at call time). The `unverified` ⚠ state remains only for a genuinely unresolvable fetch.
- **Simulated mode (default deployment):** discovery already on the mock; Part 5b is a no-op (primary == mock, nothing to fail over to); Part 5a still protects against WS/exchange blips.

## Affected Files (anticipated)

- `demo_api_ui/src/components/ScopePicker.jsx` — explainer line + classes (Part 1)
- `demo_api_ui/src/components/BankingChips.css` (or new `ScopePicker.css`) — scope-control styles (Part 2)
- `demo_api_ui/src/components/AIAgent.css` — popout sizing (Part 3)
- `demo_api_ui/src/components/BankingChips.jsx` — distinct grey states (Part 4)
- `demo_api_ui/src/services/demoAgentService.js` — surface `degraded`/`degradedReason` (Part 5a)
- `demo_api_ui/src/components/AIAgent.js` — degraded/failover detection → modal/badge wiring (Part 5a/5c)
- `demo_api_ui/src/components/DemoAuthzFallbackModal.jsx` (+ `.css`) — new modal (reuses `DraggableModal` pattern) (Part 5c)
- `demo_api_server/services/agentToolsResolver.js` — retry-once + local-catalog degraded fallback (Part 5a)
- `demo_api_server/routes/demoAgentRoutes.js` — pass `degraded` through the `/tools` response (Part 5a)
- `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` — real→mock failover + `engine` field (Part 5b)
- `demo_mcp_gateway/src/auth/GatewayConfig` + WS transport — `pingAuthorizeMockBase`, surface `engine` in `_meta` (Part 5b)
- `ping-gateway/scripts/groovy/p1az-decision.groovy` — real→mock failover (Part 5b)

## Verification / Success Criteria

1. Scope control renders styled (not a raw `<select>`) in both light and dark panel modes, with the explainer line visible and high-contrast.
2. Popout shows the full chip grid + scope row + a bottom-edge tooltip with no clipping at the smallest supported viewport.
3. Each of the three grey states is visually distinct and has an accurate, distinct tooltip.
4. **Part 5a:** with the discovery WS/exchange forced to fail (non-401), `POST /tools` returns `degraded: true` + the local catalog after one retry; chips render as usable; the modal appears once; the badge persists; a subsequent healthy fetch clears it. A 401/session-expired still returns the re-auth shape (no degraded fallback).
5. **Part 5b:** with `PINGAUTHORIZE_MOCK_BASE` set to a working authz-server and the primary endpoint pointed at an unreachable real URL, `evaluate()` returns the mock's decision with `engine: 'mock-failover'`; the groovy tags `backend: 'mock-failover'`. When the primary already equals the mock, no failover occurs (`engine: 'mock'`).
6. A real `200 + DENY` decision still denies (no failover on a valid deny), in both gateways.
7. `cd demo_api_ui && npm run build` exits 0; gateway `npm run build`/tsc passes; no regression to the chip→routing→MCP pipeline; `authz-server-parity` decision contract unchanged (failover reroutes on error only — same request/response shape).
