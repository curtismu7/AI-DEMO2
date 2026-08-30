# Handoff — main unblocked + theming Priority 0, 2026-08-30

Supersedes the untracked `.claude/HANDOFF-ui-standard-2026-08-30.md`, whose
first section ("🔴 Do this first: `main` is RED") is now resolved. That file was
never committed; delete it when convenient.

Read `THEMING.md` and `REGRESSION_PLAN.md` §0 first — they are the durable
output. This is state and traps.

---

## State at handoff

| | |
| --- | --- |
| `main` | `7b90f7fd9` — **CI green, all 7 jobs** |
| Main checkout | in sync |
| SE (`ai-demo.ping-devops.com`) | current; verified by bundle content, not by symptom |
| Open PRs | **#2627** only (another session — see the flag below) |
| Worktrees | 22 → 14 after a merged-branch sweep |

Merged this session: **#2620 #2621 #2625 #2626 #2607 #2628**.

---

## `main` was red on THREE jobs, not one

The previous handoff recorded one cause. There were two, and a third failure
appeared only after the first fix un-blocked a suite that had been failing to
*load*.

**1. UC30 public on one side only** (#2621). `9092cd1f6` flipped UC30 to
`public` but left `PUBLIC_GUEST_ACTIONS` at `['branch_hours']`. Billed as a
one-line fix; it was four files — the SoT, the wire, and two hard-coded test
assertions.

**2. Two vertical manifests were not valid JSON** (#2621) — and this accounted
for the *other two* red jobs. `#2619` stripped `"group": "advanced"` from 21
chips; in **5 places it was the last property in its object**, leaving dangling
commas in `banking` (×1) and `airlines` (×4).

> **An unparseable manifest does not fail loudly — the vertical silently
> vanishes.** `FALLBACK_CHIPS` served banking, so `bk7` dispatched workforce's
> `show_mortgage`; the chip inventory counted 14 verticals, not 15; 8 Jest
> suites failed, 4 unable to load; the *Service suites* job died on the same
> `position 4526 (line 132 column 7)`.

Diagnose in one command before chasing any symptom:

```bash
cd demo_api_server/config/verticals
node -e 'const fs=require("fs"),p=require("path");for(const d of fs.readdirSync(".")){const f=p.join(d,"manifest.json");if(!fs.existsSync(f))continue;try{JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){console.log("INVALID:",d,e.message)}}'
```

**3. `#2616` contradicted its own tests** (#2621). Repairing the manifests let
three suites load again, revealing that `#2616` had added `demoDelegate` to the
privileged group in **all 11 verticals** while those suites used it as their
stand-in for "a user with no group membership". Curtis's call: `#2616` is the
later deliberate decision, so the tests moved.

Not simply retargeted at another username — `_manifestGroupsForUser` returns
`[]` for **any** unlisted name, so that assertion would pass even if group
policy were deleted. The negative is kept as one half of a pair, and the real
proof (`DENIES user_not_in_group`, driving the decision engine) was untouched.

---

## Theming — §4 Priority 0 is DONE (#2625, #2626)

Ten stylesheets keyed dark off the OS. All cleared; the only
`@media (prefers-color-scheme)` left are the two diagram components that opt in
deliberately. **Light-only stylesheets 189 → 182.** §4 now records how each was
resolved and why the answer differed per file.

### The two traps, both now in `THEMING.md`

**`:root[data-theme="dark"] .x` outranks a bare `.x`.** Inside `@media` the
selector kept its specificity and won on *source order*; prefixed, it wins
outright. `LoadingOverlay`'s always-dark `.lo-card--dark` depended on that tie,
so the rebound rule carries `:not(.lo-card--dark)`. Without it this would have
silently un-darkened the BusySpinner panel.

**`<body>` ink never flips — it is `rgb(51,51,51)` in *both* themes.** So a
container given a `--th-*` ground and no `color` inherits near-black onto a dark
surface. #2625 reproduced the documented `Footer.css` bug three times over
(measured **1.20–1.35:1** in dark) and needed #2626 to fix it.

> It hides well: every *classed* child sets its own colour and reads perfectly,
> so the panels look right while you test. **Give a `--th-*` background a
> `--th-*` `color` on the next line**, even when every child looks covered.

That was caught only by doing the live-DOM check #2625 shipped without. Stopping
at "CI green" would have shipped it.

---

## `/pingone-authorize` signed out — two bugs (#2628)

Reported symptom: the page's inline "Sign in required" card with the global
sign-in modal stacked on it, the modal claiming a session expired for a visitor
who never had one.

**Copy.** `notifySessionExpiredIfNeeded` hardcoded the expiry sentence, but
`AUTH_REQUIRED_CODES` spans two states — `session_expired` / `expired_token` /
`token_inactive` (lapsed) vs `login_required` / `authentication_required` (never
signed in). Now `interruptMessageForAuthFailure()` picks on the code; new copy
is `SIGN_IN_REQUIRED_INTERRUPT_MESSAGE` = "Sign in to continue.". Unknown codes
keep the expiry wording.

**Stacking.** `SignInModal` and `SignInPrompt` are documented siblings — modal
for content that *cannot* render, prompt for content that still does. The gate
meant to prevent both, `isAuthenticatedAppSurface`, returns `true` for
everything except `/`, `/logout`, `/setup*`. It is an allow-everything check,
not a classifier.

Fixed with `_noAuthBanner`, the opt-out `apiClient` **already had** and
`bffAxios` did not honour.

> **A component-level registry cannot work here** — this is the obvious idea and
> it fails. The inline prompt is rendered *from* the 401 (`setNeedsLogin(true)`
> in the `catch`), so it does not exist when the interceptor runs: fetch → 401 →
> modal fires → prompt mounts. Anything keyed on the prompt being on screen is
> asked too early. **The request is the only race-free seam.**

Trade-off: `_noAuthBanner` is per-request opt-in, so this fixed
`/pingone-authorize`, not all 23 `SignInPrompt` pages at once. Others adopt it
as touched; none regress, since absent means "notify" as before.

---

## Flag for whoever owns #2627

*"PingOne Authorize console redesign"* touches the same page. **The auth fix
survives it** — `_noAuthBanner` is not removed, the PR is `MERGEABLE`, and its
new `usePingOneAuthorizeConsole` hook does not re-fetch those endpoints.

But it **raises two ratchets**:

```
-const MAX_RADIUS_LITERALS = 2552;    +const MAX_RADIUS_LITERALS = 2560;
-const MAX_SHADOW_LITERALS = 480;     +const MAX_SHADOW_LITERALS = 482;
```

The guard says *"Lower this when you migrate a stylesheet. **Never raise it.**"*
Its two new stylesheets add 8 `border-radius` and 2 `box-shadow` literals, and
the pin is lifted to admit them rather than using `--radius-*` / `--shadow-*`.

That is exactly the `--z-*` failure `THEMING.md` records — the family shipped,
adoption stalled at 3%, *"because creating a token family is the easy half."*
Small fix: swap the 10 declarations, restore 2552 / 480.

---

## Traps that cost time here

**Check `main`'s OWN CI before blaming your PR.** Main was red on three jobs
before any of this. A suite that fails to **load** hides every assertion inside
it, so repairing the loader surfaces real failures that were always there —
those are not regressions from your fix.

```bash
gh run list --branch main --limit 5 --json databaseId,workflowName,conclusion,headSha \
  -q '.[] | "\(.conclusion)\t\(.headSha[0:9])\t\(.workflowName)\t\(.databaseId)"'
gh run view <id> --json jobs -q '.jobs[] | "\(.conclusion)\t\(.name)"'
```

**A commit with no `(#NNNN)` never ran PR checks.** Both root causes here were
such commits. It is a reliable tell.

**"skipping" is not "passing".** The affected-suite selector skips jobs a PR
does not touch; check main's own run for that job's real state.

**Verify a deploy by content, not by symptom.** On SE, "the modal is gone" is
equally consistent with a deploy that never landed. The bundle was checked for
`"Sign in to continue."`, a string that exists nowhere before `7b90f7fd9`.
Note the bundle *also* still contains "Your session has expired…" — that is
correct, it remains the right sentence for a genuine expiry.

**The shared main checkout had diverged** via a local merge of
`origin/worktree-mcp-inspector-redesign` (2 merge commits), blocking sync and
the launchd job for ~50 min. Reset only after confirming every unique commit was
already on that remote branch. `park-main-edits.sh` does **not** help here — it
parks uncommitted files, not commits.

---

## Still owed by Curtis, not by an agent

- **Rotate the EMA client secret.** EMA = Enterprise-Managed Authorization
  (`io.modelcontextprotocol/enterprise-managed-authorization`). The leaked
  credential is the **IdP** client `bcc4a826-b6fa-451f-ae8e-df922bcbf1ed`, vault
  key `ENTERPRISE_IDP_INSPECTOR_CLIENT_SECRET` — not `demo-bff-mcp-client`,
  which is static with auth method `none` and has no real secret.
  `server.js` logged it on **every boot** until #2599, so it is in
  `docker logs` / `kubectl logs` and in that session's transcript. #2599 stopped
  the recurrence and added `noSecretsInLogs.test.js`; it did not un-leak what is
  already out. Pin the replacement, or MCP Inspector must be re-paired each boot.
- Decide on #2627's ratchet raise, above.
