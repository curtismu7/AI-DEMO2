# Personal agent: handoff

Written 2026-10-21 for engineers and agents picking up `/personal-agent`. Facts are from the code in PR #1682
(branch `worktree-pa-connector-flow`) unless marked *(notes)*, which means they come from earlier session notes and
were not re-checked here.

## What it is

`/personal-agent` is the page where a person talks to an AI agent whose every tool call is governed by Ping:
sign-in, RFC 8693 token exchange, PingOne Authorize, the MCP gateway. The page shows the chat, the security gates, the
movie reel (live token chain) and the tokens.

## Routes (demo_api_ui/src/App.js)

| Route | What |
| --- | --- |
| `/personal-agent` | The studio (`pages/PersonalAgentStudioPage.jsx`). Tabs: Agent, **Add to ChatGPT / Claude** (`?tab=connector`), Delegation proof (`?tab=obo`). Layout `?layout=stacked\|cockpit`. |
| `/personal-agent/full` | Same page, bare (no app chrome) |
| `/personal-agent/client` | Pop-out client window (`PersonalAgentClientWindow.jsx`), `?skin=&theme=` |
| `/personal-agent/dot`, `/dot/full` | The Dot workbench (own memory) |
| `/personal-agent/learn` | Guided/lesson page (`PersonalAgentLearnPage.jsx`, `config/studioLearn.js`), owned by agents-f1 |

## How the chat works (existing path)

1. The page posts to `/api/agent/invoke` with `{ prompt, vertical, agentMode }`.
2. The BFF (`demo_api_server`) holds the PingOne tokens, does the token exchange and calls the gateway.
3. The reply carries `tokenEvents`. `TokenChainContext` and `tokenChainTraceStore` turn them into the security rail
   (`SecurityRail`, `GateChips`), the reel (`TokenChainFilmstrip` + `TokenChainNodeRail`) and `TokenCards`.
4. A 428 `requiresConsent` starts a PingOne MFA challenge in the page, then retries the prompt.
5. Skins (`AgentClientSkin.jsx`: privilege, claude, claude-terminal, gpt, gemini, cua, dot) are presentation only.

The chat does **not** run an OAuth authorize/consent/code flow. The connector tab (below) is the part that does.

## What PR #1682 added

### 1. "Add to ChatGPT / Claude" tab: the 12-step connector flow, run for real

Follows the "How ChatGPT accesses Optum benefits" diagram (CIMD discovery, IdP consent, P1AZ, permitted MCP access).

- UI: `components/ConnectorFlow.jsx/.css`, step logic `utils/connectorSteps.js`, diagram `config/connectorFlowDiagram.js`
  (consumed by the shared `EmbeddedFlowDiagram`, so it has Simulate, Reset, speed and movable boxes).
- Backend: `services/connectorSandbox.js` (all logic) and `routes/connectorSandbox.js`, mounted in `server.js` at
  `/api/connector-sandbox`.

Why a sandbox: none of our existing authorization servers do CIMD, `private_key_jwt` or a consent screen, and the
vendor Privilege gateway cannot be made to. The sandbox plays ChatGPT, the authorization server, the MCP gateway, the
policy decision point and the benefits API in one process. Every leg runs real logic:

| Steps | What actually happens |
| --- | --- |
| 1-3 | Tokenless `tools/call` gets 401 + `resource_metadata`; RFC 9728 and RFC 8414 documents |
| 4-5 | `/authorize` with PKCE S256 and a client_id that is the CIMD document URL; client acceptance against that document |
| 6 | Consent page. Approve stores a consent record (id, version, member, client, scope, resource). Deny issues no code |
| 7-8 | Code + PKCE verifier + RS256 `private_key_jwt` assertion, verified against the client's JWKS. One-time code, `jti` replay check. Audience-bound RS256 access token |
| 9 | Gateway checks signature, issuer, audience, expiry, scope, member, consent (shown in the "Gateway token checks" card) |
| 10-12 | Policy decision with the diagram's inputs (member, client, tool, action, resource, consent id/scope/risk). Permit calls the benefits API; Deny stops. `get_other_member_benefits` demonstrates the Deny |

Endpoints under `/api/connector-sandbox`: `/.well-known/oauth-protected-resource`, `/as/.well-known/oauth-authorization-server`,
`/as/jwks.json`, `/client.json`, `/jwks.json`, `POST /mcp`, `GET /as/authorize`, `GET|POST /as/consent`, `GET /callback`,
and for the page `POST /runs`, `GET /runs/:id`, `POST /runs/:id/token`, `POST /runs/:id/call`.

**Honest limits (do not describe these as more than they are):**

- The P1AZ engine is **simulated**. No PingOne Authorize policy exists for these attributes; `decide()` in
  `connectorSandbox.js` applies three rules and labels itself "simulated PingOne Authorize policy".
- The member is the signed-in demo (PingOne) session. The sandbox has no login of its own.
- The authorization server reads the CIMD document and JWKS **in-process**; the same JSON is also served at its URL.
- Consent records, codes and keys are in memory. A restart invalidates runs and tokens.
- "ChatGPT" and "Claude" are skins on the same stand-in client. It is not the real ChatGPT or Claude.
- The step-12 explanation is a templated sentence, not a model call.

### 2. Section divider between 4 (Tokens) and 5 (Clients)

One line in `PersonalAgentStudioPage.css`: `.pas-c-cards { border-top: 2px solid var(--th-border) }`. Stacked layout only.

### 3. Empty movie reel is now a static preview

Before any run, "Live pipeline - awaiting agent action" used to show pastel chips. It now renders the real
`TokenChainNodeRail` with a new `preview` prop: the typical steps from the store's own catalog
(`PREVIEW_STEP_IDS` in `TokenChainFilmstrip.jsx`), every status forced to "waiting", `detail` dropped (no invented facts),
nodes disabled, run controls hidden. A real run replaces it. The old `.tcfs-empty-chip*` CSS is gone, so the literal
font-size pin in `src/__tests__/designTokenRatchet.test.js` was lowered to 2309.

## Tests

| Where | Command |
| --- | --- |
| Sandbox end to end (12 steps, Deny, denied consent, replay, wrong-key token, auth, run isolation) | `cd demo_api_server && CI=true npx jest tests/routes/connectorSandbox.flow.test.js --forceExit` |
| Step logic, diagram config | `cd demo_api_ui && npx vitest run src/utils/__tests__/connectorSteps.test.js src/config/__tests__/connectorFlowDiagram.test.js` |
| Component against the real sandbox (permit, Deny at step 10, consent denied) | `npx vitest run src/components/__tests__/ConnectorFlow.integration.test.jsx` |
| Reel preview | `npx vitest run src/components/__tests__/TokenChainFilmstrip.test.jsx` |
| Reel on screen (Playwright) | `CI=true BANKING_UI_PORT=4173 node_modules/.bin/playwright test tests/e2e/movie-reel-visible.spec.js` |

## Known traps

- **Worktrees have no `node_modules`.** `bash scripts/bootstrap-worktree.sh` symlinks them. Remove the links
  (`find . -maxdepth 2 -name node_modules -type l -delete`) before serving a worktree in the stack, or the container
  breaks. The script also warns about `@cedar-policy/cedar-wasm` and `xml-crypto` missing from the main install. That
  makes `src/__tests__/App.session|App.structure`, three `privilegeMcpClient` suites and `npm run build` fail locally with
  no relation to a change. Fix: `npm --prefix <main>/demo_api_ui install` (and `demo_api_server`) in the main checkout.
- **The reel guard needs a working dev server.** With the cedar package missing, all 9 cases of `movie-reel-visible.spec.js`
  fail the same way and prove nothing. The preview is taller than the old chips, which is how this guard has failed before.
- **The app zoom is 112.5%** *(notes)*, so `getBoundingClientRect` reads 1.125x the CSS px.
- **Design ratchets**: new CSS must use `--th-*` tokens and `--font-size-*`; the literal font-size count is pinned.
- **supertest binds a new port per request**, so the sandbox's client document URL changes between calls unless
  `PUBLIC_APP_URL` is pinned (the sandbox test does this). A real deployment has one stable origin.
- **Shared stack**: `npm run serve:worktree here` repoints the shared local stack at a worktree. Check what it serves
  first (`bash scripts/serve-worktree.sh`), other sessions may be using it.

## Not verified (as of this writing)

- Nothing here has run in a real browser against the stack. The consent popup and the diagram's look are only covered by
  tests (the integration test performs the popup's browser legs with fetch).
- The reel-on-screen Playwright guard has not run green with the preview (see traps). CI on #1682 had one failure, the
  font-size ratchet, fixed in the latest commit; the re-run had not reported when this was written.
- The diagram has 37 arrow crossings (its test caps at 37). Moving boxes would tidy it.
- `/chatgpt-login` (`pages/chatgptLoginDiagram.js`) and the Learning Hub card still show the older ChatGPT-login flow
  without CIMD or P1AZ. Per the diagram/demo/Learning Hub sync rule they should be brought to the same 12 steps.

## Next steps, in order

1. Confirm CI on #1682 is green, including the reel guard. If the guard fails on height, shrink the preview.
2. Test live at `https://ai-demo.ping-devops.com/personal-agent?tab=connector` after deploy: run all 12 steps, deny consent,
   try the other-member tool.
3. Sync `/chatgpt-login` and the Learning Hub card to the 12 steps.
4. Replace the simulated decision with a real PingOne Authorize policy if the demo needs P1AZ to be the real engine.

## Coordination

agents-f1 plans to merge `/personal-agent` and `/personal-agent/learn` into one base page with a Guided default view, built
on top of #1682. They asked to be told when #1682 merges, and will not touch `PersonalAgentStudioPage.jsx` or
`TokenChainFilmstrip.jsx` until then. Keep the connector tab and the `.pas-c-cards` divider through that merge.
