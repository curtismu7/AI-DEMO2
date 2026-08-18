# Handoff — 2026-08-17: the auth SoT, and the sign-in paths around it

Started from one screenshot: UC24 Act 1 ("What branches are near me?") answered
correctly, and then a banner covered it reading *"For a more personalized
experience, please sign in."* Act 1 is **defined** as the step that needs no
session, so the banner was wrong — and nothing in the codebase knew which use
cases are public, which is what the rest of this work fixed.

Six PRs merged, all deployed and verified against the running stack:
**#1936, #1943, #1952, #1958, #1962, #1967.**

One defect is still open and written up at the bottom. It is not a regression
from this work — it predates it — but it is reachable from the paths this work
added, and it bricks the agent panel until reload.

---

## Read this first — the pattern that produced almost every bug here

**Every real defect this session was found by driving the running stack, not by
reading code. Three of my code-reading hypotheses were disproved by a live
probe, including two I was confident enough to write into a PR body.**

- The banner was not the agent failing. `POST /api/agent/invoke` returned **200
  with all seven branch cards**; a *side-effect* call, `PATCH
  /api/admin/feature-flags`, returned 401 and that 401 raised a global banner
  over a correct answer. Read the network panel before the code: if the failing
  request is not the one under test, the feature is fine and something else is
  talking.
- A passing test is not a working feature. #1958 shipped a bubble promising
  *"I'll answer it as soon as you are"* with a green test — the test asserted the
  bubble appeared, and the bubble was never the broken part. The live probe
  showed `bx_agent_pending_nl: null`. Assert the **effect**, not the render.
- `X-Active-Vertical` was reported (by me) as an ignored inbound header. It is
  **outbound only** — BFF → MCP gateway, `mcpGatewayClient.js:215`. The UI never
  sends it and no route reads it. The original repro asserted a contract that
  never existed.

---

## What shipped

### #1936 — the SoT itself

`demo_api_server/config/auth-requirements.json` declares, for every use case and
admin demo step, one of `public | user | admin`. Served to the UI as `uc.auth`
on `GET /api/use-cases`, alongside `publicAgentActions`, so the client never
keeps its own copy.

- **Level semantics:** the auth needed to *reach* the surface — send the chip,
  open the linked page — not the strictest thing reachable from inside it. A
  public learning page may still hold a button that needs a session.
- **Fails closed:** `authLevelForUseCase()` answers `user` for anything
  unlisted, so a new use case is protected by omission, never exposed by it.
- The original bug's fix: a `public` use case skips feature-flag arming
  entirely, because arming PATCHes an admin route whose 401 raised the banner.

### #1943 — the SoT made binding on the routes

All 153 routes are declared, **seeded from the guards App.js already enforced**,
so adopting the file changed no behaviour. `npm run authz:verify` (now a step in
CI's gates job) fails on: an unlisted use case, an unknown level, a use case
more public than the route it links to, a drifted `PUBLIC_GUEST_ACTIONS`, and a
route whose real guard disagrees with the file.

**The guards stay written inline in App.js, deliberately.** `RequireAdminLogin`
renders a *"Log in as admin? Your current session will end."* ConfirmModal
rather than redirecting, and `App.structure.test.js:140` pins that. Replacing it
with a wrapper would change admin UX across 29 routes and delete a safety net
for no observable gain. The gate makes the two agree instead.

`scripts/lib/appRouteAudit.js` reads the guard React *actually* applies by
walking the JSX tree. This matters:

```
regex scan:  /users -> public     <- wrong; a gate that says this is worse than none
AST walk:    /users -> admin      <- inherited from a RequireAdminLogin ancestor
```

**29 of the 30 admin routes carry no guard of their own.** Both `/users` and
`/feature-flags` were confirmed live: admin modal, no data leaked.

Its tests run under `node --test` in the hygiene job, **not jest** — jest
resolves modules from the requiring file's directory, and this module lives at
the repo root where CI installs nothing. Neither `require.resolve(…, {paths})`
nor `createRequire` changes that; both were tried and both failed in CI while
the plain-node gate passed on the same checkout.

### #1952, #1958 — refusals that offer a way in

`POST /api/use-cases/demo/run` gates per declared level instead of demanding a
session from everyone (UC24 could not run at all before). A refusal now names
what it wants, so a client can render a button:

```json
{ "requiresLogin": true, "requiredAuth": "user" | "admin", "message": "…" }
```

Three surfaces now offer a sign-in rather than a dead end: the demo-step chip
path, the launcher tiles (`ChipLoginPrompt`), and the typed path — the last of
which previously showed *"⚠️ The agent request failed: Session expired — open
Token Chain … then try again"* to a visitor who had never signed in.

**Admin steps ask for an admin sign-in specifically.** A customer login cannot
satisfy an admin step, so offering one walks the visitor through OAuth to be
refused again on return. Verified live: the admin prompt's button hits
`/api/auth/oauth/login` (302), not `/api/auth/oauth/user/login`.

Also in #1952: `/api/agent/invoke` now resolves the vertical the way
`agentRun.js` does (`activeIdFor(req)`), instead of reading only `req.body`. A
caller that omitted the param got banking answers inside a switched-vertical
session — which reads as "the vertical broke", not "you omitted an argument".

### #1962, #1967 — keeping the promise the bubble makes

The bubble says *"I'll answer it as soon as you are"*, so the question must
survive the OAuth redirect.

- **#1962:** the capture moved into `addMessage`, which every user turn passes
  through. Instrumenting send sites is what broke it: the chip path set the ref,
  the typed path (a *different* `aguiRun` call site — there are four) did not,
  and the miss was silent because nothing renders a ref.
- **#1967:** the claim was gated on `isInline`, and `/` plus the admin console
  mount **only** the floating agent — so on the surfaces a signed-out visitor
  starts from, the key was stored and then stranded. Inline still claims
  synchronously; floating claims only if the key survives ~300ms.
  `claimPendingNl` is read-and-remove, so a tie replays once.

---

## Swept live and passing (no changes needed)

| Surface | Result |
|---|---|
| `/use-cases`, `/ai-control-plane` (`user`) | redirect a guest to `/` |
| `/oauth-academy` (`public`) | renders |
| `/users`, `/feature-flags` (`admin`, **inherited** guard) | modal, `leakedUserData: false` |
| UC24 chip, guest | answers in the *active* vertical ("Super Retail" with `active=retail`) — no banking bleed |
| UC1 chip, guest | sign-in prompt, request never sent |
| ADMIN1 step, guest | "needs an admin sign-in", button → `/api/auth/oauth/login` |
| Typed public prompt, guest on `/dashboard` | answered normally (BFF serves public actions to guests) |

---

## FIXED — a resumed run bricked the agent panel

Root-caused and fixed after this doc was first written; kept in full because the
*method* is the transferable part. **Not a regression from this work** — it was
reachable from the queued-question paths above, which is how it surfaced.

**Cause:** `/dashboard` is a guest-chat surface, so `marketingGuestChatEnabled`
reads true for the entire window before `isLoggedIn` flips. Reloading it while
signed in therefore replayed the queued question ~250ms in **as a guest**,
before the vertical manifest resolved, and the answer landed in state that no
longer rendered. Guest-chat eligibility now counts only once the session check
has answered either way (`sessionResolved`). A real guest is unaffected — the
flag flips as soon as the check returns "no session".

**What found it, after three wrong hypotheses:** instrumenting the *running app*
via a Playwright init script that wrapped `sessionStorage` and `fetch` before any
app code ran. The trace settled it in one reload:

```
t=1976  claim   AIAgent.js:1229
t=2248  fetch   {"prompt":"…","flowTraceId":"…"}   <- no `vertical`
t=4582  200                                        <- reply discarded
```

The same replay on an SPA remount (hydration already done) sends
`vertical:"retail"` and renders both bubbles. That contrast was the whole
diagnosis, and no amount of reading the component produced it.

The original write-up follows, unchanged.

### Repro

Signed in, on `/dashboard`:

```js
sessionStorage.setItem('bx_agent_pending_nl', 'What is my account balance?')
// reload /dashboard
```

### What happens

1. The resume fires: `POST /api/agent/invoke {"prompt":"What is my account
   balance?","flowTraceId":"ef27d1d6…"}` → **200, with a real reply body**
2. SSE `/api/mcp/tool/events?trace=ef27d1d6…` → 200, **trace id matches**
3. The panel renders **greeting + typing indicator only** — no user bubble, no
   reply, no collapsed region hiding them (confirmed by dumping panel HTML)
4. The typing indicator never clears and **the chat input stays `disabled`** —
   the agent is unusable until a page reload

### Ruled out, with evidence

- **Timing** — still hung after 16s; polled the message list every 500ms for 6s,
  the user bubble never appears at any point
- **`isInline`** — identical on `/dashboard` (inline) and `/` (floating)
- **Hydration order** — a unit test mounting with `user=null` then re-rendering
  with a user *passes*; the replay works there
- **SSE trace mismatch** — request `flowTraceId` and SSE `trace` param match
- **Message collapsing** — no collapsed container in the DOM
- **The response** — 200 with content (a legitimate P1AZ `DENY`, see below)

### Why reading the code did not find it

`sendAgentMessage` awaits only `fetch` + `res.json()`, both of which completed,
so `nlLoading` "should" have cleared in its `finally`. The resume effect calls
`addMessage("user", text)` *before* the send, so the bubble "should" have
existed. Both were true statements about the code and both were useless, because
the send belonged to a render pass whose state was already being discarded.
Three hypotheses (`isInline`, hydration order, SSE trace mismatch) each survived
a reading of the source and died on contact with a probe.

### What actually worked

`page.addInitScript()` to wrap `sessionStorage` and `fetch` **before app code
runs**, then one reload. The claim, the outgoing body, and the response all
timestamped in a single trace — and the missing `vertical` in that body is what
identified the hydration window as the culprit. Comparing it against an SPA
remount (where the same code path works) isolated the cause in one more step.

Worth reaching for earlier next time: it took ~5 minutes and settled what an
hour of reading could not.

### Incidental findings from the same trace

- In `retail`, "What is my account balance?" routes to `rewards_balance` and
  PingOne Authorize returns **DENY** on `IntentMatchesTool: "false"` (the intent
  token permitted `get_account_balance`/`get_my_accounts`). Policy behaving
  correctly — the user just never sees it, because of the render bug above.
- `GET /api/conversations/me/retail/hero-shown` returns **500** on load. Noticed
  in the console; not investigated.

---

## Notes for whoever picks this up

- **This area is contended.** Two other sessions shipped overlapping fixes
  mid-flight (#1941 added a per-vertical public-chip check to the same gate file;
  #1950 fixed the guest demo-step queue more thoroughly than my draft). Both
  times the resolution kept their work and layered only the delta — check
  `git log` on `AIAgent.js` and `check-auth-requirements.js` before editing.
- **`/dashboard` is a guest-chat surface.** `isPublicMarketingAgentPath()`
  returns true for both `/` and `/dashboard`, so gates that read it are dead
  code there. A test that renders `<AIAgent user={null}>` at `/dashboard` and
  expects a sign-in prompt fails; render at a neutral path like `/themes`.
- **PingOne SSO completes silently.** Clicking an admin sign-in prompt logged the
  browser in with no password because an SSO session existed. Signing out clears
  it and the next login needs credentials — plan guest-vs-signed-in sweeps in
  that order, or you will strand yourself mid-sweep.
- **Verify by content, not by SHA**, and check the container, not just the file:
  `docker exec ai-demo-api-server grep …`. Deploy is
  `scripts/sync-main-checkout.sh` then `scripts/deploy-live.sh <base-sha>` — pass
  the explicit range, since sync-then-bare is a no-op.
