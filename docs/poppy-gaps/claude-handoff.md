# Poppy (Personal Agent Protocol) — Claude handoff

**Read this first when picking up any Poppy work.** Last updated: 2026-11-16.

The protocol's proper name is the **Personal Agent Protocol**; "Poppy" is the nickname. Always use the full name in UI copy, docs and teaching text; "Poppy" may appear as casual shorthand in code identifiers only.

## What this is

A two-sided demo of the Personal Agent Protocol, spec 1.0: https://personalagentprotocol.org/docs/1.0/spec

- **Company side** — AI-DEMO2 (this repo): `/poppy` page, BFF serves `/.well-known/poppy.json`, `/.well-known/oauth-protected-resource`, and `/poppy/api/v1/me` (CIMD bearer token + Poppy-Session). Inspector at `/poppy/inspector` (public, redacted; admin API full).
- **Agent side** — `~/Development/AI-DEMO-Standalone/standalone/poppy-agent-tester-LAB` (own repo, `curtismu7/poppy-agent-tester-LAB`): a Personal Agent you drive in a browser. One-click run, Atlas chat, diagram, Why Poppy, talk track. Ports 5450–5499. Served via lab proxy at https://local.ping-devops.com:8443/poppy-agent-tester/ and directly at https://127.0.0.1:5451.

Both sides speak **1.0**: AI-DEMO2 #3593 (merge `63ef64191`) and lab #8 (merge `b930cd9`) merged 2026-11-15. Main checkout synced, stack served from main, lab image rebuilt from the merged tree.

## Proven working end to end (2026-11-15)

Via the lab proxy: 1 click → discovery checks all pass → real PingFederate sign-in (as demoUser) → Allow → CIMD token → Company call HTTP 200 with full Poppy-Session chain. Earlier fixes merged: honest status rows on /poppy (AI-DEMO2 #3592), sign-in returnTo through the lab-proxy (LAB PR #7), lab-proxy now sends X-Forwarded-Prefix.

## Gaps we deliberately surface in the UI ("What's missing here")

- **PingFederate:** CIMD client registration is manual — an operator uploads the agent's `client.json` as a client.
- **PingOne:** no CIMD support yet; agent needs a registered client_id; PAR works but the agent document is not fetched.
- **SE cluster deploy:** deferred by owner decision; local Docker is the supported form.
- **No agent trusted by default** (spec 4.1): operator allow-lists in `POPPY_ALLOWED_AGENTS` — the demo agent is on it.

UI copy rule: say "authorization server", not PingFederate, when speaking about the protocol generally; naming PF is fine when describing what this run used.

## Status 2026-11-15: merged and deployed

- **Company:** https://github.com/curtismu7/AI-DEMO2/pull/3593 merged (`63ef64191`). Rename, `Poppy-Version` check, `protocol_version: "1.0"`. CI green after a follow-up commit: `tests/poppyInspector.test.js` also needed `Poppy-Version` on its requests (first CI run failed there).
- **Lab:** https://github.com/curtismu7/poppy-agent-tester-LAB/pull/8 merged (`b930cd9`). Items 1–5 plus the three-page Run it tab. Post-merge on the Air: server 84, web 37, scripts 31 pass.
- **Deployed:** AI-DEMO2 main checkout fast-forwarded by hand (`git merge --ff-only`; `sync-main-checkout.sh` backs off on stray untracked screenshots from other sessions, and has been for 38h+). Stack is served from main. The lab image was built from the merged tree, not the lab main checkout, because that checkout has another session's uncommitted `web/src/top-menu/*` edits a `--build` would ship. Rollback image: `poppy-agent-tester-poppy-agent-tester:prev-2026-11-15`. Worktrees and branches removed.
- **Proven live after merge (headless, through the lab proxy):** discovery 9/9 on 1.0; Company answers `version_unsupported` to a request without `Poppy-Version`; PingFederate accepted the PAR push (private_key_jwt) and showed its sign-in page for an address holding only `client_id` + `request_uri`.
- **Lab #10** (diagram narration, merge `fc0dd06`) merged and deployed 2026-11-15; lab #11 (agent chat takes Company/issuer) landed after it from another session.
- **Proven live end to end (2026-11-15T20:51:56Z):** the owner signed in by hand (an agent may not type the demo password). Company inspector entry: `GET /poppy/api/v1/me` 200, "Legit: the Poppy-Session delegation was signed by a key published at the agent's jwks_uri". That covers PAR to PF, sign-in, token and the signed call.

## Status 2026-11-16: lab #14–#20, AI-DEMO2 #3609

- **Lab #14** (`c0c51b1`): `PAT_DEMO_LOGIN_HINT` → `login_hint` on the authorize URL and the PAR push. Lab main checkout `.env` has `PAT_DEMO_LOGIN_HINT=demouser` (exactly that, lower case; never committed).
- **Lab #15** (`e61dd40`): PAR and token rows show the decoded form fields (client_assertion as header/claims), raw url-encoded body collapsed under it.
- **Lab #18** (`567aa8c`): sign-in returns to the tab that started it (`from: "chat"` / `"run"` on `/api/authorize`, back to `?signin=ok#chat`).
- **Lab #19** (`c022dd6`): Agent chat diagram — Simulate plays, and every step shows its narration (stacked layout when the page drives the arrow).
- **Lab #20** (`2cb5c1a`, another session): Verified / In progress mark in the header. Renders nothing until the shelf records a mark for `poppy-agent-tester` (none yet).
- **Deployed:** live image built from lab main `2cb5c1a` (2026-11-16). Rollback: `poppy-agent-tester-poppy-agent-tester:prev-2026-11-16`.
- **Submodule pin:** AI-DEMO-Standalone #290 (`56099c2`) pins `poppy-agent-tester-LAB` at `2cb5c1a`.
- **AI-DEMO2 #3609:** the Company inspector said "the response is invalid_session" for every refusal; it now names the code actually sent (version_unsupported, invalid_token, insufficient_scope). Merged 2026-11-16 (`28b860cf9`) and live: a request without Poppy-Version is explained as "the response is version_unsupported (spec 3.4)".
- **Lab main checkout** is still at `fc0dd06` and its `docker-compose.yml` predates the `PAT_DEMO_LOGIN_HINT` passthrough: deploy with the recipe below, not from that folder alone.
- **Decisions to confirm:** (a) the PingOne radio is only enabled when `PAT_DEMO_P1_ISSUER` is set in the lab `.env` (the tenant id stays out of the public repo); PingOne cannot complete a run yet (no CIMD), the gaps box says so. (b) the gaps box lists 3 gaps (PingFederate, PingOne, no agent trusted by default); the "SE cluster deferred" item is not in it. (c) a refused PAR push is an error, not a silent fall back to the plain URL.
- **Not done / not audited against 1.0:** `supported_versions`, `Poppy-Extensions`, `auth.disabled`, Device Sign-In, `poppy:browser-sign-in`, DPoP (the PAR teaching copy says this tester sends no DPoP). Read spec sections 3.4, 4.3 and 6 first.
- **Found on the way:** the Poppy jest suites lived in `demo_api_server/__tests__/`, which the default `testMatch` never matched, so CI skipped them. Moved to `tests/` in #3593.
- Lab main checkout has someone else's uncommitted edits (`web/src/top-menu/*`) and the untracked mock `web/mock/redesign.html`; both left alone.

## Original plan for the batch (all five items built; kept for reference)

### 1.0 conformance work (items 1–4, approved 2026-11-15)

Audit result: session/delegation signing and verification are conformant except the items below. Verified against the 1.0 spec text.

1. **Delegation rename** — `pap-delegation+jwt` → `poppy-delegation+jwt`, `pap_dlg` → `poppy_dlg`. BFF rename is DONE in worktree `.claude/worktrees/poppy-spec-10` (branch `feat/poppy-spec-10`, not committed). Lab still to do (`server/src/poppy.js:6` `DELEGATION_TYP`, plus `server/test/poppy.test.js`, `server/test/api.test.js`).
2. **Poppy-Version header** — agent MUST send it on every Session request (major.minor); Company MUST verify, reject with `version_unsupported` 400. Missing on both sides. BFF check goes in the session-verify path (`poppyApi.js` after scope check). Lab sends it in the `/api/call` request headers.
3. **Version bump** — BFF poppy.json: `protocol_version: "1.0"` (+ optional `supported_versions: {"0.3": <url>}`), served from `routes/poppyDiscovery.js` area — check how the doc is generated before editing. Lab: `SUPPORTED_VERSION` in `server/src/discover.js:7` → `'1.0'` with 3.4-style compatibility (same major). Lab's version discovery check must accept 1.0.
4. **PAR (RFC 9126)** — lab agent should use PAR when the issuer metadata advertises `pushed_authorization_request_endpoint` (spec: SHOULD; MUST when `require_pushed_authorization_requests` is true). Push the authorization params with the client assertion, open authorize with only `client_id` + `request_uri`. Lab code: `server/src/oauth.js` (`authorizationUrl`, `clientAssertion`).
5. **Teach PAR in the UI** — the redesigned calls page should have a note explaining PAR for Poppy (why: FAPI 2.0 companies require it; the code is bound to the key via DPoP-style proof). Also worth pointing out in teaching copy: DPoP, CIMD (client_id = URL, the core idea), RFC 8707 `resource`, private_key_jwt (RFC 7523), JARM/PAR family generally — pick 3–4, don't dump.

### UI redesign (mock approved pending these tweaks)

- Mock at `poppy-agent-tester-LAB/web/mock/redesign.html` (dev server: `python3 -m http.server 5499 --directory web/mock`). 3 pages, Prev/Next + dots at bottom.
  - P1: What & why (big pitch, "PERSONAL AGENT PROTOCOL · SPEC 1.0" eyebrow, 3 value cards, "What you'll see" strip).
  - P2: The calls — inspector-row style (one-line METHOD path … status, click to expand); inside: slim red-left-border "Why this call" note (prose or 3 numbered reasons), small key/value header strip, collapsed Raw response. Plus the authorization-server radio pair (PingFederate/PingOne, both "preconfigured") and the "What's missing here" box.
  - P3: Token & session — side-by-side claim tables, collapsed raw JWT.
- Build target: React in `web/src/components/`, wired to live `/api/state` steps (`kind: discover|authorize|token|call` with request/response). The user wants to see it built after items 1–4.

## Key files

- Lab agent: `poppy-agent-tester-LAB/server/src/{poppy.js,oauth.js,discover.js,app.js}`, tests `server/test/*.test.js` (80 tests, `npm test`).
- Lab UI: `web/src/components/RunPanel.jsx` (steps log currently the "huge boxes" the user dislikes — being replaced), `web/src/standalone-ui.css` (tokens, hash-pinned).
- BFF Company: `demo_api_server/services/poppySessionService.js` (verify/sign), `services/poppyInspectionService.js`, `routes/poppyApi.js`, `routes/poppyDiscovery.js`, config `config/auth-requirements.json` (`/poppy/inspector: public` must stay in sync with App.js; `npm run authz:verify`).
- Demo env: `demo_api_server/.env` — `POPPY_DOMAIN=localhost:3001`, `POPPY_ALLOWED_AGENTS=https://local.ping-devops.com:5451/client.json`.
- Lab compose: issuer-shim (TLS shim on ai-demo network aliased local.ping-devops.com:9031) + company-shim (localhost:3001 in the agent's netns) + agent with TLS on 5451.

## Gotchas that have bitten us

- `docker compose up -d --build` recreates the agent container but the **company-shim/issuer-shim share its netns and are NOT recreated** → `fetch failed`/ECONNREFUSED on discover. Fix: `docker compose up -d --force-recreate company-shim issuer-shim`.
- **Redeploy recipe (lab):** detached worktree of lab `origin/main` → `docker --context air buildx build -q -t poppy-agent-tester-poppy-agent-tester:latest --load .` → `docker --context air save … | docker --context orbstack load` → `docker compose -p poppy-agent-tester --project-directory <lab main checkout, for .env> -f <worktree>/docker-compose.yml up -d --no-build --force-recreate poppy-agent-tester`, then the same with `company-shim issuer-shim`. Verify: company-shim NetworkMode is `container:<agent id>`, `printenv PAT_DEMO_LOGIN_HINT` is `demouser`. In zsh, don't keep the compose command in a variable (it is not word-split).
- curl of the lab's `/assets/*.js` through the proxy returns the shelf HTML; a real browser loads it fine. Check through Playwright, not curl.
- Docker demo limit: shelf counts compose projects, limit 60. Stop stale labs via the shelf.
- The main AI-DEMO2 checkout hard-blocks commits (husky) — commit from a worktree (`.claude/worktrees/...`); run `npm ci` there before UI tests. `npm run build` in `demo_api_ui` is the UI gate.
- The AI-DEMO2 vite dev server hot-reloads from the mounted repo; the lab serves built assets — `npm run build --workspace web` then `docker compose up -d --build poppy-agent-tester` in the lab.
- Local ratchet tests may fail from stray untracked files in the shared checkout (e.g. another session's `TryPromptPicker.css`); CI runs a clean clone.
- PingOne issuer for this tenant: `https://auth.pingone.com/<env id>/as`, env id from the lab `.env` (`PAT_DEMO_P1_ISSUER`); has a PAR endpoint, no CIMD.
- Demo users: demoUser / demoAdmin (PingOne SSO behind PF). The password is not kept in the repo; ask the owner. Agents never type it.
- Pre-existing red on AI-DEMO2 main: contrastRatchet on PrivilegeOwaspTop10Page.css — not ours.

## Definition of done for the current batch

- `npm test` in lab: all green (update the counts as tests are added).
- BFF: `CI=true npm test -- --forceExit` in `demo_api_server` for touched suites; UI build 0.
- Live E2E through https://local.ping-devops.com:8443/poppy-agent-tester/ re-verified after the bump (discovery says 1.0, calls show `Poppy-Version: 1.0`, session chain works, PAR used when the shim advertises it).
- Both PRs merged (LAB repo + AI-DEMO2), containers rebuilt.
