# PA2 — Personal Agent handoff

Handoff for the `/personal-agent` page (the "Digital Assistant" Studio). State as of 2026-10-21. Everything below is merged to `main` and live on the SE cluster unless it says otherwise.

Test URL: https://ai-demo.ping-devops.com/personal-agent?skin=claude
Layouts: `?layout=stacked` or `?layout=cockpit`

## What the page is

`demo_api_ui/src/pages/PersonalAgentStudioPage.jsx` (+ `.css`). One DOM, two layouts (Stacked, Cockpit) switched by a header control. The choice is remembered in `localStorage` key `pas-layout`; `?layout=` in the URL wins.

Parts, top to bottom: header (vertical picker, agent mode Heuristics | llama.cpp, skin tabs, layout switch), chat (`AgentClientSkin`), movie reel (`TokenChainFilmstrip`) with real token cards (`TokenCards`) when no reel is running, gate chips (`GateChips`), "Expand for Diagram", and the setup panels (LibreChat, LM Studio, Dot) at the bottom.

Every skin posts to `POST /api/agent/invoke` with `{ prompt, vertical, agentMode }`. The vertical is `selectedVertical || routeVertical || activeId || 'airlines'`.

## Shipped today

| PR | What |
|----|------|
| #1594–#1644 (many) | Stacked / Cockpit layouts, real-data TokenCards, reel-on-screen guard, airline reply copy, nginx 502 handling |
| #1654 | Vertical picker on the page; chat, prompts and greeting follow the active vertical |
| #1662 | Unknown-action fallback uses the active vertical's catalog, not banking prompts |
| #1668 | `mcp-server` logs the reason for every 401 (`[HttpMCPTransport] 401 unauthorized — …`) |
| #1669 | "decode my jwt token" decodes the session token in chat, in every vertical |
| #1677 | JWT reply leads with a success line and groups claims in sections |
| #1683 | Chat bubbles keep line breaks (`white-space: pre-wrap` in `AgentClientSkin.jsx`) |
| #1686 | Suggestion chips skip feature-demo chips (`show_*` tools) that chat cannot run |

Mocks the layouts came from: `~/Downloads/personal-agent-mocks/` (A stacked, B cockpit, C receipt, D hybrid, E token details, F cockpit restyled).

## Things that are not obvious

**Vertical switching and tool calls**
- Airlines tools go gateway → invest route → `mcp-resource-server`. Walbuy, healthcare, retail and most other verticals go gateway → OLB route → `mcp-server` (`PG_OLB_BACKEND_URL`).
- A tool call can fail with the chat message "The MCP gateway rejected the agent's access token". The gateway collapses the real error to `{"error":"mcp_tool_call_failed","http_status":401}`. The reason is only in `mcp-server`'s own logs now (#1668).
- On 2026-10-21 that 401 hit the OLB route and cleared after restarting `mcp-server`. The root cause was never seen. If it returns, read the `401 unauthorized — …` line in `kubectl logs deploy/mcp-server` before restarting anything.

**Token exchange (RFC 8693)**
- Symptom `invalid_grant` / "Subject token REJECTED by the tenant token-exchange policy": PingOne rejects the session's login client at exchange. Client `83572007-b2c7-4862-8197-dc225a9fb8e1` is the user login app (`PINGONE_USER_CLIENT_ID`). Cause was a tenant-side setting; enabling token exchange for it fixed it. The boot probe in `demo_api_server/services/exchangeSubjectProbe.js` names such a client in the log (`[EXCHANGE-PROBE]`).
- The session access token has `aud` `enduser.ping.demo`, header `kid` `"default"`, and a `may_act` claim. Claims are viewable while signed in at `/api/auth/oauth/user/token-claims` (decoded claims only, never the raw token).

**Chat replies**
- Heuristic routing is `demo_api_server/services/nlIntentParser.js` → `demoAgentLangGraphService.js`. A prompt that resolves to a client-dispatched action (`CLIENT_DISPATCHED_ACTIONS`: `invest_demo`, `vertical_feature_demo`, `mcp_tools`, …) returns `null` and the chat answers with the capabilities list. Every vertical's `*-feature` chip ("Portfolio status", "Permit status", "My health record", …) is one of these. Typing one of those prompts by hand still gets the capabilities list, and that list advertises the same prompt. Not fixed.
- `dispatchBankingAction` is the shared handler for banking-kind actions in all verticals. Its unknown-action fallback is vertical-aware through `ctx.catalogCtx`.
- Reply text for the 8 airline tools lives in `airlineReply()` in `demoAgentLangGraphService.js`. Goldens in `data/goldens/airlines/*.json` hold the OLD text and need a live recapture (needs a live run), not an edit.

**Layout and tests**
- The app applies a 112.5% zoom (`--app-zoom`): `getBoundingClientRect` reads 1.125× the CSS px.
- `tests/e2e/movie-reel-visible.spec.js` needs the reel on screen with no scroll at 1280×720. Run it locally before merging any layout change: `CI=true BANKING_UI_PORT=4173 node_modules/.bin/playwright test tests/e2e/movie-reel-visible.spec.js`.
- Repo guards that failed CI for me: `designTokenRatchet` (no literal px `border-radius`/`font-size`; use `var(--radius-*)`, `var(--font-size-*)`), `uiRegression` (no literal monospace; use `var(--font-mono)`). Run the whole `src/__tests__/` group (`npx vitest run src/__tests__/`) before a UI PR. Two App tests fail locally if `@cedar-policy/cedar-wasm` is missing from `node_modules`; CI is fine.
- Inline `flex:1` on `.pas-c-chat` beat a CSS `height`; move inline layout rules into the stylesheet before overriding.
- Chat message text lives in inline styles in `AgentClientSkin.jsx`; there is no markdown rendering, only plain text with `pre-wrap`.

**Deploy (SE cluster, namespace `ping-devops-cmuir`)**
- Merge → wait for the "Build images" run on the merge SHA → `kubectl set image` → verify the pod `imageID` digest equals the registry digest. Frontend: `deploy/frontend` container `frontend`, 2 replicas, no outage. API: `deploy/demo-api-server` container `api-server`, 1 replica, about 1–2 minutes of 502 per deploy, and sessions are lost. `deploy/mcp-server` container `mcp-server`.
- A "Build images" failure of `Put https://ghcr.io/...blobs/upload` is a transient push error; `gh run rerun <id> --failed` fixed it on the third try.
- A watcher must require real checks (for example "API server tests (Jest)", "UI tests (Vitest) + build") to be finished on the current head. An empty status rollup is not green.
- A merge can have no "Build images" run of its own when other merges land right after it. Deploy a later main build that contains your commit (`git merge-base --is-ancestor`), and note what else it carries.
- Main checkout is shared with other sessions: work in a git worktree.

## Open items

1. Investment (and other verticals): "decode my jwt token" now works, but typing a feature-demo prompt (for example "show portfolio status") still returns the capabilities list. Either teach chat to run these demos or stop advertising them in the catalog.
2. Root cause of the OLB-route 401 on `mcp-server` is unknown (see above).
3. Airline goldens need a live recapture.
4. Another session is merging `/personal-agent` with `/personal-agent/learn` into one page with a Guided view. Coordinate before large edits to `PersonalAgentStudioPage.jsx/.css`, `AgentClientSkin.jsx`, `TokenChainFilmstrip.jsx/.css`.
5. Walbuy/healthcare/airlines were verified by the owner with real prompts on 2026-10-21; investment, retail, government, manufacturing, university, workforce and sporting-goods were not.
