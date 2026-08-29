# Tech Debt

Known gaps and architectural smells found while fixing something else —
correct enough to ship, not worth blocking the fix that found them. Not a bug
log (`REGRESSION_PLAN.md` §4 is that); this is "should fix properly later."

Reverse-chronological, newest first. Each entry: what's wrong, why it wasn't
fixed now, what the real fix looks like. Every entry heading carries a status
checkbox — `[x]` = paid off (has a RESOLVED/FIXED block), `[ ]` = still open
(PARTLY RESOLVED stays unchecked). Tick the box in the same commit that adds
the resolution block.

An entry that has since been paid off keeps its original text and gains a
**RESOLVED** block naming the branch, what the issue actually turned out to be
(not always what the entry guessed), and what the fix was. Entries are not
deleted on resolution — the wrong guess is often the more useful half of the
record.

### [ ] 2026-08-28 — UC34/UC35 sit on the 120s reasoning timeout: ~50% failure, measured

**What's wrong.** `ai-spot-unusual-patterns` (UC34) and `ai-explain-last-denial`
(UC35) fail roughly half the time, and have poisoned REPLAY goldens on at least
three separate captures across different verticals — including one where the
stack generation was UNCHANGED, so it is not the container-recreate class.

Measured against the live stack on 2026-08-28, **after** the `:3006` 403 was
fixed (so this is not that bug):

| chip | run | elapsed | result |
|---|---|---|---|
| UC34 | 1 | **121.0s** | `reasoning_unavailable` |
| UC34 | 2 | **121.2s** | `reasoning_unavailable` |
| UC34 | 3 | 68.9s | ok — full markdown table |
| UC35 | 1 | 90.8s | `empty_answer` |
| UC35 | 2 | 35.5s | ok |
| UC35 | 3 | 38.2s | ok |

3/6 failed. `llm-timeouts.json` sets `REASON_LOOP_TIMEOUT_MS = 120000`; both
UC34 failures returned at 121s. That is the ceiling, hit exactly.

**Why this pair specifically.** They are the only two chips whose reply is
free-form LLM prose. Every other chip returns a deterministic tool result.
UC34's own definition says "the LLM decides what to look at and how to summarize
it"; UC35's says it narrates the decision "not a canned script". So they are the
only chips whose latency scales with how much the model chooses to write — and
UC34 renders a markdown table, which is why it is the slower of the two and sits
closest to the ceiling. Successful runs span 35s to 69s against a 120s limit:
the margin is thin and the variance is large.

**Why it poisons goldens rather than erroring.** The failure comes back as
**HTTP 200** with the failure prose in the body. At the HTTP layer it looks like
a success, so a capture records it. `scripts/golden-failure-prose.js` exists for
exactly this and does catch it on both the capture and check sides — the guard
works. What it cannot do is make the underlying call succeed.

**Why it wasn't fixed now.** The obvious remedy — raise
`REASON_LOOP_TIMEOUT_MS` — lands on a FROZEN LLM setting, and that value is read
by six places including both Dockerfiles, `docker-compose.yml`, the UI's
`demoAgentService.js` and a dedicated `demoAgentService.timeoutSync.test.js`
whose whole purpose is keeping them aligned. It is a coordinated change with
demo-pacing consequences (a slower failure is worse in front of an audience than
a faster one), not a one-line bump, and not a call to make as a drive-by.

**What the real fix looks like — three options, in rough order of preference:**

1. **Bound UC34's output.** It is slow because it renders a table. Tightening
   that prompt pulls it away from the ceiling without touching any timeout or
   frozen setting. Smallest blast radius; fixes the worst offender only.
2. **Stop capturing goldens for this pair.** They are the only chips whose reply
   is non-deterministic by design, so they were arguably never good golden
   candidates — a golden of generated prose is a snapshot of one sampling, not a
   contract. Does nothing for the live 50% failure rate.
3. **Raise the ceiling.** Simplest to describe, but it is a frozen setting, it
   makes an already-slow path slower before it fails, and it treats the symptom.

(1) and (2) are complementary; (3) is independent of both.

**Reproduce:** POST `{ prompt, vertical }` to `/api/agent/invoke` with an
enduser session cookie, using each chip's `trigger.text` from
`demo_api_server/config/useCases.js`. Check the reply against
`failurePatternFor()` in `scripts/golden-failure-prose.js`. Three runs each is
enough to see it.

### [ ] 2026-08-28 — `llm-proxy` can be deployed by neither deploy path

**What's wrong.** `demo_llm_proxy` is the only service that no sanctioned
deploy route can update:

- `scripts/deploy-live.sh` skips it and says so — "run-docker.sh does not manage
  llm-proxy (see its SERVICES table); rebuild it directly: docker compose up -d
  --build llm-proxy". It still prints its normal `done — live stack serves
  <sha>` line afterwards.
- `./run-docker.sh build llm-proxy` answers `✗ Unknown service: llm-proxy` and
  lists the 20-odd services it does know. The name appears elsewhere in that
  script (line 108, and the oMLX `:8090` guards), so it is half-known — enough
  to be started as part of a group, not enough to be built on its own.
- Raw `docker compose up` is blocked by a PreToolUse hook, correctly: parallel
  sessions converging on the same project caused five container-name conflicts
  on 2026-08-02.

So the only route is the one the tooling deliberately blocks, via its
`# force-compose` escape hatch.

**Why it bites silently.** `llm-proxy` is image-built, so a restart keeps the
old code — the usual bind-mount intuition is wrong here. Deploying #2576 on
2026-08-28, `deploy-live` reported success while the container kept running
six-hour-old code; the only way to notice was grepping `/app/router.js` inside
the container and finding one occurrence of a pattern the fixed file has twice.
Anyone trusting the "done" line ships a fix that is not running.

**Why it wasn't fixed now.** Adding `llm-proxy` to `run-docker.sh`'s SERVICES
table touches the launcher's `:8090` ownership logic, which is entangled with
the oMLX-vs-llamacpp backend switch (`run-docker.sh:485-531` omits `llm-proxy`
when host oMLX owns the port). That is a deliberate design with FROZEN settings
around it, and changing it while shipping an unrelated one-line rejection fix
would have been exactly the drive-by this file exists to prevent.

**What the real fix looks like.** Give `run-docker.sh` a `build llm-proxy` path
that respects the existing backend guard — refusing with a clear message when
host oMLX owns `:8090` rather than silently omitting the service. Then
`deploy-live` can call it like every other baked-image service and drop its
"rebuild it directly" note.

### [ ] 2026-08-28 — a failure class: "logged as handled, fatal anyway"

**What's wrong.** Three separate incidents in one day shared one shape: a
failure was caught and logged as non-fatal, while the damage happened on a path
nobody printed. Each cost hours, and each was initially misdiagnosed as
something else entirely.

1. **`services/agentReasoningClient.js:86`** logged `err.code || err.message`
   and discarded `err.response.status`/`.data`. Axios sets
   `ERR_BAD_REQUEST` for any 4xx, so a 403 from `agent-service` surfaced to
   users as "The llamacpp LLM could not complete this request
   (reasoning_unavailable)" — an LLM outage that was not an LLM outage. It broke
   every LLM-analysis chip in all 11 verticals. Fixed by #2564, which logs
   status and body; the answer arrived on the first request afterwards.

2. **`demo_agent_service/src/reasonRoute.ts:18-31`** returns 403 and 400 before
   the correlation-logging scope at L39 — deliberately, per its own comment. So
   agent-service is *silent by design* for both, and "agent-service logs
   nothing" was read as evidence the request never arrived. It is evidence of
   nothing at all.

3. **`demo_llm_proxy/router.js:316`** attached `promise.finally(cleanup)` with
   no catch. `.finally()` returns a NEW promise that ADOPTS the rejection; two
   other catches nearby each covered a different branch. A failed swap logged
   `pin warm-up failed: tier-manager timeout` as non-fatal, then exited 1 one
   line later. Five restarts on the SE cluster. Fixed in #2576.

**The tell, in all three:** the log says handled, the behaviour says otherwise.
When a message reports a failure as tolerated and the system dies anyway, the
message is describing a *different* code path than the one doing the damage.

**Why it wasn't fixed as a class.** Each was fixed where it was found. There is
no repo-wide lint for "caught, logged, and still fatal", and the three
mechanisms differ — a discarded field, an early return before the log scope, and
an adopted promise rejection. Only the diagnostic *symptom* is common.

**What the real fix looks like.** Two cheap conventions, neither enforced today:

- When catching an HTTP client error, log `err.response?.status` and a truncated
  `err.response?.data` — never `err.code` alone. `err.code` is the same string
  for every 4xx and 5xx.
- A `process.on('unhandledRejection')` handler in every long-lived Node service
  that logs before exiting. All three services here run without one, so Node's
  default terminated `llm-proxy` with no attribution beyond a bare stack.

**Related:** the `BFF_INTERNAL_SECRET` entry below is the same investigation —
instance (1) and (2) are why its root cause took three sessions and two wrong
theories to reach.

### [ ] 2026-08-28 — BFF_INTERNAL_SECRET: two call sites disagree about where the vault lands

**What's wrong.** The BFF↔`agent-service` shared secret is resolved two
incompatible ways, and two authoritative comments assert opposite things:

- `demo_api_server/utils/internalSecret.js:13-17` — the canonical shared
  resolver, built specifically to converge six hand-rolled module-scope copies.
  Its comment says a vault-supplied secret "could never be seen" at module
  scope and that resolving lazily per call "is what lets the vault actually
  supply this secret." Line 30 reads `process.env.BFF_INTERNAL_SECRET` only.
- `demo_api_server/services/agentReasoningClient.js:45-49` — says the opposite:
  "The vault loads into configStore (not process.env), so process.env holds
  only the .env fallback value which may differ." Line 50 therefore reads
  `configStore.getEffective('BFF_INTERNAL_SECRET')` first.

Both cannot be true. Each author wrote their call site to match their belief,
so the codebase now holds both models simultaneously.

**Which one reality matches.** Measured 2026-08-28 in the running stack:
`BFF_INTERNAL_SECRET` is a 206-character `encrypted:...` value in the
environment of BOTH `demo-api-server` and `agent-service`. So the vault is not
supplying a usable plaintext through `process.env`, and `internalSecret.js`'s
premise does not hold in this deployment.

**And that value is CORRUPT, which is the real defect.** `encrypted:` is
configStore's OWN internal ciphertext format — not dotenvx, not a vault
envelope. `services/configStore.js:780-786` states it outright: it "belongs in
LMDB rows, never in .env", and a prior export/import round-trip putting it
there literally is what caused the 2026-08-21 `invalid_client` incident, where
it shadowed a correct vault-held PingOne client secret. This is that same
incident class, a different key.

configStore SCREENS the prefix (`_isCiphertextEnvValue`, one screen shared by
`getEffective()`'s `readEnv()` and `get()`'s env fallback) and falls back to
vault/LMDB — which is why the BFF sends the real plaintext and is NOT the
broken side here.

**What it broke.** `agent-service` (`demo_agent_service/src/index.ts:70`) reads
`process.env` with no decrypt step, so its secret IS the raw ciphertext. The
BFF's reasoning client sends the decrypted plaintext. They cannot match:

    [agentReasoningClient] :3006 reason call failed: ERR_BAD_REQUEST
    status=403 body={"error":"forbidden"}

Every LLM-analysis chip (UC34 `ai-spot-unusual-patterns`, UC35
`ai-explain-last-denial`) fails in all 11 verticals as a result, and it presents
to the user as "The llamacpp LLM could not complete this request" — sending
people to the model, the proxy and the resident tiers, none of which are
involved. It also blocks golden capture for 3 use cases (see PR #2563).

**Why it was not fixed now.** It is not a one-side change. THREE hops must move
together, and two of them work today only because both ends are equally wrong
(ciphertext compared against ciphertext):

| hop | resolves via | today |
|---|---|---|
| BFF → `/reason` (`agentReasoningClient.js:50`) | configStore (plaintext) | **403** |
| BFF → `/run` (`routes/agentRun.js:197`) | `process.env` (ciphertext) | works |
| `agent-service` → BFF `/internal/agent-tool` (`agentRunHandler.ts:204`, validated by `agentTool.js` via `internalSecretMatches()`) | `process.env` both ends (ciphertext) | works |

Making `agent-service` decrypt repairs `/reason` and breaks the other two.

**What the real fix looks like.** TWO parts, and only the first fixes the 403.

1. *Root cause — config, not code.* Replace the corrupt `encrypted:...` value in
   `demo_api_server/.env` and `demo_agent_service/.env` with the real plaintext
   (or remove it BFF-side so the vault supplies it, and set agent-service's
   explicitly). There is NO decrypt path to add to `agent-service`: the value is
   configStore's own format and needs configStore's key plus the vault, neither
   of which agent-service has or should have. Any plan of the form "make
   agent-service decrypt it" is not implementable.

2. *Convergence — code.* Point `agentReasoningClient.js:50` and
   `agentRun.js:197` at `utils/internalSecret.js` so one secret stops being
   resolved three different ways. This does not fix the 403 on its own; it
   removes the split that made the fault so hard to see, and settles the comment
   contradiction above. Also verify these, unaudited:
`routes/codegraphProxy.js:13`, `routes/mcpInspector.js:903`,
`demo_agent_service/src/transactionHop.ts:37` (agent-service presenting the
secret OUTBOUND — needs the same treatment as the inbound check).

**Worth adding.** `agent-service` should refuse to start when
`BFF_INTERNAL_SECRET` begins with `encrypted:`, mirroring the `process.exit(1)`
it already does for the committed dev default and mirroring configStore's screen
on the BFF side. Today a corrupt value produces a silent 403 that surfaces to
users as "the LLM could not complete this request" — a loud startup failure
naming the cause would have made this a one-minute diagnosis instead of a long
one, and would stop a third occurrence of this class.

**The tempting wrong fix.** Dropping `agentReasoningClient.js` to env-first
makes it consistent with the canonical helper and turns the 403 green — by
converging everything on the CIPHERTEXT. Consistent and wrong: it breaks the
moment the key rotates or anything starts decrypting properly, and it reverses
the deliberate design at `agentReasoningClient.js:45-49`.

**Diagnosis note.** This was expensive to find because
`agentReasoningClient.js`'s catch logged only `err.code`, and axios reports
every 4xx as `ERR_BAD_REQUEST` — so a 403, a 400 and a transport failure were
indistinguishable, and all three surfaced as `reasoning_unavailable`. Fixed in
PR #2564 (logs `err.response.status` and `.data`); that log line is what
produced the `403 forbidden` above. Found with `ai-demo2-d0`.




### [ ] 2026-08-28 — two accessibility/robustness leftovers from the contrast pass

Both surfaced by the live dark-mode contrast probe
(`tests/e2e/darkModeContrast.real.spec.js`) and left deliberately.

**`<code>` renders at 3.38:1, and it is not ours.** `#d63384` on a faint tint
— Bootstrap 5's default code colour, arriving through `end-user-nano.css`,
an EXTERNAL Ping stylesheet we do not own. Below WCAG AA (4.5) for text.
Fixing it means overriding a vendor stylesheet, which is a deliberate choice
rather than a bug fix, so it was recorded rather than patched. Reproduce at
`/mfa-test` with the theme stamped dark.

**A guest sign-in timer is never cancelled.** `AIAgent.js` `handleLoginAction`
schedules a 150ms `setTimeout` whose job is a full-page navigation. It carries
a `typeof window === "undefined"` guard so it no longer throws after a test
environment is torn down, but the timer itself is still uncancelled.

The guard was chosen over `clearTimeout` on unmount ON PURPOSE: the timer's
entire purpose is to navigate away, so cancelling it when the panel unmounts
could abort a real sign-in, and that could not be ruled out without tracing the
whole flow. Paying this off means establishing whether the panel can unmount
mid-sign-in; if it cannot, `clearTimeout` is the cleaner fix.

Worth knowing for both: an uncaught error AFTER teardown makes Vitest exit
NON-ZERO while printing "N passed" — a red build with a green-looking summary,
which is easy to re-run past without reading.


### [ ] 2026-08-28 — design-token adoption is partial: colour, shadow, radius, weight

Found while converting components onto `--th-*`. Each is measured on main
AFTER that work, so these are the numbers that remain, not the ones we started
with.

**Colour — 16,486 hard-coded hex against 2,411 token uses.** 1,605 distinct
values. 26 components were converted; the rest were not. The damage is
near-duplicates: six near-identical whites (`#ffffff` `#f8fafc` `#f9fafb`
`#fffbeb` `#fafafa` `#f8f9fa`) accounted for ~1,979 uses when first measured —
the same visual colour written six ways, which is why surfaces differ subtly
between pages.

*Why it wasn't finished.* A blind sweep was built and REVERTED: it touched 193
files and introduced 73 rules where `color` follows the theme while the surface
stays a hard-coded literal, inverting in dark mode. Worse, 73 was only the
same-rule cases — text inheriting a light surface from an ancestor is
statically invisible. The safe unit is a whole component, surface and text
together, which is how the 26 were done.

*Do not* collapse the four text levels (`#0f172a` / `#374151` / `#556070` /
`#94a3b8`) into one token. They are heading / body / secondary / faint across
~1,300 uses; one "text" colour flattens the hierarchy. `--th-text`,
`--th-text-body`, `--th-text-muted`, `--th-text-faint` exist for this.

**box-shadow — 348 distinct literals for 517 uses.** Nearly every shadow in the
app is unique. There is no shadow scale; `--modal-shadow` and `--card-shadow`
exist but almost nothing uses them.

**border-radius — 80 distinct literals across 2,633 uses**, with 6px / 8px /
4px / 3px all competing for the same job. `--btn-radius` (8px),
`--card-border-radius` (12px), `--modal-radius` (12px) and `--inner-card-radius`
(8px) exist and are largely unused.

**font-weight — 12 distinct values**, including `650`, `750`, `550`, `900` and
`800`. Most faces do not have those weights, so the browser synthesises or
rounds them; the intended emphasis is not what renders.

**What the real fix looks like.** Colour: continue per component, worst-first,
running the inversion check (themed text over a hard-coded light surface) after
each — that check is what made the 26 safe. Shadow/radius/weight: pick the
existing tokens as canonical, then sweep exact matches only, the way the type
scale was adopted (1,974 declarations, zero visual change, because every
mapping was value-identical).

### [ ] 2026-08-28 — the monospace test's filename allowlist is now mostly stale

`uiRegression.test.js` bans the fixed-width literal in CSS through a
hand-maintained allowlist of ~45 FILENAMES, each commented "intentional" for
code/token display — a list that grew every time someone displayed a token.

`--font-mono` now exists and 281 hard-coded stacks across 81 files were
converted to `var(--font-mono)`, which carries no banned literal. Those files
therefore no longer need their allowlist entry, but the entries were left in
place: they are harmless, and pruning 45 conditions in the same commit that
moved 81 files would have made the diff unreviewable.

**12 CSS files still declare the literal directly** and genuinely need an
entry. The real fix is to convert those 12, then delete the allowlist entirely
and assert only that `var(--font-mono)` is used — turning a per-FILE exemption
list into a per-PURPOSE token, which is what it should have been.

Note `--font-family-mono` was named "mono" but resolved to a SANS stack, so
every consumer asking for a fixed-width face silently got a proportional one.
It now aliases `--font-mono`.


### [ ] 2026-08-28 — 271 emoji outside the §0 allowlist, in 53 files

**What's wrong.** `REGRESSION_PLAN.md` §0's emoji allowlist is a project-wide
hard rule, but nothing enforced it app-wide. The only test was
`supportConsole/__tests__/supportConsoleConfig.test.js`, scoped to that one
config — so violations accumulated unchallenged: **342 uses of 94 distinct
emoji across 63 files** when first measured.

71 were fixed immediately, leaving **271 in 53 files**:

- `🔒` → `🔐` (22 uses, 13 files). An exact allowlisted equivalent — §0 defines
  `🔐` as "security/lock" — so this was a pure swap.
- 49 more where the glyph merely led a text label that already carried the
  meaning (`🔄 Refresh`, `📋 Token History`), so dropping it lost nothing.

**Why the rest wasn't fixed now.** The remainder each need a semantic decision,
and mechanical substitution is the wrong tool. `🏦` on a transfer row in
`UserTransactions` is a *label*, not decoration. `🤖` (19 uses) distinguishes
agent-authored rows from user-authored ones and has no allowlisted counterpart
— `👤` is spoken for as the HITL consent marker. Choosing replacements is a
design pass, not a sweep, and doing it blind is how the token-chain education
icons would have lost their meaning.

**What the real fix looks like.** Per file, decide whether each glyph is
decoration (drop it), a duplicate of adjacent text (drop it), or load-bearing
(replace with a CSS icon or semantic HTML per §0, or propose adding the glyph
to §0 — which is what happened for `🔧`). Then drop the file from the ratchet
and lower the baseline.

**Guarded meanwhile.** `demo_api_ui/src/__tests__/emojiAllowlistAppWide.test.js`
is a ratchet: it fails if the total exceeds 271 or if the dirty-file count
exceeds 53. It cannot force cleanup, but the number can only go down. Verified
to fail on introduction by adding three emoji and watching both assertions fire.

It reads the allowlist from §0 via `__tests__/helpers/emojiAllowlistSource.js`
rather than restating it — the list was once written out in five places and
they drifted, one listing six entries while the others listed ten, so an agent
reading the wrong copy stripped four legitimate emoji.


### [x] 2026-08-28 — CI cannot push images: GHCR packages are user-owned, unlinked

Every `push-image` job fails at its final step with
`denied: permission_denied: write_package`. The build, the `docker tag`, and the
matrix selection all succeed first — only the push is refused.

The 14 `ai-demo-*` container packages were created by hand-pushes from a laptop,
so GHCR records them as owned by the **user account** `curtismu7`. GitHub Actions
authenticates as the **repository** via `GITHUB_TOKEN`, and a user-owned package
grants no repository write access by default. All 14 report `repository: None` —
they are linked to nothing. Confirmed empirically: `docker buildx imagetools
create` against the same package succeeds when run with the user's own token, so
the package is writable and only the Actions identity is denied.

This is **not** a visibility issue. Visibility governs pull; this governs push.
`ai-demo-frontend` is public and fails identically to the private ones.

**Why it wasn't fixed now:** there is no REST endpoint for package Actions access
on a user-owned package — the GitHub UI is the only route, one package at a time,
and it is an account-settings change rather than anything in this repo. The
`repository` field also does not reflect an Actions-access grant, so the grant
cannot be verified by API either; only an actual push settles it.

**The consequence while open:** no image exists for any merge, so **no commit is
promotable**. `./se-update-code.sh --promote <sha>` correctly dies rather than
promoting something stale, so this fails loudly rather than shipping wrong code —
but SE still only moves by hand-built image, which is the gap this whole feature
was built to close.

**What the real fix looks like:** per package —
`https://github.com/users/curtismu7/packages/container/<pkg>/settings` → Manage
Actions access → Add Repository → `AI-DEMO2` → change role from the default
**Read** to **Write**. Read alone fails with the identical message, which is the
step most likely to be missed. Alternative if per-package clicking is untenable:
a fine-grained PAT with `write:packages` as repo secret `GHCR_TOKEN`, swapped
into `docker/login-action` in `.github/workflows/build-images.yml` — trades 14
clicks for a long-lived broader-scoped credential in repo secrets.

**To verify once granted** (no commit needed — the matrix is already correct):
`gh run rerun 33165014221 --failed`, which is merge `09a755c10`, whose matrix
selected `llm` alone. Then confirm the `sha-` tag exists and that `:latest` is
still `sha256:76fc7bb2...`.

**RESOLVED** — PR #2540, verified on merge `622feba36` (branch
`worktree-ci-ghcr-pat`, then `worktree-ghcr-push-test`).

*What it turned out to be, versus what this entry guessed:* the diagnosis was
right — repository identity, not visibility, not a broken package. What the entry
got wrong was the remedy. It named per-package Actions access as "the real fix"
and the PAT as a fallback. Per-package access was tried first and **could not be
made to take**: the denial was byte-identical before and after, and the change is
not observable through any API, so it could not even be confirmed as applied. The
fallback became the fix.

*The fix:* `build-images.yml` now authenticates with a **classic** PAT in
repository secret `GHCR_TOKEN` (fine-grained tokens do not reliably support the
container registry), and `username:` is `github.repository_owner` rather than
`github.actor` — the PAT belongs to the owner, while actor is whoever triggered
the run, so a merge by anyone else would pair a mismatched username with the
owner's token. A guard step fails naming the secret if it is absent, because a
missing secret otherwise surfaces as an authentication error and reads as "the
token is wrong" rather than "there is no token".

*Evidence:* run 33167899190 on `622feba36` — job `llm` success;
`sha-622feba367f2b5ee6fb93c0fbbffca2eadc6e7cc` resolves to
`sha256:ce892608...`; `:latest` still `sha256:76fc7bb2...`, a **different**
digest, so a push demonstrably did not move it.

*Two things this leaves behind, deliberately recorded:*

1. **This is the weaker option on security grounds** — a long-lived,
   broadly-scoped credential in repository secrets, where `GITHUB_TOKEN` was
   short-lived and repository-scoped. It was taken because the stronger option
   could not be made to work, not because it is better. **Why per-package Actions
   access did not take was never established.** If it can be, reverting is a
   two-line change to the `docker/login-action` step.
2. A re-run cannot test a change to this workflow. GitHub re-runs use the
   workflow file from the *triggering commit*, so verifying any future change to
   the login or push step needs a fresh merge touching a service directory, not
   `gh run rerun`.

### [ ] 2026-08-28 — post-merge verification of the promote path is incomplete

Steps 4-5 of the CI build-and-push plan's post-merge checklist have never run,
because every one of them needs an image that the entry above prevents existing:
promoting a real SHA, watching the SE rollout, and proving the promoted code
actually serves traffic (`/livez` -> 200 from inside the cluster).

**Why it wasn't fixed now:** blocked entirely on the GHCR grant. Not a code gap.

**Partially retired already:** the one piece that could be tested without a CI
push has been — `docker buildx imagetools create` was exercised directly against
`ai-demo-llm-proxy` on 2026-08-28: exit 0 in **1.2s**, and the log reads
`copying sha256:db20e433...`, confirming it copies the manifest rather than
re-resolving it, so a multi-arch image survives a promote. That was the design's
load-bearing unproven assumption and it holds. The ~16-minute rebuild it replaces
is the comparison that justifies the SHA-tag design.

**What remains:** after the grant, promote a real SHA and confirm the pod serves
it. A green `kubectl rollout status` is **not** sufficient evidence — on
2026-08-27 `successfully rolled out` was reported while the pod was still the old
crash-looping one. The checklist is in `.claude/HANDOFF-ci-build-push.md`.

**Also note:** a stray `probe-delete-me` tag exists on `ai-demo-llm-proxy` from
the `imagetools` verification. It shares `:latest`'s digest, and a GHCR "version"
is a digest rather than a tag — so deleting that version via API would delete the
image `:latest` points at. Remove it via the Versions UI or leave it; do not
script its deletion.

**PARTLY RESOLVED** — 2026-08-28, once the push blocker above was fixed. Stays
unchecked: the promote itself has still never run.

*Now verified*, on run 33167899190 / merge `622feba36`, having previously been
blocked behind a push that never succeeded:

- the CI `docker push` lands an immutable tag —
  `sha-622feba367f2b5ee6fb93c0fbbffca2eadc6e7cc` → `sha256:ce892608...`
- **`:latest` does not move on a push** — still `sha256:76fc7bb2...`, a
  *different* digest from the tag just pushed. This is the property the whole
  design rests on and it had never been observed against a real CI push before,
  only against runs that failed short of pushing.

*Still not verified, and it needs the live shared SE cluster:*
`./se-update-code.sh --promote 622feba367f2b5ee6fb93c0fbbffca2eadc6e7cc llm`,
then proving the pod actually serves the promoted image:

```bash
kubectl --context us exec -n ping-devops-cmuir deploy/demo-api-server -- \
  sh -c 'curl -s -o /dev/null -w "/livez -> %{http_code}\n" http://llm-proxy:8090/livez'
```

Expect `200`. A green `kubectl rollout status` is **not** sufficient evidence —
on 2026-08-27 `successfully rolled out` was reported while the pod was still the
old crash-looping one. That is the specific trap this step exists to catch.

*Promotable commits:* only merges after `4d9ad6d31` (the PAT fix) have images.
Everything merged before it — including the feature's own merge commit — has no
image and is permanently unpromotable.

### [ ] 2026-08-28 — two parallel module trees in demo_api_server (`X.js` vs `src/X.js`)

`demo_api_server` carries near-duplicate copies of several modules at two
depths: `middleware/tokenErrorMiddleware.js` and
`src/middleware/tokenErrorMiddleware.js`, `services/errorMessageBuilder.js` and
`src/services/errorMessageBuilder.js`, and others. Live `require()`s resolve to
the NON-`src` copy; the `src/` half was dead. The dead half was removed in
PR #2521, but nothing stops the pattern recurring.

**Why it wasn't fixed now:** removing the dead copies was already the scope of
that branch. Collapsing the two trees — deciding which depth is canonical and
moving the survivors — is a much larger, higher-risk change, and the layout is
documented in `demo_api_server/CLAUDE.md` as-is.

**The risk:** this is actively dangerous to reason about, not merely untidy.
Basename matching cannot distinguish the two, so any tool or agent that greps
`errorMessageBuilder` sees hits for both and cannot tell which is live. The
parked dead-code sweep this PR replaced was built that way and would have
deleted three live files, one of them `utils/jwtDecoder.js`, which
`middleware/auth.js` requires — i.e. it would have broken authentication.

**What the real fix looks like:** pick one canonical depth (`src/` or not),
move the surviving modules there in one mechanical commit, and add a hygiene
assertion that no basename exists at both depths.

### [ ] 2026-08-28 — `src/services/tokenValidationService.js` is kept alive only by dead files

PR #2521 removed 27 unreferenced modules but deliberately kept this one. It IS
a resolved `require()` target — but every file that requires it is itself in
the dead cluster that was removed around it, so nothing reachable from
`server.js` or any test uses it.

**Why it wasn't fixed now:** the deletion criterion used was "no resolved
reference names this file", which is deliberately conservative and
under-deletes. Establishing "reachable from an entrypoint" instead means
computing a real reachability closure, which is a different (and more
error-prone) analysis than the one that branch needed.

**The risk:** low — it is dead weight, not a hazard. The cost is that the next
dead-code pass will re-derive the same ambiguity from scratch.

**What the real fix looks like:** a reachability walk from the real entrypoints
(`server.js`, every `tests/**` and `src/__tests__/**` file, `scripts/**`)
rather than a reference-existence check, then delete whatever the closure does
not reach. Note the `jest.mock()` caveat below.

### [ ] 2026-08-28 — dead-code analysis must resolve `jest.mock()`, not just `require()`

A module referenced ONLY by a `jest.mock('../../services/x')` string is invisible
to a `require()`-only scan, and deleting it does not break any import — it
breaks jest's resolver at mock time. The failure signature is a suite that
FAILS TO RUN with **0 failed tests**, which does not look like a missing module.

This bit PR #2521 during development: `services/configHostnameService.js` was
classified dead, and `node -e "require('./server.js')"` loaded the entire module
graph afterwards with zero `MODULE_NOT_FOUND`. Only the full jest suite caught it.

**Why it wasn't fixed now:** the fix landed ad hoc in that branch's analysis
(the resolver was extended to `require`, `jest.mock`, `jest.doMock`,
`jest.unmock`, `jest.requireActual` and dynamic `import()`), but it lives in a
throwaway script, not in the repo.

**The risk:** the next person doing this re-derives the require-only version,
gets a clean boot check, and ships a branch that reds the suite — or worse,
trusts the boot check the way this session initially did.

**What the real fix looks like:** commit the resolver as a script under
`scripts/` (or adopt `knip`, whose config was drafted in the parked branch) so
the analysis is reproducible rather than reconstructed each time.

### [ ] 2026-08-28 — `demo_api_server` dependencies never re-verified after the dead-code removal

PR #2521 deleted 27 modules but deliberately left `package.json` untouched. The
parked sweep it replaced also stripped 8 dependencies and 2,895 lock lines,
claiming they were orphaned by those deletions. That claim was never checked
against current `main`.

**Why it wasn't fixed now:** dependency removal has its own blast radius —
a transitive or lazily-`require()`d dependency looks unused to a static scan —
and folding it into a deletion commit would have made the diff impossible to
review as one thing.

**The risk:** carrying dead dependencies costs install time and audit surface.
Low urgency, but the information is currently stale rather than absent, which
is worse — someone may trust the parked branch's list.

**What the real fix looks like:** re-derive orphaned deps against current
`main` (not the parked list), remove them in their own commit, and verify with a
clean `npm ci` plus the full server suite.

### [ ] 2026-08-28 — SE smoke check 2/7 races a terminating replica and fails a healthy deploy

`se-update-code.sh`'s post-deploy smoke check "no pod predates deploy start"
reported `[FAIL] pods running PRE-deploy images: frontend` on a deploy that was
in fact correct, and the script exited 1 with the live demo healthy.

Verified by hand afterwards: the running pod's imageID was
`sha256:350e590d…`, byte-identical to GHCR's current `:latest`, it started
after the deploy, and the served bundle contained the newly-shipped markers.
The rollout log shows `1 old replicas are pending termination` twice — the
check sampled the old replica mid-termination.

**Why it wasn't fixed now:** the deploy this was found on had to be verified
and reported first, and the check is in a script that runs against a live SE
cluster — changing it deserves its own branch and its own verification.

**The risk:** the check cries wolf on a good deploy. Worse than a missing check,
because the documented remediation (`kubectl rollout restart`) is a no-op that
appears to fix it, training the reader to ignore the check.

**What the real fix looks like:** filter pods to `status.phase == Running` with
no `deletionTimestamp` before comparing start times, or compare the deployment's
`observedGeneration`/`updatedReplicas` instead of per-pod timestamps.
### [x] 2026-08-28 — deploy-live silently no-ops on a compose `environment:` change

`scripts/deploy-live.sh` maps changed **paths** in the merged diff to compose
services. A change to `docker-compose.yml` that only adds or edits an
`environment:` entry touches no service path, so the script exits 0, prints
nothing about that service, and deploys nothing. Container env is frozen at
create, so the running service keeps the old value while the checkout, the
merge and the deploy all look clean.

Observed twice on 2026-08-28 while wiring the audit door: adding
`GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID` and the `MCP_GW_OAUTH_STATIC_*` block
merged and "deployed" successfully, and `docker exec ... env` still reported
`<unset>`. Only an explicit `./run-docker.sh restart mcp-gateway` (which
recreates) picked them up.

**Why it wasn't fixed now:** the path-to-service mapping is the whole reason
deploy-live is fast and targeted; making it parse `docker-compose.yml` for which
services' `environment:` blocks changed is a real change to the deploy path, and
the branch that hit this was already several layers deep in an unrelated fix.

**The risk:** the silent direction. A restart-needed change that *fails* is
obvious; one that reports success and does nothing is not. It reads as "the code
is wrong" and sends you debugging the feature instead of the deploy — which is
exactly what happened here, twice, before `docker exec ... env` was checked.
Same failure mode as the image-built-services trap already in this file, one
layer further out.

**What the real fix looks like:** have deploy-live diff `docker-compose.yml`
structurally (not by path) and recreate any service whose `environment:`,
`env_file:` or `build.args` changed — or, cheaper, detect that
`docker-compose.yml` is in the diff at all and print a loud "compose changed —
env-only edits need `run-docker.sh restart <svc>`; deploy-live will not do it"
rather than silently succeeding.

**FIXED 2026-08-29 (PR #2590)** — took the structural option, not the warning.
`run-docker.sh restart` already recreates, which is exactly what picks up new
env, so deploy-live now *deploys* these services instead of telling a human to.
`scripts/compose-env-diff.js` compares the `environment:`, `env_file:` and
`build.args` blocks of each service between the two revisions and names the ones
that changed; deploy-live feeds them into `add_restart`. Structural rather than
hunk-based because a hunk says which LINES moved, not which SERVICE owns them,
and `environment:` blocks all look alike at block boundaries.

Verified by replaying the incident: `8f06af5f2~1..8f06af5f2` (the audit-door
commit, which touched *only* `docker-compose.yml`) now resolves to
`mcp-gateway` — the exact service that stayed `<unset>`. Comment-only and
whitespace edits deliberately do not trigger a recreate; a brand-new service is
skipped, since it is not running to be recreated. If the comparison itself ever
fails, deploy-live says so loudly rather than swallowing it — a silent failure
here would restore the very staleness this closes.

### [ ] 2026-08-28 — gateway tools/list is only governed on the WebSocket transport

The audit-agent work shipped a door that advertises `audit:read`, a scope wired
through all four config points, a PingOne scope, and an OAuth chain that
demonstrably issues a narrow token (`scope: audit:read mcp:invoke openid`,
verified live). The gateway then returned **242 tools** to it.

`demo_mcp_gateway/src/index.ts` is the **WebSocket** transport and owns the only
`tools/list` aggregation and the only `guardToolsList(..., candidateNames)` call.
`src/server/GatewayServer.ts` is the **HTTP** transport and has no `tools/list`
handling at all — it relays the upstream body verbatim
(`res.end(Buffer.from(upstream.data))`, ~line 1102). So over HTTP the PDP is only
ever asked the generic `DecisionContext: McpRequest` question, which
`demo_authz_server` Rule 2.9 permits wholesale (`ToolName: ""`, "no tool to
evaluate"). Proof: **zero `McpToolsList` decisions appear in the authz logs**
for a request that returned 242 tools.

Both halves of the intended mechanism already exist and were written for each
other — the gateway sends `DecisionContext: 'McpToolsList'` with
`CandidateTools`, and `demo_authz_server/routes/decision.js:~549` computes
`DeniedTools` from `requiredScopesForTool` vs granted scopes. They are simply
never connected on the HTTP path.

**Why it wasn't fixed now:** `GatewayServer` has no decoded token — the HTTP
path authorizes in the `authorizeMcpRequest` middleware and passes the forwarder
only `callerScope`. Fixing it means threading the decoded token (or the
middleware's authz result) into `forwardToUpstream` AND adding a response filter
that handles both the plain-JSON and SSE (`event: message`) shapes. That changes
authorization for **every** HTTP MCP caller — LM Studio, LibreChat, every façade
door — not just the page that surfaced it. Too broad to land at the tail of the
branch that found it.

**The risk:** any demo or doc that claims a scope-narrowed MCP client is
overstating it on the HTTP path. A caller holding only `audit:read` still
discovers the full catalog; only `tools/call` is gated per-tool. The narrowing
reads as working because the token really is narrow — the gap is entirely in
whether anything acts on it during discovery.

**What the real fix looks like:** thread the decoded token into
`GatewayServer.forwardToUpstream`, and for `jsonRpc.method === 'tools/list'`
call `guardToolsList` with the upstream tool names, dropping `deniedTools`
before relaying. Note a P1AZ policy alone cannot fix this — no rule can narrow
a decision that is never asked with a tool list. A cheaper interim option worth
evaluating first: point the page at the WebSocket transport, where the
narrowing already works.

### [ ] 2026-08-28 — the BFF's pingone-admin façade door is broken upstream

`demo_api_server/routes/mcpFacade.js`'s `pingone-admin` door calls PingOne's
hosted admin MCP (`mcp.pingone.com/admin/<envId>/mcp`) with a worker
`client_credentials` token via `mcpPingOneHttpAdapter.js`. That endpoint has
stopped accepting worker tokens — it answers `401 Invalid authentication`
(verified live 2026-08-27 both directly and through the door). The door's own
comment citing "85 tools, measured 2026-08-25" is therefore stale.

**Why it wasn't fixed now:** the hosted server wants a USER token, which an
unattended door cannot produce. Fixing it means either giving that door an
interactive OAuth path (it currently has `authorizationServer: null` by design,
so identity is fixed and per-user distinction does not exist there) or dropping
the door. Both are design decisions, not repairs, and the audit work routed
around it by calling the Management API `activities` endpoint directly — which
answers the same worker token fine.

**The risk:** anything relying on that door for PingOne admin tools fails at
call time with an opaque `pingone_mcp_unavailable`, and the stale comment
invites someone to trust a tool count that no longer exists.

**What the real fix looks like:** decide whether `pingone-admin` should become
a user-OAuth door (matching `audit`/`agentless`) or be retired; either way,
correct the comment so the next reader does not assume 85 working tools.

### [ ] 2026-08-28 — no dynamically-registered client can hold a custom gateway scope

`demo_mcp_gateway/src/oauth/ClientRegistry.ts` pins **every** DCR client to
`brokerRegistrationScope()` (`mcp:invoke`) and refuses non-loopback
`redirect_uris`. Both are deliberate — `/oauth/register` is unauthenticated, and
either control removed is a privilege escalation.

The consequence is easy to miss: **no dynamic client can ever obtain
`audit:read`, including LM Studio and any other spec-following MCP client.** A
door can advertise a narrow scope, and a DCR client will faithfully request it,
and the broker will still mint `mcp:invoke`. The audit work needed a
server-side, non-loopback client, so it added the operator-configured
`MCP_GW_OAUTH_STATIC_*` path (PR #2520) — but that only serves clients someone
configures by hand.

**Why it wasn't fixed now:** relaxing either control to serve external clients
reopens exactly the escalation they were added to close. Serving them properly
needs a different mechanism (per-door registration scope, or an authenticated
registration endpoint), which is a design decision.

**The risk:** an external-client demo that claims per-door scope narrowing will
not behave as described — the client gets `mcp:invoke` regardless of what the
door advertised, and the mismatch is silent.

**What the real fix looks like:** either make the registration scope per-door
(the door already carries `scopes`, so the broker could mint what that door
advertises) or require authentication on `/oauth/register` for anything beyond
`mcp:invoke`. Not a relaxation of the loopback rule.

### [x] 2026-08-28 — a sixth service map exists outside the hygiene gate

`k8s/aws/deploy.sh:60-77` holds `IMAGE_MAP`, an indexed-array local-name-to-GHCR-name
mapping used to rewrite image refs in the SE K8s manifests. It is a service map
in the same sense as the five `scripts/check-service-map-complete.js` gates —
but it lives outside that gate entirely.

**Why it wasn't fixed now:** `check-service-map-complete.js` iterates
`ALL_KEYS` from `se-update-code.sh`; wiring a sixth, differently-shaped map
(indexed array of `local:ghcr` pairs, not keyed by service) into the same
checker is a bigger change than this branch's scope, and nothing is broken
today — all 14 `ghcrImage` values from `--print-map` were verified present in
`IMAGE_MAP` as of this branch (checked 2026-08-28).

**The risk:** a future service added to the five gated maps and missed in
`IMAGE_MAP` — the same class of drift this branch closes for the other five,
just one map further out. It would surface as a K8s deployment silently still
pointing at a local (or stale) image name after an otherwise-clean CI build.

**What the real fix looks like:** either fold `IMAGE_MAP` into the generated
service map (derive it from `--print-map` instead of hand-maintaining it), or
add a sixth assertion to `check-service-map-complete.js` that every
`ghcrImage` in the map also appears in `k8s/aws/deploy.sh`'s `IMAGE_MAP`.

**FIXED 2026-08-29 (PR #2592)** — took the second option. `readImageMap()`
parses the `IMAGE_MAP` array out of `k8s/aws/deploy.sh` as text and
`checkMap()` now asserts every `ghcrImage` appears there. Only that direction
is asserted: extra `IMAGE_MAP` entries are legitimate, since it also carries
images this repo does not CI-build (`tier-manager`, `mcp-code-search`,
`llamaindex-agent`).

The parser is sanity-guarded the same way `inventoryCount` is — if it reads
fewer pairs than there are services, it fails as a broken parser rather than
passing everything vacuously, which is the exact way a text-parsing gate goes
quietly useless.

Verified by removing `ai-demo-mcp-gateway` from `IMAGE_MAP`: the gate failed
naming the service, and passed again once restored. 10/10 unit tests.

### [ ] 2026-08-28 — shared root files never trigger a CI build

Six of the fourteen CI-built services build from `context: .` (the repo root)
and their Dockerfiles `COPY` root-level inputs that belong to no service's
`sourceDir`:

- `demo_api_server/Dockerfile:39-52` — `scope-topology.json`,
  `service-topology.json`, `llm-timeouts.json`, `docs/`,
  `graphify-out/*.kb.json`, `snapshots/*`
- `demo_mcp_gateway/Dockerfile:8,38-43` — `scope-topology.json`,
  `mcp-tool-schemas.json`
- `demo_authz_server/Dockerfile:20-25` — `scope-topology.json`,
  `snapshots/gen-authorize-snapshot.js` and its snapshot JSON
- `demo_api_ui/Dockerfile:30` — `llm-timeouts.json`

`scripts/ci-build-matrix.js` selects services purely by whether a changed path
starts with `entry.sourceDir/`. A merge touching only `scope-topology.json`
touches none of those prefixes, produces an empty matrix, and logs "no
service source changed — building nothing" — which reads as correct, and
isn't.

**Why it wasn't fixed now:** encoding root-file-to-service dependencies would
be a fifteenth copy of the service map (which root file feeds which
service's image), and that hand-maintained duplication is exactly the drift
this whole design exists to eliminate. There is no single source of truth for
"which Dockerfiles COPY which root file" short of parsing every Dockerfile at
build-matrix time, which is a real feature, not a one-line fix.

**The mitigation already in place:** the failure is loud at the other end.
`./se-update-code.sh --promote <sha>` dies with "No image carries tag
sha-<sha>" for any service CI never built for that commit — it does not
silently promote stale. So the consequence of this gap is "that commit is
unpromotable for the affected service(s)," never "you shipped stale code
without knowing."

**Workaround:** promote a later SHA whose merge also touched the affected
service's own directory, or make the root-file change together with a touch
inside the affected service's `sourceDir` in the same merge.

**What the real fix looks like:** a small explicit table (root path → service
keys it affects) consulted by `ci-build-matrix.js` alongside the sourceDir
prefix match — accepting the fifteenth-copy cost deliberately, with a comment
explaining why it's the one hand-maintained exception.

### [x] 2026-08-27 — a BroadcastChannel test raced its own subscriber, and a stale branch made it look like a suite-wide problem

`LiveUseCaseWorkbenchPage` subscribes to the `demo-script` BroadcastChannel in an
effect keyed on `[useCases, handleRunSelected]`, and its handler drops anything
it cannot resolve:

```js
const uc = useCases.find((u) => u.id === e.data.ucId);
if (!uc) return;                 // message silently discarded
```

The test posted its Run message after waiting for tile TEXT to render — but the
DOM commit and the effect re-subscribing with a populated `useCases` are separate
commits. A message landing in that gap is dropped, the run never starts, and the
assertion fails with `Number of calls: 0`. It failed in CI and on loaded local
runs while passing in isolation and under `--no-file-parallelism`.

**RESOLVED** on `worktree-reauth-modal-and-pgtest`: both Run messages now re-post
until the run is observed, guarded so a retry cannot start a second overlapping
chain. Three consecutive full parallel runs clean afterwards.

The part worth keeping is the diagnostic mistake. Chasing this, four *different*
unrelated tests failed across runs, which looked like proof that the suite had
latent races any new file could tip — and that conclusion was written up here as
fact. It was unsound: the branch was **10 commits behind main**, so every
"main passes / my branch fails" comparison was against a moving target. After
rebasing, the same branch passed three times in a row.

**Before concluding a suite is flaky, check `git rev-list --count HEAD..origin/main`.**
A stale branch produces exactly the symptom of a nondeterministic suite, and
`--no-file-parallelism` passing does not distinguish the two.

### [x] 2026-08-27 — a use case declares only its FIRST tool, so every later tool it calls is invisible to every gate

`useCases.js` gives a use case one machine-readable tool: `primaryTool`. UC38
runs two. Its own `whatLong` says so:

> The agent then calls **get_loyalty_status** to check the miles balance and
> **redeem_miles** to upgrade the cabin on the next upcoming booking.

Only `redeem_miles` is declared. So `get_loyalty_status` was invisible to the
chip-reachability gate, stayed intent-unreachable through #2442, and was found by
driving the live stack rather than by any test.

**Why this is worse than one missing entry**: the gate derives its cases from the
catalog specifically so a new chip is covered automatically. That guarantee is
only as wide as what the catalog declares — one tool. Any use case that runs a
read-then-write pair, a lookup-then-act flow, or an A2A chain has undeclared
tools, and no gate in the repo can see them. `useCases.primaryTool.test.js` has
the same ceiling.

**How the reason was found**, worth recording because it cost a wrong conclusion:
the BFF response body for an intent denial says only

```json
{"error":"gateway_policy_denied","gatewayErrorCode":"access_denied","message":"access_denied"}
```

The actual reason is in PingGateway's `x-gw-audit-trail` response header, which
the BFF logs but does not forward:

```
IntentMatchesTool: "false"
"MCP Denied - Intent Tool Mismatch: Tool 'get_loyalty_status' is not in the
 validated intent token's permitted_tools."
```

A probe classifying denials by response body cannot tell `intent_mismatch` from
`consent required` from `A2A delegation required` — all three arrive as
`access_denied`. One did exactly that during this work and reported a clean bill
for a tool that was in fact intent-denied.

**Real fix**: let a use case declare the tools it calls (`tools: [...]`, with
`primaryTool` staying the chip's entry point), then widen the reachability gate
to the declared set and drop the hand-written `SECONDARY` list in
`demo_api_server/tests/intentTokenService.chipReachability.test.js`. Separately,
consider surfacing the audit-trail deny code in the BFF error body — the
information already reaches the BFF and is dropped on the floor.

**MEASURED 2026-08-27 — the gap is real but its blast radius today is one, and
that one is fixed.** Swept all 57 use cases for prose naming a gateway tool that
is not that use case's `primaryTool` in any vertical:

```
use cases naming an undeclared tool : 9 of 57
undeclared (use case, tool) pairs   : 9
...gateway + intent-unreachable     : none — UC38 was the only one
```

Eight of the nine are the English word "transfer" matching the `transfer` entry
in `scope-topology.json`, which is `surface: "legacy-alias"`, not `gateway` —
substring false positives, not undeclared tools. UC38/`get_loyalty_status` was
the only genuine instance, fixed in #2446.

So this stays open as a **latent** structural gap, not an active bug: nothing is
broken by it right now, and the `SECONDARY` list in the reachability test has
exactly one entry. Priority should be judged accordingly — the fix is worth doing
before the catalog grows more multi-tool use cases, not urgently today. Note the
sweep is a FLOOR: it only counts exact tool-name matches, so a use case
describing a second tool in English ("check the balance, then transfer") is not
counted and would still be invisible.

**RESOLVED 2026-08-27.** A use case can now declare every gateway tool it calls:
`secondaryTools: [...]` alongside `primaryTool` (the chip's entry point).
UC38 declares `['get_loyalty_status']`, and two gates make the field
self-maintaining rather than another hand-kept list:

- `demo_api_server/tests/useCases.secondaryTools.test.js` — fails when an
  entry's own prose names a **gateway-surface** tool it does not declare.
  Filtering to gateway surface is what makes this precise: sweeping all of
  scope-topology matches the English word "transfer" against the `transfer`
  legacy-alias entry in eight unrelated use cases (9 hits, 8 false), while
  gateway-only yields exactly 1 (UC38, real). It also asserts `resolveUseCase`
  does not strip the new field — this repo has shipped a schema silently
  dropping unknown fields before.
- `intentTokenService.chipReachability.test.js` — its `SECONDARY` array is gone.
  It now derives secondary tools from the catalog, so a new multi-tool use case
  is covered the moment it is added, with a vacuity guard so a dropped field
  cannot make the sweep iterate zero cases and pass.

Verified: delete `secondaryTools` from UC38 → 5 failed / 81 passed across both
files; restore → 96 passed. Whole affected surface, 19 suites: 842 passed.

**Still a floor, by design.** The gate keys on an exact tool name in the prose.
A use case describing its second tool in English ("check the balance, then move
the money") declares nothing and is still invisible. Closing that would mean
either a schema requiring `secondaryTools` on every multi-step entry — noise on
the ~50 single-tool use cases — or inferring tools from prose, which is guesswork.
The exact-name floor catches the shape that actually bit us and costs nothing.

### [ ] 2026-08-26 — `sensitive_passenger_record` requires only bare `read`, a weaker scope than its non-sensitive sibling

`scope-topology.json`:

```jsonc
"get_airline_bookings":       { "requiredScopes": ["airlines:read"] }
"sensitive_airline_bookings": { "requiredScopes": ["airlines:read", "sensitive:read"], "challengeType": "consent" }
"sensitive_passenger_record": { "requiredScopes": ["read"], "challengeType": "consent",
                                "a2aDelegatedScope": "pnr:read", "a2aDelegated": true,
                                "requiresAgentMediation": true }
```

Every other airlines tool requires `airlines:read`. The one holding PNR data
requires only `read` — which every session already carries. Its consent-gated
sibling requires *more* (`airlines:read` + `sensitive:read`), so this is not the
house style for sensitive tools.

**Why it was left as found**: it is plausibly deliberate. The entry carries
`a2aDelegatedScope: "pnr:read"` plus `a2aDelegated` and `requiresAgentMediation`,
so the real gate may be the delegated scope and the mediation requirement rather
than the base scope, with `read` acting as a deliberate floor for a tool only
ever reached through an A2A specialist. Changing a live PDP scope requirement to
find out is not a drive-by — it would either break the A2A chain or silently
widen nothing, and neither outcome is visible from the topology file alone.

**How it surfaced**: `demo_mcp_gateway/tests/airlinesDispatch.test.ts` used to
name three airlines tools by hand. Deriving that list from the resource server's
exported `AIRLINES_TOOL_NAMES` (nine tools) made the pre-existing
`airlines:read` assertion cover this one for the first time, and it failed. The
test now excludes it by name with the reasoning inline.

**Real fix**: decide which gate is authoritative for an agent-mediated tool. If
`a2aDelegatedScope` is the gate, say so once in the schema and stop implying the
base scope matters; if it is not, `sensitive_passenger_record` should require
`airlines:read` + `sensitive:read` like `sensitive_airline_bookings`. Then drop
the exclusion from the test.

**WITHDRAWN 2026-08-27 — this entry was wrong.** `sensitive_passenger_record` is
not an outlier; it is the convention. Every A2A-delegated tool in
`scope-topology.json` has exactly this shape:

| tool | requiredScopes | a2aDelegatedScope | challengeType |
|---|---|---|---|
| `sensitive_customer_identity` | `read` | `identity:read` | consent |
| `sensitive_holdings` | `read` | `holdings:read` | consent |
| `sensitive_membership_details` | `read` | `membership:read` | consent |
| `sensitive_order_history` | `read` | `purchase:read` | consent |
| `sensitive_passenger_record` | `read` | `pnr:read` | consent |
| `sensitive_patient_records` | `read` | `records:read` | consent |
| `sensitive_payroll_details` | `read` | `payroll:read` | consent |
| `sensitive_student_finance` | `read` | `finaid:read` | consent |
| `sensitive_supplier_contract` | `read` | `supplier:read` | consent |
| `sensitive_tax_record` | `read` | `tax:read` | consent |

Ten for ten. The base scope is deliberately coarse because it is not the gate:
`requiredScopes` gates the tool call, while `a2aDelegatedScope` is the dedicated
scope minted for the specialist in Exchange #2 — a different hop, and per
`REGRESSION_PLAN.md` §"never let an A2A specialist's derived scope be read or
write", the one that carries the authorization. Confirmed live: an unmediated
call to `sensitive_membership_details` denies with *"MCP Denied — A2A Delegation
Required"*, not on scope.

The comparison that produced this entry was against `sensitive_airline_bookings`
(`airlines:read` + `sensitive:read`) — which is the **only** `sensitive_*` tool
with no `a2aDelegatedScope`, i.e. the singleton, not the norm. Measuring one
member of a class of ten against the sole member of a different class is what
made the convention look like a defect.

Nothing to fix. The `SCOPE_GATED` exclusion in
`demo_mcp_gateway/tests/airlinesDispatch.test.ts` stays, but for the right
reason: A2A-delegated tools are gated on their delegated scope, so holding them
to `airlines:read` would assert a contract that does not apply to them.

**Follow-up ANSWERED 2026-08-27 — and the answer is no.** The open question was
whether `sensitive_airline_bookings` should be A2A-delegated like its ten peers,
since it is the one sensitive tool reachable without agent mediation. Digging in,
the premise was wrong twice over.

**First: the ten are not a class of sensitive tools.** They are one A2A
specialist tool *per vertical*, from `demo_api_server/config/a2aSpecialists.js`:

```
healthcare  records    sensitive_patient_records     manufacturing supplier  sensitive_supplier_contract
retail      purchase   sensitive_order_history       investment    holdings  sensitive_holdings
sporting-g  membership sensitive_membership_details  airlines      passenger sensitive_passenger_record
workforce   payroll    sensitive_payroll_details     admin         identity  sensitive_customer_identity
government  tax        sensitive_tax_record          university    finaid    sensitive_student_finance
```

Airlines' slot is already taken. `sensitive_airline_bookings` is not a missing
eleventh member; it is a second airlines sensitive tool with no specialist slot.

**Second: airlines runs THREE tiers on purpose**, where healthcare runs two:

| tier | tool | gate | chip `useCaseId` |
|---|---|---|---|
| plain | `get_airline_bookings` | `airlines:read` | — |
| consent | `sensitive_airline_bookings` | `airlines:read` + `sensitive:read`, `challengeType: consent` | **`hitl-consent`** |
| A2A-only | `sensitive_passenger_record` | `read` + `pnr:read`, `requiresAgentMediation` | **`a2a-delegation`** |

Both sensitive tools have their own chip in
`config/verticals/airlines/manifest.json` ("🔐 Sensitive reservations" and
"Sensitive passenger record"), driving two different use cases. The resource
server states the split in its own comment: `pnr:read` exists so "the delegation
chain is the only way in", while `sensitive_airline_bookings` "carries
`sensitive:read`, so the plain lookup stays ungated and only THIS one prompts".

**What converting it would cost.** `requiresAgentMediation: true` DENIES any call
with no `act` claim (`demo_authz_server/routes/decision.js` Rule ~721, gated on
`REQUIRE_ACT_FOR_AGENT_TOOLS`, which defaults ON). The "🔐 Sensitive
reservations" chip and the `/sensitive.*(booking|reservation)/` heuristic would
both start failing `missing_act`, deleting airlines' HITL-consent demo and
duplicating what `sensitive_passenger_record` already shows. It would also need a
new `bookings:read` scope provisioned on the live `Super Banking A2A MCP Gateway`
resource (verified live: 12 scopes, no `bookings:read`) BEFORE any code merge, or
Exchange #2 dies with `invalid_scope`.

**Decision: leave the tool exactly as it is.** The asymmetry is the design, not a
defect. Recorded in `REGRESSION_PLAN.md` §1 ("Airlines is THREE tiers, not two")
so the next person does not re-file this finding — as I did.

### [x] 2026-08-26 — 143 gateway tools are intent-unreachable; only the 17 chip-driven ones were mapped

`server.js` mints `intent = _TOOL_TO_INTENT[tool] || tool`, and the gateway then
denies anything that intent does not permit:

```
intent_mismatch: tool "view_wishlist" not permitted for intent "view_wishlist"
```

A tool with no `_TOOL_TO_INTENT` override AND no `INTENT_TO_PERMITTED_TOOLS`
entry is therefore unreachable — the minted intent is the tool name, and the
unknown-intent fallback (the vertical's non-sensitive reads) excludes it.

Measured 2026-08-26: **160 of 244** gateway-surface tools are in that state.

**What was fixed** (PR #2442): the **17** that drive a chip. Chips are the
demo-reachable surface, so those were provably broken.

**What was NOT fixed**: the remaining **143**. They are not known to be broken —
they are known to be *unproven*. Nothing in the demo drives them today, so there
is no evidence any of them is reached at all; mapping them blind would add 143
`tool: [tool]` entries whose only justification is symmetry, and would make the
chip-reachability gate assert a scope nobody has validated.

**Why not now**: the real question is upstream of the intent map — is each of
those 143 a live tool that nothing routes to yet, a dead alias, or a
never-implemented catalog stub? That inventory is the fix; the mapping is a
consequence of it. Doing the mapping first would bury the inventory question
under a green test.

**Real fix**: classify the 143 by whether any surface (chip, LLM route, A2A
chain, guided-demo step) can dispatch them. Map the live ones, delete the dead
ones from the catalog, and extend
`demo_api_server/tests/intentTokenService.chipReachability.test.js` from "every
chip-driven tool" to "every dispatchable tool" once "dispatchable" has a
definition the test can compute.

**INVENTORY DONE 2026-08-27 — and "unproven" was too generous. Most of them are
plainly broken.** Current count after #2442/#2446: 142 of 244 unreachable.
Classified by the highest-priority surface that can dispatch each:

| surface | count | meaning |
|---|---|---|
| chip (`primaryTool`) | 0 | fixed by #2442 |
| **vertical heuristic** | **99** | **a typed phrase reaches it — BROKEN** |
| plugin `getTools()` | 26 | the LLM may pick it |
| named in UC prose | 0 | fixed by #2446 |
| no surface modelled | 17 | mostly `jwt_*`, `pingone_*`, `demo_show_*` — teaching/admin surfaces this classifier does not model, NOT proof they are dead |

The 99 are not theoretical. A vertical's `getHeuristics()` maps a phrase regex
straight to a tool name, and these are ordinary demo phrases. Driven live in
Super Sports, each routing correctly and then dying at the intent gate:

```
"my addresses"                routed->list_addresses       call 403
"show my invoices"            routed->list_invoices        call 403
"my wishlist"                 routed->list_wishlist        call 403
"my subscriptions"            routed->list_subscriptions   call 403
"what promotions do you have" routed->list_promotions      call 403
```

All five denials confirmed as the intent gate, from the gateway audit trail:
`IntentMatchesTool: "false"` ×5. So the heuristic does its job, the tool exists,
and the intent map is what refuses.

**These are not deliberately denied.** `permittedToolsForIntent` falls back to
`READ_ONLY_TOOLS_BY_VERTICAL[vertical]`, which excludes them — the same
incomplete-map failure that broke `get_weather`, `get_branch_hours` and the 17.
The fallback's narrowing is a real security control (it stopped cross-vertical
exposure) but it was never intended as the gate for a tool the demo dispatches
on purpose.

**Do NOT fix by adding 99 hand-written entries.** Today produced three separate
bugs from hand-kept copies of one list (`AIRLINES_TOOLS` in `router.ts`,
`INVEST_BACKEND_TOOLS` in the Groovy, and that test's own array). Derive the
self-grant set from the dispatch registry instead — per vertical, the union of
`getHeuristics()` actions and `getTools()` names, intersected with
gateway-surface tools — so it cannot drift and stays bounded to what the demo can
actually dispatch. Anything outside that set keeps failing closed.

A blanket "intent equals tool name always self-permits" would be simpler and is
**wrong**: it makes the fallback's narrowing unreachable and removes the
fail-closed default for genuinely unknown tools.

**CLOSED 2026-08-27 — re-measured after #2450, and the remainder is not broken.**
229 of 244 gateway tools are now reachable. Re-running the classification with
the SHIPPED logic (vertical *directories*, 16, not the 14 manifest `VERTICALS`
the first sweep used) and applying `_TOOL_TO_INTENT` — without the override map
the sweep reports `show_mortgage` as unreachable when its real intent
`view_mortgage` permits it, the same blind spot that produced three false
failures in the first chip-reachability test — leaves **13**:

```
brave_news_search   demo_show_accounts     jwt_decode_full      jwt_verify_signature
call_pingone_operation  demo_show_transactions  jwt_fetch_jwks   user_profile_card
create_wire_transfer    discover_oas_operations jwt_inspect_key
get_account_nickname                            jwt_validate_claims
```

**The intent gate does not apply to any of them.** `demo_mcp_gateway/src/index.ts`:

```js
const intentValidation = xIntentToken || config.intentTokenRequired === true
  ? validateIntentToken(xIntentToken, toolName) : null;
```

The gate runs only when an intent token is *present*. Three independent
confirmations that these tools never carry one:

1. `INTENT_TOKEN_REQUIRED` is unset on the live gateway → `intentTokenRequired`
   is `false`, so a token-less call skips validation entirely.
2. `mintIntentToken` has five call sites (`agentRun.js`, `agentInvokeRoute.js`,
   `devTools.js`, `attackSimulatorService.js`, `server.js`). The MCP façade —
   `routes/mcpFacade.js`, 680 lines, the external-client door — is not one of
   them and sends no `X-Intent-Token`.
3. Driving `jwt_verify_signature` through the BFF path that *does* mint returns
   `502 Unknown tool` — that route does not even know these tools. Their only
   caller is an external MCP client (LM Studio, MCP Inspector, the façade).

`ServerCapabilitiesPanel.js` lists the `jwt_*` names, but as documentation text,
not a dispatcher.

**Nothing to fix. One latent risk worth knowing**: setting
`INTENT_TOKEN_REQUIRED=true` would deny all 13 at once, because a token-less
external call would then be validated and fail `no_intent_token`. That flag is
the switch to check first if external MCP clients ever start returning
`intent_token_invalid`.

**Also noted, unfixed**: `ping-gateway/config/scope-topology.json` is a
hand-maintained twin of the root `scope-topology.json` and has drifted by two
tools (`get_loyalty_status`, `redeem_miles`). `npm run topology:verify` does not
compare them, so nothing catches it.

### [x] 2026-08-26 — nine gateway-routed tools were never registered in scope-topology, so the PDP denied them as `unknown_tool`

**Where:** `scope-topology.json` and its hand-maintained twin
`ping-gateway/config/scope-topology.json`.

**What was wrong:** `demo_authz_server/routes/decision.js` Rule 3 fails closed when
`ruleStore.requiredScopesForTool()` returns null — correct, but nine tools the
gateways actively route were absent from the topology it reads:

| tools | backend |
|---|---|
| `get_weather` | weather showcase |
| `brave_news_search` | brave showcase |
| `get_branch_hours` | PingGateway |
| `jwt_verify_signature`, `jwt_validate_claims`, `jwt_fetch_jwks`, `jwt_inspect_key` | jwtverifier |
| `demo_show_accounts`, `demo_show_transactions` | bankingdata disposition |

**What made it demo-visible and hard to see:** the weather geofence
(`checkWeatherScope` / `tx-weather-scope.groovy`) is a feature-flag driven gateway
filter that runs AFTER authorization. With no policy entry the PDP denied first, so
the geofence never evaluated. Measured live:

```
Austin, TX   403  unknown_tool: no policy defined for tool "get_weather"
Miami        403  unknown_tool: no policy defined for tool "get_weather"
(no city)    403  unknown_tool: no policy defined for tool "get_weather"
```

Austin is IN Texas and should PERMIT. So UC30 was broken outright, and **UC31 looked
correct while being wrong**: it denies, as the demo intends, but for a missing-policy
reason rather than the geofence. A test asserting only DENY passes either way, and a
viewer cannot tell the difference — the same false-green shape as the dead intent-token
verifier.

**Fixed 2026-08-26 (branch `worktree-topology-missing-showcase-tools`):** all nine
registered with `surface: gateway` and `requiredScopes: ["read"]`.

`read`, not the finer `jwt:verify` / `accounts:read` / `transactions:read`, and that
was not a shortcut: `allowedScopesByAudience.parity` rejected those three because the
INBOUND gateway token carries gateway-audience scopes. The finer scopes live on the
EXCHANGED, backend-audienced token; requiring them at the gateway surface would deny
tools whose inbound token can never carry them. `get_my_accounts` is `["read"]` for
exactly this reason, and all three were defined-but-unused by any gateway-surface tool.

Verified with `npm run topology:verify` — PASSED, exit 0, after regenerating
`docs/scope-topology.md` (a generated artifact; the gate caught it un-regenerated
first, working as designed).

**Known drift left alone:** `ping-gateway/config/scope-topology.json` is a
hand-maintained copy that nothing generates or checks — it was last touched
2026-08-12 and still lacks `get_loyalty_status` and `redeem_miles`, which root gained
since. Both copies now carry the nine, but the pre-existing two-tool gap is untouched
because I could not establish whether PingGateway is meant to serve airlines tools at
all. A generator or a parity gate for those two files is the real fix; today nothing
would notice them diverging again.

### [x] 2026-08-26 — native ID-JAG is a per-server grant, but the BFF took it for tools on OTHER servers, 502ing every non-banking vertical

**Where:** `demo_api_server/services/agentMcpTokenService.js` (~1445, the
`maybeResolveNativeIdJagToken` call site).

**What was wrong:** a redeemed ID-JAG bearer carries exactly ONE audience —
oauth-mcp's own resource (`TokenIssuer.resolveOwnAudience`; the AS is not entitled
to assert any other). The BFF took the native path for EVERY tool, resolving the
resource from the routing mode rather than from the backend the tool actually
reaches.

`demo_mcp_gateway/src/router.ts` `routeTool()` sends **ten** verticals — retail,
sporting-goods, healthcare, government, manufacturing, university, workforce,
airlines, A&F, investment — to the `invest` backend. Only banking defaults to
`olb`. For all the rest the gateway PERMITs, its ID-JAG exemption then correctly
refuses to forward (the token's aud is not the invest resource, and forwarding
would widen what an ID-JAG bearer reaches beyond what D-05 verified), it falls
through to the RFC 8693 exchange, and PingOne rejects a token it did not sign:

```
RFC 8693 exchange to backend=invest (resource=mcp-invest.ping.demo,...)
rejected with HTTP 400 — invalid_request:
Cannot parse token claims for request param 'subject_token'
```

→ HTTP 502 `Gateway upstream error` for the tool call.

**How it surfaced:** it was NOT reachable this morning. Before the `expectedAud`
fix, every ID-JAG call was rejected BFF-side before leaving the process, so no
vertical ever got here. Completing the ID-JAG chain made banking work and exposed
that every other vertical could not. The incompatibility pre-existed; finishing the
chain is what made it visible — and briefly made the default demo vertical (Super
Sports) return 502.

**Fixed 2026-08-26 (branch `worktree-idjag-olb-tools-only`):** take the native path
only when the tool actually lives on the OLB server; everything else falls through
to the RFC 8693 stand-in, unchanged and working.

The OLB set is read from the BFF's OWN banking tool registry
(`getBankingToolDefinitions`, 11 tools) rather than by copying `router.ts`'s routing
sets — this repo has been burned twice by a second copy joined only by a
keep-in-sync comment. The failure modes are asymmetric and both land safe: a genuine
OLB tool missing from the registry merely loses the native path and uses the
exchange (today's working behaviour); the reverse would reproduce the 502 the guard
exists to stop.

Evidence: `src/__tests__/agentMcpTokenService.idJagOlbOnly.test.js` — 15 tests
pinning the predicate for the three OLB tools, seven invest-backed vertical tools,
and the null/unknown fail-safe. It also asserts the predicate is exported at all,
because a skipped suite reads as green. RED-proven: removing the gate fails 8 of 15.
Full BFF suite 10,334 passed, 0 failures.

**Worth knowing for the next per-server grant:** the more correct long-term shape is
minting the ID-JAG for the backend the tool routes to, so invest-backed verticals get
the native path too. That needs the invest resource allow-listed on both legs
(`ENTERPRISE_MCP_RESOURCE_URIS` and `MCP_SERVER_RESOURCE_URI`) and a per-tool
resource resolution in the mint — a bigger change than restoring the demo warranted.

### [ ] 2026-08-26 — `ig_mcp_error_total` does not count schema-invalid JSON-RPC envelopes

PingGateway's `McpValidationFilter` publishes `ig_mcp_error_total` on the admin
connector, labelled by JSON-RPC error code. It counts most rejections but not
all: a request whose envelope fails JSON-RPC **schema** validation is rejected
with a 400 and never reaches the counter.

Measured live against `00-mcp-external-door` on `ping-devops-cmuir`, each case
driven through the real OAuth flow with a valid token, reading the counter
before and after:

| Case sent | Gateway response | Counter |
|---|---|---|
| unsupported `MCP-Protocol-Version` header | 400 `-32600` | +3 of 3 |
| unknown MCP method (`does/not/exist`) | 400 `-32600` | +2 of 2 |
| unknown tool (`no_such_tool`) | 400 `-32602` | +1 of 1 |
| envelope missing `jsonrpc` property | 400 `-32600` | **0 of 2** |

The last row is the gap. The gateway answers
`{"code":-32600,"message":"Invalid Request: Invalid JSON-RPC Request","data":["required property 'jsonrpc' not found"]}`
and `ig_mcp_error_total{mcp_error="-32600"}` stays flat across repeated sends
(7.0 → 7.0). Schema validation evidently runs before the point where the filter
records the error, so those rejections are invisible to metrics.

Why it wasn't fixed here: it is upstream product behaviour in `openig-mcp`, not
demo code — there is nothing in this repo to correct. What this repo can do, and
does, is refuse to present the number as a total: `routes/gatewayMetrics.js`
documents the gap and the UI panel labels the figure "a floor, not a total".

The real fix is upstream — the counter should increment wherever the filter
emits a JSON-RPC error, including the schema-validation path. Worth raising with
Ping if anyone builds alerting on this metric, because the blind spot covers
exactly the traffic an operator most wants alerted on: a client sending
structurally broken envelopes. Until then, treat `ig_mcp_error_total` as a lower
bound and corroborate with `ig_http_server_*` status counts.

Reproduce: `demo_api_server/tests/routes/gatewayMetrics.test.js` covers the
parser; the live probe is an authenticated `tools/list` POST with `jsonrpc`
omitted from the body, with the counter read from
`http://ping-gateway:8085/metrics/prometheus/0.0.4` either side.
### [x] 2026-08-26 — the banking circuit breaker counts 403 authorization denials as upstream failures, so a cross-owner probe DoSes banking for everyone

**Where:** `oauth-mcp/src/utils/CircuitBreaker.ts` `execute()`, driven from
`oauth-mcp/src/banking/BankingAPIClient.ts:543`.

**What's wrong:** the breaker treats every thrown error identically —

```ts
try { const result = await fn(); this.onSuccess(); return result; }
catch (error) { this.onFailure(); throw error; }
```

so a 403 `Access denied. You can only check your own account balance.` — an
authorization control working exactly as designed — counts the same as the banking
API being unreachable. With `failureThreshold: 5` and `resetTimeout: 60000`, **five
cross-owner reads open the breaker for a minute and take banking tools down for
every user**, not just the caller who probed.

Found live: a value-assertion sweep passed four `account_id`s that were not
demoUser's, earned four 403s plus one more failure, and the next call returned
`Banking API is currently unavailable (circuit breaker open)`. The banking API
itself was healthy throughout (`/health` 200, container up 9 hours).

**This is reachable on purpose.** UC10 is the demo's cross-owner attack simulation
— its whole point is to present another owner's account id and be denied. Running
it a handful of times in a demo trips the breaker and the next legitimate "show my
balance" fails with an infrastructure error, which reads as the demo being broken
rather than the control working.

**The same file already knows better.** `BankingAPIClient.shouldRetryRequest()`
deliberately excludes 4xx-except-429 from retries ("Don't retry authentication
errors"). So the two resilience policies disagree on the same responses: a 403 is
"not worth retrying" but IS "evidence the upstream is failing". Only one of those
can be right, and the retry side has it.

**Why it wasn't fixed now:** it is a resilience-policy decision (which classes of
error are evidence of upstream sickness) on a security-adjacent path, and it was
found while doing something else. It also self-heals in 60s, so it degrades a demo
rather than breaking the stack.

**Real fix:** give the breaker the same predicate the retry manager already uses —
do not call `onFailure()` for 4xx except 429. A client error means the request was
wrong, not that the server is sick; counting it inverts the breaker's purpose.
Cheapest shape is an `isFailure?: (err) => boolean` on `CircuitBreakerConfig`,
defaulting to today's behaviour so no other consumer changes, with
`BankingAPIClient` passing the same test as `shouldRetryRequest`. Pin it with a
test that fires 10 consecutive 403s and asserts the breaker stays CLOSED.

**FIXED 2026-08-26 (branch `worktree-breaker-ignores-client-errors`).** Built as
scoped: optional `isFailure` on `CircuitBreakerConfig`, defaulting to the original
count-everything behaviour so no other consumer changes, and `BankingAPIClient`
passes the same predicate its retry manager uses.

Rather than add a second copy of the 4xx test, the retry path's inline logic was
extracted to `BankingAPIClient.isClientError()` and BOTH policies now consume it —
this file has already been burned once by two copies joined only by a keep-in-sync
comment (see `tests/helpers/actionToTool.js`'s header), and this bug WAS the two
policies disagreeing about the same response.

Two deliberate calls worth recording:

- **A non-failure error is NEUTRAL**, not a success. It neither trips the breaker
  nor closes a HALF_OPEN one. The upstream did answer, but a rejected request is
  thin evidence of health, and letting a 403 close the breaker is a bigger claim
  than this fix needs to make.
- **429 still counts as a failure**, unlike other 4xx — rate limiting IS upstream
  distress, and the retry manager already treats it as retryable. Pinned by its
  own test so nobody "simplifies" it into the 4xx bucket.
- A throwing `isFailure` predicate fails SAFE (counts the error), so a broken
  predicate can never mask a real outage. Also tested.

Evidence: `src/utils/__tests__/CircuitBreaker.clientErrors.test.ts` — 26 tests.
RED-proven: restoring the unconditional `onFailure()` fails 9, including
"still serves requests after those 403s", which is the user-visible regression.
The breaker still OPENs on ECONNREFUSED, 5xx and 429. Full oauth-mcp suite green:
94 suites, 1197 tests.

### [x] 2026-08-26 — intent-token verification is dead on BOTH gateway paths, and the BFF signs with the vault CIPHERTEXT

**Where:** `demo_api_server/services/intentTokenService.js:8`,
`demo_mcp_gateway/src/intentTokenValidator.ts:40`,
`ping-gateway/scripts/groovy/p1az-decision.groovy`,
`demo_api_server/scripts/refresh-service-envs.js` (~504, ~690).

**What's wrong:** all three sides resolve the HMAC key as
`INTENT_TOKEN_SECRET || SESSION_SECRET`, and no two of them arrive at the same
value. Found in the gateway audit trail of a real `get_account_balance` turn:
`IntentTokenValid: "false"`, `IntentTokenError: "no_signing_key"`.

| path | state | cause |
|---|---|---|
| Node gateway (`mcp-gateway`) | `no_signing_key` — visible in `gw_audit_trail` | `demo_mcp_gateway/.env` carries no `INTENT_TOKEN_SECRET`; neither var is set in the container, so `getSigningKey()` throws |
| PingGateway (IG) | `invalid_signature` — **silent** | `ping-gateway/.env` has a 48-char key; the BFF's effective key is a DIFFERENT 207-char value, so every HMAC check fails |

**The root cause is worse than the wiring.** `demo_api_server/.env` contains
`SESSION_SECRET=encrypted:…` — the vault CIPHERTEXT, 206 chars — and
`intentTokenService.getSigningKey()` reads `process.env` directly. `configStore`'s
`encrypted:`-in-.env guard (added after the 2026-08-21 `invalid_client` incident,
see `docs/vault.md`) does not apply to `process.env`, so **the BFF signs intent
tokens with the literal ciphertext string**. Verified: the BFF's runtime
`SESSION_SECRET` is 207 bytes beginning `encrypted:`, and its SHA differs from
`ping-gateway/.env`'s value. Any service handed the *real* secret can never match
it — which is precisely why ping-gateway's key looks correct and still fails.

`refresh-service-envs.js` already tries to fix this: both the
`demo_mcp_gateway/.env` and `ping-gateway/.env` blocks emit
`INTENT_TOKEN_SECRET: fb('INTENT_TOKEN_SECRET') || fb('SESSION_SECRET')`, each with
a comment describing this exact dead-verifier bug (PR #2055, 2026-08-18). It does
not work, because `fb()` reads `demo_api_server/.env` — where `SESSION_SECRET` is
the ciphertext and `INTENT_TOKEN_SECRET` is absent entirely.

**Consequence:** ~190 lines of HMAC checking in `p1az-decision.groovy` plus the
Node validator are inert. The PDP receives `IntentTokenValid: false` and permits
anyway, so **the intent-token evidence the demo claims to bind is not being
checked on either path.** Nothing is blocked, which is why it went unnoticed.

**Why it wasn't fixed now:** the repair needs secret material — either a new
dedicated `INTENT_TOKEN_SECRET` provisioned in the vault and propagated, or
stopping `SESSION_SECRET` from resolving to its own ciphertext, which touches
session signing (REGRESSION_PLAN §1). Both are decisions about credentials rather
than bug fixes, and this was found while closing an unrelated entry.

**Real fix — preferred:** provision a DEDICATED `INTENT_TOKEN_SECRET` (vault),
have `refresh-service-envs.js` emit it to both gateway env files, and let all
three sides resolve it first. That is better than sharing `SESSION_SECRET` across
services regardless of the ciphertext bug — a gateway should not hold the key that
signs browser sessions. Add a startup assertion that the resolved key is not
`encrypted:`-prefixed, so this fails loudly instead of silently signing with
ciphertext. A parity check (BFF effective key vs each gateway's) belongs in the
demo-check framework next to `gatewayMetadataCheck`.

**RESOLVED 2026-08-26 (branch `worktree-intent-token-ciphertext-guard`).** Took the
preferred option: a DEDICATED key, so no gateway holds the browser-session secret.

`INTENT_TOKEN_SECRET` (48 chars, `openssl rand -base64 36`) provisioned in
`demo_api_server/.env`. It has to live there rather than the vault:
`intentTokenService` reads `process.env`, and a vault-only entry is decrypted by
configStore, which never reaches `process.env`. `scripts/refresh-service-envs.js`
needed NO change — its `fb('INTENT_TOKEN_SECRET') || fb('SESSION_SECRET')` blocks
(PR #2055) were correct all along and had simply never had a value to find.
Re-running it propagated the key to `demo_mcp_gateway/.env` and `ping-gateway/.env`;
all three files and all three running containers now hash identically.

**Verified live** — same signed `get_account_balance` turn, gateway audit trail:

```
IntentTokenValid: "true"    IntentMatchesTool: "true"   IntentTokenError: ""
IntentIntent: "view_balance"  IntentConfidence: "0.97"  decision: "PERMIT"
```

Previously `IntentTokenValid: "false"` / `no_signing_key`. The ~190 lines of HMAC
checking now actually run. Run validated with `stack:generation --check`.

**Guard added so it cannot silently regress:** `intentTokenService.getSigningKey()`
now throws if the resolved key is `encrypted:`-prefixed, naming both the fault and
the fix. This was undetectable from the signing side — an HMAC key is just bytes, so
the signature was always valid and only the verifiers failed. Pinned by
`src/__tests__/intentTokenService.ciphertextKey.test.js` (5 tests, including the exact
production shape: no dedicated key plus a ciphertext `SESSION_SECRET`). RED-proven:
removing the guard fails 3 of 5. Full BFF suite 10,273 passed, 1 known flake
(`mcpFacade`) that passes scoped.

**Parity probe SHIPPED 2026-08-26 (branch `worktree-intent-key-parity-check`).**
`services/checks/intentTokenKeyCheck.js` (`intent.key_parity`, Agent Gateway,
blocking) compares the BFF's effective key against BOTH gateway env files through
the `/repo` mount and reports by SHA-256 digest — key material never reaches a
posture line. It distinguishes all four states seen here: peer with NO key
("no_signing_key"), peer with a DIFFERENT key (the silent `invalid_signature`),
a ciphertext BFF key (fails before comparing anything), and parity held only via
the `SESSION_SECRET` fallback (warn — it works, but hands a gateway the
browser-session key).

It carries a vacuity guard, added because the first live run tripped it: run
outside the container `/repo` is absent, neither peer file is readable, and it
reported **`pass` having compared nothing** — the same shape of green-that-proves-
nothing this whole entry is about. Now that case is `warn`. Verified live inside
the BFF container: `pass — dedicated INTENT_TOKEN_SECRET, digest 33d0…, matches
2/2 gateways`. 8 tests.

**Still not done:** the guard catches the
ciphertext case at the source, which is what actually happened; a BFF-vs-gateway
key-parity check is still worth adding. And `SESSION_SECRET` in
`demo_api_server/.env` is still configStore ciphertext — harmless for sessions (a
consistent key is a valid key) but the same trap for any future consumer that reads
it from `process.env`.

### [ ] 2026-08-26 — `ping-mcpgw` Helm release's only remaining purpose is a backend it doesn't gate

**Where:** `k8s/helm/mcpgw` release `ping-mcpgw` in `ping-devops-cmuir`.

**What's wrong:** the release's gateway piece (`mcpgw.enabled`) was set to
`false` for good in PR #2391 — it was a redundant duplicate of the one real
agent-based gateway in `ping-devops-curtismuir` (`cm-mcpgw-mcpgw`), and could
never stay up anyway (its `ENV_PROXY_TOKEN` is ~2h-lived and every SE deploy
used to reinstall it with a 5-day-stale one). That leaves the release
installing only `ping-mcpgw-opensearch` and `ping-mcpgw-opensearch-mcp-server`
— a gateway chart, still deployed on every SE deploy, whose sole surviving
purpose is an OpenSearch backend nothing in the Privilege console even points
at any more (the `opensearch-cmuir` Agentic App was repointed the same day to
curtismuir's `cm-mcpgw-opensearch-mcp-server` instead, precisely so it
wouldn't depend on this release). See
`.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` for the full routing
rule this incident produced.

**Why it wasn't fixed now:** the clean end state — moving OpenSearch out of
`k8s/helm/mcpgw` into its own chart, or dropping the `ping-mcpgw` release
from `deploy.sh` entirely once nothing references its backend — was raised
the same day and deliberately deferred; disabling the broken gateway piece
without touching anything currently working was the requested scope.

**Real fix:** once nothing depends on `ping-mcpgw-opensearch*` (or once it's
confirmed genuinely unused), either extract `opensearch`/`opensearch-mcp-server`
into a standalone chart so a gateway release stops shipping a non-gateway
backend, or stop installing `ping-mcpgw` from `deploy.sh` altogether.

### [ ] 2026-08-24 — `mcpPrivilegeAuth.js`'s cached DCR client can't serve a callback origin discovered after registration

**Where:** `demo_api_server/routes/mcpPrivilegeAuth.js`'s `ensureClient()` —
`_clientCache` is process-lifetime, keyed by nothing (one client for the whole
process), registered once against `inspectorCallbackUrls(req)`'s snapshot at
first-call time.

**What's wrong:** if `PUBLIC_APP_URL` changes at runtime (a config-store
write, not a redeploy) to a host not already in the hardcoded set
(`local.ping-devops.com:4000`, `api.ping.demo:4000`) or `CORS_ORIGIN`, a login
from that new origin computes a `redirect_uri` the cached DCR client was never
registered with — the gateway's token exchange rejects the mismatch, and
nothing in this process re-registers until it restarts. Flagged by Greptile's
review of PR #2348 (P2, non-blocking).

**Why it wasn't fixed now:** narrow, self-recovering-on-restart edge case —
`PUBLIC_APP_URL` changing mid-process is not part of this demo's normal
operation, and the current code already defends the two real hostnames this
repo actually serves from plus `CORS_ORIGIN`. A proper fix (re-register on
cache-miss-by-origin, or invalidate on config change) adds real complexity
for a scenario that hasn't been observed in practice — the same judgment call
`mcpTransports/http.js`'s sibling session-eviction gap made before its own
fix landed in this same PR.

**Real fix:** key `_clientCache` by the set of registered `redirect_uris`
(or simplest: by whether the current request's `callbackUrl(req)` is already
in the cached client's registered set) and re-run `ensureClient` when it
isn't, instead of caching one client unconditionally for the process
lifetime.

### [ ] 2026-08-25 — `demo_mcp_gateway`'s RFC 8693 client duplicates `oauthService.js`'s request-building

**Where:** `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts` vs.
`demo_api_server/services/oauthService.js`.

**What's wrong:** both independently build the same RFC 8693 token-exchange request shape
(`grant_type`/`subject_token`/`actor_token`/`resource`/`scope`) and independently handle the
same PingOne quirk — `resource=` (repeated) for a multi-resource client, `audience=` otherwise,
because PingOne rejects a scope-less exchange with "May not request scopes for multiple
resources" — each with its own comment explaining the same workaround. Investigated while
deleting a *different*, dead duplication (`demo_api_server/services/rfc8693TokenExchangeService.js`
and `subjectTokenService.js`, both unreachable — see the commit that added this entry); this one
is real and live on both sides, so it wasn't in scope for that fix.

**Why it wasn't fixed now:** the gateway is TypeScript, a separately deployed Node process from
`demo_api_server`. Consolidating means a shared package published/linked between two
independently-deployed services — real infrastructure work, not a code-only refactor, and
disproportionate for two call sites.

**What the real fix looks like:** if a third RFC 8693 client shows up anywhere in this repo, pull
the request-building + PingOne-quirk logic into a small shared package both services depend on.
Until then, two hand-synced copies is the cheaper trade.

### [x] 2026-08-24 — LibreChat Privilege MCP tool call blocked by LLM context size, not by anything in `librechat/`

**Where:** `librechat/librechat.yaml`'s `mcpServers.privilege` block; the live
LLM backend served via `demo_llm_proxy/` at `:8090`.

**What's wrong:** Task 5 of
`docs/superpowers/plans/2026-08-24-librechat-privilege-mcp-client.md` proved
the OAuth flow end-to-end against the real PingOne Privilege gateway —
Dynamic Client Registration and a real login both succeeded, and LibreChat's
MCP server panel showed "Connected." But a live proof of an actual
`get_my_accounts` tool call through LibreChat's chat UI is blocked:
`curl localhost:8090/v1/models` confirms the live LLM backend's real context
window is 8192 tokens, while the Privilege MCP server's full 242-tool
catalog alone needs roughly 30243 tokens of schema just to describe the
tools — about 4x more than the model can hold before any conversation or
tool-result content is added. This is an LLM-capacity vs. tool-catalog-size
mismatch, not a bug in `docker-compose.yml`, `.env.example`, or
`librechat.yaml`.

**Why it wasn't fixed now:** this repo's LLM tiers/context sizes are frozen
by prior policy, so swapping to a larger-context tier is out of scope. The
currently-pinned LibreChat version (`version: 1.3.14` config schema,
`librechat-dev:latest` image) has no librechat.yaml-side or LibreChat-side
option to filter or scope which of an MCP server's tools get advertised to
the model, so there is also no config-only way to shrink the catalog.

**Real fix:** either (a) gateway/MCP-server-side tool-catalog scoping — the
`privilege` MCP server or the agentless gateway in front of it exposes a
reduced tool set to this client instead of the full 242, or (b) a
larger-context local model tier. Both are out of scope for the LibreChat
proof-of-concept plan that found this.

**RESOLVED** (branch `worktree-agent-abb04d0a310af8164`, PR #2343, same day):
the diagnosis above was half right. The catalog-size mismatch is real for
LibreChat's plain chat picker, but the blocker underneath it was different:
the phi tier (`:8091`) is started without `--jinja`, so llama-server drops
the `tools` field outright — `prompt_tokens` stays at 9 with a tool attached,
so no tool call could ever have happened on that tier at any catalog size.
Neither of the "real fix" options was needed:

- Tool calling: `librechat.yaml`'s custom endpoint now lists `gpt-oss-20b`.
  `demo_llm_proxy/router.js` `classFromModel()` routes any `/gpt-oss/` model
  name to `:8096` — the only tier started with `--jinja` — which returns real
  `tool_calls`. No frozen LLM setting changed.
- Catalog scoping: a native LibreChat feature. The Agent Builder's MCP tool
  dialog selects individual tools (`agent.tools` stores
  `get_my_accounts_mcp_privilege`, and `ToolService.loadAgentTools` filters
  on it), so the model sees one schema instead of 242. An uncommitted
  client-side truncating proxy (`mcp-tools-proxy.js`) was tried first and
  discarded: LibreChat's `assertResourceBoundToServer` rejects any OAuth
  flow whose RFC 9728 `resource` origin differs from the configured server
  URL, so a proxy on a different origin can never pass discovery.

Proven live 2026-08-24 21:27 (Task 5 of the plan): an Agent with provider
Local LLM Proxy, model `gpt-oss-20b`, tools = `get_my_accounts` only, asked
"What are my account balances?" — LibreChat showed "Ran get_my_accounts in
privilege · 3.3s" and replied with a masked account number and balance from
the gateway.

### [x] 2026-08-24 — Agent Gateway HTTP `/mcp` advertises a protocol version it then rejects (`MCP-Protocol-Version` mismatch)

**Where:** `demo_mcp_gateway/src/server/GatewayServer.ts` HTTP `/mcp` path — the `initialize`
reply relays the upstream mcp-server's `protocolVersion` (`2026-07-28` observed live) while the
per-request `MCP-Protocol-Version` header check only accepts `2025-11-25`
(`unsupported_protocol_version`, `supported: ["2025-11-25"]`). Absence of the header is tolerated.

**What's wrong:** a spec-following Streamable-HTTP client (MCP SDK, LM Studio, LibreChat)
echoes the version negotiated in `initialize` on every later request, so `tools/list` /
`tools/call` 400 through this door. Found 2026-08-24 while live-verifying the recording
façade (PR #2356) with a client that echoes the negotiated version.

**Why not fixed now:** the façade only needed to reach the gateway; it drops the header for
the `agent-gateway` door (`demo_api_server/routes/mcpFacade.js`, `dropProtocolHeader` — a
`ponytail:` shortcut). Clients talking to `:3005/mcp` directly still hit the mismatch.

**Real fix:** the gateway should advertise in `initialize` the version it actually enforces
(or accept the version it advertised), then drop `dropProtocolHeader` from the façade.

**RESOLVED (branch `worktree-fix-gateway-protocol-version`):** took the "accept the version it
advertised" half — `demo_mcp_gateway/src/server/GatewayServer.ts`'s legacy per-request
`MCP-Protocol-Version` check now validates against `SUPPORTED_PROTOCOL_VERSIONS` (already
`['2025-11-25', '2026-07-28']`, the same list the Modern `_meta`-based check next to it already
used) instead of the single `MCP_PROTOCOL_VERSION` constant. `MCP_PROTOCOL_VERSION` is untouched
— it's still what the gateway sends on its own hop to the upstream mcp-server, a separate
concern. Removed `dropProtocolHeader` from `demo_api_server/routes/mcpFacade.js` now that the
gateway accepts the header it echoes back, so the `agent-gateway` door forwards
`MCP-Protocol-Version` like every other door.

### [x] 2026-08-24 — `k8s/create-secrets.sh` never falls back to the internal vault, so a vault-only secret silently never reaches the SE K8s Secret — RESOLVED 2026-08-25

**Resolved:** `docs/superpowers/plans/2026-08-25-vault-in-k8s.md` implements
exactly the "Real fix" below, plus a guard-rail: for any vault-managed key,
`create-secrets.sh` now uses the vault's value, and hard-fails the deploy if
`.env` has a *different* non-empty value for that key (drift), rather than
silently letting either source win. `.env` files keep their real values
(matching the vault) rather than being blanked — local Docker/native runs
are unaffected, since `configStore.js`'s own `.env` → vault → LMDB order
already prefers `.env` when present and it now always matches.

**Where:** `k8s/create-secrets.sh`'s `secret_from_envfile()` (~line 103-154),
called by `se-update-config.sh` / `run-pingaws.sh update config`.

**What's wrong:** the SE K8s live-canary (`ai-demo.ping-devops.com`) started
failing every scheduled run with `?error=callback_failed&detail=invalid_client`
right after PingOne sign-in. The BFF's masked diagnostic log
(`demo_api_server/routes/oauthUser.js:154-162`) showed `user_secret=MISSING`
for env `01d89b06`. `PINGONE_USER_CLIENT_SECRET` *is* present in the local
encrypted vault (`secrets.vault`, confirmed via `npm run vault:list` — names
only, value not decoded), so it resolves fine for anything running with
`VAULT_PASSWORD` set (local Docker, native `./run.sh`). But
`create-secrets.sh` only ever reads `demo_api_server/.env` (dotenvx-decrypted
if needed, see the script's own `encrypted:` handling at line 113 — that's
dotenvx's whole-file encryption, a *different* mechanism from
`configStore.js`'s per-value `encrypted:...` vault-shadow ciphertext added in
the 2026-08-21 incident). A secret that lives only in the internal vault (not
as a plain `.env` line) is invisible to this script and never makes it into
the `ai-demo-secrets` K8s Secret at all. The script's own comment at line
383-384 already documents the consequence: *"In-cluster the BFF has no vault
password and no LMDB entry"* — so there's no runtime fallback in the pod
either. Net effect: any secret migrated into the vault (the whole point of
the 08-21 hardening) silently stops reaching the SE cluster.

**Why it wasn't fixed now:** the immediate unblock was a one-off
`vault:get` + `kubectl create secret --dry-run=client -o yaml | kubectl apply`
patch of the single key (handed to the user to run — reading a decrypted
vault value and writing a live K8s Secret both correctly hit the agent
permission classifier's secret-handling guard). The real fix — teaching
`secret_from_envfile()` to `vault:get` any `ENV_FALLBACK_MAP` key it doesn't
find in `.env` before giving up on it — touches a deploy script every SE
session relies on and deserves review on its own, not a same-session
drive-by.

**Real fix:** in `create-secrets.sh`, after sourcing the (decrypted) `.env`
and before building the `--from-literal` args, for any key with no value try
`VAULT_PASSWORD=... node demo_api_server/scripts/vault.js get <KEY>` and use
that if `.env` came up empty — mirroring `configStore.js`'s own `.env` →
vault → LMDB resolution order so the K8s path matches local behavior instead
of silently diverging from it.

**Update 2026-08-24 (same day):** the triggering symptom for
`PINGONE_USER_CLIENT_SECRET` specifically is now moot — the User Login
PingOne app (`83572007-b2c7...`) was switched to PKCE-only
(`tokenEndpointAuthMethod: NONE`), so that key isn't needed anywhere anymore
(see `docs/ENV.md`). The underlying `create-secrets.sh` gap is still real for
any *other* vault-only secret (e.g. if `PINGONE_ADMIN_CLIENT_SECRET` is ever
vault-migrated without also flipping the Admin app to PKCE-only), so this
entry stays open.

### [x] 2026-08-24 — `get_my_accounts`'s output schema doesn't match the Banking API's actual response shape

**Where:** `oauth-mcp/src/tools/BankingToolRegistry.ts` (declared output
schema for `get_my_accounts`) vs `demo_api_server`'s `/api/accounts/my`
handler (actual response for a live user).

**What's wrong:** once the external-door auth chain actually worked end to
end (see `docs/superpowers/plans/2026-08-23-external-door-token-chain-bridge.md`,
session 4), a real `get_my_accounts` call for `demoUser` returned genuine
account data, but MCP Inspector rejected the tool result with `-32602
Invalid params`: `accounts/0` and `accounts/1` are missing the required
`accountNumber` property, and `swiftCode`/`iban`/`branchName`/`branchCode`/
`openedDate`/`notes` fail the schema's `string` type on all four accounts —
almost certainly `null` where the schema requires a string.

**Why it wasn't fixed now:** found as a side effect of finally closing a
much longer-running auth investigation (four separate bugs: a ms/s units bug
in `TokenResolver.ts`, a missing PingOne resource grant, a missing scope on
the `/authorize` request, and a missing `requestScopesForMultipleResourcesEnabled`
toggle — all fixed and live-verified). This is a distinct, unrelated bug in
tool response shape, first exercised the moment real data flowed through
for the first time — nobody had gotten this far in the external-door flow
before tonight to trip over it.

**Real fix:** not yet diagnosed. Fetch the live `/api/accounts/my` response
for `demoUser` directly (Banking API, bypassing MCP) and diff its shape
against the declared output schema in `BankingToolRegistry.ts` before
guessing whether the fix is loosening the schema (nullable fields) or
populating/omitting those fields correctly on the Banking API side.

**RESOLVED** (branch `worktree-external-door-well-known-suffix-routing`):
traced with a read-only exploration agent rather than guessing. Two
independent, compounding causes, both in `oauth-mcp` — not in
`demo_api_server` as originally suspected:

1. `accountNumber` was mapped with no fallback
   (`accountNumber: account.accountNumber`); when the upstream value was
   `undefined` (demoUser's checking/savings accounts, seeded via the
   minimal `seedAccountsForUser` path in `demo_api_server/data/store.js`,
   never set it), `JSON.stringify` dropped the key entirely — "missing
   required property," not a wrong-type value.
2. Every other optional field (`swiftCode`/`iban`/`branchName`/
   `branchCode`/`openedDate`/`notes`) was mapped with `|| null`, but
   `GET_MY_ACCOUNTS_OUTPUT` (`oauth-mcp/src/tools/outputSchemas.ts`) types
   them as plain `{ type: 'string' }` with no `null` in the union — a
   present-but-`null` value fails ajv's type check.

Fixed at the correct boundary — `oauth-mcp/src/tools/handlers/accountHandlers.ts`'s
`executeGetMyAccounts`, the code that owns the MCP output contract — rather
than touching `demo_api_server`'s seed data (broader blast radius: the UI
and other consumers read that data too, and may rely on `null` meaning
"not applicable"). Every optional/missing field, including `accountNumber`,
now falls back to `''` instead of `null`/omission, matching the file's own
existing convention (`formatAccountNickname`'s
`(account.accountNumber || '')`, a few lines above).

A second, related bug was found and fixed in the same pass: `account_type`
filtering (`?account_type=checking`) used a case-sensitive `===` against
real `accountType` values that are inconsistently cased/named across two
different seed-generation code paths (`'CHECKING'`/`'SAVINGS'` uppercase
from the banking seed profile; lowercase `'loan'`/`'credit_card'` from the
account-spec builder) — while the tool's own enum advertises lowercase
`'checking'`/`'savings'`/`'credit'`. Every filtered call silently returned
zero accounts regardless of whether the user actually had one of that type.
Fixed with a case-insensitive compare plus a `'credit'` → `'credit_card'`
mapping, following the same normalization pattern `pickAccountForNickname`
(same file) already used for exactly this class of mismatch.

Verified live end-to-end via MCP Inspector as `demoUser`: `get_my_accounts`
now returns a schema-valid result with all 4 real accounts (unfiltered),
and `account_type: "checking"` correctly returns the one matching account
instead of an empty array. New unit tests added in
`oauth-mcp/src/tools/handlers/__tests__/accountNickname.test.ts` covering
both fixes; full suite green (1079/1079) before deploy.

### [x] 2026-08-23 — `pingone_mgmt_client_id`/`_client_secret`/`_token_auth_method` are missing from `configStore.js`'s `FIELD_DEFS`

**Where:** `demo_api_server/services/configStore.js` — all three keys are
referenced in `SECRET_KEYS` (the first two) and the env-alias table (all
three), but none appear in `FIELD_DEFS`.

**What's wrong:** `setConfig()`'s unknown-key guard (`if (!(key in
FIELD_DEFS)) continue;`) silently drops any of these three keys if ever
written via `setConfig` — the exact same class of bug fixed for
`pingone_mgmt_private_key` in `docs/RUNTIME_AUDIT_FINDINGS.md` finding #32.

**Why it wasn't fixed now:** found while registering
`pingone_mgmt_private_key` for finding #32, but these three appear to only
ever be set via `.env` (`PINGONE_MGMT_CLIENT_ID`/`_SECRET`/`_TOKEN_AUTH_METHOD`
and their aliases) in the current codebase, not via any `setConfig({...})`
call site — `getEffective()` reads them straight through the env-alias
fallback regardless of `FIELD_DEFS` membership, so the gap is latent, not
currently triggered. Fixing three unrelated config keys wasn't part of
finding #32's scope.

**Real fix:** add `FIELD_DEFS` entries for all three (mirroring
`pingone_mgmt_private_key`'s `{ public: false, default: '' }` shape, adjusted
for which of them are secrets), so any future admin-UI or route code path
that calls `setConfig` with one of them doesn't silently no-op.

**RESOLVED 2026-08-26 (branch `worktree-techdebt-small-correctness`).** All three
registered next to `pingone_mgmt_private_key`, following the file's own
conventions rather than that one key's shape: `client_id` `{ public: true }`
(matching every other `*_CLIENT_ID`), `client_secret` `{ public: false }`
(it is in `SECRET_KEYS`), and `token_auth_method`
`{ public: true, default: 'basic' }` (matching the sibling
`PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD`).

The default was the one real decision here. `'post'` would have been wrong:
every consumer — `pingOneClientService.js:68`, `pingOneUserService.js:71`,
`pingoneTestRoutes.js:1072` — already reads
`getEffective('pingone_mgmt_token_auth_method') || 'basic'`, and `getEffective`
returns the `FIELD_DEFS` default when nothing else supplies a value. A `'post'`
default would therefore have silently flipped the Management API worker's client
authentication method on every deployment that doesn't set the env var. `'basic'`
reproduces today's behaviour exactly.

The entry's "latent, not currently triggered" read was re-confirmed: no
`setConfig` call site writes any of the three today, and the basic/post self-heal
in `pingOneTokenAuth.js` is in-memory only.

Evidence: `src/__tests__/configStore.mgmtWorkerKeysSave.test.js` (5 tests) —
`setConfig` round-trip per key, a `FIELD_DEFS` membership assertion, and a guard
pinning the `'basic'` default to the consumers' fallback. It clears the env
aliases first, since `getEffective` reads those ahead of the defaults and would
otherwise mask what the spec asserts. RED-proven: removing the three entries
fails 4 of 5. Full BFF suite green — 10,224 passed, 1 pre-existing environment
failure (`anthropic.lmstudio.live.test.js`, `getaddrinfo ENOTFOUND
api.ping.demo`; that host is absent from this machine's `/etc/hosts`).

### [x] 2026-08-23 — `useVertical()` reshapes the context into a new object on every call, defeating the Provider's own memoization

**Where:** `demo_api_ui/src/vertical/useVertical.js` — every non-null-context
return path (lines 29–41) builds `{ activeId: ctx.activeId, pageManifest:
ctx.pageManifest, ... }` fresh, on every invocation.

**What's wrong:** `VerticalProvider.jsx`'s context value is now memoized
(`docs/RUNTIME_AUDIT_FINDINGS.md` finding #20 — `useMemo(() => ({...state,
refetch: doFetch}), [state, doFetch])`), so `useContext(VerticalContext)`
correctly returns the same object across an unrelated ancestor re-render.
But almost nothing in the app reads that raw context — nearly every consumer
(TopNav, AdminSideNav, UserDashboard, etc.) goes through `useVertical()`,
which unconditionally derives a brand-new object every time it's called,
including `agentManifest`/`isAdminScope` computed inline. A consumer that
memoizes work off `useVertical()`'s return value (or is itself wrapped in
`React.memo`) gets no benefit from the Provider-level fix — it still sees a
new reference every render.

**Why it wasn't fixed now:** the finding that surfaced this (#20) was scoped
to the Provider's own `value={...}` literal. Memoizing `useVertical()`'s
return additionally requires either `useMemo`-wrapping its result (deps:
`ctx`, `location.pathname`'s admin-scope slice, `isAdminScope`) or restructuring
so `isAdminScope`/`agentManifest` aren't recomputed as a new object shape each
call — a wider change touching a hook nearly every screen calls, worth doing
deliberately rather than folding into an unrelated bug fix.

**Real fix:** wrap `useVertical()`'s return in `useMemo`, keyed on the
primitive/derived values that actually determine its shape (`ctx`,
`isAdminScope`), so a `React.memo`'d consumer or a `useEffect` deps array
keyed on `useVertical()`'s output stops re-firing on every unrelated render.

**RESOLVED 2026-08-26 (branch `worktree-use-vertical-memo`).** Done as scoped:
`useMemo` keyed on `[ctx, isAdminScope]`, which is the complete dependency set —
every field in the returned object is either read off `ctx` or derived from both.

Two details the entry did not call out:

- The **early `!ctx` return had to move inside the memo**, because a hook cannot
  be called conditionally. That branch is now a frozen module constant
  (`NO_PROVIDER`) rather than a fresh literal, so the no-provider path is stable
  too — it was the one path that would otherwise still churn a new object every
  render.
- `isAdminScope` is derived as a **boolean before** the memo rather than passing
  `location.pathname` as a dependency. Keyed on the raw pathname, the memo would
  invalidate on every navigation; keyed on the boolean it invalidates only when
  a route actually crosses the `/admin` boundary — which is the only thing about
  the path this hook cares about.

Evidence: `src/vertical/__tests__/useVertical.test.jsx` grew 4 -> 8. The four new
tests capture every value the hook returns and compare identity: same object
across an unchanged re-render, a NEW object when the context value really
changes, correct recompute when the route crosses into admin scope (so the memo
is not sticky enough to become a correctness bug), and a stable no-provider
fallback. RED-proven: replacing the memo with a plain IIFE fails 2 of 8.

Full UI gate green — 3467 unit tests passed (434 files), `npm run build` exit 0.
Run unscoped on purpose: this hook is called by nearly every screen.

### [x] 2026-08-23 — native ID-JAG: PingGateway's own D-05 still blocks the real tool call even when the OLB-audience pin should redirect it

Live E2E verification of PR #2268 (native ID-JAG gateway filter — mint → redeem
→ tool call) surfaced this while checking whether the redeemed, OLB-audienced
bearer actually reaches the Node "Demo Agent Gateway" for a real
`get_account_balance` call, as `mcpGatewayClient.js`'s OLB pin
([mcpGatewayClient.js:163-176](demo_api_server/services/mcpGatewayClient.js))
is supposed to force.

**What was observed:** with `ff_mcp_gateway_pinggateway` ON (this demo's
default routing), a real native-ID-JAG tool call still gets rejected by
**PingGateway's own, separate** anti-bypass rule
(`ping-gateway/scripts/groovy/p1az-decision.groovy`, same "D-05" naming
convention as the Node gateway's `GatewayTokenPolicy.ts` but an independent
implementation) — reply: `Gateway Policy Denied — get_account_balance` /
`bypass_attempt: token aud targets upstream mcpserver.ping.demo — cannot
bypass gateway (D-05)`. That means the call reached PingGateway, i.e. the pin
in `mcpGatewayClient.js` did not redirect `base` to the Node gateway for this
call — even though every value it depends on resolved correctly when checked
live: `MCP_PINGGATEWAY_URL === MCP_GATEWAY_HTTP_URL === http://ping-gateway:8080`
(PingGateway-mode precondition satisfied) and `PINGONE_RESOURCE_MCP_SERVER_URI
= mcpserver.ping.demo` (the OLB audience the pin checks the token's `aud`
against).

**Why not fixed now:** reproducing this specific path live is unreliable —
the SAME session, moments apart, more often hit a *different*, earlier
failure (see the next entry) before ever reaching this code, so the one
clean repro that surfaced this exact error was not re-instrumented before the
session ended. The debug logging added for this investigation
(`console.log('[idjag-debug] OLB pin check', ...)` at the guard) was never
captured against a run that actually reached it — every later attempt died
earlier in the flow.

**Real fix — investigate first, then decide:**
1. Add the `[idjag-debug] OLB pin check` logging (or equivalent) back at
   `mcpGatewayClient.js:163` and reproduce until a run reaches the actual
   `get_account_balance`/`get_my_accounts` tool call (not just discovery) —
   confirm live whether `audList.includes(olbAud)` is actually true at that
   point, i.e. whether the bearer handed to `callToolViaGateway` for THIS
   call really carries `aud: mcpserver.ping.demo` the way the discovery
   token demonstrably did (`iss: https://localhost:8080`, `kid:
   62b4c1eb0d4f5572`, `aud: mcpserver.ping.demo` — captured live this
   session).
2. If the aud doesn't match, find where the tool-call token diverges from
   the discovery token (different exchange path, different resource
   resolution, or a fallback to the RFC 8693 stand-in token instead of the
   native ID-JAG one for that specific tool).
3. If the aud DOES match and the pin still doesn't fire, the bug is in the
   `pgUrl && base === pgUrl` guard itself — verify `gatewayUrl` (the
   `mcpToolPipeline.js`-supplied first argument) is literally what's
   expected, not a value that predates trimming/normalization.

**INVESTIGATED 2026-08-26 (branch `worktree-idjag-pinggateway-allowlist`) — entry
stays OPEN: D-05 itself is still unproven, but it is no longer the blocker.**

The two things that made this unreproducible are gone: the empty-cookie mint
failure was PR #2281, and customer sign-in (broken 2026-08-24 → 2026-08-26, see
REGRESSION_PLAN §4) is fixed. A real signed `show my balance` turn as `demoUser`
on the banking vertical now runs end to end.

**It does not reach D-05 any more. It fails two legs earlier:**

```
POST /api/enterprise-idp/token 400
[demo-agent/tools] error: invalid_target
  resource https://api.ping.demo:3036/mcp is not an approved MCP server.
```

Native ID-JAG has two legs and each checks the requested resource against a
DIFFERENT list — leg 1 (mint, `routes/enterpriseIdp.js`) against
`ENTERPRISE_MCP_RESOURCE_URIS`, leg 2 (redeem, mcp-server's `IdJagGrantHandler`)
against `MCP_SERVER_RESOURCE_URI`. Under this demo's default routing
(`ff_mcp_gateway_pinggateway=true`) `resolveExpectedMcpResourceUri()` returns
`pingone_resource_pinggateway_uri` = `https://api.ping.demo:3036/mcp`, so both
legs are asked for that URI. It was listed on leg 2 and **missing on leg 1**, so
every mint 400'd and the tool call was never attempted.

`MCP_SERVER_RESOURCE_URI`'s own comment in `docker-compose.yml` asserted that
"the demo-api-server side already allow-lists the same URI via
`ENTERPRISE_MCP_RESOURCE_URIS`" — nothing checked that claim, and it was false.
Fixed on the compose default, with
`src/__tests__/docker-compose.enterpriseIdJagAllowlist.test.js` (4 tests) now
checking it: leg 1 ⊇ every mintable audience leg 2 serves. RED-proven — reverting
the one compose value fails 2 of 4.

**The pin's inputs were all fine, so step 3 of the plan above is NOT the bug.**
Re-verified live in the BFF container: `MCP_PINGGATEWAY_URL` ===
`MCP_GATEWAY_HTTP_URL` === `http://ping-gateway:8080`,
`PINGONE_RESOURCE_MCP_SERVER_URI` = `mcpserver.ping.demo`, and both `base` and
`pgUrl` are trailing-slash-normalised before comparison.

**Second blocker, newly found and NOT in the original entry:** the pin's
destination does not exist under default runtime. `mcpGatewayClient.js`'s OLB pin
redirects to `mcp_demo_gateway_url` (`http://mcp-gateway:3005`), but the
`mcp-gateway` service sits behind the **`demo-auth` compose profile** while
`run-docker.sh` defaults to core + rag — `docker ps` shows only
`ai-demo-ping-gateway`. So even once the mint succeeds, a correctly-pinned call
has nothing listening at the other end. Note the pin fails SILENTLY in the
adjacent case: `if (nodeUrl) base = nodeUrl;` no-ops when the URL is empty, which
is the same shape of quiet failure this entry has been chasing.

**What is still unknown:** whether D-05 fires once both blockers are cleared.
Answering it needs `--profile demo-auth` (or an equivalent) so the Node gateway
is actually up, then a re-run of the same signed turn. Until then the original
D-05 observation should be treated as recorded-but-unreproduced.

**ANSWERED 2026-08-26, second pass (branch `worktree-idjag-d05-findings`) — the
cause is NOT D-05, and not any of this entry's three hypotheses.**

With both blockers cleared (PR #2407's allow-list fix, and `deploy-live.sh`
bringing up `ai-demo-mcp-gateway`), a real signed turn as `demoUser` now gets all
the way to `get_account_balance`. The mint succeeds
(`POST /api/enterprise-idp/token 200`) and the turn fails here instead:

```
[MCP Proxy] Error calling get_account_balance: Wrong audience: the access token's
aud is [mcpserver.ping.demo] but the gateway requires "https://api.ping.demo:3036/mcp".
This is a configuration drift, not an expired token...
```

**No D-05. No `bypass_attempt`. And no HTTP request at all** — neither
`ai-demo-mcp-gateway` nor `ai-demo-ping-gateway` logged anything in the window.
The rejection is entirely BFF-side.

**The defect: `expectedAud` does not follow the OLB pin.**
`mcpGatewayClient.js`'s audience classifier (~L452) computes

```js
const expectedAud = require('./mcpToolAuthorizationService').resolveExpectedMcpResourceUri() || ...
```

which is the **per-mode** resolver — under `ff_mcp_gateway_pinggateway=true` it
returns `https://api.ping.demo:3036/mcp`. But by the time that runs, the OLB pin
(~L163) has already rewritten `base` to the NODE gateway. The request's
destination changed; the expected audience did not. So a correctly-pinned ID-JAG
bearer is failed against the audience of a gateway it is deliberately no longer
being sent to.

The pin is working. The Node gateway would accept the token — its live
`MCP_GW_RESOURCE_URI` is
`mcpgateway.ping.demo,https://api.ping.demo:3036/mcp,mcpgateway-a2a.ping.demo,mcpserver.ping.demo`,
which includes `mcpserver.ping.demo`. Nothing downstream ever gets the chance.

Note the classifier's own comment describes fixing the MIRROR of this bug ("use
the SAME per-mode resolver the token was minted with — otherwise on the IG path
the token's aud is compared against the Node-gateway aud"). That fix was correct
for the unpinned IG path and introduced this one for the pinned path. The
audience to compare against is a property of the **effective destination after
pinning**, not of the routing mode.

**Each of this entry's three hypotheses is now ruled out**, all re-verified live:
1. the aud DOES match — the token carries `mcpserver.ping.demo`, exactly as the
   discovery token did;
2. the tool-call token does NOT diverge from the discovery token;
3. the `pgUrl && base === pgUrl` guard is fine — `getMcpGatewayHttpUrl()` returns
   `MCP_PINGGATEWAY_URL` verbatim under the flag and both sides are
   trailing-slash-normalised before comparison.

**Not fixed here on purpose.** The repair is small (derive `expectedAud` from the
post-pin destination rather than the mode) but it sits on a protected auth path
and encodes a decision — once a bearer is pinned away from PingGateway, which
audience is authoritative — that belongs with whoever owns the native-ID-JAG
rollout. Whoever takes it should add the case to a test: a pinned ID-JAG bearer
must not be failed against PingGateway's audience.

**FIXED 2026-08-26 (branch `worktree-expected-aud-follows-pin`).** The decision
above resolved as: **the pin audience is authoritative.** A pin only fires when
the bearer's `aud` already contains the pin audience, so that value is correct
for the destination by construction — there was nothing to weigh.

`callToolViaGateway` now records `pinnedAud` at the moment a pin actually moves
`base`, and the audience classifier prefers it over
`resolveExpectedMcpResourceUri()`. Recorded ONLY inside
`if (nodeUrl) { base = nodeUrl; pinnedAud = ...; }` — when no Node URL is
configured the pin silently no-ops, the request really does go to PingGateway,
and PingGateway's audience is still the right thing to judge against. Both pins
(native ID-JAG and A2A) are covered; A2A had the identical latent bug.

Evidence: `src/__tests__/mcpGatewayClient.pinnedAudience.test.js` (5 tests) — a
pinned ID-JAG bearer reaches the Node gateway URL and is NOT
GATEWAY_AUDIENCE_MISMATCH; same for A2A; an UNPINNED bearer on the PingGateway
path still reports a genuine mismatch (no behaviour change there); and the
pin-could-not-move case keeps the mode audience. RED-proven: removing
`pinnedAud ||` fails 2 of 5. Neighbouring classifier specs green
(`mcpGatewayClient.reauth`, `attackSimulator.wrongAudFields`). Full BFF suite
10,251 passed, 2 worker-contention flakes that pass scoped and touch neither file.

**RESOLVED 2026-08-26 — and my own two earlier readings of this were wrong.**
Ticking it `[x]` after the `expectedAud` fix was premature (that unblocked the
REQUEST, not the feature), and the follow-up claim that D-05 and native ID-JAG
are "mutually exclusive by design" was also wrong. They are not. **The exemption
already existed in both implementations; it simply never fired.**

With the earlier blockers cleared, a live signed turn reached the exact symptom
this entry recorded on 2026-08-23:

```
bypass_attempt: token aud targets upstream mcpserver.ping.demo
— cannot bypass gateway (D-05)
```

**What D-05 is:** a per-hop invariant — a client obtains a GATEWAY-audienced
token, and only the gateway may exchange it for the next hop. So an upstream
audience must never appear in a token presented at the gateway. It stops a
leaked or forged OLB-audienced token being presented directly to skip the
gateway's own checks. Implemented independently three times: the Node gateway
(`GatewayTokenPolicy.ts`), the P1AZ policy (`demo_authz_server/routes/decision.js`)
and PingGateway's Groovy.

**Native ID-JAG is a legitimate exception and both live implementations know it.**
`GatewayTokenPolicy.ts:145` wraps the blacklist in `if (!isIdJagIssuedToken(...))`;
`decision.js:409` computes the same exemption. Both gate on the CRYPTOGRAPHICALLY
VERIFIED `iss` — a token merely claiming that issuer never gets that far, because
signature verification against oauth-mcp's JWKS happens first.

**The actual bug: the same hardcoded-scheme trap, in a third place.**

```js
// demo_authz_server/routes/decision.js:408
const idJagIssuer = process.env.OAUTH_MCP_ID_JAG_ISSUER
  || process.env.OAUTH_MCP_ISSUER_URI
  || 'https://localhost:8080';
```

`OAUTH_MCP_ID_JAG_ISSUER` was unset in `ai-demo-authz-server`, so it fell to that
hardcoded `https://` — which never equals the token's real `http://localhost:8080`
(mcp-server's `OAUTH_ISSUER`). Exemption skipped, D-05 denied. This is the same
one-character defect fixed for `mcp-gateway` earlier the same day, which is why
the audit trail showed `GatewayTokenPolicy: passed` but `P1AZDecision: blocked`.

**Why no test caught it:** every unit test sets `OAUTH_MCP_ID_JAG_ISSUER` to
`https://localhost:8080` explicitly and mints its fixture tokens with the same
value, so the exemption always fires under test. The production value was the one
combination never exercised.

Fixed by wiring `OAUTH_MCP_ID_JAG_ISSUER` on `authz-server` to
`${ENTERPRISE_MCP_AS_ISSUER}`, the same source the BFF and mcp-server use.
`docker-compose.idJagIssuerScheme.test.js` now requires BOTH runtime consumers to
declare it and all three sides to agree on the scheme — RED-proven by removing
either one. **No policy was weakened: D-05 is unchanged, and the exemption still
requires a verified issuer.**

**CONFIRMED LIVE 2026-08-26 — box ticked on evidence.** A signed
`get_account_balance` turn as `demoUser` (banking vertical, follow-up turn after the
account-picker disambiguation) now returns PERMIT in the gateway audit trail:

```
"authorize":{"decision":"PERMIT","engine":"mock","policySource":"p1az-mock"}
"filterChain":[
  {"filter":"TokenIntrospection","result":"skipped"},
  {"filter":"GatewayTokenPolicy","result":"passed"},
  {"filter":"P1AZDecision","result":"forwarded","decision":"PERMIT"},
  {"filter":"mTLS","result":"skipped"},
  {"filter":"BackendExchange","result":"skipped"}
]
"backend":{"target":"olb","audience":"mcpserver.ping.demo","exchanged":false}
```

`TokenIss: http://localhost:8080`, `TokenKidKnown: true`, `TokenAudActual:
mcpserver.ping.demo` — the ID-JAG bearer is recognised, its key resolves, and the
D-05 exemption fires. `BackendExchange: skipped` / `exchanged: false` is correct
here, not a gap: ID-JAG is a per-server grant, so the token already carries the OLB
audience and there is nothing to exchange. Run validated with
`npm run stack:generation -- --check` ("stack unchanged — the run stands").

**Five distinct blockers stood between this entry and that result**, each hiding
the next: the mint allow-list (#2407), the Node gateway not running under the
default compose profile, `expectedAud` not following the OLB pin (#2410), the
gateway's ID-JAG issuer scheme (#2412), and the authz server's (#2413). None was
the one the entry named.

**Still open, from the same trail:** `IntentTokenValid: false` /
`IntentTokenError: no_signing_key` — the gateway cannot verify the intent token the
BFF mints. It blocks nothing (P1AZ permits regardless) but it is a third
missing-key wiring gap of the same family, and it means the intent-token evidence
is not actually being checked on this path.

**Also worth noting:** this whole path is arguably incoherent as configured —
the ID-JAG is minted FOR the PingGateway resource, but oauth-mcp always redeems
it audienced to its OWN resource (`resolveOwnAudience`), PingGateway rejects that
audience (D-05), and the pin exists to route around PingGateway to a gateway that
is not running. That is a design question, not a bug fix, and it belongs to
whoever owns the native-ID-JAG rollout.

### [x] 2026-08-23 — a real HTTP request into `/api/agent/run` can arrive with `req.headers.cookie` empty while `req.session.user` is populated, breaking the native-ID-JAG mint for that turn

Same live-verification session as the entry above. `services/idJagService.js`'s
`mintIdJag(req, ...)` forwards `req.headers.cookie` on its loopback POST to
`/api/enterprise-idp/token` so that endpoint's own session middleware can
authenticate the call
([idJagService.js:77](demo_api_server/services/idJagService.js)). That
forwarding assumes the OUTER Express request always carries a real Cookie
header whenever `req.session.user` is populated — which held for the FIRST
message in a turn ("show my balance": `outerHasUser: true, outerCookieLen:
1924`, mint succeeded 200) but did not hold for follow-up messages
(disambiguation answer "checking": `outerHasUser: true, outerCookieLen: 0`),
where the loopback call 401'd with `invalid_grant — No signed-in user for
this exchange` because `/api/enterprise-idp/token`'s OWN session (loaded
fresh from the empty cookie) had no user at all. Confirmed reproducible
across 3 separate live attempts, all on the follow-up turn specifically, never
on the first turn.

**What it is NOT:** not a native-ID-JAG-specific bug — `mintIdJag` is only
one caller of this cookie-forwarding pattern, so any other code that forwards
`req.headers.cookie` on a loopback call for a follow-up agent turn is exposed
to the same gap. Not a browser-side cookie omission either — checked via
Playwright's network inspector and confirmed that tool strips the `cookie`
header from its capture even on requests independently known to have
succeeded with a valid session (e.g. `/api/auth/session`), so that angle is a
dead end; the evidence has to come from server-side `req.headers.cookie`
logging, not the browser's network tab.

**Leads not yet chased down:** the browser network log for this session
showed **duplicate near-simultaneous dispatches** of `POST
/api/demo-agent/tools` (two, sometimes three, within milliseconds of each
other) around the same turn — consistent with a frontend double-fire (same
class as the StrictMode+useRef reauth-loop bug documented elsewhere in this
repo's history). A plausible mechanism: two concurrent requests against the
same session race inside whatever code constructs/threads `req` down into
`executeHeuristicBanking` → `executeBffTool` →
`resolveMcpAccessTokenWithEvents` → `mintIdJag`
(`services/bankingAgentLangGraphService.js:109` down to
`services/idJagService.js:64`), and one of the two loses its `req` reference
(or picks up a stale/reused one) somewhere in that chain — but this was not
confirmed; `req` is threaded as a plain parameter the whole way down with no
obvious shared-mutable-state culprit spotted on read-through.

**Real fix — investigate first, then decide:**
1. Reproduce with logging at the very top of the Express route handler for
   the follow-up-turn request (before any async work) to confirm whether
   the INCOMING request itself already has an empty cookie header (a
   frontend/fetch bug) or whether it arrives fine and gets lost/overwritten
   internally before reaching `mintIdJag` (a backend bug).
2. If frontend: check the SPA's fetch call for the disambiguation-answer
   message for a missing `credentials: 'include'` or an unintended
   `fetch`/axios instance without cookie jar wiring, and check for the
   duplicate-dispatch pattern (`POST /api/demo-agent/tools` firing 2-3× per
   turn) as a possible root cause or contributing factor — a duplicate
   request racing the real one could plausibly explain an intermittently
   empty header if the SPA's dedup/abort logic cancels or corrupts one of
   the two.
3. If backend: instrument every hop from the route handler to
   `mintIdJag` to find exactly where `req.headers.cookie` stops being the
   original value.

**RESOLVED — was already fixed when this entry was written; verified 2026-08-26.**
PR #2281 (`0e407dbf`, merged 2026-08-23 14:53, ~4 hours after this entry was
recorded at 11:07) fixed it and nobody came back to tick the box. The answer to
the entry's own question 1 turned out to be "neither frontend nor backend loss":
the follow-up turn does not arrive as a browser request at all. It comes through
the `/internal/agent-tool` callback (`routes/agentTool.js:99`), which resolves
the session server-side via `sessionStore.get()` and builds a synthetic `fakeReq`
carrying `sessionID` but **no `headers` object whatsoever** — hence
`outerHasUser: true, outerCookieLen: 0`, and hence "follow-up turns only, never
the first". The entry's premise ("a real HTTP request into `/api/agent/run`")
was the wrong frame; the duplicate-dispatch lead was a red herring.

`idJagService.cookieHeader(req)` now re-signs a `connect.sid` from `req.sessionID`
using express-session's own format when no real header exists. Verified today:
the re-sign uses `process.env.SESSION_SECRET || 'dev-session-secret-change-in-production'`,
character-for-character the expression `server.js:470` configures the session
middleware with, so the loopback cookie validates against the same secret.
`src/__tests__/idJagService.cookieForward.test.js` — 3 passed (real header
forwarded unchanged / re-signed from sessionID / empty when neither exists), with
the unsign algorithm re-implemented independently of the code under test.

The entry's "what it is NOT" worry — that any other loopback cookie-forwarder is
exposed to the same gap — does not materialise: `idJagService.js` is the only
one. `authStateCookie.js` and `pkceStateCookie.js` read inbound browser cookies
(different question) and `server.js:958` only counts cookie names.
### [x] 2026-08-23 — native ID-JAG gateway filter (PR #2268) was merged and unit-verified but never actually deployed — `demo_mcp_gateway`'s Docker image was stale

While doing the live E2E verification that produced the two entries above,
every early attempt hit either an unrelated session-forwarding failure or a
JWKS `kid` mismatch that traced back to `services/tokenValidationService.js`
— but `docker logs ai-demo-mcp-gateway` showed **zero requests** across every
attempt, which didn't add up once the BFF-side flow was confirmed correct.
`docker exec ai-demo-mcp-gateway grep -c isIdJagIssuedToken
/repo/demo_mcp_gateway/dist/tokenValidator.js` returned `0` — the running
container's compiled output had none of PR #2268's code, despite
`./run-docker.sh restart mcp-gateway` having been run right after merge.

**Root cause:** per this repo's own `CLAUDE.md`, only `ui` and
`demo-api-server` bind-mount their source into the running containers — every
other service, including `demo_mcp_gateway`, runs from its **built Docker
image**. `run-docker.sh restart <svc>` is `docker compose up -d
--force-recreate --no-deps` — it recreates the *container* from whatever
image already exists, with no `--build`. There is a separate `./run-docker.sh
build <svc>` (`up -d --build`) that actually rebuilds. For a bind-mounted
service the distinction is invisible (edits are live immediately); for
`demo_mcp_gateway` it means "restart" silently no-ops on any source change —
this is easy to get wrong because the restart command succeeds, logs clean
startup output, and gives no signal that it's running stale code.

**Fix applied:** `./run-docker.sh build mcp-gateway`, confirmed via the same
`grep -c` check that the rebuilt image now contains the PR's code (7 matches).
With the real code running, live testing progressed measurably further —
past the discovery step into an actual `get_account_balance` tool-call
attempt (see the two open entries above for what's still blocking full
success beyond that point).

**Broader implication, not chased down:** any prior session that "restarted"
`demo_mcp_gateway`, `oauth-mcp`, `authz-server`, `ping-gateway`, or any other
non-bind-mounted service to deploy a source change may have hit this same
silent no-op. Worth a `npm run serve:worktree`-style guard or a CLAUDE.md
callout distinguishing "restart" (container only) from "build" (image +
container) more prominently — `demo_mcp_gateway/CLAUDE.md` and the root
`CLAUDE.md`'s worktree section do not currently mention this distinction at
all.

### [ ] 2026-08-19 — nothing protects a live UI drive from another session recreating the stack under it

**Where:** `scripts/deploy-live.sh` (the `.git/deploy-live.lock` it already
takes), `run-docker.sh restart <svc>`, and any session invoking either. The two
services that matter are `ai-demo-ui` and `demo-api-server` — the only ones that
bind-mount source, and therefore the only ones a deploy recreates.

**What's wrong:** `deploy-live.sh` locks so two *deploys* cannot race each
other. Nothing tells it a live UI drive is in progress, and nothing tells the
driver the ground moved. Six Claude sessions were live on this machine on
2026-08-19 (`/tmp/cc-socks/`), all sharing one Docker stack whose compose
project is the main checkout. Any of them recreates `ui` / `demo-api-server` at
will, mid-request, under whoever is driving the browser or presenting.

The failure is nasty because it is *invisible from the driver's side*. The
browser gets a 404 or a 502; the BFF has no trace of the request because it was
not running when the request arrived; and `docker logs` afterwards reads the
NEW container, so the evidence is not merely missing, it is misleading. It
looks exactly like an application bug in whatever code path happened to be
executing.

Measured, in a controlled reproduction (`UI_FINDINGS.md` #3): container pinned
at 10:13:19Z, prompt sent 10:16:39Z, `ai-demo-api-server` recreated 10:16:41Z —
two seconds into the run — and `ai-demo-ui` recreated again at 10:17:54Z.
Neither restart came from `deploy-live.sh`; its own ledger recorded only two,
both `ui`, at 10:00 and 10:07.

**Cost so far:** roughly an hour on `UI_FINDINGS.md` #3, chasing a
consent-challenge 404 through session lookup, TTL, single-use consumption,
hitl-service and an unrelated authz-server fix — every one of them a
server-side hypothesis for a fault that was not server-side. Two agent sessions
were involved in that hunt. The same trap costs a presenter a demo rather than
an hour.

**Why it wasn't fixed now:** the fix is a coordination protocol between
sessions, not a bug fix, and it wants a decision about which side yields. A
drive-in-progress lease that blocks deploys can deadlock the stack if a session
dies holding it (exactly the failure mode the `[x] 2026-08-18` deploy-live
entry describes for its own lock). A deploy that merely *warns* does not stop
anything. Both need the fallback rules thought through before anything is
written, and neither belonged inside the UI fixes that surfaced it.

**Real fix — smallest useful first:**

1. **Make the ground checkable, cheaply.** `deploy-live.sh` already records
   `.git/deploy-live.restarts`. Have it also stamp `.git/stack-generation`
   (a counter or the compose container ids), and expose
   `npm run stack:generation`. A driver captures it before a run and compares
   after — one command instead of remembering the `docker inspect` incantation.
   This is the 80% fix and it changes no locking behaviour.
2. **Announce, do not block.** Have `deploy-live.sh` broadcast to the other
   sessions' sockets before it restarts anything ("recreating ui in 5s"), so a
   session mid-drive can say so. Advisory only; no deadlock risk.
3. **Only if 1 and 2 prove insufficient:** an actual drive lease with a hard
   TTL (minutes, auto-expiring, never indefinite) that `deploy-live.sh` honours,
   plus a documented override for the case where the lease-holder is gone.

Do NOT start at 3. The existing deploy lock already demonstrates how a
stale lock on this stack turns into a worse outage than the race it prevents.

**Interim discipline, until any of the above exists:** pin
`docker inspect ai-demo-ui ai-demo-api-server --format '{{.State.StartedAt}}'`
before and after any live drive, and treat the run as void — not as a finding —
if either moved. That one check is the difference between a bug report and an
hour in the routing layer.

**STEP 1 SHIPPED 2026-08-26 (branch `worktree-stack-generation-check`) — entry
stays OPEN for steps 2 and 3.** `scripts/stack-generation.sh` +
`npm run stack:generation`, exactly the "make the ground checkable, cheaply"
option, changing no locking behaviour:

```
gen="$(npm run -s stack:generation)"
...drive the UI, run the probe, present...
npm run -s stack:generation -- --check "$gen"   # exit 1, and says why, if it moved
```

**One deliberate departure from this entry's own step 1:** the generation is
DERIVED from `docker inspect` rather than stamped by `deploy-live.sh`. That
matters here more than it looks. In the incident measured above, the restarts
did NOT come from `deploy-live.sh` — its ledger recorded only two, both `ui`, at
10:00 and 10:07, while the damaging recreates happened at 10:16:41 and 10:17:54.
A counter written by `deploy-live.sh` would have missed the exact case this entry
exists to catch. Reading the containers catches a recreate from any source:
`deploy-live.sh`, `run-docker.sh restart`, `serve-worktree.sh`, or a bare
`docker compose up`.

The generation is container id AND `StartedAt` per container, because a recreate
changes the id while a plain restart does not — an id-only check would silently
pass the second case. Both invalidate a run, so both are in the string.

`--check` failing prints which container moved, from what to what, and says in
words that the run is void rather than a finding — the sentence whose absence
cost an hour in the routing layer.

Evidence: `scripts/stack-generation.test.sh` — 12 checks against a stub `docker`
on PATH, covering recreate, same-id restart, a container disappearing, and
misuse exiting 2 rather than a false pass. Verified against the live stack too.
CLAUDE.md's deploy-cadence section now carries the before/after recipe, replacing
the `docker inspect` incantation in this entry's "interim discipline" note.

Steps 2 (broadcast to other sessions' sockets) and 3 (a drive lease with a TTL)
are untouched, and step 3 should stay untouched until 1 and 2 prove insufficient
— this entry's own warning about stale locks on this stack still stands.
### [x] 2026-08-19 — 71 write actions across all 12 verticals reply "Here are your <verb noun>."

Found while fixing UC8's "Here are your extend rental." (`REGRESSION_PLAN.md` §4,
2026-08-19). The reply-heading builder in
`demo_api_server/services/demoAgentLangGraphService.js` hand-cases 10 write actions
(`book_appointment`, `checkout`, `submit_expense`, …) and falls through everything else to
`Here are your ${noun}.`, where `noun` is the action name with a read prefix stripped. Any
write action without its own case therefore produces an ungrammatical confirmation:

```
pay_bill        -> "Here are your pay bill."          (healthcare)
withdraw        -> "Here are your withdraw."          (banking, investment)
transfer        -> "Here are your transfer."          (banking)
redeem_miles    -> "Here are your redeem miles."      (airlines)
cancel_order    -> "Here are your cancel order."      (retail, sporting-goods)
buy_security    -> "Here are your buy security."      (investment)
```

71 actions in total, spanning every vertical. Only `extend_rental` was fixed, because that
is the one the UC8 finding named.

**Why not fixed now:** the obvious generic rule — "no read verb ⇒ write confirmation" —
misclassifies genuine reads that simply lack a read verb (`afford_check`, `biggest_purchase`,
`browse_gear`, `loyalty_balance`), so it would trade 71 broken confirmations for a different
set of broken headings. Getting it right needs an authoritative action→write map, and a
copy change touching every vertical's agent replies is not something to slip into a
bug-fix PR unreviewed.

**Real fix:** derive write-ness from the tool the action resolves to —
`scope-topology.json` already marks write tools via `requiredScopes: ['write']`, which is the
same signal `p1az-decision.groovy`'s tier check uses (`isWriteToolLocal`). Thread that into
the reply builder and give writes a single neutral confirmation template, keeping the 10
hand-written cases for the ones that read better. Scan that produced these numbers:
`scratchpad/scan-writes.py` in the 2026-08-19 Demo Steps run.

**RESOLVED 2026-08-26 (branch `worktree-write-action-reply-copy`).** Fixed as the
entry scoped it — write-ness DERIVED, not guessed. The derivation already existed:
`services/agentRestrictionsService.js`'s `getRequiredTier(toolName)` reads
`scope-topology.json`'s `tools[].requiredScopes` and maps them through each scope's
`riskLevel`, returning `'read'|'write'`. `buildVerticalReply()` now takes one branch
ahead of the noun fallback — `getRequiredTier(action) === 'write'` →
`` `Your ${action.replace(/_/g,' ')} request is complete.` `` — so no new loader, no
action→write table to drift, and unknown tools tier as `'read'` (fail-open: the branch
can only soften an existing heading, never invent a confirmation).

Note the derivation is slightly BROADER than `p1az-decision.groovy`'s
`isWriteToolLocal`, which does an exact `requiredScopes.contains('write')` and would
miss `redeem_miles` (`['airlines:read','airlines:write']`). Going through `riskLevel`
catches it. Same SoT, better predicate — the Groovy is worth aligning if it ever
matters for tier enforcement, but that is a policy change, not copy, so it was left
alone.

Evidence: 100 tools tier as write across the whole topology; **0** still produce
`Here are your ...`. All 10 hand-written cases are untouched (they precede the branch).
`src/__tests__/buildVerticalReply.writeActions.test.js` grew from 12 to 19 tests —
6 named samples, a whole-catalog sweep (every write tool, with a >50 vacuity guard),
and a guard pinning the entry's four named traps (`afford_check`, `biggest_purchase`,
`browse_gear`, `loyalty_balance`) as reads. RED-proven: disabling the branch fails 7
of the 19. Neighbouring agent specs green
(`agentInvokeRoute.mcpAuthorizeEvaluations`, `agentInvokeRoute.intentToken`,
`agentReasoningClientLoopGuard`, `demoAgentRecursion.regression` — 12 passed).

**Left behind on purpose:** those same four read actions still degrade to
`Here are your afford check.` when `render` falls back to `'text'` (a failed MCP
round-trip). They are reads, so they are outside this entry, and on the normal path
their own `render` case answers first (`loyalty_balance` → `Your balance: N`). Fixing
them is a read-side noun problem, not a write-ness one.

### [x] 2026-08-19 — `serve:worktree` reports a state file, not the actual container mounts, and leaves the BFF without its gitignored config

Two separate gaps, both hit while live-verifying the 2026-08-19 Demo Steps fixes.

1. **The status line lied.** `npm run serve:worktree here` reported
   `UI worktree /…/demo-steps-verdict-fixes/demo_api_ui` while
   `docker inspect ai-demo-ui` still showed `/Users/cmuir/Development/AI-DEMO2/demo_api_ui/src -> /app/src`.
   The UI change under test was therefore not being served, and the verification run
   reported the *old* behaviour as a failed fix. A second `serve:worktree here` fixed the
   mount. Verify with `docker inspect`, never with the script's own status output.
2. **A worktree carries no gitignored files, and the BFF needs them.** After pointing the
   stack at the worktree, every OAuth login failed with
   `invalid_client — Request denied: Invalid client credentials`: the BFF reads
   `demo_api_server/.env` from its own bind-mounted directory, and the worktree has none.
   `data/persistent/*.db` is missing for the same reason. CLAUDE.md says
   `--project-directory` stays on the main checkout so all 37 `env_file` entries resolve —
   true for Compose, but it does not cover the per-service `.env` the BFF loads itself
   (see `project-privilege-env-stale-vs-runtime-drift`).

**Why not fixed now:** out of scope for the fix that found it, and the workaround is two
`cp` commands.

**Real fix:** have `serve-worktree.sh` (a) read the live mount from `docker inspect` for its
status output and re-apply if it disagrees, and (b) symlink or copy the main checkout's
`demo_api_server/.env` and `data/persistent/*.db` into the target worktree when switching to
it — the same way `node_modules` already has to be linked in.

**RESOLVED 2026-08-26 (branch `worktree-serve-worktree-honesty`).** Both halves done, but
the diagnosis in (a) was wrong in a way worth recording, and (b) was half unnecessary.

**(a) was never a state file.** `print_status` has read `docker inspect` since the script was
introduced in PR #2009 (2026-08-18), a day BEFORE this entry. The real cause is visible in
the entry's own evidence: it reported the UI mount as the worktree while `docker inspect`
showed `.../demo_api_ui/src -> /app/src` on main. `mount_source` only ever asked about
`/app` — and **the UI serves from `/app/src`, not `/app`**. So the status line was reading
live docker state and was still wrong, because it was reading the wrong mount. The overlay
comment ("Both targets must move together") was added for the same reason; nothing checked
that it held.

Now `print_status` reads `/app/src` too and prints an explicit `UI  MOUNT SPLIT` line when
the two disagree, and a new `verify_mounts` re-reads all three mounts after the recreate.
A recreate that does not take is retried once — the cure the entry observed ("a second
`serve:worktree here` fixed the mount") — and then **fails with exit 1** rather than
printing "now serving:" over a stack that is serving something else.

**(b) is one file, not two.** `demo_api_server/.env` is now copied from the main checkout on
every non-main switch. `data/persistent/*.db` needs nothing: `docker inspect` confirms
`/app/data/persistent` is the named volume `ai-demo_ai-demo-bff-data`, which mounts over
whatever the source directory holds, so the databases never moved in the first place.
Copied rather than symlinked — the mount hands the container the worktree directory, so a
symlink inside it would resolve to a host path that does not exist in the container, and the
BFF would see no `.env` at all. That is the same trap in a new costume, so it is spelled out
at the call site.

Evidence: `scripts/serve-worktree.test.sh` — 12 checks, run against a stub `docker` on
PATH, so it never touches the shared stack. RED-proven in three separate passes: removing
the `.env` copy fails 2, removing the mount verification fails 3, and removing just the
`/app/src` half of `verify_mounts` fails exactly the test that reproduces the original
symptom (`/app` moves, `/app/src` lags).

**Not done:** the script still does not take the `.git/deploy-live.lock` that
`deploy-live.sh` uses, so two sessions can still fight over the stack — that is the separate
2026-08-19 "nothing protects a live UI drive" entry, still open.

### [x] 2026-08-18 — the accepted-gateway-identity list is maintained by hand in two places, and has now drifted twice

**RESOLVED 2026-08-18, same session — and the entry undercounted.** It was
**three** hand-written copies, not two: the third is the step-0 literal in
`snapshots/authorizeSnapshotCloudDelta.test.js` (~60). The generator's comment
also promised a guard file, `snapshotAudienceParity.test.js`, that has never
existed — the real guard was step 0 of that cloud-delta test all along.

*What the fix was:* the entry's first option — a marker in the SoT. Gateway
resources carry `"role": "mcp-gateway"` in `scope-topology.json`, and
`gen-authorize-snapshot.js` plus `demo_authz_server/routes/import-snapshot.js`
both derive from it. `scope-topology.schema.json` declares `role` as a CLOSED
enum (the resource schema is `additionalProperties: false`, so it had to be
declared anyway) — a typo'd value now fails schema validation instead of
silently dropping a gateway from every derived consumer.

*What the entry got wrong:* it proposed deriving in **all** consumers and
deleting **both** literals. Doing that to the cloud-delta pin would have been a
mistake, and that file's own comment already said so: once every consumer reads
one field, they all agree with each other even when the field is wrong, so a
resource that quietly loses its marker is missing *everywhere* and nothing
notices. The pin stays literal and now cross-checks the marker too. Verified by
mutation — removing the API-Key resource's `role` fails it with a message naming
the cause.

*Relocated, not dropped:* `deriveSot` used to abort when a gateway resource was
deleted, because it looked resources up by name. A marker cannot detect a
deletion (the deletion removes the marker). That guarantee now lives in the pin;
`deriveSot` still aborts on a marked resource with no `uri` and on an SoT with
nothing marked — the empty-OR case that would deny all MCP traffic on import.
Both directions still fail loudly, which was the property worth keeping.

*Cost:* the generated snapshot changed by exactly one line — same four
audiences, order now following the SoT's declaration order, condition version
re-derived from content by `ver()` as designed. An OR of equality comparisons is
order-independent.

Verified: `npm run topology:verify` PASSED 10/10 · `demo_authz_server` 260/260 ·
`npm run test:snapshots` 44/44. Original entry follows.

**Where:** `snapshots/gen-authorize-snapshot.js` `GATEWAY_RESOURCE_NAMES` (~118)
and `demo_authz_server/routes/import-snapshot.js` `GATEWAY_RESOURCE_NAMES` (~154).

**What's wrong:** the same set — "which `scope-topology.json` resources are
accepted MCP gateway audiences" — is written out longhand in both files, and
the generator and the validator must agree or the validator rejects the
generator's own output. They have now disagreed twice:

1. the A2A gateway was added to the SoT and the generator but not the validator
   (recorded in the validator's own comment: "made this check compare the SoT's
   2 known audiences against the tracked snapshot's real 3");
2. the API-Key PingGateway identity, same omission, same false
   `mcp_audience_mismatch` 409 — fixed 2026-08-18 in the commit that added this
   entry, found only because the `demo_authz_server` suite was being run as the
   INDETERMINATE rework's verification gate.

Nothing derives one list from the other, and nothing derives either from the
SoT, so the third occurrence is already possible. Neither file is wrong in
isolation — that is what makes this a design gap rather than a bug.

**Why not fixed now:** the honest fix needs a way to mark a resource as a
gateway identity in `scope-topology.json`, which is an SoT schema change and a
provisioning question (`bootstrapPingOne.js` and `pingoneProvisionService.js`
both carry their own name lists), not something to fold into a test-baseline
commit. The one-line list repair plus the CI filter that would have caught it
were in scope; the schema change was not.

**Real fix:** give each gateway resource a marker in `scope-topology.json`
(e.g. `role: 'mcp-gateway'`), derive `GATEWAY_RESOURCE_NAMES` from that marker
in both files, and delete both literals — at which point adding a gateway to
the SoT is the only edit required and the two copies cannot disagree. Cheaper
interim if the schema change is unwanted: a single test that asserts the two
literals are equal, which is small and catches occurrence three.

**Related:** the CI gap that let occurrence 2 land green is fixed separately —
`decision-services` in `.github/workflows/ci.yml` did not list
`scope-topology.json`, so a SoT-only PR never ran the suite whose existing test
already caught this.

### [ ] 2026-08-18 — customer-dashboard banking column is the one dashboard pane without a resize handle

**Where:** `demo_api_ui/src/components/UserDashboard.css` `.ud-body--dashboard-split3`
(first grid track, `minmax(240px, 260px)`), rendered by `UserDashboard.js` /
`UserDashboardPing2026.js` when agent placement is "middle",
`ff_show_agent_in_middle` is ON, and Focus mode is OFF.

**What's wrong:** the agent and token-rail columns drag-resize; the banking
column does not. The resizable-columns rollout (PRs #2086/#2091, phase 3
branch) deliberately skipped it twice: the 3-column-with-banking state never
rendered during verification (live stack was first in `--no-banking`, then in
Focus mode, where the banking column is not mounted at all), and the grid's
own comment ("Token rail | Banking | Agent") does not match DOM child order
(agent, banking, token rail) — so the track-to-column mapping could not be
confirmed without mutating live demo state (feature flags / focus mode) that
the presenter owns. jsdom cannot verify grid geometry either.

**Real fix:** in a session where mutating demo state is acceptable (or on a
throwaway stack), turn Focus mode off with placement "middle" + banking ON,
confirm which grid track the banking column actually occupies, then add a
third handle following the file's own drag pattern (`onAgentWidthResizeMouseDown`
shape + `--ud-banking-col-width` var) in BOTH dashboard variants, and
re-baseline the UserDashboard sha256 canary in `UserDashboardPing2026.test.js`.

### [x] 2026-08-18 — deploy-live reports success while a core service stays down, and keeps skipping it forever

**RESOLVED 2026-08-18 (branch `worktree-deploy-live-truthful`).** Two halves, the
first of which had already landed by the time this was paid off: `filter_running`
now records exists-but-not-running services (`BROKEN_FILE`), withholds the stamp
and exits 1, and a post-deploy poll re-reads docker instead of trusting exit
codes. This branch adds the entry's remaining "minimum" fix: `assert_stack_health()`
scans the WHOLE `com.docker.compose.project=ai-demo` project on every terminal
path (no-op, bootstrap, no-affected, done) — so a container in `created` with no
changes in range, the self-sustaining case, now fails the run by name instead of
hiding forever. `created`/`restarting`/`(unhealthy)` fail; `exited` warns (an
operator's deliberate stop mid-debug is legitimate); absent-entirely stays fine
(profiled service). The stamp is still written on the done path — the touched
services did take the range; the non-zero exit is the escalation, not the stamp.
Verified: synthetic-row test (both branches) + live dry-run. Original entry
follows.

**Where:** `scripts/deploy-live.sh` — `filter_running()` (~line 205) and the
`running_containers` list it is built from (line 197).

**What's wrong:** the script only restarts services whose container is already
running:

```sh
running_containers="$(docker ps --format '{{.Names}}' ...)"     # excludes `created`
...
else
  note "$svc changed but its container is not running — skipped ..."
```

`note()` appends to `NOTES`. It does not set a failure flag, so the run prints
`[deploy-live] done — live stack serves <sha>` and **exits 0**.

The failure is self-sustaining, which is what makes it worse than a one-off miss:
a container that is not running is skipped, being skipped means it is never
started, and so it is not running for the next deploy either. Every subsequent
run repeats the note and exits 0. Nothing escalates.

**Observed 2026-08-18:** after a deploy of `a86e96f24fc1` that exited 0 and
printed its success line, `ai-demo-ping-gateway` sat in state `created` — never
started, no logs, exit code 0, container created inside that deploy's window.
`ping-gateway` has **no compose profile**; it is a core service selected at
runtime by `ff_mcp_gateway_pinggateway`, which `MCP_GATEWAY_RUNTIME_FLAGS`
requires ON for **any** MCP tool chip. So the stack was serving without its IG
gateway while every signal said the deploy succeeded. Recovered with
`./run-docker.sh restart ping-gateway`.

Caught only because the containers were enumerated by hand afterwards
(`docker ps -a --filter label=com.docker.compose.project=ai-demo` and grep out
the healthy ones). Nothing in the deploy path would have surfaced it.

**Not claimed:** that `deploy-live.sh` *created* the stuck container. Compose
recreates during a run and something in that sequence left it un-started; the
cause is unproven. The defect recorded here is the reporting and the permanent
skip, both of which are in this script and are true regardless of what stopped
the container.

**Why not fixed now:** deciding what a non-running service should DO is a
judgement call this entry should not make silently. Starting it is not obviously
right — some services are deliberately down (profiled, `k8-build`, an operator
mid-debug), and `deploy-live` restarting them would be its own surprise.

**Real fix:** separate "deliberately absent" from "should be up and isn't".
Minimum: after the restarts, assert that every container in the compose project
is `running` (and `healthy` where a healthcheck exists), and exit non-zero
naming the ones that are not — the same shape as the `PIPESTATUS`/`-o pipefail`
discipline already required of scripts under `scripts/`. Better: have
`filter_running` distinguish a service that is *absent by design* from one in
`created`/`exited`, and escalate the second from a note to a failure.

**Related:** the `| tail` masking entry below — same class. A command's exit
status describing something other than the thing you care about, with the real
state visible only if you look for it deliberately.

### [x] 2026-08-18 — `ff_a2a_delegation` should not exist as a switch at all

**RESOLVED 2026-08-18 (branch `worktree-remove-ff-a2a`) — the entry's own 6-step
plan, executed in one PR.** (1) The five gates are unconditional and `isA2aEnabled`
is deleted; `a2aProtocolServer`'s 404-when-off middleware is gone (grep found no
consumer of its `a2a_disabled` shape — the admin PATCH also silently skips unknown
flag ids, so stale clients are harmless). (2) Registry entry + both
`FF_A2A_DELEGATION` env-alias rows removed, and the existing server.js startup
reconciliation was repurposed to delete ANY persisted `ff_a2a_delegation` value
(not just `'false'`) — the persisted-orphan trap the entry warned about. (3) UC2 +
UC2.6 maturity `flag:ff_a2a_delegation` → `works` ('works' is the only coherent
value once the flag id no longer exists). (4) The 30 step-verification fixtures
regenerated via their own test suites — one wrinkle: making UC2/UC2.6 maturity
`works` pulled them into the works-chip parse gate, and UC2.6's chip is
intercepted by the (now always-on) A2A overlay mismatch heuristic, so
`stepVerificationExpectations` got an overlay-phrase exclusion mirroring the
existing `/specialist/` one. (5) Both arming mirrors stripped; the parity test now
pins the flag's ABSENCE. (6) UI copy (8 files), admin card, ~12 test files and 4
live specs swept; the never-produced `a2a_delegation_disabled` chat copy removed.
Verified: 11 touched server suites + all 18 step-verification suites green; UI
unit 383 files/3261 tests green; UI build exit 0; full server suite run.
Live UC2/UC2.5/UC2.6/UC37 chip verification on the running stack remains the
post-merge manual check. Original entry follows.

**Where:** `demo_api_server/services/configStore.js` (registry),
`services/a2aDelegationService.js` (`isA2aEnabled`), and its five runtime gates.

**What's wrong:** A2A delegation is not an optional behaviour. The tools flagged
`a2aDelegated` in `scope-topology.json` are reachable **only** through a two-hop
chain — Authorize's `DenyA2aDelegationRequired` denies `ActChainDepth < 2` for
exactly those tools. With the flag off, those tools cannot succeed by any path;
the demo does not degrade, it breaks, and it breaks as an Authorize DENY that
looks nothing like a missing flag. There is no demo that the OFF state tells.

Half-fixed today (PR pending as of this entry): the registry default moved
`'false'` → `'true'`, and the tile now arms the flag from the served
`a2aDelegated` field rather than a hand-kept list of use-case ids. That closes
the accident. It does not remove the ability to turn a required subsystem off.

**Why not fixed now:** removing a flag is not a one-line deletion, and the parts
that would break are not all obvious. Measured, excluding tests and docs:

| Surface | Count | What removal means |
|---|---|---|
| `isA2aEnabled()` call sites | 5 | `routes/agentTool.js`, `services/a2aProtocolServer.js:102`, `services/demoAgentLangGraphService.js` (×2), `services/a2aDelegationService.js:265`. Each becomes unconditional — but `a2aProtocolServer` currently returns a specific 403 (`A2A protocol endpoints require ff_a2a_delegation`) that some caller may depend on |
| configStore registry | 1 | delete the entry. **A persisted `'false'` in a live LMDB outlives the registry change** — needs a migration or an explicit cleanup step, or the environment stays off with no switch left to turn it back on |
| admin listing | 1 | `routes/featureFlags.js:309` — the flag's card, description and any UI that renders it |
| catalog `maturity: 'flag:ff_a2a_delegation'` | 2 | UC2 and UC2.6 change maturity. What they become (`works`?) is a product call, and it changes how they render and whether they are armed |
| arming mirrors | 2 | `services/demoStepPrerequisites.js` + `demo_api_ui/src/utils/requiredDemoFlags.js` — the A2A branch goes away entirely, including the `a2aDelegated` check added today |
| step-verification fixtures | 30 | `data/step-verification/<vertical>/UC2{,.5,.6}.chip.unit-prereq.json`, 10 verticals × 3 — each records the flag as a prerequisite; they are generated, so regenerate rather than hand-edit |
| UI copy referencing the flag by name | 8 files | `AIAgent.js`, `DelegationPage.js`, `DelegationChainValuePage.jsx`, `demoScript.js`, `DemoTourContext.js`, `demoUseCaseSteps.js`, `education/A2ADelegationPanel.js`, plus the tour hint |
| tests asserting the gate | ~12 files | including `demoStepPrerequisites.test.js`, `requiredDemoFlags.parity.test.js` (a parity test across the two mirrors), and three `*.real.spec.js` live specs that arm it |

The live E2E specs are the sharp edge: they arm the flag before running, so they
fail on an unknown flag id rather than on the behaviour under test.

**Real fix:** one PR, in this order — (1) make the five gates unconditional and
delete `isA2aEnabled`; (2) drop the registry entry **with** a startup cleanup that
removes a persisted value, so no environment is left off; (3) retire the two
`maturity: flag:` markers; (4) regenerate the 30 fixtures; (5) strip the arming
branches and their parity test; (6) sweep UI copy and live specs. Verify by
running the three A2A use cases (UC2, UC2.5, UC2.6) plus UC37 on the real stack
with no flag anywhere, and by confirming the group-policy decision board's
delegated rows reach PERMIT — that path has never been exercised with A2A on
(see the decision-board entry above).

**Do not** delete the registry entry alone. `getEffective` falls back to the
default only when nothing is persisted; an environment that already stored
`'false'` keeps it, and with the switch gone there is no way to unset it.

### [x] 2026-08-18 — Bug-hunt round 2: customer-dashboard UI + backend data plane (10 findings)

**ALL 10 FINDINGS RESOLVED — bookkeeping tick 2026-08-18 (branch
`worktree-techdebt-bookkeeping`).** Every child entry below is independently
`[x]` and carries its own FIXED/RESOLVED block (PRs #2022, #2028, #2031,
#2036; the #2037 DashboardQuickNav mount was tried, glanced at live, and
deliberately reverted to its accepted end state). Nothing was outstanding —
this heading was just never ticked. No code change in this commit.

A second audit scoped to the signed-in customer dashboard and the customer
data-plane routes/services surfaced 10 fresh defects not already in this file.
None were fixed in the same pass — they are correctness/consistency gaps found
while auditing, logged for a deliberate round. Backend first, then UI.

### [x] 2026-08-18 — `saveMessage` reads the sequence from the wrong key segment, so same-millisecond writes collide and drop messages

**FIXED 2026-08-18 (PR #2036, merged + deployed).** The seq is now read from the
final key segment (`parts[parts.length - 1]`) instead of the out-of-range `[4]` —
minimal, and robust even if `userId`/`vertical` ever contain a `:`. Key format and
chronological ordering unchanged. Regression test
`tests/services/conversationStoreConcurrentWrites.test.js` freezes `Date.now` to
force same-ms writes (a real-clock loop can't reproduce it — each `putSync` fsyncs
~6ms apart, which is the nondeterminism that hid the bug); verified pre-fix the
`[4]` code loses 7 of 9 messages in a burst. Noted follow-up: the intra-ms seq is
not zero-padded, so an 11+-message single-ms burst would sort lexicographically —
unreachable given the fsync spacing, left per minimum-code. Original entry follows.

**Where:** `demo_api_server/services/lmdb/conversationStore.lmdb.js` — `saveMessage`
(the seq-dedup read of `key.split(':')[4]`).

**What's wrong:** the LMDB key is `${userId}:${vertical}:${15digitTs}:${seq}`, so the
sequence is segment index **`[3]`**, but `saveMessage` reads `key.split(':')[4]`
(one past the end). Because the timestamp is `Date.now()`, several messages written
in the same millisecond share the `${ts}` portion, and the mis-indexed seq read
fails to disambiguate them, so same-millisecond writes collide and overwrite each
other. The count of distinct persisted messages then depends on machine speed —
this is exactly what made the round-2 prune test read 500 locally but 469 on the
faster CI runner, and it is a genuine data-loss-under-load bug in its own right, not
just a test artefact.

**Why not fixed now:** found while making the round-2 summary-scan test deterministic
(the test was fixed with a mocked clock; the underlying write-path bug was left
untouched as out of scope for that PR). It is a write-path change in a §1-adjacent
store and deserves its own fix + a concurrency test.

**Real fix:** read the seq from segment `[3]` (or key by a monotonic counter rather
than wall-clock ms), and add a test that writes N messages in a tight loop without a
mocked clock and asserts all N persist.

### [x] 2026-08-18 — Conversation summaries share the message key-prefix, so history replays a summary as the newest turn

**FIXED 2026-08-18 (PR #2022, merged + deployed).** All four message scans now
apply an `_isMessage()` value-shape guard (real messages have string `.role` +
`.content`; summaries don't), and `getHistory` collects `limit` *real* messages
rather than capping at the DB level — so a `_summary:` entry can no longer surface
as the newest turn or evict real ones, and prune no longer mis-orders summaries.
Regression test `tests/services/conversationStoreSummaryScan.test.js` (made
deterministic with a mocked clock). Original entry follows.

**Where:** `demo_api_server/services/lmdb/conversationStore.lmdb.js` — `getHistory`
(~180-190), `getThreadSize` (~225-232), `_pruneThreadIfNeeded` (~144-160),
`isSummarizationNeeded` (~324-329); summary written at ~278.

**What's wrong:** messages are keyed `${userId}:${vertical}:${15digitTs}:${seq}`,
summaries `${userId}:${vertical}:_summary:${id}`. Every thread scan ranges over
`[prefix, prefix+￿]`, and `_` (0x5F) sorts AFTER the digits (0x30-0x39), so a
`_summary:` key falls inside the range and sorts last. `getHistory` scans in
reverse, so once any summary exists it is returned as the most-recent "message"
and replayed into the LLM as a fake turn (a summary object has `.summary`, no
`.role`/`.content`). The same in-range inclusion inflates `getThreadSize` and the
returned `threadSize`, skews `isSummarizationNeeded`'s turn/token math, and —
because a summary object has no `.timestamp` (only `createdAt`), so
`value.timestamp||0` is 0 — makes prune delete summaries FIRST when a thread
exceeds 500. Repro: `POST /api/conversations/:u/:v/summarize?range=0-5` then
`GET .../history` returns the summary object at the tail as the latest turn.

**Why not fixed now:** found while auditing; touches the LMDB key scheme and the
range bounds of four methods at once — a scoped correctness fix with its own test
surface, not a drive-by.

**Real fix:** give summaries a key space the message scans cannot reach — a
separate sub-prefix scanned only by the summary reader, or an end bound that stops
before `_` — and give a summary object a `timestamp` so prune orders it correctly.

### [x] 2026-08-18 — `createTransaction` overwrites any caller-supplied `createdAt`/`status`, collapsing seeded transaction history

**FIXED 2026-08-18 (PR #2022, merged + deployed).** Now
`createdAt: transactionData.createdAt ?? new Date()` and
`status: transactionData.status ?? 'completed'`, with `id` always generated — a
caller-supplied value is preserved, defaults still apply when absent. Regression
test `tests/createTransactionPreservesCallerFields.test.js`. Original entry follows.

**Where:** `demo_api_server/data/store.js:391` —
`const transaction = { id, ...transactionData, createdAt: new Date(), status: 'completed' };`

**What's wrong:** the trailing `createdAt`/`status` clobber whatever the spread
carried. `provisionDemoAccounts` (`routes/accounts.js:134-147`, via
`POST /api/accounts/reset-demo`) authors 11 sample transactions with deliberate
2024-02/2024-03 dates; all are discarded and every row stamped with the current
time (and they carry no `date` field), so reset-demo history collapses to one
identical timestamp instead of a historical spread. The same clobber makes
`restoreTransactionsFromSnapshot` (`routes/transactions.js:44`) and
`verticalAccountSnapshots.restoreVertical` (`services/verticalAccountSnapshots.js:125-127`)
lose every restored transaction's original `createdAt`/`status` on cold-start or
vertical switch-back.

**Why not fixed now:** cosmetic-looking but it silently corrupts demo data; the
fix must decide per-caller whether a supplied `createdAt`/`status` should win, so
it is a small contract decision, not a one-liner.

**Real fix:** only default `createdAt`/`status` when the caller did not supply them
(`createdAt: transactionData.createdAt ?? new Date()`, same for `status`).

### [x] 2026-08-18 — GET conversation history `limit` is unsanitised, so the 100-message cap is silently defeated

**FIXED 2026-08-18 (PR #2022, merged + deployed).** `limit` is coerced to a finite
number (fallback to the default) then clamped to `[1,100]` before `getHistory`, so
`?limit=abc` (NaN) and `?limit=-1` can no longer defeat the cap. Regression test
`tests/routes/conversationsHistoryLimitClamp.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/conversations.js:56,62`.

**What's wrong:** `const limit = parseInt(req.query.limit || DEFAULT_HISTORY_LIMIT, 10)`
then `getHistory(userId, vertical, Math.min(limit, 100))`. A non-numeric
`?limit=abc` yields `NaN`, and `Math.min(NaN, 100)` is `NaN`, passed straight to
`db.getRange({ limit: NaN })` — the 100-message cap no longer applies and the full
thread (up to the 500 ceiling) is returned and replayed. Negative values
(`?limit=-1`) also pass unclamped. Repro: `GET /api/conversations/me/banking/history?limit=x`
dumps the entire thread.

**Why not fixed now:** found while auditing; trivial but wants a test for the
NaN/negative cases alongside the fix.

**Real fix:** coerce and clamp — `Math.min(Math.max(1, Number.isFinite(n) ? n : DEFAULT), 100)`
before calling `getHistory`.

### [x] 2026-08-18 — `GET /api/accounts/my` serves hardcoded banking identifiers for every vertical

**FIXED 2026-08-18 (PR #2022, merged + deployed).** SWIFT/IBAN/branch/masked-account
defaults are emitted only for the banking vertical; other verticals surface those
fields only when the account genuinely carries them. Banking output byte-identical.
Regression test `tests/routes/accountsMyBankingFields.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/accounts.js:232-234`.

**What's wrong:** `swiftCode: account.swiftCode || 'CHASUS33'`,
`branchName: account.branchName || 'Super Banking Main Branch'`, and the
`iban`/masked-`accountNumber` fallbacks apply unconditionally. Non-banking seed
accounts (healthcare, retail, workforce) have no `swiftCode`/`branchName`, so a
healthcare or retail account card is served with SWIFT `CHASUS33` and branch
"Super Banking Main Branch." Repro: switch a session to healthcare, load accounts —
the card carries banking-only identifiers.

**Why not fixed now:** found while auditing; the fix needs a per-vertical decision
about which of these fields are even meaningful outside banking.

**Real fix:** only emit banking-shaped fields when the vertical is banking (or when
the account actually carries them), rather than defaulting them in for all.

### [x] 2026-08-18 — `investment` portfolio/balance ignore the `:accountId` path param and 200 with the default portfolio

**FIXED 2026-08-18 (PR #2022, merged + deployed).** `/portfolio` and `/balance` now
validate ownership — an `ownsAccount` check accepts `profile.portfolioId` or any
`data.portfolios[].id`, and a genuinely foreign/unknown id returns 404. The
caller's real/default account is unchanged. Regression test
`tests/routes/investmentAccountOwnership.test.js`. (The first fix keyed only on
`profile.portfolioId` and 404'd the caller's own sub-portfolio ids — caught by CI
against the pre-existing `investment.route.test.js`, then corrected.) Original
entry follows.

**Where:** `demo_api_server/routes/investment.js:16-29,54-66`.

**What's wrong:** `/accounts/:accountId/portfolio` and `/accounts/:accountId/balance`
call `store.get(req.user.id)` and return the user's single portfolio while echoing
`accountId: req.params.accountId` back in the body. Nothing checks the requested
account exists or belongs to the caller; any `accountId` yields a 200 labelled with
that id but populated from the one portfolio. Benign only because the seed gives one
portfolio per user — it mislabels the response and would return the wrong record the
moment a second account exists.

**Why not fixed now:** no visible symptom with today's single-portfolio seed; found
while auditing input validation.

**Real fix:** look the account up by `:accountId`, scoped to the caller, and 404 when
it does not exist or is not theirs.

### [x] 2026-08-18 — Customer dashboard fires the agent-resume event on the Email-OTP path even with no agent involved

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `handleVerifyOtp` now guards the
resume on `if (agentTriggeredStepUp)`, matching the TOTP/push/CIBA/FIDO2 siblings —
a manual OTP verify no longer toasts "resuming agent request…" nor dispatches
`cibaStepUpApproved`. Fixed in both `UserDashboard.js` and `UserDashboardPing2026.js`.
Regression covered by `UserDashboardPing2026.stepUpLifecycle.test.js`. Original
entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js:1044-1048` (`handleVerifyOtp`);
mirrored in `UserDashboardPing2026.js`.

**What's wrong:** `handleVerifyOtp` unconditionally runs `setAgentTriggeredStepUp(false)`,
toasts "Identity verified — resuming agent request…", and dispatches
`cibaStepUpApproved` — with no `if (agentTriggeredStepUp)` guard, unlike the TOTP
(~980), push-poll (~1107) and CIBA-poll (~1176) success paths which all guard on
the flag. Repro: signed-in customer starts a manual transfer ≥ $250, hits the 428
step-up, picks "Verify via Email", enters a valid OTP → sees "resuming agent
request…" with no agent involved, and `cibaStepUpApproved` broadcasts to
`AIAgent.js:2287`, which re-fires `pendingStepUpActionRef.current` if any stale
pending agent action exists.

**Why not fixed now:** REGRESSION_PLAN §1 step-up/consent surface; found while
auditing, needs the same guarded pattern its siblings use plus a test.

**Real fix:** guard the resume broadcast on `agentTriggeredStepUp`, matching the
TOTP/push/CIBA success paths.

### [x] 2026-08-18 — Agent CIBA auto-initiate timers survive Dismiss and unmount, firing a back-channel auth after the user cancelled

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `cancelAutoInitiate` (which
clears the t1/t2/t3 timers) is now called from `dismissStepUp`, the toast `onClose`,
and the `agentStepUpRequested` effect cleanup — not only the Cancel button — so a
real CIBA back-channel auth can no longer fire after Dismiss or navigation mid-
countdown. Fixed in both dashboard files. Regression test asserts unmount clears
with a positive control (fires=1 mounted vs 0 unmounted). Original entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js:1231-1238`
(`autoInitiateTimerRef` t1/t2/t3), cleared only by `cancelAutoInitiate` (~1149,
wired solely to the Cancel button); mirrored in `UserDashboardPing2026.js:1346-1348`.

**What's wrong:** neither `dismissStepUp` (~1132-1138), the toast `onClose`/
`onToastClosed` (~1268), nor the effect cleanup (~1257, which only removes the
listener) clears the timers. Repro: agent requests a CIBA step-up → 3s countdown
→ user clicks Dismiss (or navigates off `/dashboard`) within those 3s. `stepUpRequired`
goes false and the toast closes, but `t3` still fires ~3s later, calling
`handleCibaStepUp()` → a real CIBA back-channel auth is POSTed and the 5s poll
starts with no visible UI, after the user explicitly dismissed. On unmount it also
`setAgentCountdown`/`setCibaStatus` after teardown.

**Why not fixed now:** §1 step-up surface; found while auditing, needs the timers
cleared from every teardown path plus a test.

**Real fix:** clear `autoInitiateTimerRef` in `dismissStepUp`, the toast close
handler, and the effect cleanup — not just in the Cancel button handler.

### [x] 2026-08-18 — `agentTriggeredStepUp` is never reset on step-up FAILURE paths, leaking stale state into the next manual step-up

**FIXED 2026-08-18 (PR #2031, merged + deployed).** `agentTriggeredStepUp` is now
reset on the three terminal failure/expiry paths (push timeout/failed, TOTP
`challenge_expired`, OTP `challenge_expired`) in both dashboard files. The
CIBA-poll error path was deliberately left untouched — it shows a Retry that must
resume the same agent attempt, so resetting there would break the legitimate agent
CIBA retry; only genuinely terminal paths reset. Note: `pendingStepUpActionRef`
does not exist in either file, so only the flag is reset (the round-2 entry's
mention of a paired ref was a guess). Original entry follows.

**Where:** `demo_api_ui/src/components/UserDashboard.js` — push
`PUSH_CONFIRMATION_TIMED_OUT`/`FAILED` (~1111-1119), TOTP `challenge_expired`
(~995-1002), OTP `challenge_expired` (~1060-1066).

**What's wrong:** all three failure/expiry paths leave `agentTriggeredStepUp === true`.
Repro: an agent-triggered step-up times out or expires; later the user starts a
manual transfer step-up. Because the stale flag is still true, the success path
renders "resuming agent request…" and (push/CIBA/TOTP) dispatches `cibaStepUpApproved`
for an action the user performed by hand — stale state leaking across attempts.
Compounds the two findings above.

**Why not fixed now:** §1 step-up surface; found while auditing, part of the same
flag-lifecycle cleanup as the two above.

**Real fix:** reset `agentTriggeredStepUp` (and any paired pending-action ref) on
every step-up failure/expiry/cancel path, not only on success.

### [x] 2026-08-18 — `DashboardQuickNav` stack-height count is off by one for customers and overrides the correct CSS default

**FIXED 2026-08-18 (PR #2028, merged + deployed) — but the premise was partly
wrong.** The JS override (`count = 6 + …`, hardcoded `* 44`) turned out to be
**inert**: its only consumer is the `.App--has-quick-nav` rule (`App.css:140-142`),
and that class (plus `.App--has-nav-dash`) is **never applied to any DOM element**
(grep-confirmed). So the off-by-one wrote a variable nothing read. The fix removed
the dead `useEffect` entirely, making the already-correct, breakpoint-aware CSS
default `calc(7 * var(--stack-fab-height))` the single source of truth; a test locks
the non-admin count at 7.

**FOLLOW-UP RESOLVED 2026-08-18 (investigation + PR #2037, merged + deployed).** The
"overlap" was moot: `DashboardQuickNav` was **never mounted** (imported only by its
own tests), so no rail rendered and no overlap could occur — the described "overlaps
the 7th button" geometry was impossible in the running app. Per the requester's
decision the rail was then WIRED UP (#2037): mounted for signed-in non-admins on the
gated routes, with `App--has-quick-nav` applied on exactly that condition so the
pre-designed `App.css` geometry engages. `App--has-nav-dash` was deliberately not
added — it gates a different, unmounted single-FAB nav concept, not this rail.
Geometry verified live on the deployed CSS: with the class applied,
`--stack-fab-top-demo` resolves to `calc(156px + 7×44px)` = 464px, i.e. the demo FAB
is pushed flush below the 156–464px rail — no overlap. The pixel-level signed-in
visual could not be automated (customer sign-in on this host is passkey-based, not
headless-drivable) — a human glance on `/dashboard` as a customer is the only
remaining confirmation. Original entry follows.

**REVERSED 2026-08-18.** The human glance happened once #2037 was first served
(the `ui` container recreate for #2038 was the first deploy to render the rail):
it overlays the left of the dashboard and the user asked for it to be removed.
PR #2037 was reverted — `DashboardQuickNav` is back to existing-but-unmounted, which
is the accepted end state, not debt. Do not re-mount without an explicit request.

**Where:** `demo_api_ui/src/components/DashboardQuickNav.js:21-26`; interacts with
`App.css:138,140-142,668`.

**What's wrong:** `count = 6 + (isAdmin ? 2 : 0)`, but a non-admin renders 7 buttons
(Home, Dashboard, Agent, Settings, Learning Log, API, Logs). The effect writes
`--quick-nav-stack-height = 6 * 44 = 264px` onto `.App`, overriding the correct CSS
default `calc(7 * var(--stack-fab-height))` (App.css:138). So `--stack-fab-top-demo`
(derived at App.css:140-142) is 44px too high and the demo FAB stack overlaps the
last quick-nav button. It also hardcodes `44` while the CSS var drops to `42px` at a
breakpoint (App.css:668), so at that width the override is wrong on both count and
unit.

**Why not fixed now:** cosmetic overlap; found while auditing. The real fix is to
stop recomputing in JS a value CSS already knows.

**Real fix:** count the buttons actually rendered (or let the CSS default stand and
remove the JS override), and read the fab height from the CSS var rather than the
hardcoded `44`.

### [x] 2026-08-18 — Run-story bullets keyed by a 48-char text prefix collide and drop a row

**FIXED 2026-08-18 (PR #2028, merged + deployed).** `key={b.slice(0, 48)}` changed to
`key={i}` (the index the map callback already provides), so two bullets sharing a
48-char prefix no longer collide. Regression test drives two colliding bullets
through the real component. Original entry follows.

**Where:** `demo_api_ui/src/components/TokenChainTraceRail.jsx:527` —
`<li key={b.slice(0, 48)}>`.

**What's wrong:** two run-story bullets that share their first 48 characters produce
the same React key, so one is dropped from render (React de-dupes siblings by key).
Long bullets with a common prefix (e.g. two "Exchanged token for backend …" lines
differing only in a trailing id) are exactly this shape.

**Why not fixed now:** low-impact rendering glitch; found while auditing.

**Real fix:** key by index (or a stable bullet id) rather than a text-prefix slice.

**Honourable mentions — BOTH RESOLVED 2026-08-18 (branch
`worktree-leftovers-sweep`):** the `_transferLocks` delete is now conditional —
release cleans up its own entry iff no waiter chained behind it (the
unconditional finally-delete severed the queue; pinned by
`tests/services/storeTransferLock.test.js`, incl. serialization across an await
in the critical section). And `applyDemoTransaction` + its three `isDemoMode`
call branches are DELETED from both dashboard files (the branch was unreachable
— every caller behind `if (!user) return` while isDemoMode is only true signed
out — and hid an unguarded money-creation shape); UserDashboard sha256 canary
re-baselined with the rationale. Original text follows.

`demo_api_server/data/store.js` `applyTransfer`
deletes the per-account `_transferLocks` entry unconditionally in `finally`, breaking
mutual exclusion — but the critical section is fully synchronous so the event loop
already serialises it and no overdraft results (redundant lock, buggy delete, no
fund-correctness failure). And `demo_api_ui/.../UserDashboard.js:1494-1522`
(`applyDemoTransaction`) is effectively dead (all callers early-return on `if (!user)`
while `isDemoMode` is only true when `!user`), but it hides an unguarded
money-creation path (`to` credited full, `from` clamps at `Math.max(0, …)`) worth
removing before it is ever wired live.

### [x] 2026-08-18 — `deploy-live.sh` warns about its unreliable fallback only when the checkout did not move

**RESOLVED 2026-08-18 (branch `worktree-deploy-live-truthful`).** The
`STAMP_BOOTSTRAP && OLD != NEW` case now emits its own WARNING before deploying:
the range is deployed as a best effort (that part was always right), but the run
says out loud that it cannot tell whether the containers were current before it,
and how to pass an explicit range if anything looks stale — the same honesty the
`OLD == NEW` branch already had. The deeper "derive the running SHA from the
containers themselves" idea was not taken: the stamp bootstrap is one-time per
clone and the warning closes the silent half at one branch's cost. Original
entry follows.

**Where:** `scripts/deploy-live.sh:42-58` — the `STAMP_BOOTSTRAP` path, and the
`OLD = NEW` branch at `:62-77` that owns the warning.

**What's wrong:** the script already solves the hard half of this. `.git/deploy-live.last`
records **what the containers last had deployed** rather than what the checkout
was a moment ago, precisely because the 15-minute launchd sync usually advances
the checkout first (#2000, and its comment says so). When that stamp is missing —
first run on a clone, or it names a commit the repo no longer has after a
force-push — it falls back to `OLD=PRE`, the checkout's pre-sync HEAD.

The fallback is documented and reasonable. What is not is that the script says so
in only one of the two ways it can be wrong:

- `OLD == NEW` (checkout did not move): prints "no deploy stamp yet and the
  checkout did not move this run … Cannot tell whether the containers are
  current", and tells you to pass an explicit range. Correct and loud.
- `OLD != NEW` (the sync moved the checkout this run): **silently** deploys
  `PRE..NEW` — and `PRE` is exactly the signal the script's own comment calls
  unreliable. Anything the containers were behind by before this run is skipped,
  and the final line still reads `live stack serves <NEW>`.

**Measured 2026-08-18.** Containers were running `df0bd3904`. The stamp did not
exist yet — the code that writes it shipped in `73b4977ff` (#2000), i.e. inside
the very range that had not been deployed. The no-arg dry run offered:

```
[deploy-live] 53449195ef1a -> 73b4977ff040 (6 files)
[deploy-live] DRY RUN — would run: ./run-docker.sh restart ping-gateway
```

The true range from what was actually running was 12 files and also required
`ui`:

```
[deploy-live] df0bd3904b46 -> 73b4977ff040 (12 files)
[deploy-live] DRY RUN — would run: ./run-docker.sh restart ui ping-gateway
```

So the UI would have been left stale while the run reported success — the exact
failure this script was written to end, reached through its one unguarded path.

**Why not fixed now:** found while deploying, not while working on the script,
and the window is genuinely narrow — the bootstrap is one-time per clone, and the
run that hits it also writes the stamp, so every later no-arg run is correct.
That narrowness is also why it will be met by whoever is least equipped to
recognise it: someone on a fresh clone, deploying for the first time.

**Real fix:** make the two branches say the same thing. In the bootstrap path,
emit the existing "cannot tell whether the containers are current — pass an
explicit range" warning whenever the stamp was missing, not only when
`OLD == NEW`; deploying `PRE..NEW` as a best effort is fine, claiming it is
complete is not. Better still, derive the running SHA from the containers
themselves (the checkout is bind-mounted, so a marker file or a
`docker exec … git rev-parse` equivalent would make the stamp advisory rather
than load-bearing) — then no bootstrap case exists at all.

Related: `project-deploy-live-explicit-range-skips-sync` in memory records the
opposite hazard (explicit range does NOT sync). Both are the same shape: the
script cannot observe the thing it reports on, so it reports on what it can see.

### [x] 2026-08-18 — Multi-service bug-hunt audit (findings deferred here; scripts/agents/UI fixes went out as separate PRs)

**ALL 15 DEFERRED FINDINGS RESOLVED — bookkeeping tick 2026-08-18 (branch
`worktree-techdebt-bookkeeping`).** Every child entry below is independently
`[x]` with its own FIXED/RESOLVED block, including both flagged SECURITY items
(the capitalised-`type` authz bypass, PR #2007; the MCP rate-limit forgery, PR
#2008) and the pkce cookie crash (verified during its own fix to have a SECOND
throw path beyond the one originally described, both closed). Nothing was
outstanding — this heading was just never ticked. No code change in this
commit.

A five-service audit (BFF, UI, MCP gateway/proxy/resource, Python/Node agents,
scripts/gateway) surfaced ~27 fresh defects not already in this file. The
low-risk ones — script/infra, Python agent retry/timeout, and standalone UI —
were fixed in grouped PRs. The entries below are the ones left deferred because
they sit on REGRESSION_PLAN §1 protected surfaces (transactions, OAuth callback,
token caches, MCP gateway auth, LLM proxy) and each needs its own reviewed pass.
Two are **security-relevant** and flagged as such — decide on those first.

### [x] 2026-08-18 — SECURITY: a capitalised `type` skips the entire transaction authorization/HITL/step-up/scope layer

**FIXED 2026-08-18 (PR #2007, pending merge).** `type` is normalised
(`String(type||'').toLowerCase().trim()`) immediately after destructure, so every
gate sees the canonical form. Regression test proves `"Transfer"` / `"  transfer  "`
/ `"WithDrawal"` take the identical step-up/HITL/authz path; logged in
REGRESSION_PLAN §4. No blanket type rejection added (deposit legitimately returns
`type_not_in_scope` when `ff_authorize_deposits` is off). Original entry follows.

**Where:** `demo_api_server/routes/transactions.js:419` (`type` destructured raw
from `req.body`, never normalised), gated against exact-lowercase lists in
`services/transactionAuthorizationService.js:149-161` (`AUTHORIZE_TYPES`) and
`routes/transactions.js:557` (`writeOperations`).

**What's wrong:** `POST /api/transactions` with `{"type":"Transfer","amount":9000,...}`
(capital T, above the HITL/step-up threshold) makes `evaluateTransactionPolicy`
return `{ran:false, reason:'type_not_in_scope'}`, so PingOne DENY, HITL consent
and RFC 9470 step-up are all skipped; the write-scope check is skipped too.
Execution falls through to `dataStore.applyTransfer(...)` (~755, which ignores
`type`) and the funds move with no policy decision, no consent, no step-up
recorded. The hard `max_transaction_amount` gate (~480) still fires because it
does not read `type`, but every type-driven control is bypassed. This is the
highest-severity finding of the audit.

**Why not fixed now:** it is on a §1 protected transfer-consent path and the user
scoped this round to safe, non-§1 fixes — a control-bypass fix on that surface
must be done deliberately with the regression pass, not folded into a batch.

**Real fix:** normalise `type` (`String(type||'').toLowerCase().trim()`) once at
the top of the handler before any gate reads it, and add a test that
`{"type":"Transfer"}` and `{"type":"transfer"}` take identical authorization
paths. Consider rejecting unknown `type` values outright rather than treating
"not in scope" as "no controls apply".

**RESOLVED 2026-08-18 by PR #2007** (`fix(security): normalize transaction type
before authorization gates`) — verified, not assumed.

`demo_api_server/routes/transactions.js:430` now reads
`type = String(type || '').toLowerCase().trim();` before any gate, with the
re-read at `:450` normalised the same way. The commit message states the same
failure this entry did: `"Transfer"` returned `type_not_in_scope` and skipped
PingOne-Authorize DENY, HITL consent, step-up and write-scope while
`applyTransfer` still moved funds.

### [x] 2026-08-18 — SECURITY: MCP gateway rate-limit bucket is keyed on an unverified `sub`, so a forged token starves a victim

**FIXED 2026-08-18 (PR #2008, pending merge).** The `check()` moved to AFTER token
validation on both transports (WS after `validateInboundToken`; HTTP after
introspection+policy), keyed on the verified subject — so forged/inactive tokens
are rejected `401` before the limiter runs and can only exhaust the attacker's own
bucket. Regression test proves 10 forged `sub=<victim>` requests are each `401`,
never `429`, and the real victim keeps its full allowance. Original entry follows.

**Where:** `demo_mcp_gateway/src/index.ts:508-533` (WS path) and
`demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:275-288` (HTTP path).

**What's wrong:** the UC18 limiter runs *before* `validateInboundToken`/
introspection and derives its key `${sub}:${tool}` from a raw base64 decode of
the bearer payload. The in-code comment claims a forged `sub` only wastes a slot
in the attacker's own bucket — the reverse is true. An attacker sends
garbage-signed JWTs with `sub=<victim>`; each `check()` consumes a slot in the
victim's bucket before the signature check rejects the call, and after
`GATEWAY_RATE_LIMIT_MAX_REQUESTS` (default 20) the legitimate victim gets
`-32429 rate_limited` on that tool for the window.

**Why not fixed now:** §1 gateway auth surface; reordering the limiter after
token validation (or keying on the verified subject only) is a behavioural change
to the gateway's request pipeline that needs its own blast-radius check.

**Real fix:** key the limiter on the *verified* subject — move the `check()`
after `validateInboundToken`, or fall back to the source IP for unverified
tokens so an unauthenticated caller can only exhaust its own bucket.

**RESOLVED — verified 2026-08-18.** `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:495-506`
now reaches the limiter only after verification, and says so in place: *"inactive
above and never reaches this check, so an unauthenticated caller can only ever
consume its OWN bucket — it can no longer deny a victim's."* The key is still
`${sub}:${tool}`, but `sub` is now a verified claim, which is the property this
entry was about. Metering remains scoped to `tools/call`.

### [x] 2026-08-18 — MCP gateway WS `close` cancels the call timeout without settling the promise, hanging the request forever

**FIXED 2026-08-18 (PR #2013, merged + deployed).** The `close` handler now rejects
any still-pending call for that socket with `Backend closed connection before
responding to <method>` BEFORE clearing the timers, guarded by the existing
`settled` flag so an already-answered close is never double-settled — the awaiting
caller's `finally` then runs and cleans `inFlightCalls`. Regression test
`tests/proxy-close-pending.test.ts` (rejects-not-hangs + no-double-settle) at the
`proxyJsonRpc` level. Original entry follows.

**Where:** `demo_mcp_gateway/src/proxy.ts:187-190` (`ws.on('close')`), awaited by
`src/index.ts:960` with the `inFlightCalls` cleanup `finally` at ~974.

**What's wrong:** on `close` the handler runs `clearTimeout(timer)` /
`clearTimeout(handshakeTimer)` but never rejects. If a backend completes the
handshake then closes cleanly without answering the proxied request (crash
mid-call, policy-close, restart), `proxyJsonRpc` never resolves and its 30s
safety timeout has just been cancelled — the promise hangs indefinitely, the
client never gets a JSON-RPC response for that id, and the `inFlightCalls` entry
leaks because the `finally` never runs.

**Why not fixed now:** §1 gateway internals; the fix must reject with the right
JSON-RPC error shape without regressing the normal-close path.

**Real fix:** in the `close` handler, reject any still-pending call for that
socket with a transport-closed error before clearing timers, so the `finally`
cleans up `inFlightCalls`.

### [x] 2026-08-18 — MCP gateway introspection cache is unbounded and never pruned

**FIXED 2026-08-18 (PR #2013, merged + deployed).** Both introspection inserts now
route through `cacheInsertWithEviction` (`boundedTokenCache.ts`, made generic over
`{ expiresAt }`) with a 1000-entry cap + FIFO eviction, and the get-path deletes
expired entries instead of only skipping them. Live-token hit/expiry semantics
preserved. Regression test `tests/boundedIntrospectionCache.test.ts`. Original
entry follows.

**Where:** `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:26,155,176`.

**What's wrong:** `_cache.set(...)` has no size cap and no sweep; expired entries
are only skipped on `get`, never deleted. Every distinct inbound token (they
rotate per login/exchange; even garbage tokens get their `{active:false}` result
cached) adds a permanent map entry for the process lifetime. The sibling exchange
cache was hardened with `cacheInsertWithEviction` (`boundedTokenCache.ts`, HI-06);
this one was missed, so memory grows monotonically and a caller spraying random
bearers inflates it at will.

**Why not fixed now:** §1 gateway auth; small but should land with the other
gateway-cache hardening and a test.

**Real fix:** route this cache through the same `cacheInsertWithEviction` bound +
periodic sweep the exchange cache already uses.

**RESOLVED — verified 2026-08-18.** `demo_mcp_gateway/src/boundedTokenCache.ts`
now owns the eviction policy (hard cap, sweep-expired, then FIFO-evict-oldest) and
is imported by both `auth/GatewayIntrospectionClient.ts:15` and
`auth/McpTokenExchangeClient.ts:28`. Its header records that the two call sites
previously held a byte-for-byte-identical private copy, so the extraction also
retired the duplication.

### [x] 2026-08-18 — `demo_mcp_proxy` pins `MCP-Protocol-Version: 2025-03-26`, which the Node gateway hard-rejects

**FIXED 2026-08-18 (PR #2058, merged + deployed).** Investigation confirmed the Node
gateway IS a real upstream: `docker-compose.yml:1116` bakes
`MCP_GATEWAY_HTTP_URL: http://mcp-gateway:3005` as the proxy default (and
`run-docker.sh`/`k8s/deploy.sh` make it runtime-selectable); the proxy is stateless
(never sends `initialize`) and sends the version header on every request, so an
authenticated `tools/list`/`tools/call` reaches the gateway's version check and 400s
on the stale value. Both upstreams (Node gateway and PingGateway scripts) want
`2025-11-25`. Fix: one line, `2025-03-26` → `2025-11-25`, with a test that drives a
real `GET /tools` through the proxy and asserts the emitted header. (`400s before
auth` was slightly imprecise — bearer/token checks run first; the version 400 hits
the authenticated case.) No current in-repo consumer calls the proxy's `/tools`, so
it was not user-visible, but the wired upstream rejected it. Original entry follows.

**Where:** `demo_mcp_proxy/server.js:38`; rejected by
`demo_mcp_gateway/src/server/GatewayServer.ts:727-736` (expects `2025-11-25`,
`proxy.ts:31`). Wired to the Node gateway by `docker-compose.yml:1116`
(`MCP_GATEWAY_HTTP_URL: http://mcp-gateway:3005`).

**What's wrong:** every `mcpRpc` the sidecar makes is `tools/list`/`tools/call`
with the stale header, so `GET /tools` and `POST /tools/:name` return 400
`unsupported_protocol_version` before auth even runs — whenever the proxy is
pointed at the Node gateway.

**Why not fixed now:** the version string is a one-liner, but it touches the MCP
transport contract; verify the gateway truly is the intended upstream for this
sidecar (vs PingGateway) before bumping, and that no other consumer depends on
the old value.

**Real fix:** align the proxy's advertised protocol version with the gateway's
(`2025-11-25`), or make it negotiate from the gateway's advertised version.

### [x] 2026-08-18 — `demo_mcp_proxy` per-caller tools/list cache has no TTL and no size bound

**FIXED 2026-08-18 (PR #2042, merged + deployed).** Added a TTL
(`MCP_PROXY_TOOLS_TTL_MS`, default 30s — re-fetched on expiry) and an LRU size bound
(`MCP_PROXY_TOOLS_MAX`, default 500), closing both the unbounded-token-accumulation
window and the scope/vertical staleness window. Regression test
`demo_mcp_proxy/test/toolCache.test.js`. Original entry follows.

**Where:** `demo_mcp_proxy/server.js:15-124` (`_toolCacheByCaller`, keyed
`sha256(bearer)`).

**What's wrong:** entries are deleted only on an MCP error; a successful fetch is
cached forever. (a) tokens rotate per session, so the map grows unbounded for the
process lifetime; (b) while a token stays valid, a change of scope or of vertical
that alters the gateway's filtered tools/list (greyed/denied tools, a vertical
switch via header) is never reflected — the proxy serves the first catalog it saw.

**Why not fixed now:** batched with the gateway-cache hardening above; needs a
TTL + bound decision consistent with the rest of the MCP layer.

**Real fix:** give the cache a short TTL and an LRU bound, and key/scope it so a
vertical or scope change invalidates it.

### [x] 2026-08-18 — MCP gateway SSE passthrough leaks the upstream connection on client disconnect

**FIXED 2026-08-18 (PR #2042, merged + deployed).** `pipeGetToUpstream` now destroys
the upstream request on `req`/`res` `close`, and a real `'timeout'` handler aborts an
idle upstream (the `timeout` option was previously inert). A settle-once guard
detaches the close listeners on normal completion, so normal streaming is unchanged.
Regression test `demo_mcp_gateway/tests/gateway-sse-client-close.test.ts`. Original
entry follows.

**Where:** `demo_mcp_gateway/src/server/GatewayServer.ts:542-591`
(`pipeGetToUpstream`).

**What's wrong:** it never watches `req`/`res` for `close`. When the SSE client
goes away the upstream GET is not destroyed (`pipe` only unpipes, it does not
destroy the source), and the request's `timeout` option (~560) is inert because
no `'timeout'` listener is attached. Each abandoned SSE stream holds an upstream
socket (and the pending middleware promise) until the upstream itself ends, so
browser reconnect loops accumulate zombie upstream connections.

**Why not fixed now:** §1 gateway; the teardown must destroy the upstream without
regressing normal stream completion.

**Real fix:** on `res`/`req` `close`, destroy the upstream request; attach a real
`'timeout'` handler that aborts it.

### [x] 2026-08-18 — LLM proxy: cross-class swaps race and unload each other's just-loaded tier

**FIXED 2026-08-18 (PR #2048, merged — on disk, NOT yet live in the running
proxy).** A global `swapChain` lock now runs every swap behind the previous one, so
a concurrent different-class swap waits instead of overwriting `swapInFlight` and
firing a second `ensure` that unloads the first swap's just-loaded tier; a failed
swap advances the chain (`.catch`) so it can't wedge the queue. Same-class coalescing
and per-swap `SWAP_TIMEOUT_MS` unchanged. Router-logic only — no tier ports/model
names/`LLAMACPP_MAX_TOKENS`/`SWAP_TIMEOUT_MS`/config values touched (frozen surface).
Regression test in `demo_llm_proxy/router.test.js` (mock tier servers; not verified
against a live model backend). **Deploy note:** `run-docker.sh`/`deploy-live.sh` do
NOT manage `llm-proxy` — it goes live only on a deliberate `docker compose up -d
--build llm-proxy`, left to the owner of the frozen LLM surface. Original entry
follows.

**Where:** `demo_llm_proxy/router.js:262-292` (`swapTo`); serialised at
`tier-manager.js:78-84`. (Distinct from the known warmup positional-tier issue.)

**What's wrong:** `swapInFlight` coalesces only same-class swaps; a concurrent
request for a different class starts a second swap and overwrites `swapInFlight`.
Because `ensure` "stops every other tier", the second queued ensure unloads the
first swap's just-loaded target. Classic swap mode, no residents: concurrent
phi-4-mini + gpt-oss → swap A starts streaming on :8096, then `ensure(8091)`
kills :8096 mid-response → ECONNRESET / 502, or the loser polls a dead tier for
the full `SWAP_TIMEOUT_MS` (180s) before a 503.

**Why not fixed now:** LLM proxy is a delicate, effectively-frozen surface
(memory: `feedback-llm-settings-frozen`); a swap-serialisation change needs its
own soak test.

**Real fix:** serialise swaps across all classes (single global swap lock/queue),
or reject/queue a cross-class swap while one is in flight rather than clobbering
`swapInFlight`.

### [x] 2026-08-18 — LLM proxy: the pin-only experimental tier is reachable by normal classification

**FIXED 2026-08-18 (PR #2048, merged — on disk, NOT yet live in the running
proxy).** `:8093` (`llama-3-groq-8b-tool-use`) is now marked `pinOnly: true` and
`smallestLoadedCovering` skips pin-only tiers on substitution (`i !== cls`), so it is
returned only when a route targets class 2 exactly (explicit `LLM_PROXY_PIN_TIER` /
`model=` pin) — never as a health-based substitute-up for a lower class
(`classifyText` only emits class 0/1). `pinOnly` is a minimal marker encoding the
existing 100-103 invariant as data; no tier values changed (frozen surface).
Regression test in `demo_llm_proxy/router.test.js`. Same deploy note as the entry
above — goes live only on a deliberate `llm-proxy` rebuild. Original entry follows.

**Where:** `demo_llm_proxy/router.js:227-232` (`smallestLoadedCovering`), against
the invariant stated at ~100-103.

**What's wrong:** lines 100-103 promise the `llama-3-groq-8b-tool-use` tier
(:8093, class 2, tool-reliability "unproven") is reached only via explicit
`LLM_PROXY_PIN_TIER=8093`, never by keyword classification — but the coverage
loop iterates `i = cls … TIERS.length-1` and returns index 2 whenever it is
healthy and the intended tiers are not. If :8096 is down (crash/swap window) while
:8093 happens to be up, class-1 agent tool-loop requests are silently served by
the smaller unproven model — exactly the "agent shows no result, nothing in the
logs" degradation the downgrade-refusal guard (~477-494) exists to prevent (that
guard only fires on pin-capped routing, not health-based substitution).

**Why not fixed now:** same frozen LLM-proxy surface.

**Real fix:** exclude pin-only tiers from `smallestLoadedCovering` unless the
active route is a pin, so health-based substitution cannot fall onto :8093.

### [x] 2026-08-18 — `helix_llm._generate` blocks the FastAPI event loop for up to ~35s

**FIXED 2026-08-18 (PR #2050, merged + deployed).** A sync function on the loop
thread cannot await the Helix round-trip without blocking that thread, so a
"non-blocking sync path" is physically impossible — and the correct async entry
`_agenerate` already exists and is what every real caller uses (`message_processor.py`
→ `ainvoke`; LangGraph → `astream_events`; grep found no sync `.invoke`/`.stream` on
any graph/model in `src`). So on a running loop `_generate` now refuses immediately
with a `RuntimeError` pointing at the async API instead of freezing the loop. The
non-loop sync path, `_agenerate`, streaming, poll interval and timeout constants are
all unchanged. Regression test `tests/test_helix_llm.py::TestEventLoopNotBlocked`
(25 passed). Tradeoff: a future sync `.invoke()` from inside the loop now errors
clearly rather than silently stalling all sessions. Original entry follows.

**Where:** `langchain_agent/src/agent/helix_llm.py:372-377`.

**What's wrong:** when called on a thread with a running loop (its own comment:
"Inside an already-running loop (e.g. FastAPI)"), it submits `asyncio.run(...)` to
a thread pool and then calls `future.result(timeout=POLL_TIMEOUT_SECONDS + 5)` —
a synchronous blocking wait on the event-loop thread. Any sync LangChain
`.invoke()` path hitting Helix freezes the whole FastAPI/WebSocket loop for the
Helix create-conversation + 1s-interval poll (up to 35s): every other session's
SSE/WS stalls, keepalives stop, clients time out.

**Why not fixed now:** the honest fix is an async refactor of this path, not a
one-liner, and it interacts with the agent's streaming lifecycle.

**Real fix:** make the sync `_generate` path use `run_coroutine_threadsafe`
against the running loop (or expose a proper async `_agenerate`) so the poll does
not block the loop thread.

### [x] 2026-08-18 — `tokenIntrospectionService`'s deliberate `INTROSPECTION_NOT_CONFIGURED` throw is swallowed, reported as "token inactive"

**FIXED 2026-08-18 (PR #2043, merged + deployed).** The catch now re-throws when
`err.code === 'INTROSPECTION_NOT_CONFIGURED'` instead of swallowing it, and
`tokenVerificationService._introspectAsFallback` treats that code as "introspection
skipped" (returns a warning, `error:null`) rather than "token inactive" — so a valid
exchanged token is no longer rejected in fail-closed mode when JWKS is momentarily
down and introspection simply isn't configured. Configured active/inactive behaviour
unchanged. Regression test
`tests/services/tokenVerificationService.introspectionFallback.test.js`. Original
entry follows.

**Where:** `demo_api_server/services/tokenIntrospectionService.js:184` (throw
inside the `try` opened at 151, whose `catch` at 252-265 returns
`{valid:false, error:'token_introspection_failed'}` with no re-throw).

**What's wrong:** the throw is meant to propagate so callers can tell
"skipped/not-configured" from "PingOne said inactive", but it never escapes. When
introspection is unset (common in the demo), `tokenVerificationService._introspectAsFallback`
(~57-77) gets `{valid:false}`, takes the "inactive per RFC 7662" branch, and in
fail-closed mode rejects a genuinely valid exchanged token whenever JWKS was
momentarily unavailable and introspection simply is not configured. The in-code
comment referencing `agentMcpTokenService` is also stale (that service uses JWKS
now).

**Why not fixed now:** §1 token-verification path; changing the fallback's
error discrimination needs the auth regression pass.

**Real fix:** let the `INTROSPECTION_NOT_CONFIGURED` code propagate (re-throw in
the catch when `err.code === 'INTROSPECTION_NOT_CONFIGURED'`) and have the
fallback treat "not configured" as "introspection skipped", not "inactive".

### [x] 2026-08-18 — OIDC nonce is not enforced when the returned ID token omits the `nonce` claim

**FIXED 2026-08-18 (PR #2043, merged + deployed).** The "nonce requested but ID token
has none" branch now fails the callback (`error=nonce_missing`) instead of
`console.warn`-and-proceed, mirroring the existing `nonce_mismatch` path (OIDC Core
§3.1.3.7). The matching-nonce happy path is unchanged. Regression test
`tests/oauthUserCallbackNonce.test.js`. Original entry follows.

**Where:** `demo_api_server/routes/oauthUser.js:460-467`.

**What's wrong:** nonce is validated only inside `if (expectedNonce && idTokenClaims.nonce)`;
the `else if (expectedNonce && tokenData.id_token && !idTokenClaims.nonce)`
branch merely `console.warn`s and proceeds. Per OIDC Core §3.1.3.7, when the
client sent a `nonce` it MUST verify a matching one is present — a login where
`expectedNonce` was set but the ID token comes back with no `nonce` (misconfigured
mapping, or a replayed/substituted token stripped of `nonce`) is accepted and a
session established, defeating the replay protection.

**Why not fixed now:** §1 OAuth callback; related to the known `davinciLogin.js`
nonce gap but a distinct route — should land with a nonce-enforcement pass across
callbacks.

**Real fix:** in the `!idTokenClaims.nonce` branch, fail the callback (reject/
redirect to error) instead of warning, so a missing nonce when one was requested
is treated as verification failure.

### [x] 2026-08-18 — `pkceStateCookie._verify` calls `timingSafeEqual` outside its try/catch, so a malformed cookie 500s the OAuth callback

**Where:** `demo_api_server/services/pkceStateCookie.js:53` (call at 53, `try`
opens at 54); `readPkceCookie` calls `_verify` outside its own `try` (116 vs 118).
Callers: `routes/oauth.js:215`, `routes/oauthUser.js:414`.

**What's wrong:** `crypto.timingSafeEqual` throws `RangeError` on unequal buffer
lengths (reproduced). A malformed/truncated/crafted `_pkce` cookie whose signature
segment decodes to a length other than 32 makes the throw propagate into the
callback handler and surface as a 500 / error redirect, even when the session
already holds valid PKCE state the fallback was meant to use. The sibling
`services/authStateCookie.js:55-60` wraps the identical call in try/catch and
returns `null` — the correct behaviour.

**Why not fixed now:** §1 OAuth path; trivial fix but must land with the callback
regression check.

**Real fix:** move the `timingSafeEqual` call inside the try/catch (or length-
check first) and return `null` on any comparison error, matching
`authStateCookie.js`.

**RESOLVED 2026-08-18 (branch `worktree-fix-pkce-cookie-timingsafe`).**

*What the issue really was:* exactly as described, and reproduced against the real
module before touching it — but there were **two** throws reachable from cookie
text, not one:

```
readPkceCookie({headers:{cookie:'_pkce=abc.zz'}})  -> THROWS RangeError  Input buffers must have the same byte length
readPkceCookie({headers:{cookie:'_pkce=%ZZ'}})     -> THROWS URIError    URI malformed
```

The second is the same defect one frame further out: `_parseCookieHeader` calls
`decodeURIComponent` on every cookie value, and a malformed escape throws there —
before `_verify` is ever reached. Fixing only the `timingSafeEqual` call would
have left the 500 reachable with a one-character cookie, and the entry would have
read as closed.

*What the fix was:* `demo_api_server/services/pkceStateCookie.js`, three
non-throwing points, all returning `null` so the caller falls through to the
session that this cookie only ever backs up:

- `_verify` — `timingSafeEqual` moved inside the existing `try`, matching
  `services/authStateCookie.js`, which has always done it this way.
- `_parseCookieHeader` — per-value `decodeURIComponent` falls back to the raw
  text, so an undecodable cookie fails signature verification instead of throwing.
- `readPkceCookie` — its own second `decodeURIComponent` guarded the same way.

*What was deliberately NOT changed:* verification strength. A wrong signature, a
tampered payload, a cookie signed with a different secret, and an expired cookie
all still return `null`. The fix converts "cannot verify" from *throw* to
*reject*; it never converts it to *accept*. Pinned by
`demo_api_server/tests/pkceStateCookie.test.js`, which asserts the tamper and
wrong-secret cases alongside the two crash cases — a fail-open regression here
would be far worse than the 500 this fixes.

*Note for whoever touches `authStateCookie.js`:* its `_verify` is correct, but its
`_parseCookieHeader` is the same unguarded shape this fix repaired. It was left
alone because nothing in this session showed it reached — but it is the same code,
one file over.

### [x] 2026-08-18 — Honourable mentions from the audit (lower confidence / not yet load-bearing)

**ALL 5 RESOLVED — last one closed 2026-08-18 (branch
`worktree-orphaned-component-fixes`).** The two UI defects below were fixed
despite both components staying orphaned (fix-on-principle, since either could
be wired up without warning): `SessionExpiryTimer.jsx` now polls
`fetchSessionData` every 30s instead of fetching once at mount, so a silently
refreshed session no longer drifts into a false "Expired"
(`SessionExpiryTimer.periodicRefresh.test.js`, 3 tests). `RecognizeOverlay.tsx`'s
`loadSdkScript()` now records the script element's settled state in its own
`dataset` the moment `load`/`error` fires, so a retry after a failed load reads
that state instead of re-attaching listeners to an already-fired one-shot DOM
event and hanging on "Loading face ID…" forever
(`RecognizeOverlay.sdkLoadRace.test.tsx`, 2 tests — the second proves the
retry-after-failure path specifically, not just the happy path a naive fix
would have covered). Full UI unit 388 files / 3306 tests passed; build exit 0.
The other three items (JWKS amplification, falsy TTL, sync-status fetch) were
already closed earlier the same day. Root `CLAUDE.md` has no
`demo_mcp_server/` reference (verified); the stale copy was in
`langchain_agent/CLAUDE.md`, already fixed. Original entries follow.

- **`demo_mcp_gateway/src/auth/tokenValidator.ts:223-226`** — a forced JWKS
  re-fetch on an unknown `kid` passes `force=true`, bypassing the in-flight
  dedupe, so tokens with random `kid`s each trigger a full JWKS round-trip: a
  cheap amplification vector against PingOne. **FIXED 2026-08-18 (PR #2042):**
  forced refreshes now share the in-flight fetch and are rate-capped
  (`MCP_GW_JWKS_MIN_REFRESH_MS`, default 10s); a genuine rotation still refreshes
  once. Regression test `tests/tokenValidator-jwksRefetch.test.ts`.
- **`demo_api_ui/src/components/SessionExpiryTimer.jsx:34-82`** and
  **`RecognizeOverlay.tsx:37-41`** — real defects (mount-once fetch that never
  refetches after silent token refresh → shows "Expired" against a live session;
  `load`/`error` attached to an already-settled script tag → retry hangs at
  "Loading face ID…") but both components are currently orphaned (imported only by
  their own tests), so no user-visible failure today. Fix if either gets wired up.
- **`langchain_agent/src/storage/token_cache.py:66`** — `ttl_seconds=0` falls to
  the default via a falsy check, but the class is never instantiated (imported
  only in `storage/__init__.py`), so no runtime impact today.
- **`scripts/sync-status.sh:23`** — computes "behind" against the local
  `origin/main` ref without fetching, so if the launchd sync job is dead (the
  scenario the script exists to surface) it can print "in sync" while GitHub is
  ahead; partially mitigated by the printed last-sync age.
- **Repo-map staleness:** root `CLAUDE.md` lists `demo_mcp_server/`, which does
  not exist (only `demo_mcp_resource_server/` and `oauth-mcp/`). Fold into the
  "reports/docs updated to current codebase" follow-up.

### [ ] 2026-08-18 — `INDETERMINATE` means "evaluation failed" from the cloud and "pause for step-up" locally

**PHASE 2 SHIPPED 2026-08-18 (branch `worktree-indeterminate-phase2`) — entry
stays open; phases 3–5 remain.** Per the plan's Option B sequence, the PDP now
emits `obligations: [{ id, type, obligatory: true, fulfilled: false }]` on every
pause (STEP_UP / HITL_CONSENT via `indeterminate()`, plus the inline
ELICITATION site) alongside the unchanged `decision`/`reason`. Nothing consumes
it yet. `obligatory` is hard-coded true (#1310 / llm-path-approval-gate: an
"optional" pause is not a pause). Pinned by `tests/decision.obligations.test.js`
(5 tests); the phase-1 baseline (24) and the 26-assertion contract suite are
untouched and green. Next: phase 3 moves consumers one at a time
(`transactionConsentChallenge` → `mcpToolPipeline` → `hitlClient.ts` → Groovy →
UI), then phase 4 flips the PDP, phase 5 adds the fail-closed guard. Original
entry follows.

**Where:** `demo_authz_server/routes/decision.js` (12 `STEP_UP` / `HITL_CONSENT`
sites) versus the cloud PingOne Authorize decision endpoint; 55 source files and
40 test files reference the value.

**What's wrong:** one word carries two unrelated meanings.

- **Cloud P1AZ** returns `INDETERMINATE` when evaluation FAILED — missing
  attribute, attribute provider unreachable, malformed payload. It should be
  treated as an error and failed closed.
- **`demo_authz_server`** returns it deliberately as a PAUSE: `reason=STEP_UP`
  when an amount crosses the step-up band, `reason=HITL_CONSENT` between confirm
  and step-up. UC7 and UC8 are built on it; `tests/decision.test.js` pins it with
  26 assertions.

Anyone acting on "INDETERMINATE means something is broken" deletes a working
flow. Anyone acting on "INDETERMINATE means step-up" silently swallows a real
cloud evaluation error. The meaning currently lives in `reason`, not `decision`,
so nothing in the type tells a reader which they have.

Baseline captured live 2026-08-18 (real subject and actor, five verticals):
`$600 → INDETERMINATE/STEP_UP`, `$300 → INDETERMINATE/HITL_CONSENT`,
`$100 → PERMIT`, `$2500 → DENY` ceiling. In 45 minutes of ordinary traffic
`demo_authz_server` logged ZERO indeterminate and the cloud endpoint returned
clean `PERMIT`s — today the value only ever appears as the intended pause, so
this is a clarity defect rather than an outage.

**Why not fixed now:** the user chose the full obligation-based rework over the
cheaper rename, and asked for a plan before any code. Scope is 55 source files,
40 test files and PingGateway's Groovy `p1az-decision`, in a REGRESSION_PLAN §1
area covering UC7 and UC8 — not something to start at the end of a session.

**UPDATE 2026-08-19 — the live fail-open half is FIXED, scope was smaller than
this entry assumed.** Auditing every consumer before starting the rework found
two of the three boundaries already disambiguate correctly (BFF
`pingOneAuthorizeService.js:_normalizeDecision`, #1310; Node gateway
`PingOneAuthorizeClient.ts:448-471`). The real remaining live gap was one line
in `ping-gateway/scripts/groovy/p1az-decision.groovy:1162` — fixed, see
REGRESSION_PLAN §4 2026-08-19 entry. Of the ~57 files that reference the
literal string, only 2 remaining consumers propagate the (now-fixed) Groovy
mislabel for **display only** — `demo_api_server/routes/verticalManifest.js`
(`/check-chip`, admin badge) and `demo_api_ui/src/vertical/AdminEditor/VerticalPipelineMap.jsx`
(cosmetic edge color in a read-only admin diagram) — neither grants access,
both cosmetic. Everything else is safe by construction (local-only mock
engines, or already downstream of a normalized decision).

**What's still open — the vocabulary overload itself.** The word still means
two things in the source; the live security gap is closed, but the plan
below's Option B (move step-up/HITL off the decision channel entirely, for
both engines) is what actually retires the overload rather than just guarding
every consumer against it. Not started.

**Real fix:** `docs/superpowers/plans/2026-08-18-indeterminate-rework.md` — five
independently-shippable phases beginning with characterisation tests that capture
today's behaviour before anything moves. It also records the cheaper alternative
(rename the pause to `CHALLENGE`/`PENDING`, no behavioural change, the 26
assertions become a rename) in case the trade looks different on reading. Two
traps apply directly: `obligatory:false` is NOT safe to treat as optional, and an
INDETERMINATE with no obligation must resolve to DENY (#1310). Memory:
`project-indeterminate-two-meanings`.

### [x] 2026-08-18 — The LMDB store is at 66% of a hard 128MB ceiling and nothing watches it

**RESOLVED 2026-08-18 (part 2, branch `worktree-lmdb-measure`) — measured,
explained, and bounded; `mapSize` deliberately NOT raised.** Per-DB analysis of
a copy of the live store (`scripts/lmdb-stats.js`, new): the 84.4MB file holds
only **~21.2MB of live data** — 75% is free/fragmented pages, the legacy of the
pre-#1976 broken delete, exactly as this entry suspected. Largest live
consumer: `reports` (966 entries, 14.9MB) — the ONLY store with no prune — now
capped at `MAX_REPORT_RUNS = 500` (oldest-first eviction on new-run saves,
never on `appendFile` re-saves; `tests/services/reportStorePrune.test.js`).
Copy-compaction verified on the live copy: **84.4MB → 29.5MB (65% reclaimed)**
via `scripts/lmdb-compact.js` (new; header documents the stop-copy-compact-swap
recipe for the `ai-demo_ai-demo-bff-data` volume). Post-compaction the store
sits at ~23% of the 128MB map with a bounded growth driver, so raising
`mapSize` is unnecessary — the part-(1) startup watcher warns at 80% if that
ever changes.

**Live volume swap DONE 2026-08-19 (operator-run, this session).** Hit and fixed
in the process, added to the script's own recipe (part 3): `docker cp`-ing the
compacted file back into the container preserved the HOST user's numeric UID,
which does not match `appuser` (UID 1001) inside the container — the mismatch
made `openEnv()` throw `Permission denied: Attempting to open main database
file` and `demo-api-server` crash-loop, surfacing as an unrelated-looking FATAL
`[VERTICAL GUARD]` error (every vertical "failed to resolve" — the actual cause
was one directory down in the log, not in that message). No data loss — the
compacted file itself was correct, only its owner was wrong. Fixed with
`docker run --rm -v ai-demo_ai-demo-bff-data:/data alpine chown 1001:1001
/data/lmdb/data.mdb` against the volume directly (works even while the
container is down), then a restart. Live post-fix confirmation:
`[lmdb] data.mdb 29.5MB of 128MB mapSize (23%)` and `[VERTICAL GUARD] OK`.
Original entry follows.

**PARTLY RESOLVED 2026-08-18 (branch `worktree-lmdb-mapsize-watch`) — part (1)
only.** `openEnv()` now stats `data.mdb` at startup and logs size vs `mapSize`;
at >= 80% it switches to a `console.error` naming `MDB_MAP_FULL` and saying to
measure per-DB sizes and prune/compact before raising the ceiling. Threshold
logic is a pure exported `mapSizeReport()` with tests
(`tests/services/lmdbMapSizeWatch.test.js`). Part (2) — establishing why 84MB
accumulated (suspect: dead entries from the pre-#1976 broken delete), measuring
per-DB sizes, and the compaction-vs-raise decision — is deliberately NOT done
here and keeps this entry open; `mapSize` itself is unchanged. Original entry
follows.

**Where:** `demo_api_server/services/lmdb/openEnv.js` — `mapSize: 128 * 1024 * 1024`.

**What's wrong:** LMDB's `mapSize` is a hard wall, not a hint. Every write past it
throws `MDB_MAP_FULL`, and this env backs conversations, sessions, nav configs and
the operator's persistent config — 14 named DBs. Measured today inside
`ai-demo-api-server`:

```
-rw-r--r-- 1 appuser appgroup 88522752 Aug 18 03:47 data.mdb   # 84.4M of 128M
```

At the ceiling, every LMDB write path 500s at once, and `data.mdb` never shrinks
back on its own — so the failure is permanent from the operator's point of view
and looks like "the whole BFF broke" rather than "a disk-shaped limit was reached".
The `maxDbs: 32` line above it carries a comment explaining its headroom;
`mapSize` carries none, and no check, alert or startup log reports how close the
store is.

**Why not fixed now:** found while trying to reproduce the `hero-shown` 500 (see
that entry), which is a plausible-but-unconfirmed symptom of exactly this. Raising
the number is a one-character change with a real consequence — `mapSize` is the
virtual address reservation, so it should be raised deliberately, not
opportunistically, and the pruning question below is the more interesting half.

**Real fix:** two parts. (1) Log the store's size against `mapSize` at startup and
fail loudly above some fraction of it, so this shows up as a warning rather than
as a fleet of unexplained 500s. (2) Establish why 84MB accumulated at all —
`conversationStore` prunes at `MAX_MESSAGES_PER_THREAD = 500` per thread, and PR
#1976 repaired a broken LMDB delete API, so some of this may be dead entries the
old delete never removed. Measure per-DB sizes before raising the ceiling; a
compaction may be the actual fix.

### [x] 2026-08-18 — `authLevelForUseCase` names two different functions, one taking an id and one taking an object

**Where:** `demo_api_server/config/authRequirements.js:32` takes a use-case **id**
(`authLevelForUseCase('UC24')`); `demo_api_ui/src/utils/useCaseAuth.js:18` takes a
**catalog object** (`authLevelForUseCase(uc)`). The UI one was `useCaseAuthLevel`
until it was renamed into the collision.

**What's wrong:** the same name across the BFF/UI boundary with different inputs
and nothing to catch a mix-up. Passing an object to the server helper returns the
`user` default (the object is not a key); passing an id to the UI helper returns
the same default (`uc.auth` is undefined). Both fail **closed and silently** —
the safest possible wrong answer, which is exactly why it would sit unnoticed.

**Why not fixed now:** both are correct at their own call sites today, and a
rename touches SoT plumbing that four PRs had just stabilised.

**Real fix:** name them for their input — `authLevelForUseCaseId(id)` on the
server, `authLevelOf(uc)` in the UI — or let the UI helper accept either and
normalise.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* what the entry described, and its own framing is why
this was worth paying off. Both helpers fail **closed and silently**, so a mix-up
produces no error, no log and no failing test — it produces a sign-in prompt on a
use case that should be public, or the reverse, and it reads as bad config.
Nothing in the linter or the test suite could have caught it, because
`authLevelForUseCase(x)` is a valid call on both sides of the boundary for any `x`.

*What the fix was:* the entry's first option — name each helper for the input it
accepts, so the collision cannot be written down.

- `demo_api_server/config/authRequirements.js` → `authLevelForUseCaseId(id)`,
  call sites updated in `routes/useCases.js` (3), `scripts/check-auth-requirements.js`
  (2), `tests/authRequirements.test.js`.
- `demo_api_ui/src/utils/useCaseAuth.js` → `authLevelOf(uc)`, call sites updated
  in `components/AIAgent.js` and `utils/__tests__/useCaseAuth.test.js`.

Rejected the "accept either and normalise" option: it keeps one name meaning two
things and adds a branch whose wrong side is still silent. Behaviour unchanged —
rename only. `scripts/check-auth-requirements.js` still reports
`OK — 63 use cases, 153 routes, 1 public agent action(s)`.

### [ ] 2026-08-18 — The queued-question resume is held together by two tuned timeouts

**PARTLY RESOLVED 2026-08-18 (branch `worktree-resume-readiness`) — the
load-bearing timeout is now a backstop, not the mechanism.** `VerticalProvider`
reports `verticalStatus` ('loading' | 'resolved' | 'failed') through
`useVertical` — every hydration path concludes it, including the 401 +
`/api/verticals/active` follow-up settling either way. The resume now hands a
question back IMMEDIATELY when the vertical question is answered-empty
(waiting cannot change a concluded answer) and waits only while genuinely
'loading', with `RESUME_VERTICAL_WAIT_MS` kept solely as the visible-expiry
backstop for a signal that never arrives. Tests:
`AIAgent.resumeVerticalReadiness.test.jsx` (4 — the two concluded-empty cases
are impossible under the old code) + 4 `verticalStatus` transition tests in
`VerticalProvider.test.jsx`. STILL OPEN: the 300ms floating-instance claim
delay (#1967) — left deliberately; the read-and-remove `claimPendingNl` guard
does the real work there, and the instance-registration handshake the entry
sketches remains the un-built half. Original entry follows.

**Where:** `demo_api_ui/src/components/AIAgent.js` — the 300ms floating-instance
claim delay (#1967) and `RESUME_VERTICAL_WAIT_MS = 8000` (#1986).

**What's wrong:** both numbers were chosen against *observed* behaviour on one
machine — the vertical manifest resolves in ~2s, an inline instance mounts within
300ms of a floating one — not from anything the code guarantees, and nothing
notices if that stops holding. A slower load pushes the manifest past 8s and the
visitor gets their question handed back for no reason they can see. A slower
inline mount lets the floating instance win a claim it should have lost —
harmless today only because `claimPendingNl` is read-and-remove, so the guard is
doing the work, not the delay.

**Why not fixed now:** the alternative is an explicit readiness signal from the
vertical manifest plus an instance handshake between agent copies. Both are real
work; the timeouts close a user-visible defect today.

**Real fix:** have the vertical context expose a resolved/failed state the resume
can await instead of racing, and let instances register so the claim goes to the
visible one by identity rather than by arrival order.

### [x] 2026-08-18 — A guest typing a banking prompt is redirected to PingOne mid-sentence, with no way to decline

**FIXED 2026-08-18 (PR #2067, merged + deployed).** The `marketingGuestChatEnabled`
branch no longer calls `handleLoginAction("login_user")` directly — it renders the
same "needs you signed in" bubble + **Sign in to continue** button (`showLoginPromptAction`,
the #1952/#1958 pattern), so the visitor chooses. The existing
`BX_AGENT_PENDING_NL_KEY` persist/replay machinery is reused unchanged — the typed
question is still replayed after login. Only the timing changed (on click, not
automatic). Regression test `AIAgent.guestBankingSignIn.test.jsx` asserts the bubble+
button render, no auto-redirect fires, the question is queued, and the click triggers
login. Original entry follows.

**Where:** `demo_api_ui/src/components/AIAgent.js:6440` — the
`marketingGuestChatEnabled` branch in `dispatchNlResult`.

**What's wrong:** it calls `handleLoginAction("login_user")` directly, so a
signed-out visitor typing "what is my balance" on `/` or `/dashboard` is thrown
to PingOne without being asked. Everything else built this session does the
opposite: #1952/#1958 replaced dead ends with a *"needs you signed in"* bubble
and a **Sign in to continue** button, so the visitor chooses. This path predates
that and was never brought into line. Observed live: the redirect fires before
any bubble renders.

**Why not fixed now:** it is not broken — the question is persisted and replayed
after login (verified live), so the visitor does get their answer. It is an
inconsistency in consent, not a failure.

**Real fix:** show the same prompt-plus-button the other paths use. The
persistence and replay machinery it needs already exists.

### [x] 2026-08-18 — `POST /api/conversations/:userId/:vertical/hero-shown` 500s on a normal signed-in load

**Where:** `demo_api_server/routes/conversations.js:229`.

**What's wrong:** observed live on `/dashboard`, signed in as `demouser` in the
`retail` vertical: `POST /api/conversations/me/retail/hero-shown → 500`. The
handler's only 500 path is `conversationStore.saveMessage(...)` throwing, caught
at line 249. The `userId` on the wire is the literal string `me`, not a subject
id — worth checking whether the store rejects that, or whether it is unrelated.

**Why not fixed now:** found while chasing an unrelated agent defect; nothing the
user sees breaks (the hero greeting still renders). It is console noise that
makes real errors harder to spot, which is its own cost.

**Real fix:** reproduce with a session, read the logged `err.message`, and either
fix the store call or stop calling it with a placeholder `userId`.

**PARTLY RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**
The 500 could **not** be reproduced. What was fixed is the reason nobody could
explain it.

*What was actually tried:* the exact request replayed against the live stack with
a real signed-in `demoUser` session (`tests/real/helpers/session.js`
`resolveSession('enduser')`, run from inside `ai-demo-api-server` so it used the
container's own env):

| probe | result |
|---|---|
| `POST /api/conversations/me/retail/hero-shown`, synthetic body | `200 {"saved":true}` |
| same, with the **real** payload from `GET /api/verticals/retail/hero` | `200` |
| 8 concurrent POSTs to one thread (the StrictMode double-write shape) | `200` × 8 |
| same request sent as `application/x-www-form-urlencoded` | `200` |
| `conversationStore.saveMessage(...)` called directly in the container | `OK` |

The `me` alias is therefore not the cause: `router.param('userId')` resolves it to
`req.user.sub` before the handler runs (`routes/conversations.js:40`), and the
store accepts everything the route can hand it.

*What the issue really was — at least in part:* **the entry's premise was wrong.**
It said "the handler's only 500 path is `conversationStore.saveMessage(...)`
throwing, caught at line 249". There was a second path: `const { greeting, imageUrl }
= req.body;` sat **above** the `try`, so a throw there escaped to Express's default
error handler as a 500 that logged **nothing**. That is the only 500 this route
could emit with no `[conversations.POST.hero-shown] Error` line to find — which
fits a 500 seen once and never explained. (Not reachable on Express 4, which sets
`req.body = {}`; `demo_api_server` pins `^4.18.2` and runs 4.22.2. It becomes
reachable on Express 5, where an unmatched parser leaves `req.body` `undefined`.)

*What the fix was:* `demo_api_server/routes/conversations.js` — body read moved
inside the `try` and defaulted (`req.body || {}`), and the catch logs
`err.stack || err.message` instead of `err.message` alone. The next occurrence
names its own cause instead of costing another session.

**RESOLVED 2026-08-18.** The original 500 *does* have a confirmed cause, and it
had already been fixed the day before — the "partly resolved" pass above simply
never connected the two.

*What the issue really was:* `saveMessage` → `_pruneThreadIfNeeded` called
`db.deleteSync(key)`, which the lmdb-js handle does not define (the API is
`removeSync`). The prune only runs once a thread exceeds
`MAX_MESSAGES_PER_THREAD = 500`, and `demouser:retail` had grown past it (the same
oversized thread behind the 84MB store in the `mapSize` entry). So every
hero-shown write triggered the prune, the prune threw
`TypeError: db.deleteSync is not a function`, and the handler's catch turned it
into the 500 seen on **every** dashboard load — not the once-off the "partly
resolved" note assumed. Neither the `me` alias (resolved since July at
`routes/conversations.js:40`) nor the body-above-`try` path (Express 4 sets
`req.body = {}`, so unreachable here) was ever the cause; both were real but
adjacent cleanups.

*Why it "could not be reproduced":* the live-stack probes above all wrote to
*fresh* threads well under the 500-message cap, so the prune branch never ran.
The bug is only reachable on an over-cap thread.

*What the fix was:* `db.deleteSync` → `db.removeSync` at both call sites in
`conversationStore.lmdb.js`, shipped in **PR #1976** (commit `5d92b23fa`,
2026-08-17) with store-level guard `tests/services/conversationStoreDelete.test.js`
— whose own docstring names this exact hero-shown 500. That landed the day before
this entry's investigation, which is why the 500 was already gone by the time
anyone tried to reproduce it.

*What this pass added:* `tests/routes/conversationsHeroShown.test.js` — the
missing **route-level** guard. It drives `POST /api/conversations/me/:vertical/hero-shown`
through the real router + real store and asserts (1) 200 with the greeting
persisted under the resolved `req.user.sub`, never under literal `me`, and (2) a
hero-shown write onto an at-cap thread runs the prune path and still returns 200
— the precise scenario that 500'd pre-#1976. No production code changed: the bug
was already fixed; only the through-the-route regression was uncovered.

The remaining LMDB `mapSize` headroom concern is real but unrelated to this 500 —
see that entry at the top of the file; it is deliberately *not* fixed here.

### [ ] 2026-08-18 — The launcher's sign-in prompt is nearly unreachable, so nothing in the product exercises it

**Where:** `demo_api_ui/src/pages/UseCaseLauncherPage.js` — `ChipLoginPrompt`
(#1952), rendered when `/api/use-cases/demo/run` refuses with `requiresLogin`.

**What's wrong:** the page is `user`-gated, so a signed-out visitor never reaches
it and the customer branch cannot fire. The admin branch needs a signed-in
customer running an `admin` use case, and `UC-NHI2` is the only one in the
catalog — with a `link` trigger, not a chip. Both branches are live code that
only unit tests touch.

**Why not fixed now:** it is correct and costs nothing to keep. Deleting it would
be wrong the moment `/use-cases` opens up or an admin chip is added.

**Real fix:** nothing in the code — but walk this path live before trusting it,
because that will be its first real exercise.

### [wontfix] 2026-08-18 — The MCP handshake is reported by the Node gateway, which is not the gateway in the path

**ACCEPTED / WON'T FIX 2026-08-18 (owner decision).** The handshake is observable
only on the Node gateway path; real traffic goes through IG (PingGateway), where it
is unobservable without a custom Groovy filter — recording it there is a
disproportionate amount of product-path work for the value. Decision: keep the honest
"not visible from here" narrative (#1960) and treat the Node-gateway `X-Gw-Mcp-Handshake`
header as dormant, correct support for the non-default path (live whenever
`mcp_demo_gateway_url` is the active gateway). The existing plumbing stays — do not
delete it. Reopen only if the IG-path handshake becomes worth a Groovy filter.
Original entry follows.

**Where:** `demo_mcp_gateway/src/server/GatewayServer.ts` (the `X-Gw-Mcp-Handshake`
header added in #1977), consumed by `demo_api_server/services/mcpGatewayClient.js`
(`_parseGwMcpHandshake`) and `mcpToolPipeline.js`.

**What's wrong:** #1977 set out to make the MCP lifecycle handshake
(`initialize` → `notifications/initialized`) visible on the gateway path, since
the BFF is not the MCP client there and cannot observe it. The implementation is
correct and tested — and inert, because it was added to the **Node** gateway
while tool calls go to **PingGateway (IG)**:

```
[GW→PingGateway] REQUEST: url=http://ping-gateway:8080/mcp
MCP_GATEWAY_HTTP_URL=http://ping-gateway:8080
```

Verified live: a real `list_orders` call returns `gw-introspection`,
`gw-authorize`, `gw-filter-chain` and the two `mcp_challenge` events, but no
`mcp-initialize` / `mcp-initialized`. The header is never set because the code
that sets it never runs.

The tell was already on screen and went unread: the filter stages rendering in
the chain are `McpValidationFilter`, `McpAuditFilter`, `McpProtectionFilter` —
IG filter names, which #1965 even added labels for. Same shape as putting the
gateway stages in `TraceStepCard`, a component the focus-mode dashboard never
mounts: right code, wrong host.

**Why not fixed now:** IG is a product. It performs the handshake inside
`McpProtectionFilter`/its upstream client, not in code this repo owns, so there
is no `forwardToUpstream` to instrument. Emitting the header from IG means a
Groovy filter in `ping-gateway/scripts/groovy/` that can observe the upstream
session negotiation — a different piece of work from the Node-side change, and
not one to start at the tail of the session that found it.

**What the real fix looks like:** either (a) an IG Groovy filter that records the
upstream `initialize` response and stamps `X-Gw-Mcp-Handshake` in the same place
`transaction-hop.groovy` already posts to the BFF, or (b) accept that the
handshake is unobservable on the IG path and keep the honest "not visible from
here" narrative #1960 added, treating the Node-gateway header as dormant support
for the non-default path. Do not delete the existing plumbing either way — it is
live and correct whenever `mcp_demo_gateway_url` is the active gateway.

**How to check whether it is fixed:** drive a tool call and assert
`mcp-initialize` appears in the returned `tokenEvents` — not that the code exists.

#### Attempt 2 (#2023) — also inert, reverted. Read this before attempting a third.

The second attempt instrumented `ping-gateway/scripts/groovy/olb-token-exchange
.groovy`, which contains an explicit MCP `initialize` call, and folded the result
into `X-Gw-Audit-Trail` via `p1az-decision.groovy` the way `mtlsResult` already
is. It passed unit tests, both Groovy scripts compile-checked against the
gateway's own `groovy-4.0.28.jar`, and it was merged and deployed. Live result:
`mcp-initialize` **absent**.

**That script never runs on this deployment.**

```
docker logs ai-demo-ping-gateway | grep OlbExchange   →  0 lines
```

The tell was already in the live token events: no `gw-mtls` either, and that
comes from the same script. Reading the code proved the call exists, not that it
executes — the same mistake as attempt 1, one layer deeper.

**Two facts the attempt got wrong, which any third attempt must not inherit:**

1. **The handshake IS performed, in full.** `ai-demo-mcp-server` logs
   `initialize`, then `notifications/initialized`, then `lifecycle ready`, on
   short-lived connections that open and close per call. It is a complete
   three-message lifecycle.
2. **`notifications/initialized` IS sent.** #2023 asserted the opposite in a code
   comment, a commit message and this file, and built an `initializedSent: false`
   flag on top of it. Wrong. Do not carry that assumption forward.

**So the client is not the IG filter chain.** The server authenticates each
connection with an agent token over WebSocket (`Agent token validated via
Authorization header for connection <uuid>`). Identify that client from the
connection ids and instrument *there*; do not instrument anything on the basis of
reading a script until a log line proves it executes on a live call.

**And prove it live before merging.** Both attempts were green, reviewed and
merged before anyone drove a real tool call. `npm run test:e2e:real --
chain-hops-reachable` reports this hop under CONFIG_DEPENDENT and takes 30
seconds.

#### Measured 2026-08-18 — where the handshake actually happens

Before attempting a third time, this was traced by driving each leg separately
and reading container logs, rather than by reading code. The result contradicts
both previous attempts AND the correction above.

**The MCP client is `demo_mcp_gateway` — the Node gateway.** Running the
discovery leg alone opened 3 connections on `ai-demo-mcp-server`; running the
tool-call leg alone opened 2, and `ai-demo-mcp-gateway` logged exactly 2
`[GW] tools/list` in the same window. So #1977 targeted the RIGHT service. It was
not the wrong gateway.

**But the handshake rides the discovery leg, not the tool call.** During the
tool-call leg the MCP server saw:

```
2 : initialize
2 : notifications/initialized
2 : tools/list
```

and **no `tools/call` at all**. The lifecycle belongs to tool discovery. Note
this also settles the earlier claim in #2023 that `notifications/initialized` is
never sent — it is sent, on every connection.

**Why #1977 is still inert:** it stamps `X-Gw-Mcp-Handshake` on the Node
gateway's HTTP proxy response (`GatewayServer.ts`, ~line 1045). Discovery does
not use that path — `agentGatewayClient.listAvailableTools` calls `mcpListTools`
with `getMcpGatewayWsUrl()`, i.e. a **WebSocket**. An HTTP response header cannot
reach a WebSocket caller. Right service, right data, wrong transport.

**What a fourth attempt should do:** carry the handshake in the WS `tools/list`
result — the gateway already returns `_meta` there (`_meta.deniedTools`,
`_meta.authzEngine` are consumed today) — and have `listAvailableTools` turn it
into `mcp-initialize` / `mcp-initialized` events beside the existing
`tools_list_success`. The hops then belong to the discovery leg, which is where
the protocol says they belong.

**And they must be modelled as discovery hops, not tool-call hops.** Today
`buildTraceSteps` places `mcp-initialize` between the gateway and the MCP call.
On the evidence above that is the wrong position — the session is opened and
closed during discovery, before any tool call exists.

#### Attempt 3 (#2049) — VERIFIED LIVE 2026-08-18. This entry is closed.

Two halves shipped on that PR:

- **Position (verified).** The hops moved next to `tools-list`, `MCP_STEP_IDS`
  stopped listing them — `TokenTopologyPanel` partitions spine from branch off
  that list, so while they were in it the topology drew the session as part of
  the invocation, the same wrong claim on a second surface — and the narratives
  stopped saying the handshake "happens on every tool call". Guarded by three
  tests, two verified to fail with the reposition reverted.

- **Transport (NOT verified).** `proxy.ts` captures the initialize result it
  already receives and attaches it non-enumerably to the resolved response;
  `index.ts` folds it into the `tools/list` `_meta`; `agentGatewayClient` emits
  `mcp-initialize` / `mcp-initialized` beside `tools_list_success`.

**Verified on the live stack after merge and a gateway rebuild:**

```
[list] 97 tools, events: ["mcp_challenge","mcp_resource_metadata",
                          "mcp-initialize","mcp-initialized","tools_list_success"]
```

Real events from a real run — the thing neither #1977 nor #2023 ever produced.
What made the difference was not better code: it was tracing where the handshake
happens before writing any. Both earlier attempts were argued from reading the
source.

**Do not revert on an ABSENT reading from the invoke leg.** An earlier version of
this entry said to revert if `chain-hops-reachable` printed ABSENT. That
instruction is now wrong, and following it would delete working code. The hops
appear on the DISCOVERY response (`/api/demo-agent/tools`) and are correctly
absent from `/api/agent/invoke`, because the tool-call leg produces no
`tools/call` on the MCP server at all — measured, see above. The spec reports both
legs separately; read the `[list]` line, not the `[hops]` line.

**DECIDED 2026-08-18: shown on discovery, not as hops of its own.** The owner
chose this over carrying discovery evidence forward into the run chain. The
`mcp-initialize` / `mcp-initialized` STEPS are gone; their evidence now hangs off
the `tools-list` hop that caused the session, as `MCP session`, `MCP server` and
`session opened by` rows plus a `handshake` detail block.

Why this and not the alternative: filling the hops from an earlier request makes
the chain look complete, but a viewer reads two cards between the gateway and the
MCP call as a session negotiated for that call. That is the fiction this whole
thread has been removing. Reporting the session on the hop that opened it says the
true thing and adds no card that is blank most of the time.

The step ids are now history in three positions, which is worth knowing before
moving them a fourth time:

| shape | why it was wrong |
|---|---|
| hops between gateway and MCP call | claimed a session per tool invocation |
| hops next to `tools-list` | honest, but blank on any chain built from one invoke response |
| rows on the `tools-list` hop | current |

`TITLES` / `NARRATIVES` / `STEP_RFCS` / `STEP_SPEC` entries for both ids are
REMOVED, along with `TokenTopologyPanel`'s badge rows for them. Keeping them was
argued for at first — the teaching text was good — but retained metadata for a hop
that no longer exists is the same trap as retained code that no longer runs: it
reads as coverage and sends the next reader looking for a step. The MCP lifecycle
teaching moved onto the `tools-list` spec, which is the hop that actually performs
initialize / notifications/initialized, and the removed text is in git history if a
discovery-detail surface ever wants it verbatim.

The token EVENTS are unchanged and still asserted live in
`chain-hops-reachable.real.spec.js` — the gateway still reports the handshake; only
the rendering moved.

### [x] 2026-08-18 — Nothing proves a token-chain hop is reachable on the gateway actually in use

**Where:** `demo_api_ui/src/components/__tests__/FocusModeChainRenders.test.jsx`
(the render guard), and the whole `buildTraceSteps` step model.

**What's wrong:** the guard added on 2026-08-17 closed one hole — it renders the
real focus-mode component tree and asserts the DOM, so a feature can no longer
ship into a component nobody mounts. It cannot catch the sibling failure: a hop
whose EVIDENCE is produced by a service that is not in the request path. The
handshake entry above is exactly that, and the guard passes for it, because the
guard feeds the store a fixture rather than a live run.

Three hops now depend on which gateway is active, and nothing states that
dependency in code: the filter stages (IG and Node emit different chains), the
handshake (Node only), and the 401 challenge (both, via the BFF's own probe).

**Why not fixed now:** the honest check is an end-to-end assertion against a
running stack, and the `*.real.spec.js` Playwright suites that could host it
require `local.ping-devops.com:4000` and therefore never run in CI — which is
why they caught none of this class today.

**RESOLVED 2026-08-18** — `demo_api_ui/tests/e2e/chain-hops-reachable.real.spec.js`.
Two tests, run deliberately (`npm run test:e2e:real -- chain-hops-reachable`):
one drives a tool call via `/api/agent/invoke` and asserts `mcp_challenge`,
`gw-authorize` and `gw-filter-chain`; the other drives discovery via
`/api/demo-agent/tools` and asserts the `tools/list` challenge plus
`degraded === false` (the shape #1949 took). Hops that depend on which gateway is
active are reported, never asserted, so the check does not encode today's
deployment. Verified green live, 97 tools discovered.

Two things had to be true for it to be worth anything, and both were measured:

- It asserts only ids the preview fallback cannot synthesize.
  `buildSessionPreviewTokenEvents` emits `user-token` / `exchange` /
  introspection when the real chain fails to resolve, so an assertion on those
  passes on a stack with no working gateway at all.
- Run against the Inspector route — which passes `forceDirectMcpAudience: true`
  and bypasses PingGateway — the same request returned 12 token events, the
  entire two-exchange chain, and **none** of the three asserted ids. The
  assertions discriminate.

Still true, and the reason this is a smoke check rather than a CI gate: it needs
`local.ping-devops.com:4000`, so nothing runs it automatically. A chain hop that
passes unit tests is still evidence about the model, not about what a demo will
show — run this before believing otherwise.

### [x] 2026-08-18 — A piped verification command reports the pipe's exit code, so a failed deploy reads as success

**Where:** every `./scripts/deploy-live.sh ... | tail`, `npm test | grep`,
`npx jest | tail` invocation — agent-run and human alike.

**What's wrong:** `cmd | tail` exits with tail's status, not `cmd`'s. A
`deploy-live.sh` run that aborted mid-way with exit 1 was read as exit 0 because
the output was piped; the only reason it was caught is that the deploy stamp had
not advanced. Every "verified, exit 0" claim made through a pipe is unfounded,
and the failure mode is silent by construction.

This is the same shape as the entries above it — a check that cannot observe the
thing it checks — but it applies to the act of verifying itself, so it
invalidates other evidence rather than one feature.

**Why not fixed now:** it is a habit encoded in commands, not a line of code to
change. `set -o pipefail` fixes scripts in the repo but not the ad-hoc
command that reads their output.

**Real fix:** two parts. (1) `set -o pipefail` at the top of every script under
`scripts/` that runs a subcommand whose failure should matter — `deploy-live.sh`
already has `set -euo pipefail`, most helpers do not. (2) A stated rule in
`CLAUDE.md`'s verification section: capture to a file and grep the file, or check
`${PIPESTATUS[0]}` — never conclude from a piped command's status. Cheap to
state, and it retires a whole class of false green.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`), with a
deliberate scope reduction — read the audit before assuming the whole class is
retired.**

*What the issue really was:* the mechanism is exactly as the entry describes, but
its premise about the blast radius was measurably wrong. It says "`deploy-live.sh`
already has `set -euo pipefail`, most helpers do not". Audited all 39 scripts
under `scripts/` for a `set -` line **anywhere in the file**, not just near the top:

- **30 already set `pipefail`** — including `deploy-live.sh`, as the entry said.
- **9 do not.** Of those, only 4 declare `set -e` at all — so only those 4 are
  scripts where "a subcommand's failure should matter" is already the author's
  stated intent.

This was never a 39-script problem. It was a 4-script problem plus a habit.

*What the fix was — part 1, the scripts:* added `-o pipefail` to the three that
declare `set -e` and carry a pipeline whose first stage matters:

- `scripts/load-secrets-docker.sh` — the real one. `op item get … | jq …`: when
  `op` fails, `jq` reads empty input, succeeds, and the script continues with no
  secrets loaded and exit 0.
- `scripts/install-hooks.sh`, `scripts/install-master.sh`.

**Deliberately not changed, and why:** `scripts/render-diagrams.sh` also has
`set -e`, but line 20 is `FLOWS=$(ls …/*.mmd 2>/dev/null | wc -l | tr -d ' ')` — a
deliberately tolerant `ls` whose failure is the normal "no diagrams" case.
`pipefail` there converts a supported state into an abort: a behaviour change
disguised as hardening. The other five (`demo-terminal.sh`, `llm-warmup.sh`,
`pac-common.sh`, `ping-email.sh`, `preflight-demo.sh`) do not set `-e`, so
`pipefail` would change nothing except the `$?` of pipelines whose status nothing
reads — and `pac-common.sh` is **sourced**, so a `set` in it leaks into the
caller's shell. Blanket-applying the entry's "every script under `scripts/`"
would have been wrong in six places.

*What the fix was — part 2, the habit:* added the rule to `CLAUDE.md`'s "Before
claiming done" section as its own numbered step. The entry is right that the
scripts are the smaller half — the ad-hoc `cmd | tail` an agent types to read a
script's output is not fixed by anything inside the script.

### [x] 2026-08-18 — A fresh worktree cannot verify anything, and every failure mode looks like a pass

**FIXED 2026-08-18 (PR #2071, merged).** `run-tests.sh` had three points
(`run_api_tests`, `run_ui_vite_smoke`, `run_e2e_tests`) that silently ran
`npm install` when `node_modules` was absent — the exact "stray toolchain
masquerading as a clean run" trap. Replaced all three with a shared
a shared `require_toolchain` guard that refuses with a clear message
("refusing to verify: SERVICE/node_modules is missing — run npm ci in SERVICE
first") and exits non-zero when the service's `node_modules` or the specific
`node_modules/.bin/<tool>` is missing; the Playwright probe now uses
`npx --no-install` so a missing local tool errors instead of downloading a stray
one. Verified end-to-end: a fresh worktree running `run-tests.sh unit` now refuses
and exits 1 instead of silently proceeding. (Covers the run-tests.sh path; ad-hoc
`npx jest`/`npx tsc` typed directly in a shell are still on the operator — the
`verify-ai-demo2` skill documents that.) Original entry follows.

**Where:** any worktree created without `npm ci` in the service being changed.

**What's wrong:** three different false signals, all observed in one session:

- `npx tsc --noEmit` with no local TypeScript silently downloads one and reports
  "No errors found" — a typecheck that never used the project's tsconfig or its
  types. `npm run build` immediately after said `tsc: command not found`.
- `npx jest` with no local jest fetches a stray one and dies in babel, which
  reads as a broken test rather than a missing toolchain.
- `jest` reporting `Cannot find module 'argon2'` for a cross-package import is a
  missing dependency, not a failing test — but it counts as a failed suite, and
  under `SUITE_BLOCKING=1` it fails the gate.

The `verify-ai-demo2` skill documents the jest case. Nothing catches the tsc one,
which is worse because it produces a confident false positive rather than an
error.

**Why not fixed now:** found while doing something else each time, and the
workaround (`npm ci`, wait ~90s) is known once you have been bitten.

**Real fix:** a preflight in the repo's verify scripts that fails loudly when
`node_modules` is absent in the target service — "refusing to verify: run
`npm ci` in that service first" — so a missing toolchain can never be mistaken
for a clean run.
`npx --no-install` would also turn the silent-download cases into an explicit
failure.

### [x] 2026-08-18 — `groupsForUser` cannot tell a caller whether it answered live or from the manifest

**Where:** `demo_api_server/services/groupPolicy.js` — `groupsForUser()` /
`groupsForUserSync()`; correct handling in
`routes/groupMembership.js` (`source: 'pingone' | 'manifest'`).

**What's wrong:** `groupsForUser(username, verticalId, {})` falls back to
manifest data when no `pingOneUserId` is supplied, and returns a bare array. The
caller cannot distinguish "this user IS in AI_Demo_Privileged, live" from "the
manifest says users like this are". Called without the id, it returned
`["AI_Demo_Privileged","Banking_PremiumTier"]` for a user the live directory
reported as being in ZERO groups — and that manifest answer was reported as
verified live membership before enabling `ff_authorize_group_policy`.

The decision-board route already solves this: it does the live lookup and stamps
each row `source`. The service underneath does not, so every other caller can
make the same mistake.

**Why not fixed now:** the callers that matter for the group demo happen to pass
`pingOneUserId`, so nothing is currently wrong in production behaviour — only in
what a caller (or an operator reading a probe) can safely conclude.

**Real fix:** return `{ groups, source }` from `groupsForUser` as the board route
already does internally, and make the manifest path impossible to mistake for a
directory read. `project-group-policy-provision-before-flag` in memory says "live
lookup beats manifest" for exactly this reason; the API should enforce it rather
than rely on the caller remembering.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* the entry called this a reporting gap — "only in what
a caller can safely conclude" — and said "nothing is currently wrong in production
behaviour, the callers that matter happen to pass `pingOneUserId`". Auditing every
caller in order to change the return shape showed that was not true. There are
four callers and the fourth is broken:

```js
// services/enterpriseMcpPolicyService.js:64, inside the SYNCHRONOUS demoGroupsForUser()
const fromPolicy = groupPolicy.groupsForUser(username);   // async — returns a Promise
if (fromPolicy.length) return fromPolicy;                 // Promise.length === undefined
```

`groupsForUser` is `async`, so `fromPolicy` is a Promise, `.length` is `undefined`,
the branch is **never** taken, and the manifest fallback this function exists to
provide has never once fired — it drops to the `getAllowedGroups()` username match
instead. That is the entry's own thesis proving itself: an async array-returning
helper is easy to misuse in a way nothing observes. It stayed invisible because
both the right and the wrong answer are "some array".

*What the fix was:* the entry's stated fix.

- `services/groupPolicy.js` — `groupsForUser()` now returns `{ groups, source }`,
  `source` being `'pingone'` for a real directory read and `'manifest'` for the
  vertical manifest's claim about users like this one. The two no longer share a
  shape, so a caller cannot silently conflate them. `groupsForUserSync()` is
  unchanged: its name already says manifest-only and it is the honest choice on a
  path with no PingOne id.
- Destructured at the three real callers — `mcpToolAuthorizationService.js:779`,
  `mcpToolPipeline.js:948`, `agentPreflightService.js:348`. Behaviour identical.
- `enterpriseMcpPolicyService.js:64` switched to `groupsForUserSync(username)`,
  which is what that synchronous function meant all along. **This is a real
  behaviour change:** the manifest branch can now fire where it previously could
  not. It affects only the demo fallback taken when the PingOne Management API is
  unavailable.

Kept the "an empty array from a *successful* live call still wins" rule and wrote
it into the code as a comment, because `docs/LIVE-PINGONE-RUNBOOK.md:108` depends
on it: enable `ff_authorize_group_policy` before the groups exist and "no gate"
becomes "a gate that denies everyone".

### [x] 2026-08-18 — Shared jest automocks let an assertion pass on a different test's call

**RESOLVED 2026-08-18 (branch `worktree-test-trust`).** `clearMocks: true` is
now set in `demo_api_server/jest.config.js` (mockClear before every test —
call HISTORY cleared, implementations preserved), with the leak story in a
comment at the flag. The predicted fallout did not materialise: the full suite
ran 820/820 suites / 9852 tests green on the first flip — the one known bad
instance had already been repaired in place, and no other test depended on
leaked history. The class conversion is what matters: an assertion against a
call another test made now FAILS loudly instead of passing silently, which is
the only way the next instance gets found. Original entry follows.

**Where:** `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js`
(fixed there); the pattern is repo-wide wherever a module-level `jest.mock()`
is asserted against without `mockClear`/`mockReset`.

**What's wrong:** automock state persists across tests in a file. A test
asserting `expect(configStore.setRaw).toHaveBeenCalledWith({...})` passed because
an EARLIER test in the same file had made that call — the behaviour it claimed to
cover never ran. Its `.mockRejectedValueOnce` was likewise queueing behind
`*Once` values other tests left unconsumed, so the self-heal branch it existed to
exercise frequently never executed. It passed in isolation and passed in the
suite, while proving nothing.

Found only because a change made the assertion fail; a test that passes for the
wrong reason is invisible until something disturbs it.

**Why not fixed now:** the one instance found was repaired in place
(`mockReset()` before queueing, `mockClear()` before the assertion). Auditing
every automock assertion in ~800 suites is its own pass.

**Real fix:** set `clearMocks: true` (or `resetMocks`) in `demo_api_server`'s
jest config so call history cannot leak between tests, then fix the fallout. That
converts this class from "silently passing" to "loudly failing", which is the
only way to find the rest.

### [x] 2026-08-18 — UI probes have no settle contract, so "the page renders nothing" is unreliable

**Where:** ad-hoc Playwright scripts driving the live stack; the recipe lives in
memory (`playwright-live-ui-drive-recipe`), not in the repo.

**What's wrong:** two false findings from one session. A route was reported as
rendering blank — 0 characters, 0 buttons — because the probe sampled before
React settled; with a longer wait it rendered 1381 characters and 16 buttons. And
a signed-call verification produced no tool call because the probe submitted a
retail phrase while the session had resolved to the banking vertical, so nothing
matched and the absence of gateway traffic was nearly read as "the fix did not
work".

Neither is a product bug, and both are the same mistake: a probe whose negative
result is indistinguishable from a broken feature. `networkidle` never fires here
because the app holds SSE open, so every script invents its own wait.

**Why not fixed now:** each probe was written for one question and discarded. The
knowledge exists in memory but nothing in the repo carries it, so the next
session re-derives it — and may not notice when a too-short wait produces a
finding.

**Real fix:** a small committed helper under `scripts/` or `demo_api_ui/tests/`
that owns sign-in (the BFF redirect, since the top-nav button is 0x0 headless),
the settle strategy (fixed wait plus a content assertion, never `networkidle`),
and active-vertical resolution — so a probe asserts it reached a usable page
before reporting what it did or did not find.

**RESOLVED 2026-08-26 (branch `worktree-ui-probe-settle-contract`).**
`demo_api_ui/tests/e2e/helpers/uiProbe.js` — `settle()`, `activeVertical()`,
`requireVertical()`.

Sign-in is NOT in it: `realLogin.js` (same directory) already owned the BFF
redirect, so the helper covers only the two halves that were actually missing.

The load-bearing design decision is that **everything throws rather than
returning a falsy value.** A helper that returned `{chars: 0}` would reproduce
false finding #1 exactly — that zero is what got written up as "the route renders
nothing" for a page that in fact renders 1381 characters and 16 controls. The
`ProbeNotSettled` message says in words that it is not a finding about the page,
and names what it needed versus what it last saw. `requireVertical` does the same
for false finding #2, naming both the assumed and the resolved vertical, because
a phrase submitted into the wrong vertical matches nothing and the missing tool
traffic is indistinguishable from a broken feature.

Settle is a floor PLUS a quiet period, not a single threshold check: React renders
in bursts, so one sample over the floor can be a mid-burst frame that then changes
again. Pinned by a test that walks 0 -> 400 -> 900 -> 1381 chars and requires the
final value.

`networkidle` is called out at the top of the file as never usable here — the app
holds SSE open for the session, so it burns its timeout. That is why every ad-hoc
script invented its own wait and why they disagreed with each other.

Evidence: `demo_api_ui/src/__tests__/uiProbe.test.js` — 10 tests, `page`
duck-typed with scripted samples so the real helper runs with no browser. The
spec lives under `src/` because `vite.config.js` excludes `tests/e2e/**` from
vitest; had it sat beside the helper, nothing would have run it. RED-proven twice:
returning the measurement instead of throwing fails 4, and settling on the first
over-threshold frame fails the burst test. Full UI gate green — 3473 unit tests
passed (435 files), `npm run build` exit 0.

`demo_api_ui/CLAUDE.md` now carries the usage, so the next session finds it
without re-deriving it from memory. Pairs with `npm run stack:generation` from the
2026-08-19 live-drive entry: one answers "did the page render", the other answers
"was it still the same stack".

### [x] 2026-08-18 — The group-policy board cannot produce a PERMIT, so the demo it exists for cannot be shown

**Where:** `demo_api_server/routes/groupMembership.js` (`GET /api/groups/decision-board`)
→ `agentMcpTokenService.resolveMcpAccessTokenWithEvents(req, tool)`.

**What's wrong:** the board's premise is "change the membership below and every
row moves with it". Membership now demonstrably moves — `inRequiredGroup` flips
`false → true` across all 13 rows when the toggle runs — but no decision moves
with it. Every row stays `DENY` on `mcp-invalid-audience`.

The cause is one layer below the board. Each row mints the token the PEP would
present (#1972) so the decision is asked with real evidence rather than a
fabricated audience. That mint SUCCEEDS — it returns a token — but
`decodeJwtClaims(token).aud` yields nothing, so no audience is presented and the
PDP fail-closes on audience before the group rule is ever reached. Deduction, not
guesswork: `tokenError` stays null on exactly one code path, the one where
`minted.token` is truthy.

Three fixes deep on this surface already, each exposing the next: a 429 burst
(#1969) hid the audience deny, the audience deny hid the empty-`aud` mint
(#1972), and the mint hid its own reason (#1976, #1983). What remains is why a
successfully minted MCP token carries no readable `aud`.

**RESOLVED 2026-08-18 (PR #2015) — and the diagnosis above was WRONG.** The
mint was never the problem. `decodeJwtClaims` returns `{ header, claims }`, not
the claims; the board read `.aud` straight off it, so the audience was always
`undefined` for a perfectly good token. Every other caller in `routes/` already
unwrapped `.claims` — this was the one that did not.

The deduction recorded above ("`tokenError` stays null on exactly one code
path") was sound reasoning applied to a symptom the instrumentation had
manufactured. `groupDecisionBoardToken.test.js` mocked `decodeJwtClaims` with a
flat `{ aud }` — the only one of 21 suites to do so — so the test asserted the
same misreading as the code and stayed green. That is the durable lesson here:
green meant "the test and the route agree", not "the route is right".

Verified live, signed in as `demoUser` on the real stack: 13 rows, every one
`tokenPresented: true` with no `tokenError`, and **`mcp-invalid-audience` absent
from every row** — it had previously denied all 13. Two rows now PERMIT
(`HITL,mcp-tool-authorized`).

**Newly visible underneath it, then ADDRESSED 2026-08-18 (PR #2017):** with
`inRequiredGroup: true` on all 13 rows, 11 denied on
`mcp-invalid-a2a-generalist`. Authorize's `DenyA2aDelegationRequired` rule
denies `ActChainDepth < 2` for exactly the tools flagged `a2aDelegated` in
scope-topology — verified: the 10 flagged tools are precisely the ones that
denied, and the 2 unflagged ones are the 2 that PERMITted. The board minted a
one-hop token, so those rows denied on delegation shape and never reached the
group rule; membership could not move them.

Those rows now mint through `a2aDelegationService.delegateToSpecialist()` — the
same chain the real call path uses — keyed on the scope-topology flag rather
than the tool-name list in `pac/policies/mcp-delegation.yaml`, so the two cannot
drift apart silently.

**`ff_a2a_delegation` defaults to `false`**, so the fallback is the DEFAULT path,
not an edge case: the row is probed with the one-hop token (keeping the
informative `mcp-invalid-a2a-generalist` verdict rather than the
`mcp-invalid-audience` you get by presenting nothing) and `tokenError` states
that delegation was unavailable and why.

**Not verified live with the flag ON.** The flag-off path is confirmed on the
real stack; the delegated branch is unit-tested only. The admin
feature-flag endpoint now requires a bearer token, and flipping a live demo flag
is the operator's call, not something to route around an auth gate for.

### [x] 2026-08-18 — A caller token whose scopes miss the backend can never call it, and the error names the wrong cause

**FIXED 2026-08-18 (PR #2059, merged + deployed) — deny with a clear caller-facing
reason (owner's decision).** Rather than change the request (the round-1 trap that
broke two tested contracts), a shared helper
`scopeMismatchReasonFromExchangeError()` maps PingOne's `invalid_scope: multiple
resources` response — gated on that signature AND a confirmed-empty
subject∩backend intersection so it never mislabels other failures — into the
caller-facing response on BOTH transports (HTTP + WS). Same envelope, now with
`data.reason: "scope_mismatch"`, `data.subject_scopes`, `data.backend_scopes`,
`data.backend`, and a message naming both sets, so the caller learns the cause from
the response instead of a gateway log. `exchangeForBackend` is untouched, so the two
deliberate contracts hold — confirmed passing in isolation: "sends no scope without
the flag — the tools/call path is unchanged" and the cache-isolation test. Full
gateway suite 755 passed. Original entry follows.

**Where:** `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts` —
`exchangeForBackend`, the `requestScopes.length === 0` case.

**What's wrong:** on the call path the requested scope is `subject scopes ∩
target-resource scopes`. When that intersection is empty the exchange goes out
with `scope=` omitted, and PingOne rejects it with `invalid_scope: May not
request scopes for multiple resources` — an error about resource ambiguity that
names neither the caller's scopes nor the backend's. Observed live as a recurring
error-level failure on every `sensitive_order_history` call: a token carrying
`purchase:read` against `backend=olb` (`mcpserver.ping.demo`), which accepts 27
scopes, none of them that one.

A pre-flight warning naming both scope sets now precedes it (#1983), so the cause
is diagnosable — but the underlying condition stands: those tool calls cannot
succeed, and the only signal is a log line.

**Why not fixed now:** the scope-less request is deliberate and tested
(`sends no scope without the flag — the tools/call path is unchanged`) —
inventing a scope the caller does not hold would manufacture authority. Making it
fail locally instead broke that contract plus a cache-isolation test; rewriting
those to fit would have been making the evidence match the conclusion. The defect
that could be fixed without touching the contract — diagnosability — was.

**Real fix:** decide whether these tools are meant to be reachable by such
callers. If yes, grant the scope or add it to the resource's `mirroredScopes` in
`scope-topology.json`; if no, deny at the gateway with a scope-mismatch reason so
the caller learns it from the response rather than from a gateway log.

### [~] 2026-08-18 — `olb` tools/list times out; its tools vanish from the catalog and callers see "tool not found"

**INSTRUMENTED 2026-08-18 (PR #2054, merged + deployed) — root cause not yet
diagnosed (not reproducible on demand).** Investigation ruled out the pool-exhaustion
hypothesis: `proxy.ts::proxyJsonRpc` opens a fresh WebSocket per request — there is no
connection pool and `MCP_WS_MAX_CONCURRENT` does not exist in the codebase. The
timeout is `HANDSHAKE_TIMEOUT_MS = 10_000` and fires only when the socket OPENED but
`initialize` went unanswered for 10s (a never-opening socket trips the 30s call
timeout — a different message). Added structured, greppable diagnostics on the
failure path: the timeout rejection now carries `code: 'handshake_timeout'`,
`timeoutMs`, `elapsedMs`, `connectMs`; `formatToolsListBackendFailure()` emits one
line keeping the `tools/list failed for backend=<id>` prefix plus
`reason=… timeoutMs=… elapsedMs=… connectMs=… attempts=1 pool=none(fresh-ws-per-request)`.
No retry added (it would mask the signal and add ~10s + load to a struggling
backend). So the next occurrence produces data to correlate with mcp-server
restarts/cold starts. `[~]` = instrumented, not cured. Original entry follows.

**Where:** `demo_mcp_gateway/src/index.ts` tools/list fan-out; backend `olb`
(`mcpserver.ping.demo`, WebSocket).

**What's wrong:** `[GW] tools/list failed for backend=olb: MCP handshake timeout`
recurred 5 times in 45 minutes while every other backend answered. That backend's
tools are then simply absent from the merged catalog, so an agent asking for one
gets "tool not found" rather than "backend down".

`/health` now reports partial outages (#1980) — before that it actively CLEARED
the signal whenever any backend answered, so this read as healthy. Visibility is
fixed; the timeout itself is not diagnosed.

**Why not fixed now:** the visibility gap was the reportable defect and was
fixable in one place. Why the `olb` WebSocket handshake intermittently times out
is a separate investigation into that backend's startup/liveness, and it was not
reproducing on demand.

**Real fix:** instrument the handshake path with the timeout value and elapsed
time, and establish whether it correlates with mcp-server restarts, cold starts,
or connection-pool exhaustion (`MCP_WS_MAX_CONCURRENT`).

### [x] 2026-08-18 — Intent tokens cannot be validated on the Node gateway path (`no_signing_key`)

**FIXED 2026-08-18 (PR #2055, merged + deployed) — was a deploy-wiring gap, not a
missing key.** Investigation: the BFF signs intent tokens HMAC-SHA256 with
`INTENT_TOKEN_SECRET || SESSION_SECRET` (`intentTokenService.js`); PingGateway
verifies with the same secret (`p1az-decision.groovy`) and reports
`IntentTokenValid:true` because `refresh-service-envs.js` writes that secret into
`ping-gateway/.env`. The Node gateway's validator (`intentTokenValidator.ts`) already
read the SAME `INTENT_TOKEN_SECRET || SESSION_SECRET` — it was simply never written
into `demo_mcp_gateway/.env`, so `getSigningKey()` threw `no_signing_key`. The fix is
one line in the env writer: emit `INTENT_TOKEN_SECRET` to the gateway `.env` verbatim
in the same form as ping-gateway (no new secret, no rotation, no value committed —
the existing symmetric secret is already shared to PingGateway by design). Regression
guards: `src/__tests__/refreshServiceEnvs.intentSecret.test.js` now covers the gateway
block; `intentTokenValidator.test.ts` adds no-key / SESSION_SECRET-fallback /
wrong-key cases. **Effective when** the gateway `.env` is regenerated
(`refresh-service-envs`) and the container restarts; still latent behind
`ff_mcp_gateway_pinggateway` (Node path off by default). **How to confirm:** flip to
the Node path and assert `IntentTokenValid:true` in the `gw_audit_trail`. Original
entry follows.

**Where:** `demo_mcp_gateway` intent-token validation; visible in every
`gw_audit_trail` from that path as
`IntentTokenValid: "false", IntentTokenError: "no_signing_key"`.

**What's wrong:** the Node gateway cannot verify intent tokens at all — it has no
signing key — so `IntentTokenValid` is always false there. The same call through
PingGateway reports `IntentTokenValid: "true", IntentMatchesTool: "true"`, so the
token itself is fine; only this path cannot check it.

`INTENT_TOKEN_REQUIRED` is declared fail-open on `/health`, so this is disclosed
rather than silent, and nothing is currently bypassed because MCP traffic routes
through PingGateway in the compose stack. It becomes live the moment
`ff_mcp_gateway_pinggateway` flips to the Node path.

**Why not fixed now:** found while auditing for silent failures, and the
enforcement posture is already published — this is a latent gap, not an active
bypass. Provisioning a signing key for the gateway is its own config change.

**Real fix:** give the Node gateway the intent-token signing key (or the JWKS to
verify against), then confirm `IntentTokenValid: true` on that path before
anyone flips the routing flag.

### [x] 2026-08-18 — Testing against the live stack requires editing the shared checkout, and the guardrail only covers two tools

**Where:** the worktree rule in `CLAUDE.md`, the `Write`/`Edit` hard-block hook,
and `docker-compose.yml` — which bind-mounts the SHARED checkout into
`demo-api-server` and friends.

**What's wrong:** two rules collide. Edits must happen in a worktree because
concurrent sessions share one index; but Docker serves the shared checkout, so
the only way to exercise a change against the running stack is to put it there —
which backs off `sync-main-checkout.sh` and stops every other session's deploys.

Four sessions hit this in one day. The hard-block hook covers `Write`/`Edit`;
a peer session reported reaching the same file through a `python3` heredoc via
Bash with no prompt, so the guardrail constrains the obvious path while the
workflow supplies a reason to find another.

Recovery is also non-obvious: restoring the file from `origin/main` is NOT enough
once main has moved past the checkout's HEAD — it stays dirty until the
checkout's own HEAD blob is written (`git show <checkout-HEAD-sha>:<path>`).

**Why not fixed now:** this is a workflow/tooling decision for the repo owner,
not a code change to make unilaterally — and tightening the hook to cover Bash
writes would harden the workaround without removing the reason for it.

**RESOLVED 2026-08-18 (PR #2009).** `npm run serve:worktree here` points the
running stack at the calling worktree: `--project-directory` stays on the main
checkout so all 37 `env_file` entries still resolve, and only the two source
mounts move (`ui` and `demo-api-server` are the only services that bind-mount
source). No argument prints which checkout each container is actually serving;
`main` hands it back. Verified live end to end — repointed, proved the container
read the worktree's files and Vite served its `src`, confirmed the BFF kept its
178 env vars, then handed back.

Deliberately NOT a per-worktree parallel stack: OAuth `redirect_uri` values are
registered per port in PingOne, so a second stack on another port cannot sign in
until someone edits the PingOne app. One stack with a visible owner is the shape
that works.

**Still true:** the hard-block hook covers `Write`/`Edit` only, and a `python3`
heredoc via Bash still reaches the shared checkout. That is now a gap without a
motive rather than a gap with one — the reason to go around the guardrail is
gone. Original framing follows.

**Real fix:** give sessions a sanctioned way to test against the running stack
without touching the shared tree — a compose override or scratch bind-mount
pointing at the requesting worktree. Two supporting fixes already landed:
`deploy-live.sh` now compares against what was last deployed rather than the
checkout SHA against itself (#1944), so a correct post-merge deploy is one
command; and `npm run sync:status` names the blocking files, though only if you
think to run it.
### [x] 2026-08-18 — 687 error-level lint findings, 455 of them false, hiding the real ones

**RESOLVED 2026-08-18 (branch `worktree-trustworthy-gates`).** Error count at
resolution time had grown to 731; after the fix it is **0** (295 warnings). The
`no-undef` mass turned out to be entirely `vi` (480) + `globalThis` (6) — the
entry's diagnosis held. Fix in `package.json#eslintConfig`: `env.es2020` (for
`globalThis`), a test-file override (`__tests__`, `*.test.*`, `setupTests.js`,
`test-utils`) declaring `vi` and demoting the `testing-library/*` +
`jest/no-conditional-expect` style rules to `warn`; `import/first` demoted to
`warn` globally (ESM imports hoist — stylistic, not a crash); and
`jest/valid-expect` OFF for test files because vitest legitimately supports the
two-arg `expect(value, message)` form the jest plugin flags. Error-level now
means "this line throws at runtime" and is worth gating on. The two real
production errors the original entry found (`AIAgent.js` `handleSubmit`) were
already fixed in that incident; zero real `no-undef` remained. Original entry
follows.

**Where:** `demo_api_ui` ESLint config — no test-environment globals declared
for the vitest specs or `src/setupTests.js`.

**What's wrong:** `npx eslint src` reports **687 error-level findings**. The
breakdown:

```
455  no-undef                                 <- almost all vitest globals
 48  testing-library/no-node-access
 39  testing-library/prefer-screen-queries
 35  testing-library/prefer-find-by
 32  testing-library/render-result-naming-convention
 28  import/first
```

The `no-undef` mass is `describe`, `it`, `expect`, `vi`, `globalThis` in test
files and `setupTests.js` — all genuinely defined at runtime. They are config
gaps, not bugs. But they are reported at the same severity as a real one, and
they outnumber the real ones roughly 200:1.

The consequence is not hypothetical. `AIAgent.js` contained

```js
handleSubmit({ agentMode: agentMode || 'helix' })
```

where neither identifier existed anywhere in the file — a guaranteed
`ReferenceError` on every MCP-tools selection. ESLint had been reporting both as
`no-undef` **errors** the whole time. They were dismissed repeatedly across a
long session as "the pre-existing baseline" because the *count* never changed,
and nobody read the contents of a 687-line error list. It was found by reading
the list line by line, not by the tooling surfacing it.

Two real production errors sat inside 455 false ones. That is a signal-to-noise
problem, not a discipline problem — no reviewer reliably reads 687 lines to find
2.

**Why not fixed now:** the fix touches the shared ESLint config for the whole UI
package, which affects every contributor's editor and any lint gate in CI. It
was found mid-incident while fixing an unrelated defect, and changing lint
severity across the package during that would have obscured which findings the
fix was responsible for.

**What the real fix looks like:** declare the test environment so the false
`no-undef` mass disappears — an `env: { 'vitest-globals/env': true }` override
(or equivalent `globals` block) scoped to `**/__tests__/**`, `**/*.test.*` and
`setupTests.js`. Once the count reflects reality, `no-undef` is worth gating on
in CI, because in this codebase it means "this line throws at runtime." The
`testing-library/*` and `import/first` findings should be triaged separately —
they are style, and reporting them at `error` alongside a crash is part of what
flattened the signal.

### [ ] 2026-08-18 — Agent tests pass `user` at first render, so a whole class of auth-timing bug is invisible

**FURTHER 2026-08-18 (branch `worktree-test-trust`):** the hydrating harness is
now a SHARED util — `demo_api_ui/src/test-utils/renderAgentHydrating.jsx`
(component passed in so each spec keeps its own vi.mock graph) — and
`AIAgent.protectedStepLogin.test.jsx` consumes it. Remaining: converting the
other AIAgent specs to hydration-first mounts.

**PARTLY RESOLVED 2026-08-18 (branch `worktree-trustworthy-gates`).**
`AIAgent.protectedStepLogin.test.jsx` now has `renderAtHydrating(path)` —
mounts `user={null}` (the window every real load has), returns
`resolveSession(user)` to land the session, so assertions can run inside the
hydration window — and `renderAt` carries the entry's requested warning comment
naming #1963 and pointing at the hydrating helper. The existing
"waits for the session instead of firing during hydration" spec was converted
to it. STILL OPEN: hydration-first is not yet the DEFAULT across the other
AIAgent specs — each still mounts with `user` resolved; converting them (or
lifting the helper into a shared test util) is the remaining work. Original
entry follows.

**Where:** `demo_api_ui/src/components/__tests__/AIAgent.*.test.jsx` — the shared
harness, e.g. `renderAt(path, user = null)` in
`AIAgent.protectedStepLogin.test.jsx:166`, which mounts `<AIAgent user={user} …>`
with the user already resolved.

**What's wrong:** in the real app `user` arrives asynchronously. `isLoggedIn`
is `!!(user || sessionUser)`, both resolved after mount, so there is a window
on every load where the component is mounted and signed-out-looking before the
session lands. Effects fire in that window, and the OAuth return is *the* moment
it matters. The harness never creates that window, so any defect that lives in
it is unreachable from the suite.

This is not theoretical. On 2026-08-17/18 the queued-question resume defect
(#1963) was shipped as fixed **three times** against a green suite. Each round
the tests passed because they encoded an ordering that never happens in a
browser. The measurement that finally found the cause had to be taken in the
running app. A test added afterwards (`waits for the session instead of firing
during hydration`) reproduces it only by rendering `user={null}` first and then
re-rendering with a user — nothing about the default harness suggests that is
the load-bearing detail.

**Why not fixed now:** each fix was scoped to one defect on a REGRESSION_PLAN
§1 surface, mid-incident, and re-shaping the shared harness would have changed
every agent spec at the same time. Doing it while the underlying bug was still
unidentified would also have meant changing the instrument and the subject in
the same step.

**What the real fix looks like:** make the async arrival the default. A
`renderAtHydrating()` helper that mounts with `user={null}` and flips after a
tick, used by any spec touching auth-dependent effects — so the hydration window
exists unless a test opts out, rather than existing only when someone remembers
to build it by hand. At minimum, a comment on `renderAt` saying what it does not
simulate.

### [x] 2026-08-18 — `GET /api/mcp/inspector/tools` is unauthenticated, and the UI grouping implied otherwise

**Where:** `demo_api_server/routes/mcpInspector.js:382` (`router.get('/tools')`),
mounted at `demo_api_server/server.js:1190` (`app.use('/api/mcp/inspector', …)`).

**What's wrong:** neither the route nor the mount carries auth middleware.
Measured against the running stack:

```
curl -sk -o /dev/null -w "%{http_code}" https://api.ping.demo:3001/api/mcp/inspector/tools
200          # no cookie at all
```

The full MCP tool inventory is readable by anyone who can reach the API host.
That may well be intended for a demo — but nothing states it, and the UI
actively implied the opposite by filing "MCP Tools" under `ACTION_GROUPS.admin`,
where the whole group is stripped for non-admins. So the control read as
admin-gated while the data was public, and #1978 opened the UI on the grounds
that it was hiding something already reachable.

The risk is the inverse of the usual one: a reviewer looking at the UI
concludes access is restricted and does not check the endpoint. If the tool
inventory should in fact be restricted, the fix is on the server and the UI
grouping was never protection.

**Why not fixed now:** #1978 was a role-visibility change. Adding auth to a
route that many surfaces already call unauthenticated is a behavioural change
needing its own blast-radius check, and this is a demo where a readable tool
list is plausibly deliberate.

**What the real fix looks like:** decide explicitly, then make the code say so.
Either add the middleware and let the UI grouping mean what it looks like, or
leave it open and note on the route that it is intentionally public so the next
reader does not infer protection from the chip's placement. Generally: UI
grouping is not an authorization boundary and should not be read as one.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-batch2-0818`) — decided, not
gated.**

*The decision:* leave the endpoint open. It is a demo whose point is showing the
tool surface, several callers already reach it without a session, and adding
middleware to a route that many surfaces call unauthenticated is a behavioural
change with no security benefit here — the inventory is names and JSON schemas,
no execution and no account data.

*What the issue really was:* not the openness. It was that **nothing said so**,
while the UI actively implied the opposite by filing "MCP Tools" under
`ACTION_GROUPS.admin`, where the whole group is stripped for non-admins. The
control read as admin-gated while the data was public, so a reviewer who checks
the chip's placement and stops there draws exactly the wrong conclusion. That is
the inverse of the usual risk: the danger is a review that *does not happen*.

*What the fix was:* `demo_api_server/routes/mcpInspector.js` — the `/tools` route
now carries an explicit `INTENTIONALLY UNAUTHENTICATED` block recording the
measured behaviour (200 with no cookie and no bearer), why it is deliberate, and
the general rule this case exists to teach: **UI grouping is not an authorization
boundary and must never be read as one.** If the inventory should ever be
restricted, the middleware goes on the route, not in the menu.

### [x] 2026-08-18 — Flag arming needs admin, but the steps that need flags are run by any role

**RESOLVED 2026-08-18 (branch `worktree-presenter-flag-arming`) — the premise
had gone stale, and the fix was smaller than any option the entry proposed.**
Investigation: `PATCH /api/admin/feature-flags` is NOT admin-gated —
`middleware/featureFlagsAuthGate.js` routes mutations through plain
`authenticateToken` with no role check, and the server-side chip dispatch
(`routes/useCases.js` auto-arm loop) already arms as any role. The only place
"arming needs admin" existed was `ensureRequiredDemoFlags` in `AIAgent.js`,
which believed a customer's PATCH would 403 and never even tried — producing
exactly the "working demo, subtly wrong output" failure this entry predicted.
Fix: any signed-IN user now attempts the PATCH (customer or admin); on write
failure it falls back to the read-and-inform path; signed OUT keeps the
check-and-inform behavior (a session is genuinely required to write). No
server change, no new endpoint, no gate change. Regression tests: customer
arms; failed arm informs; guest never writes
(`AIAgent.protectedStepLogin.test.jsx`, 14 passed). Original entry follows.

**Where:** `demo_api_ui/src/components/AIAgent.js` `ensureRequiredDemoFlags`,
against the admin-gated `PATCH /api/admin/feature-flags`.

**What's wrong:** most demo steps declare required flags — every step with a
`primaryTool` needs `ff_mcp_gateway_pinggateway`, A2A steps also need
`ff_a2a_delegation`. Arming them is an admin-only write. A presenter signed in
as a customer therefore cannot arm anything, and before #1970 the 403 was
swallowed: the flag stayed off and the step quietly misbehaved with nothing
said.

#1970 made the failure visible (check flag state, name the flags that are
actually off, skip the doomed write) but did not close the gap — a customer
still cannot run a flag-gated step correctly without someone else flipping the
flag. It presents as a working demo giving subtly wrong output, which is the
worst failure mode for a demo.

Currently masked: both flags are ON in env `01d89b06`, so nothing misbehaves
today. It bites the first time a flag is off.

**Why not fixed now:** the fix is a product decision, not a bug fix — either
demo flags stop being admin-gated, or steps stop depending on runtime arming.
Both are larger than the visibility fix that surfaced the gap.

**What the real fix looks like:** most likely a separate presenter-scoped
endpoint for demo-flag arming that does not require full admin, or seeding the
demo flags ON at provisioning so no runtime arming is needed. Failing either,
the step catalog should refuse to offer a flag-gated step to a role that cannot
arm it, rather than running it degraded.

### [ ] 2026-08-18 — `renderActionGroups()` never mounted on `/dashboard` for either role

**Where:** `demo_api_ui/src/components/AIAgent.js:10866` —
`{isLoggedIn && renderActionGroups()}`.

**What's wrong:** with a live session on `/dashboard`, `document.querySelectorAll('.ba-action-group')`
returned **0** for a customer and 0 for an admin on the banking vertical, while
`isLoggedIn` was true. The action chips (`account`, `transaction`, `ai`,
`testing`, `attacks`, and `admin` for admins) render nowhere on that surface, so
some enclosing container is not mounting.

Not established: whether that is correct-by-design (these chips may be intended
only for a surface not exercised here) or a real regression. What is certain is
that it cannot be determined from the call site — the condition there is just
`isLoggedIn`, and the gating actually lives in an ancestor.

Consequence already paid: #1978 changed which roles are offered "MCP Tools" and
merged on unit evidence alone, because the rendered chip could not be located in
the running app to confirm placement.

**Why not fixed now:** it needs a decision about intended surface before any
code change, and #1978 was a role-visibility fix that had no business also
relocating a UI region.

**PARTIALLY OVERTAKEN BY EVENTS — noted 2026-08-26, entry stays OPEN.** The
specific call site this entry pins no longer exists: `AIAgent.js:10866`'s
`{isLoggedIn && renderActionGroups()}` is now an unconditional
`{renderActionGroups()}` (`AIAgent.js:11174`), consistent with the
"show all actions, gate auth per use case from `auth-requirements.json`"
direction. So the `isLoggedIn` half of the diagnosis is gone.

What this entry actually asked has NOT been answered, which is why the box stays
unticked: the entry's own conclusion was that the gating "lives in an ancestor,"
not at the call site, so removing the call-site condition does not establish that
`.ba-action-group` now mounts on `/dashboard` for either role. That still needs
the live check the entry called for — `document.querySelectorAll('.ba-action-group').length`
on `/dashboard` as customer and as admin — and it needs the settle contract from
the "UI probes have no settle contract" entry, or a zero result means nothing.

**What the real fix looks like:** establish which surfaces are meant to show
action groups. If `/dashboard` is one, find the ancestor that is not mounting
and fix it. If it is not, move the condition to the call site so it reads
`{isLoggedIn && surfaceShowsActions && renderActionGroups()}` — the current form
claims the only requirement is a session, which is false and cost a
verification.

### [x] 2026-08-18 — Two dispatch paths converge on the resume state but leave through different send functions

**RESOLVED 2026-08-18 (branch `worktree-resume-dispatch-seam`).** Every
queued-question OUTCOME now announces itself through one seam:
`emitResumeDispatch(outcome, detail)` in AIAgent.js dispatches a
`agent-resume-dispatch` window CustomEvent (+ a `[resume-dispatch]` debug tag)
with `outcome: 'sent' | 'handed_back' | 'failed'` and `exit` naming the path
(`resume-effect`, `ciba-retry`, `vertical-unavailable`). All four exits wired:
the resume effect's send, its failure branch, the vertical-unavailable
hand-back, and the CIBA-approval retry. An instrument (test, probe, session
debugging) listens to THE EVENT, never an individual exit — the
contradictory-numbers episode this entry records (probes on two different exits
both "right") cannot recur. Producers were audited en route: all three setters
(OAuth return, launcher deep-link, handleDemoStepSelect) already converge on
`nlResumeAfterAuth` before any send, so observing outcomes is observing the
mechanism. Pinned by `AIAgent.resumeVerticalReadiness.test.jsx`: hand-back and
send each assert the seam's event with the right outcome/exit. Original entry
follows.

**Where:** `demo_api_ui/src/components/AIAgent.js` — `nlResumeAfterAuth` is set
from at least three places (the OAuth-return effect, the launcher deep-link
mount effect, `handleDemoStepSelect`), and the queued value then leaves through
`sendAgentMessage` on the resume effect's path or through `sendAsNl` /
the AG-UI run on others.

**What's wrong:** there is no single point that observes every resume send. A
typed guest question and an `agent-demo-step-select` demo step both queue into
the same state and both call themselves "the resume", but they exit through
different functions hitting different endpoints. Nothing in the code signals
that, so an instrument placed on one path reads as a measurement of the resume
mechanism as a whole.

This is not hypothetical — it cost a full debugging cycle on 2026-08-18. Two
sessions measured the same feature and got contradictory numbers, and both were
right: a probe at the `sendAgentMessage` line reported `resumeSends: 0` while a
probe at the storage/fetch boundary saw a send go out at t=3412ms. The
disagreement was read as a defect for a while before it was recognised as two
narrow instruments on two different paths.

The sharper consequence is diagnostic. #1981 gates the replay on
`effectiveVerticalId` with no timeout or fallback, so a surface where the
manifest never resolves drops the queued question **silently**. From outside the
component that is indistinguishable from a false zero on one path — same
symptom, no fetch, no error. The next person debugging a lost question starts
from an ambiguous signal and cannot disambiguate it without an in-component
probe.

**Why not fixed now:** the fix that found this (#1985, the ref-held claim) is
one line of state plumbing on a `REGRESSION_PLAN` §1 surface, landing beside a
second fix (#1981) from another session. Adding a dispatch-path refactor to
that would have made a two-half coordinated change into a three-way one, with
the paired live validation still outstanding.

**What the real fix looks like:** one instrumentation and dispatch point
downstream of the convergence, that every resume send passes through regardless
of which dispatcher queued it — so `resumeSends` means what its name says, and
a silent drop is distinguishable from a path the instrument does not watch.
Failing that, at minimum name the paths distinctly in code so nobody reads one
as the whole.

### [ ] 2026-08-17 — Every migrated vertical now has two seed stores and nothing keeps them agreeing

**SEED-FILE HALF RESOLVED 2026-08-18 (branch `worktree-seed-single-source`) —
entry stays OPEN for runtime write-divergence.** The resource-server seeds are
now DERIVED from the BFF seeds: `demo_mcp_resource_server/scripts/gen-seeds-from-bff.mjs`
(`npm run seeds:gen`) writes each `seed/<v>.seed.json` as a pure extraction of
the migrated entity from `config/verticals/<v>/seed.json`, and
`tests/seedParity.test.ts` was upgraded from id-match to **full-record deep
equality**, failing with a pointer at the generator. The case list lives once in
`seed/parity-cases.json`, shared by both. Proven live: the deep gate immediately
caught real drift the id-only guard had passed — abercrombie's resource seed had
silently lost `sku`/`size`/`color` (regenerated; its SQLite schema projects 5
columns at ingest, so tool output is unchanged — the served shape is decided in
the db module, not by seed truncation). What remains open is exactly the deeper
half already scoped below: a BFF-side write is invisible to the SQLite copy
regardless of seed agreement — the real fix is still finishing the migration.
Original entry follows.

**INTERIM GUARD ADDED 2026-08-18 (PR #2072) — entry stays OPEN for the real fix.**
`demo_mcp_resource_server/tests/seedParity.test.ts` now asserts the migrated
entity's record ids match between the two seed files for all 8 verticals that keep a
comparable `seed.json` on both sides (retail/sporting-goods/abercrombie-fitch/
government/healthcare/manufacturing/university/workforce; banking and airlines are
documented exclusions with no parallel BFF `seed.json`). Investigation finding: the
ids ALREADY match today — the size gap the entry cites is because the BFF seed
carries many *other* entity types (rewards, wishlist, returns…), not because the
migrated set diverges — so this is a green tripwire for the *next* one-sided seed
edit, not a red gate. It catches **seed-file** divergence only; it does NOT close the
deeper **runtime write-divergence** (a BFF-side cancel is invisible to the resource
server's SQLite copy regardless of seed agreement) that the real fix — finish the
migration, or generate both seeds from one source — must address. Seeds were not
rewritten. Original entry follows.

**Where:** `demo_mcp_resource_server/seed/*.seed.json` (10 files) and
`demo_api_server/config/verticals/<vertical>/seed.json` (+ `data.js`), read
through `demo_mcp_resource_server/src/db/<vertical>Db.ts` and the BFF's own
store respectively.

**What's wrong:** the SQLite migration moved exactly one or two READ tools per
vertical onto `demo_mcp_resource_server` (list + get). Every write action and
every other read still runs against the BFF's seed store. So one vertical now
answers "show my orders" out of `retail.db` and "cancel my order" out of
`config/verticals/retail/seed.json`, from two independently maintained seed
files that were never derived from each other — `retail.seed.json` is 1.0K next
to the BFF's 7.9K. A cancel applied on the BFF side is invisible to the next
list; the demo shows a cancelled order as still open, and no test or gate
notices because each half is internally consistent. It only reads as correct
because the demo scripts happen to exercise the two halves in an order where
the divergence does not show.

**Why not fixed now:** the migration was deliberately scoped to the read path
per vertical (PRs #1913, #1914, #1916, #1918) and shipping it that way was the
right call — the alternative was moving all 8 verticals' write surfaces in one
sweep. The split is the cost of that decision, not an accident.

**What the real fix looks like:** either finish the migration (writes move to
the resource server, the BFF store becomes a client of it) or generate both
seeds from one checked-in source so the two halves cannot describe different
worlds. Interim guard worth having regardless: a test that loads both seeds for
a vertical and asserts the record ids match — divergence is currently invisible
until someone demos the wrong combination of chips. `abercrombie-fitch.mock.json`
still sits in the resource server's seed directory next to the real
`abercrombie.seed.json` it replaced (#1918) — an artifact of the same split.

### [x] 2026-08-17 — Unrouted resource-server tools declare scopes that exist nowhere, and nothing checks

**GATED 2026-08-17.** `scripts/check-tool-scope-registration.js` now fails the
build on any `requiredScopes` string that is not a scope or alias in
`scope-topology.json` (`npm run topology:verify` step 10/10). The 8 known-bad
declarations are listed in `UNROUTED_UNREGISTERED` and exempted ONLY while
nothing routes them — the checker greps `demo_mcp_gateway/src/router.ts` and
fails the moment one is named there, which is precisely the "route it and it
403s" trap. A stale entry (allowlisted tool no longer declared anywhere) also
fails, so the exemption list cannot outlive what it excuses. The 8 declarations
themselves are UNCHANGED and still wrong — that part is deliberately not fixed;
see below. Original entry follows.

**Where:** `demo_mcp_resource_server/src/tools/*Tools.ts` — `healthcare:read`
(`get_patient_record`), `government:read` (`get_permit`), `anf:read`
(`get_anf_order`), `banking:read`, and the rest of each vertical's second tool.

**What's wrong:** those strings are not scopes. `grep` them in
`scope-topology.json` and every one returns zero hits — only `airlines:read` was
ever registered. They survive because `router.ts` deliberately routes just the
one migrated tool per vertical, so the tool carrying the invented scope is never
reached. The moment anyone routes it — the obvious next step, and the exact
motion the last four PRs performed — the call 403s on a scope the platform has
never heard of. That is how the whole migration started: every vertical's
`requiredScopes` was an invented `<vertical>:read`, and the fix in each case was
to replace it with the plain `read` that `scope-topology.json` already declared
for that tool. The unrouted half was left holding the original bug.

**Why not fixed now:** each PR corrected the scope on the tool it routed and
left the others untouched, which kept the diffs honest and reviewable. The
generalisation — every declared scope must resolve — was never the change in
front of anyone.

**What the real fix looks like:** a check in `npm run topology:verify` that
walks every `requiredScopes` entry in `demo_mcp_resource_server/src/tools/` and
fails on any string that is not a scope in `scope-topology.json`. It is a dozen
lines, it would have caught this class before the first vertical shipped, and it
turns "route the second tool" from a live-403 discovery into a build failure.

**What is still open after the gate:** the 8 declarations are still wrong, just
now enforced. Collapsing them to the plain `read` their routed siblings use was
considered and rejected: `read` is carried by every session, and these are
single-record lookups (`get_patient_record`, `get_banking_account`), so that
would quietly turn "unreachable" into "readable by anyone" the day someone
routes one. Neither is the SoT-registration path free — unlike the migrated
tools, these have no `tools.<name>` entry in `scope-topology.json` either, so
there is nothing to match against; giving them real least-privilege scopes means
adding both the tool and the scope to the SoT and provisioning them in PingOne,
which mutates a live environment. That decision belongs to whoever actually
needs one of these tools routed, and the gate now forces them to make it.

**RESOLVED 2026-08-18 by PR #1988** (`feat(topology): fail the build on tool
scopes that exist nowhere`) — verified. `scripts/topology-verify.sh:96` runs
`node scripts/check-tool-scope-registration.js || fail=1`, so the check is a build
gate rather than an advisory script, and `npm run topology:verify` is the entry
point the root `CLAUDE.md` already tells you to run for cross-service changes.

### [x] 2026-08-17 — A guessed authorization outcome is indistinguishable from a real one in the ledger

**FIXED 2026-08-18 (PR #2068, merged + deployed) — primary gap only.** The hop now
carries provenance: `transaction-hop.groovy` stamps `source: 'trail'` when the
outcome came from the parsed `X-Gw-Audit-Trail` and `source: 'inferred'` when it fell
back to the status code (fail-open fallback preserved; the `outcome`/`by`/`reason`
shape is unchanged so downstream consumers keep working). `TransactionTracePage.jsx`
renders an amber "inferred" tag only when `decision.source === 'inferred'`, so a
guessed PERMIT visibly reads as a guess; authoritative and no-provenance hops render
as before. Used `source` (not `authoritative`, which §4 already overloads for
"gateway-as-PDP"). Groovy was verified by reading (no in-repo Groovy harness); 2 UI
tests cover the tag. **Still open (deliberately out of scope):** the two secondary
gaps this entry notes — dropped PDP statement/obligation detail, and folding the
decision into the transport hop rather than a separate `authz.decision` hop.
Original entry follows.

**Where:** `ping-gateway/scripts/groovy/transaction-hop.groovy` (~line 71,
`if (!outcome) outcome = (statusCode >= 400) ? 'DENY' : 'PERMIT'`), reading the
`X-Gw-Audit-Trail` header that `p1az-decision.groovy` stamps.

**What's wrong:** the hop emitter prefers the authoritative decision off the
audit trail — correctly, because a JSON-RPC error rides a 200 envelope and
status alone cannot tell a policy DENY from a successful call. But when the
trail is absent or unparseable the `catch` falls through silently and the
outcome is INFERRED from the status code, and the emitted hop records that guess
in the same `decision.outcome` field, with the same `by: 'ping-gateway'`
attribution, as a real PDP verdict. Nothing in the payload marks it as inferred.
So `/transaction-trace` can display a confident `PERMIT` for a request whose
policy decision was never read — which is the one thing an authorization trace
exists to rule out. The fallback is right to exist (fail-open is correct for an
observability surface); recording it as indistinguishable from the real thing is
not.

Two smaller gaps in the same hop: the PDP's own detail — statements/obligations,
policy id, evaluation latency — is dropped, only `outcome`/`reason`/`op`
survive; and because the decision is folded into the transport hop rather than
carried as its own, a trace cannot separate "IG enforced this" from "PingOne
Authorize decided this."

**Why not fixed now:** the instrumentation is recent and deliberately fail-open,
and this is a fidelity question about what the ledger records rather than a
break in it. It was found while checking a stale claim that the boundary was
uninstrumented at all — it is not.

**What the real fix looks like:** carry the provenance, not just the value —
add a `source: 'trail' | 'inferred'` (or `authoritative: false`) to the emitted
`decision` object and surface it in the trace UI, so a guessed outcome reads as
a guess. Then, if the PDP detail is wanted, emit a distinct `authz.decision` hop
from the same trail data rather than a second emitter in the decision script,
which would duplicate the telemetry that already flows.

### [x] 2026-08-17 — The P1AZ snapshot generator still pins 7 object versions by hand, and nothing rejects a new one

**RESOLVED 2026-08-18 (branch `worktree-p1az-guards`) — the entry's "cheaper
interim", delivered in full.** `snapshots/authorizeSnapshotRequestContract.test.js`
(runs in CI via `npm run test:snapshots`) asserts every `version: '...'` literal
in the generator is in `FROZEN_VERSION_LITERALS` — the 7 current ones, each
carrying its static-content justification — and that no allowlist entry
outlives its literal. A NEW literal now fails CI with the #1311/#1897 history in
the failure message instead of importing as a silent no-op. Red-proven: an
appended literal fails the suite. The maximal fix (ver() as the only version
source) remains available but the trap this entry records is closed. Original
entry follows.

**Where:** `snapshots/gen-authorize-snapshot.js` — `ver()` derives a version
from content for the attribute/condition/statement/rule builders, but 7 objects
still carry literal `version: 'aaaaaaaa-00NN-…'` strings (the RAR set at ~959-1004,
`mcpStepUp` at 674, `txConsent` at 690/706).

**What's wrong:** PingOne skips any import object whose version is unchanged, so
a pinned version on an object whose CONTENT is generated from
`scope-topology.json` makes the import a silent no-op — the file imports
"successfully" and the cloud keeps the old policy. That is exactly what happened
twice: `AdminRoleOnWriteTool` (#1311) and `HasValidActorChain` (#1897), the
second one costing a live `verify:a2a-policy` failure that read as a policy bug.
PR #1905 converted 7 more objects to `ver()`, but the distinction that matters —
"this object's content is static, so a literal is safe" versus "this object
mutates from a source of truth, so a literal is a bug" — exists only in whoever
is editing the file's head. Nothing in the generator, the tests, or `--check`
tells the two apart.

**Why not fixed now:** #1897 and #1905 fixed the objects that were already
demonstrably wrong. Deciding the general rule means auditing all 7 remaining
literals to confirm each is genuinely static, which was not the change that
found the trap.

**What the real fix looks like:** make `ver()` the only way to produce a version
— every object derives from its own content, static ones included, at which
point a literal in this file is a lint failure rather than a judgement call.
Cheaper interim: a test asserting no `version: '` literal appears in the
generator, with an explicit allowlist for any object deliberately frozen, so
adding one is a deliberate act with a comment attached.

### [x] 2026-08-17 — `abercrombie-fitch` carries render descriptors for tools its own allowlist excludes

**Where:** `demo_api_server/config/verticals/abercrombie-fitch/index.js`
(`ALLOWED_TOOL_NAMES`, filtering the tools it borrows from
`../retail/tools`) versus the descriptors in its `manifest.json`.

**What's wrong:** A&F builds its tool set from retail's and filters it through a
name allowlist, but the manifest kept descriptors for tools the filter removes —
the 2026-08-17 render-descriptor audit counted 4 orphans. They are inert today,
which is the problem: a descriptor pointing at a tool that cannot be called is
indistinguishable, by reading the manifest, from one that is load-bearing, and
the audit that found the real descriptor bugs (#1898, #1901, #1903) had to check
each by hand to tell them apart.

**Why not fixed now:** cosmetic — no user-visible symptom, and it was found
during an audit whose scope was descriptors that actually break rendering.

**What the real fix looks like:** drop the orphans, and add the inverse
assertion to the manifest-schema suite that already validates descriptors: every
descriptor must name a tool the vertical actually exposes. The suite currently
checks descriptor shape, not descriptor reachability, which is why a borrowed-
and-filtered tool set can accumulate these unnoticed.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-batch2-0818`).**

*What the issue really was:* the orphan count was right — 4, confirmed by loading
every vertical and diffing `manifest.render` against the tools it actually
exposes: `view_subscriptions`, `pause_subscription`, `view_price_alerts`,
`remove_price_alert`. All four are retail tools that `ALLOWED_TOOL_NAMES` filters
out of A&F.

**But the entry's proposed assertion was wrong, and writing it as stated would
have broken the build.** "Every descriptor must name a tool the vertical actually
exposes" is false in this repo — a descriptor key is reached three ways, and the
audit found live examples of all three:

1. it names an exposed tool (the common case);
2. a handler returns it explicitly — `return { result, render: 'portfolio_value' }`
   — which is how `investment` reaches `portfolio_value`, `trades`,
   `dividend_summary` and how `oauth-teaching` reaches `token_pair`;
3. a **service-level** map names it for a tool no vertical lists — today
   `A2A_TOOL_RENDER = { get_portfolio_summary: 'portfolio_summary' }` in
   `services/demoAgentLangGraphService.js`, the only reason `investment`'s
   `portfolio_summary` is live.

Applied naively, the entry's rule flags 6 healthy descriptors across two
verticals. The guard would have been reverted on its first red build and the
lesson lost with it.

*What the fix was:*

- Dropped the 4 orphan descriptors from
  `demo_api_server/config/verticals/abercrombie-fitch/manifest.json`.
- Added `demo_api_server/src/__tests__/verticalRenderReachability.test.js`,
  which encodes all three reachability sources and runs per-vertical. Across all
  14 verticals with a `render` block it now reports zero orphans.

One subtlety the test comments call out: source (2) is scanned **per-vertical,
not through borrowed modules**. `retail/tools.js` does contain
`render: 'pause_subscription'`, but that branch belongs to a tool A&F's allowlist
removes — counting it would mark the exact orphans this test exists to catch as
reachable.

*Verified the guard bites:* injecting a `zz_orphan_probe` descriptor into the A&F
manifest fails the suite with `Received + "zz_orphan_probe"`. A guard nobody has
watched fail is not a guard.

### [x] 2026-08-17 — Only the invest resource server has an audience no-drift gate; every other audience is still trust-by-convention

**RESOLVED 2026-08-18 (branch `worktree-audience-bindings`) — the entry's real
fix, as prescribed.** The resource→env binding is now DECLARED IN
`scope-topology.json` itself (`resources[*].audienceEnv: { var, surfaces[],
sourcePin? }`, schema-validated), and `check-resource-server-audience-drift.js`
iterates the table instead of hard-coding one var — every occurrence of a bound
var on a declared surface must lead with the resource's canonical uri, and a
topology with NO bindings fails (vacuity guard). Three audiences bound today:
invest (`MCP_RESOURCE_SERVER_RESOURCE_URI`, 5 surfaces + source pin), banking
MCP server (`MCP_SERVER_RESOURCE_URI`, compose + k8s), MCP gateway
(`MCP_GW_RESOURCE_URI`, compose + k8s + .env.example). A new resource is covered
the day its binding is declared. Deliberately NOT bound: the A2A-intermediate
uris (exchange audiences minted per-hop, no accepted-list env var to drift) and
`PG_GATEWAY_RESOURCE_ID` (its own dual-purpose entry below owns that decision).
Self-test grew 11→14 cases, including "a second declared binding is enforced
with no checker change" and "every occurrence validated, not just the first".
Original entry follows.

**Where:** `scripts/check-resource-server-audience-drift.js` (`npm run
topology:verify` step 9/9), which derives one canonical URI from
`scope-topology.json resources["Super Banking MCP Invest"].uri` and diffs the
handful of surfaces that set `MCP_RESOURCE_SERVER_RESOURCE_URI`.

**What's wrong:** `scope-topology.json` is the source of truth for *every*
audience in the chain — banking MCP server, MCP gateway, PingGateway, the A2A
and privilege resources — but only one of them is gated. The gate was written
to close the specific collision that produced `Audience mismatch: got
[mcp-invest.ping.demo], expected one of [mcpserver.ping.demo,
mcpgateway.ping.demo]` across all 7 airline and 4 invest tools, and it is shaped
around that one variable name and that one resource entry. Any other audience
can still drift between `scope-topology.json`, compose, `k8s/02-configmap.yaml`,
the Helm templates and `refresh-service-envs.js` without a check firing. The
failure mode is the same every time and it is invisible until a tool call fails
at runtime in one vertical: checked-in config reads correct, only the running
env is wrong.

**Why not fixed now:** the audience fix that found it was scoped to the invest
server. Generalising means deciding what the canonical mapping from a
`scope-topology.json` resource to an env var on a given surface actually is —
today that relationship is implicit and one-off per service.

**What the real fix looks like:** declare the resource-to-env-var binding in
`scope-topology.json` itself (each resource names the var and the surfaces that
must carry it), then rewrite the step-9 checker to iterate that table instead of
hard-coding `OWN_VAR` / `TOPOLOGY_RESOURCE`. One gate, every audience, and a new
resource is covered the day it is added rather than the day it breaks a demo.

### [ ] 2026-08-17 — Nothing fails a build when a P1AZ request omits an attribute the policy requires

**PARTLY RESOLVED 2026-08-18 (branch `worktree-p1az-guards`) — the offline
fail-at-build gate exists; the shared request-builder contract does not.**
`snapshots/authorizeSnapshotRequestContract.test.js` DERIVES the required set
from the snapshot itself (request-resolved + no `defaultValue` + referenced by
at least one CONDITION — 6 attributes today) and fails CI when no PEP source
(`PingOneAuthorizeClient.ts`, `pingAuthorizeGuard.ts`,
`pingOneAuthorizeService.js`) sends one, with the two legal fixes in the
message (send it, or give it a defaultValue like Amount). A vacuity guard stops
the derivation from silently walking to zero, and a companion check pins
TokenKid's deliberate not-sent exemption to its no-condition-reads-it premise.
Red-proven via an injected condition-referenced attribute. STILL OPEN: having
every caller BUILD its request from one checked-in contract, and the live
snapshot-parity check ("nothing can tell the live environment has diverged").
Original entry follows.

**Where:** `demo_api_server/scripts/verifyA2aDelegationPolicy.js` and
`scripts/verifyAuthorizeCloudParity.js` (both live-only, neither in CI);
`demo_api_server/tests/pingOneAuthorizeIndeterminate.test.js`.

**What's wrong:** live PingOne Authorize returns `INDETERMINATE` only when the
request or the policy is wrong — a missing or null attribute the Trust Framework
references, a failed attribute fetch, a malformed payload, or an unenforceable
obligation. It is never a legitimate outcome for this demo, so it should be
impossible to ship a caller that provokes it. Today nothing prevents it: the
probes learned to send `Amount: 0` / `TransactionAmount: '0'` only after
`verify:a2a-policy` started evaluating INDETERMINATE against a shape the real PEP
never sends, and any new caller can omit the same attribute the same way. The
existing unit test asserts the enforcement behaviour once INDETERMINATE comes
back; it does not assert that we never ask a question that produces one. The live
verifiers that would catch it run by hand against a real environment.

**Why not fixed now:** the fix that found this was a two-line probe-parameter
change. A real guard needs a shared definition of the request contract, and the
policy half of that contract lives in a PingOne snapshot that is imported through
the console — `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`
already carries all 11 actor ids, but `verify:a2a-policy` still FAILs airlines and
admin depth-2 with `mcp-invalid-actor` until someone re-imports it, and nothing in
the repo can tell that the live environment has diverged.

> **STALE as of 2026-08-18 — the airlines/admin failure no longer reproduces.**
> Run live against env `01d89b06` after the CLI scripts were repaired (#2124):
> `verify:a2a-policy` **PASS 11/11**, airlines and admin depth-2 among them, and
> `verify:authorize-parity` **PASS 7/7**. Someone re-imported in the interim.
> Note the two verifiers were themselves unrunnable between the dotenvx cutover
> and #2124 — they failed at the token endpoint with `invalid_client` — so the
> window in which this paragraph could have been re-checked was also the window
> in which it could not. The rest of the entry (nothing in the repo detects
> repo-vs-cloud divergence) is UNCHANGED and still the point: the only reason we
> know the environment agrees today is that someone ran a script by hand.

**What the real fix looks like:** extract the attribute set the Trust Framework
requires into one checked-in contract (derivable from the snapshot), have every
decision caller — PEP, both verifiers, tests — build its request from it, and add
an offline test that a caller omitting a required attribute fails at build time
rather than at evaluation time. Pair it with a snapshot-parity check so
"policy in the console is older than policy in the repo" is a reported condition
instead of a residual note in `REGRESSION_PLAN.md`.

### [x] 2026-08-17 — `DashboardTokenRail` persists its own default on mount, so every default flip costs a storage-key bump

**Where:** `demo_api_ui/src/components/DashboardTokenRail.jsx` (~line 49, the
`useEffect(() => persistTokenRailCollapsed(collapsed), [collapsed])`), reading
`demo_api_ui/src/utils/tokenRailLayout.js` `readStoredTokenRailCollapsed()`.

**What's wrong:** the effect fires on first render, so the value the component
merely *defaulted* to is written to `localStorage` as though the user had chosen
it. From then on the stored value shadows the default forever. That is why
flipping the Live Pipeline rail to collapsed-by-default could not be done by
changing the default alone — every existing browser already had the old default
persisted — and why the key had to be bumped to `ud_token_rail_collapsed_v2`. The
same trap is now armed for the next flip, and the width effect above it has the
identical shape. `REGRESSION_PLAN.md` §0 records the workaround ("bump the key
again if the default ever changes") rather than the cause.

**Why not fixed now:** the change that found it was a default flip under a
locked-UI area, and correcting the persistence semantics would have altered
behaviour beyond the flip.

**What the real fix looks like:** persist only on user action — write inside the
collapse toggle handler and the resize handler — and let an absent key keep
meaning "no preference". Then a default is genuinely a default: changing it
reaches every browser that never touched the control, and the key never needs
another version suffix. Guarded by asserting that mounting the rail writes
nothing to `localStorage`.

**RESOLVED 2026-08-18 (branch `worktree-techdebt-small-batch-0818`).**

*What the issue really was:* as described — `useEffect` runs after the first
render, so an effect whose only job is "persist this state" cannot tell a value
the user chose from a value the component defaulted to. It writes both. The cost
is not the write; it is that from that moment the stored value **shadows the
default forever**, which makes changing a default unreachable for every browser
that ever loaded the page. `ud_token_rail_collapsed_v2` is the scar from the first
time that bill came due, and the width effect one line above had the identical
shape with the same bill waiting.

*What the fix was:* `demo_api_ui/src/components/DashboardTokenRail.jsx` —
persistence moved out of the effects and into the user actions.

- The remaining `useEffect` reflects `collapsed`/`width` into the
  `--ud-token-rail-width` CSS var only. No storage writes.
- `persistTokenRailCollapsed()` moved into `handleToggle`, which computes `next`
  from `collapsed` and depends on it — rather than writing from inside the
  `setCollapsed` updater, which StrictMode may double-invoke.
- `persistTokenRailWidth()` moved into the drag's `onUp`, with the in-flight width
  held in a `dragWidth` ref so mouseup sees the final value. One write per drag
  instead of one per mousemove.
- `utils/tokenRailLayout.js` untouched — the key stays `ud_token_rail_collapsed_v2`
  and an unset key still reads as collapsed.

*What is now true that was not:* an absent key means "no preference", so the next
default flip reaches every browser that never touched the control, and the key
never needs another version suffix. `REGRESSION_PLAN.md` §1 recorded the
workaround ("bump the key again if the default ever changes") as if it were the
rule; that row now records the cause and the guard instead.

*Guarded by* two new cases in `components/__tests__/DashboardTokenRail.test.jsx`:
mounting writes neither key, and mounting does not overwrite an existing stored
preference. Both assert through `localStorage.getItem` — deliberately **not** a
spy, per the Node 22 CI / Node 26 local storage-spy trap.

### [ ] 2026-08-17 — `demo_agent_service` tests import `demo_api_server`'s vault across the package boundary

**Where:** `demo_agent_service/tests/vault.test.ts` requires
`../demo_api_server/lib/vault/index.js`, which requires `argon2`.

**What's wrong:** the suite depends on a sibling package's internals AND on that
sibling's `node_modules`. `argon2` appears in `demo_api_server/package.json`, not
in `demo_agent_service`'s, so the test only passes where the sibling happens to
be installed. That is true on any developer machine and false on a clean runner —
which is exactly how it surfaced: wiring the suite into CI for the first time
produced `125 passed, 1 suite failed to load`, with zero failing assertions.

**Why not fixed now:** the CI job installs `demo_api_server`'s deps before
running this suite, which is the smallest change that makes the job honest. The
real repair is a decision about the boundary, not a build tweak, and it was not
the change that found it.

**What the real fix looks like:** either extract the vault into something both
packages depend on explicitly (a workspace package with its own `argon2`
dependency), or move the test to `demo_api_server`, where the code and its
dependency already live. Whichever way, `demo_agent_service` should stop
reaching into a sibling's `lib/` — a require path with `../` crossing a package
root is the smell, and it will keep producing environment-dependent green.

**STILL OPEN — but both fixes this entry proposes are wrong. Re-scoped
2026-08-18 (branch `worktree-techdebt-batch2-0818`) after auditing the code.**

*Why "move the test to `demo_api_server`" is wrong:* `vault.test.ts` tests
`demo_agent_service`'s OWN loader — `loadVaultIntoEnv` from `../src/vault`, whose
one behavioural delta from the gateway's copy is the `AGENT_` allowlist prefix.
It only reaches across the boundary to *build the fixture vault* it then loads.
Moving it would put a test of `demo_agent_service` code in another package.

*Why "extract to a workspace package" is bigger than it looks:* the crossing is
**deliberate at runtime**, not just in tests. `demo_agent_service/src/vault.ts:42`
sets `VAULT_LIB_PATH = '../../demo_api_server/lib/vault'` and requires it on
purpose, and `tests/vault.libUnavailable.test.ts` exists specifically to assert
the behaviour when that sibling is **absent** — which is the normal case in the
agent-service image, where `demo_api_server` is never shipped. Extracting the
vault would change that runtime contract and the container layout that depends
on it, not just a `require` path.

*What is actually true today:* `.github/workflows/ci.yml` installs the sibling's
deps (`npm install --prefix demo_api_server`) before the suite, with a comment
pointing here. That works and is honest about why it exists. The residual cost is
one full package install on a job that otherwise needs none.

*Real fix, restated:* pick one deliberately — (a) publish the vault as a workspace
package that BOTH services depend on explicitly, and update the image layout and
`vault.libUnavailable.test.ts`'s premise with it; or (b) give
`demo_agent_service` its own test-only fixture builder so the suite stops needing
the sibling's `argon2` at all, leaving `src/vault.ts`'s deliberate runtime
crossing as the only one. (b) is much the smaller change and removes the CI
install; it costs a second implementation of the vault write path used only by
tests.

### [ ] 2026-08-17 — `PG_GATEWAY_RESOURCE_ID` is both the token audience and the advertised RFC 9728 metadata URL

**PARTLY RESOLVED 2026-08-18 (branch `worktree-gateway-metadata-check`) — the
entry's "regression test worth having" now exists.**
`services/checks/gatewayMetadataCheck.js` (demo-check framework, Agent Gateway
category, applies when `ff_mcp_gateway_pinggateway` is on) probes the gateway
unauthenticated, extracts `resource_metadata` from the 401's WWW-Authenticate,
DEREFERENCES it, and requires 200 + JSON naming a `resource` — each hop failing
by name. Verified live: challenge advertises
`https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp`, answers
200. The silent-for-months failure mode (audience half working while discovery
is dead) now surfaces on every posture run. STILL OPEN: the actual role split
(`PG_GATEWAY_METADATA_BASE` defaulting to request authority, or moving the
challenge into the Groovy `deny()`), which is what would also let this audience
join scope-topology's `audienceEnv` binding table. Original entry follows.

**Where:** `ping-gateway/.env` (`PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3036/mcp`),
consumed as `resourceId` by `ping-gateway/config/routes/01-mcp-olb.json` (and the
`/apikey`, `/invest` variants), and checked as `aud` by
`ping-gateway/scripts/groovy/p1az-decision.groovy` (~line 789) and
`jwks-token-validation.groovy`.

**What's wrong:** one value carries two unrelated contracts. As an OAuth audience
it only has to be a stable opaque identifier every party agrees on. As the input
IG's `McpProtectionFilter` derives its RFC 9728 `resource_metadata` URL from, it
has to be a URL that actually serves a metadata document. Nothing enforces the
second property, and for months it did not hold: the identifier said `https` on
port 3036 while the listener there was plaintext, so every `WWW-Authenticate`
challenge pointed clients at a URL that failed the TLS handshake from the host
and from inside the compose network alike. Discovery was unreachable and nothing
reported it, because the audience half kept working perfectly.

**Why not fixed now:** the obvious repair — point the metadata URL at something
reachable — is unavailable, because changing `PG_GATEWAY_RESOURCE_ID` changes the
audience every token in the chain is minted against (`MCP_GW_RESOURCE_URI` in
`docker-compose.yml` lists it, PingOne resources are provisioned with it,
`scope-topology.json` records it as `pingGatewayResourceUri`). PR #1938 therefore
moved the LISTENER to match the identifier instead — IG now serves TLS on 8443,
published as host 3036 — which makes the advertisement true today but leaves the
coupling in place. The Node gateway does not share the problem: `selfBaseUrl.ts`
derives its pointer from the request authority, so its challenge is always
reachable by construction.

**What the real fix looks like:** separate the two roles. Give IG a distinct
`PG_GATEWAY_METADATA_BASE` (defaulting to the request authority, as the Node
gateway already does) used only to build the `resource_metadata` URL, leaving
`PG_GATEWAY_RESOURCE_ID` purely an audience string that never has to be
dereferenceable. That requires either an IG config knob for the filter's metadata
base or moving the challenge out of the built-in `McpProtectionFilter` into the
Groovy that already builds one (`jwks-token-validation.groovy`'s `deny()`), which
is why it was not attempted alongside a TLS change. Until then, a regression test
worth having: assert that the URL in the gateway's `WWW-Authenticate` actually
returns 200 — the failure mode here was silent precisely because nobody followed
the pointer.

### [x] 2026-08-17 — `davinciLogin.js`'s `/callback` has no ID-token nonce replay verification

**FIXED 2026-08-18 (branch `worktree-davinci-nonce-verify`) — and the entry's
"blocked on the SDK" premise was wrong.** `@forgerock/davinci-client` (2.1.1) has
no *named* nonce feature, but `client.start()` officially accepts typed
`StartOptions.query` params that are merged into the `/authorize` URL
(`dist/src/lib/davinci.api.js`, `existingParams.set(key, value)`) — so a standard
OIDC `nonce` can ride the authorize request and PingOne echoes it in the ID
token. No fork, no hand-built authorize request. Fix: new
`POST /api/davinci-login/nonce` binds a single-use `crypto.randomBytes(16)` nonce
to the session; `DavinciLoginPage.start()` fetches it and passes
`client.start({ query: { nonce } })`; `/callback` consumes the session nonce
(read-and-delete before the code is spent) and fails `401 nonce_missing` /
`nonce_mismatch` when the ID token does not echo it — strict, never
warn-and-proceed, same rule as `routes/oauthUser.js` post-#2043. Regression tests
`tests/davinciLoginNonce.test.js` (5 cases incl. single-use replay; verified all
5 red against the pre-fix route) and
`src/pages/__tests__/DavinciLoginPage.test.jsx` (UI half pins the nonce wiring).
Caveat: nothing in the UI posts to `/callback` yet (the page stops at "Signed
in." and the SDK does no PKCE, so no caller can supply `codeVerifier`) — the
verification is live the day that wiring lands, and the callback now refuses
nonce-less logins rather than silently accepting them. Original entry follows.

**Where:** `demo_api_server/routes/davinciLogin.js` (`POST /callback`).

**What's wrong:** the route exchanges the DaVinci widget's authorization code and
reads the resulting ID token, but never checks it against a stored nonce the way
`routes/oauth.js`'s callback does (`idPayload.nonce !== expectedNonce`, ~line 266-276)
and `routes/oauthUser.js`'s does (`idTokenClaims.nonce !== expectedNonce`, ~line
459-467). Without that check the callback can't detect ID token replay.

**Why not fixed now:** both reference flows generate a nonce themselves and pass
it into `oauthService.generateAuthorizationUrl(..., nonce)` before redirecting to
PingOne, so the nonce round-trips through a redirect URL they control. This route's
flow start is entirely inside the `@forgerock/davinci-client` SDK
(`demo_api_ui/src/lib/davinciWidgetClient.js`'s `davinci({ config })` /
`client.start()`/`client.next()`) — checked the installed package's README and
`dist/src` for `nonce` support and found none, so there's no supported way to set
or retrieve one through the SDK today. Implementing this would mean either forking
the SDK's flow-start call or hand-building the DaVinci authorize request outside
it — both fragile enough to risk breaking the widget flow this fix round wasn't
scoped to touch.

**Real fix:** once the SDK exposes (or a DaVinci-orchestration-level workaround is
found for) a way to pass a nonce into the flow's authorize step and have it echo
back in the ID token, wire up the same pattern as `routes/oauth.js`: generate a
nonce before the widget starts, store it in `req.session`/PKCE cookie, and verify
`idPayload.nonce === expectedNonce` in the callback before establishing a session.

### [ ] 2026-08-17 — `davinciFlowClient._getApiToken()` is a placeholder, not a real token fetch

**Where:** `demo_api_server/services/davinciFlowClient.js` (`_getApiToken()`).

**What's wrong:** returns `` `${apiClientId}:${apiClientSecret}` `` and sends it
as a `Bearer` token to PingOne's orchestrate API. PingOne expects a real OAuth
access token (client_credentials grant) or `Basic base64(id:secret)` at the
token endpoint itself — a raw colon-joined pair as a bearer token will 401
against a live environment. Every consumer of `invokeFlow()` currently runs
against mocked HTTP in tests, so this has never been exercised live.

**Why not fixed now:** scoped out of the plan's Task 3 (`docs/superpowers/plans/2026-08-17-davinci-orchestration-showcase.md`)
on purpose — building a full client_credentials grant + token cache wasn't
needed to land the mockable client shape, and DaVinci console setup (that
plan's Task 1) hasn't happened yet, so there's no live environment to test
against regardless.

**Real fix:** implement a real client_credentials token fetch (mirror
`services/mfaService.js`'s `_getWorkerToken()` pattern) with expiry-aware
caching, before this client is ever pointed at a live PingOne environment.

### [x] 2026-08-16 — `MCP_SERVER_RESOURCE_URI` means two different things across services

**RESOLVED 2026-08-17.** `demo_mcp_resource_server` now reads
`MCP_RESOURCE_SERVER_RESOURCE_URI` (falling back to the old name so a container
or `.env` pinned before the rename keeps working, and logging a warning when it
does). Every surface that sets it — compose, `k8s/02-configmap.yaml`, the
privilege Helm template, `.env.example`, `refresh-service-envs.js` — carries the
invest list under the new name, and `npm run topology:verify` step 9/9
(`scripts/check-resource-server-audience-drift.js`) derives the canonical URI
from `scope-topology.json` and fails if any surface drifts or reverts to the
banking value. The defensive union in `resolveAcceptedAudiences()` stays as
belt-and-braces. Original entry below, kept for the reasoning.

**Where:** `demo_api_server/scripts/refresh-service-envs.js` (shared default
`'mcpserver.ping.demo,mcpgateway.ping.demo'` fanned out to every service env),
`demo_mcp_resource_server/src/index.ts` / `src/server/acceptedAudiences.ts`.

**What's wrong:** everywhere else `MCP_SERVER_RESOURCE_URI` is "the banking MCP
server's accepted-audience list", but inside demo_mcp_resource_server it means
"THIS server's accepted list". Only a per-service override in the env writer
keeps the invest server from inheriting the banking value; a container created
before the override (or a K8s pod on the shared configmap) rejected every
gateway exchange-#3 token with `Audience mismatch: got [mcp-invest.ping.demo]`.
Patched defensively: `resolveAcceptedAudiences()` now always unions the
server's own canonical audience, so a stale env can no longer break tool calls
— but the name collision remains.

**Why not fixed now:** renaming the env var touches compose, K8s manifests,
refresh-service-envs, and docs in one sweep — out of scope for the audience
fix.

**Real fix:** give the invest server its own env name (e.g.
`MCP_RESOURCE_SERVER_RESOURCE_URI`), source it from
`scope-topology.json resources["Super Banking MCP Invest"].uri`, and extend
`npm run topology:verify` to diff every surface that sets it (compose, K8s,
env writer) against the topology.

### [x] 2026-08-16 — Node MCP Gateway's HITL retry path never consumes the receipt

**RESOLVED 2026-08-17.** Both Node gateway retry sites — HTTP
(`middleware/authorizeMcpRequest.ts`) and WS (`index.ts`) — now call
`verifyAndConsumeHitlReceipt()`, which POSTs to the existing consuming
`POST /challenges/:id/verify` instead of `GET /challenges/:id` plus a local
re-implementation. The server runs the same binding checks
(`demo_hitl_service/src/receiptVerification.js` mirrors `verifyHitlReceipt`
message for message) and calls `store.consume()` on success, so a replayed
retry is rejected as `status: consumed`.

Neither of the two options sketched below was needed. `/verify` already existed
and already consumed — the gap was only that this gateway never called it — so
no new endpoint, no `?consume=true` flag, and none of the read-only
`GET /challenges/:id` pollers (`demo_api_server/services/hitlServiceClient.js`,
`demo_authz_server/routes/decision.js`) were touched. `verifyHitlReceipt` stays
exported and tested as the pure binding helper. Regression guard:
`demo_mcp_gateway/tests/hitlReceiptConsume.test.ts` asserts the gateway POSTs to
the consuming endpoint, never GETs, and that a second retry is rejected.
Original entry below, kept for the reasoning.

**Where:** `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (~L611-654,
the `_hitl_challenge_id` retry branch) and `demo_mcp_gateway/src/hitlClient.ts`
(`getHitlChallengeStatus` + `verifyHitlReceipt`).

**What's wrong:** BUGS.md #35 fixed HITL receipt replay by having
`demo_hitl_service`'s `POST /challenges/:id/verify` transition the challenge
to a terminal `consumed` status on its first successful call
(`demo_hitl_service/src/routes/challenges.js`, `store.consume()` in
`demo_hitl_service/src/store/challengeStore.js`). That closes the replay gap
for `ping-gateway/scripts/groovy/p1az-decision.groovy`, the only caller of
`/verify`. The Node MCP Gateway (`demo_mcp_gateway`) never calls `/verify` —
it calls `GET /challenges/:id` and re-implements the same binding checks
locally in `hitlClient.ts#verifyHitlReceipt`, with no call that mutates
challenge state. So a replayed retry against the same `_hitl_challenge_id`
through the Node gateway still succeeds every time until the 10-minute TTL,
identical to the bug BUGS.md #35 describes. Per `ping-gateway/README.md:32-34`,
`ff_mcp_gateway_pinggateway` **OFF (the default)** routes MCP traffic through
this unfixed Node gateway path — the fixed PingGateway/Groovy path is opt-in.

**Why not fixed now:** the task scoped the fix to `demo_hitl_service` only
(minimum diff, don't touch the two consumer services). Closing this gap
requires either (a) adding a consuming call from `hitlClient.ts` at its one
use site and a way for `demo_hitl_service`'s `GET /challenges/:id` to
distinguish that consuming read from the read-only polling done by
`demo_api_server/services/hitlServiceClient.js` (BFF dashboard) and
`demo_authz_server/routes/decision.js` (own PDP flow) — both of which also
call plain `GET /challenges/:id` and must not be treated as consuming — or
(b) a new dedicated consuming endpoint the Node gateway calls instead of GET.
Either touches 2-3 more services and needs its own regression pass; out of
scope for a targeted HITL-service fix in a protected area.

**Real fix:** give the Node gateway path a consuming step equivalent to
`/verify`'s, without breaking the other `GET /challenges/:id` pollers — e.g.
a `?consume=true` flag (or dedicated `POST /challenges/:id/consume`) that
only `hitlClient.ts`'s retry-time call sends, verified against a test that
replays the Node gateway's retry twice and asserts the second is rejected.

### [x] 2026-08-15 — mastra_agent: `req.on('close')` fires before the client actually disconnects

**Where:** `mastra_agent/src/runHandler.ts` — `req.on('close', () => abortController.abort())`.

**What's wrong:** Node's `IncomingMessage` is a Readable stream with
`autoDestroy` on, so it emits `'close'` once its own body has been fully
read — not when the underlying connection/client actually goes away. For a
small JSON POST body (this endpoint's whole payload), that happens almost
immediately after Express's body parser finishes, often before
`agent.stream()` even starts consuming `fullStream`. Confirmed live:
instrumenting the handler showed `abortController.signal.aborted` already
`true` by the time the `for await` loop began, in every request. Effect:
`tests/runHandler.test.ts`'s three streaming-event assertions (`RUN_FINISHED`,
`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`/`END`) fail — the loop `break`s on
its first `abortController.signal.aborted` check before processing any part,
so `onRunEnd()` falls back to the "model didn't return a usable response"
error path. Reproduced identically on an unmodified `main` checkout (no code
change involved) via `cd mastra_agent && npx jest tests/runHandler.test.ts`,
so it predates and is unrelated to any recent change in this file.

**Why not fixed now:** found while fixing the missing `'tool-error'` branch
in the same file (BUGS.md #14) — a distinct, unrelated code path. The real
fix (switching the disconnect signal from `req` to `res`) touches request
lifecycle handling for every run, which is out of scope for a targeted
tool-error fix and risks the exact abort/stream-teardown behavior this repo
is careful about.

**Real fix:** listen on `res.on('close')` (or `res.on('finish')` paired with
a separate disconnect check) instead of `req.on('close')` — the response
stays open for the SSE duration, so its `'close'` reflects the actual
client/connection state rather than "the request body has been read." Needs
a scoped repro against a real (non-supertest) client to confirm the new
listener still aborts on a genuine client disconnect before landing.

**ALREADY RESOLVED — verified 2026-08-18. No code change needed; this entry was
stale.**

*What happened:* PR **#1975** (`fix(mastra): abort on res close, not req close —
req fires when the body lands`) landed the exact fix this entry specified.
`mastra_agent/src/runHandler.ts:46` now reads `res.on('close', () =>
abortController.abort())`, carrying a comment with the same diagnosis this entry
made.

*Confirmed, not assumed:* the full suite through the CI harness —
`bash scripts/test-service-suite.sh mastra-agent` → `36 passed, 0 failed, 36
total`; `tests/runHandler.test.ts` alone is green. Those are the three assertions
the entry named as failing.

*Bookkeeping note:* this block was supposed to land in PR #2004, whose body and
commit message both claim it. It did not — it was dropped when the annotation
script was rewritten mid-task, and only the accompanying `.github/workflows/ci.yml`
comment fix actually shipped. Recorded here rather than quietly patched, because
"the PR says it was annotated" is exactly the kind of second-hand claim this file
exists to stop people trusting.

### [x] 2026-08-12 — oauth-mcp encrypted-storage CBC mode has no integrity check

**Where:** `oauth-mcp/src/utils/encryption.ts` — uses `aes-256-cbc`.

**What's wrong:** CBC is unauthenticated. Decrypting with the wrong key
doesn't reliably fail — it produces garbage that happens to pass PKCS#7
padding validation roughly 1 run in 256, so `decipher.final()` succeeds and
returns corrupted plaintext instead of throwing. Surfaced as an
intermittent failure in `tests/utils/encryption.test.ts` ("should fail to
decrypt with wrong password") while reviewing an unrelated branch —
untouched by that branch's actual changes.

**Why not fixed now:** found while verifying oauth-mcp's DCR work
(`docs/superpowers/plans/2026-08-12-oauth-mcp-dcr.md`), which never touches
this file. A migration to an authenticated mode changes the on-disk/at-rest
ciphertext format, which is a real migration concern (existing encrypted
data, if any persists across restarts) — bigger than a drive-by fix
belongs in.

**Real fix:** migrate to `aes-256-gcm` (or another AEAD mode), which
fails deterministically — and cryptographically meaningfully — on a wrong
key/tampered ciphertext instead of a ~1-in-256 chance of silent corruption.
Needs a decision on migrating already-encrypted data vs. accepting a
one-time invalidation.

**RESOLVED — verified 2026-08-18.** `oauth-mcp/src/utils/encryption.ts` now
writes **AES-256-GCM** with a versioned layout —
`[0x01][salt(32)][iv(12)][authTag(16)][ciphertext]` — and `decrypt()` dispatches on
that version byte, keeping `_decryptCbc` as a **read-only** path for ciphertext
written before the change.

That also answers the migration question this entry flagged as the reason not to
fix it in passing: existing encrypted data is neither invalidated nor rewritten,
it is simply still readable, and every new write is authenticated. Wrong-key
decryption now fails deterministically on the auth tag instead of ~1-in-256
returning corrupted plaintext.

### [ ] 2026-08-12 — oauth-mcp DCR: two follow-ups from the final review

**Where:** `oauth-mcp/src/oauth/OAuthRouter.ts`, `oauth-mcp/src/oauth/TokenIssuer.ts`.

**What's wrong:**
1. `resolveOwnAudience()` (`TokenIssuer.ts`) takes the first entry of
   `MCP_SERVER_RESOURCE_URI` positionally to decide this AS's own audience.
   Every other resolver answering "what is MY resource URI" in this service
   (`lastHopAuthorization.ts`, `JwtClaimVerifier.ts`) instead prefers a
   dedicated `PINGONE_RESOURCE_MCP_SERVER_URI`-shaped var first, specifically
   so a stale/reordered `MCP_SERVER_RESOURCE_URI` can't silently shadow the
   real audience. Correct in every shipped config today (`mcpserver.ping.demo`
   is always first in `docker-compose.yml`/`k8s/02-configmap.yaml`), but the
   positional dependency is fragile if that list is ever reordered.
2. `POST /register`'s new `DCR_INITIAL_ACCESS_TOKEN` gate (added closing a
   Critical finding — unauthenticated DCR with unbounded scope) isn't wired
   into any deployment yet: not in `docker-compose.yml`'s `environment:`
   block, not in `k8s/02-configmap.yaml`. `/register` therefore 503s
   everywhere until an operator sets it, which is the safe default but means
   DCR is not actually reachable outside unit tests yet.

**Why not fixed now:** (1) is correct behavior today, just a fragility
worth naming, not a bug to chase without a live misconfiguration to fix
against. (2) is deployment/config wiring, not application code, and doing
it blind (no PingOne app exists yet for Part B's redirect-federation half
either — see the design spec's explicit "out of scope for this
implementation pass") risks wiring a secret nobody's ready to rotate.

**Real fix:** (1) switch `resolveOwnAudience()` to prefer a dedicated env
var (e.g. `PINGONE_RESOURCE_MCP_SERVER_URI`, matching sibling resolvers'
precedence) before falling back to `MCP_SERVER_RESOURCE_URI[0]`. (2) once
DCR is meant to be exercised for real, set `DCR_INITIAL_ACCESS_TOKEN` in
the deployment's env and document the value's provenance/rotation.

**PART (1) RESOLVED 2026-08-26 (branch `worktree-techdebt-small-correctness`) —
entry stays OPEN for part (2).** `resolveOwnAudience()` now prefers
`PINGONE_RESOURCE_MCP_SERVER_URI` (first entry, since that var may itself be a
comma list) and falls back to `MCP_SERVER_RESOURCE_URI[0]`, matching
`JwtClaimVerifier`'s precedence. Confirmed inert today: the dedicated var is set
in neither `docker-compose.yml` nor `k8s/`, and `printenv` inside the live
`ai-demo-mcp-server` container shows it unset — so this changes no shipped
behaviour and only removes the reordering fragility. Three tests added to
`src/oauth/__tests__/TokenIssuer.test.ts` (14 total, RED-proven: 2 fail without
the change).

Part (2) is deliberately untouched. Wiring `DCR_INITIAL_ACCESS_TOKEN` means
introducing a secret with no rotation story and no PingOne app behind it, which
is exactly what this entry said not to do blind.

### [x] 2026-08-11 — gw-authorize fallback duplicated across two client consumers

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
(around line 594) and `demo_api_ui/src/context/ProofOfEnforcementContext.js`
(`gwAuthorizeEvent()`).

**What's wrong:** on a gateway-authoritative run (`useGateway: true`), the BFF
skips its own Authorize gate — `mcpAuthorizeEvaluationThisRequest` stays a
skip-shaped object with no `.decision` (this is intentional, see Contract C4
comment at `mcpToolPipeline.js:456` — it's how a caller tells "BFF's gate
didn't run" apart from "it ran and permitted"). On PERMIT, the real decision
only ever arrives client-side as a `gw-authorize` token event
(`mcpToolPipeline.js:956-977`), never merged into `trace.authorize`.

This "authorize decision may only be visible as a `gw-authorize` event, not
`trace.authorize` / `body.authorize`" fact is independently reimplemented in
**four** places, not two:

1. `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:594` — Token
   Chain rail (had it first).
2. `demo_api_ui/src/context/ProofOfEnforcementContext.js`
   (`gwAuthorizeEvent()`) — ProofStrip verdict, added in #1635 because
   nobody had touched it and it silently read "Run failed before
   authorize-decision" on a run that had, in fact, been permitted.
3. `demo_api_server/services/stepVerificationExpectations.js:341-345`
   (`hasAuthorize` in `scoreDelegatedAccessInvoke`) — server-side chip
   prerequisite scorer, same fallback, third independent implementation.
4. `demo_api_server/services/attackSimulatorService.js:295-316`
   (`_authorizeFromPipelineOutcome` → `_normalizeAuthorizeDecision`) — attack
   sim outcome scoring, fourth implementation. Well-documented (docstring at
   282-294 explains the two-source fallback explicitly) so less of a silent
   trap than #2, but still separate logic reimplementing the same fact.

**Why not fixed now:** the fix that found this (#1635) was scoped to the one
broken consumer (#2). Fixing the duplication means normalizing the fallback
in one place per side — client (`tokenChainTraceStore.js`, where
`trace.authorize` gets set, covers #1 and #2) and server (wherever
`stepVerificationExpectations.js` and `attackSimulatorService.js` could share
a helper, covers #3 and #4) — since #3 reads a raw HTTP response body, not
`trace.tokenEvents`, it can't share the client-side store fix directly.
Either normalization touches shared/cross-cutting code used by more than the
one reported bug — bigger surface than a bug fix warrants.

**Real fix:** two separate normalizations, not one:

- Client: merge `gw-authorize` into `trace.authorize` once during ingestion
  (`tokenChainTraceStore.js`), keeping BFF-native vs gateway-native
  provenance distinguishable (e.g. a `source: 'gw-authorize'` field, which
  `buildTraceSteps.js` already stamps) so nothing downstream loses the "who
  actually decided" signal Contract C4 cares about. Fixes #1 and #2.
- Server: extract the `gw-authorize`-token-event fallback shared by #3 and #4
  into one helper (`attackSimulatorService.js`'s `_normalizeAuthorizeDecision`
  is the closer-to-reusable of the two) so both consumers call it instead of
  hand-rolling the `seenIds.has('gw-authorize')` / `events.find(...)` check.

**Do not break:** whatever the fix, `mcpAuthorizeEvaluationThisRequest`
itself must stay skip-shaped on the BFF side for gateway-authoritative
requests — see `mcpToolPipeline.js:456`. Client-side normalization must not
try to make the server stop being honest about that.

**ALREADY RESOLVED — verified 2026-08-18. No code change needed; this entry was
stale.**

*What happened:* PR **#1795** (`refactor(trace): deduplicate gw-authorize fallback
across 4 call sites`) landed the split fix this entry specified, one helper per
side:

- **Server** — `demo_api_server/utils/gwAuthorizeUtils.js` exports
  `gwAuthorizeEventFrom(tokenEvents)`, now the single implementation behind
  `stepVerificationExpectations.js:345` (consumer #3) and
  `attackSimulatorService.js:315` (consumer #4).
- **Client** — `tokenChainTrace/tokenChainTraceStore.js` gained
  `_gwAuthorizeToAuthorize()` + `_syncGwAuthorize()`, which set `trace.authorize`
  from the event after every `tokenEvents` mutation, exactly as the entry
  proposed. Consumers now read `trace.authorize` and nothing else:
  `ProofOfEnforcementContext.js:76` (consumer #2) records this in place —
  "from the gw-authorize token event, so no separate fallback is needed here".

`buildTraceSteps.js` (consumer #1) still contains `findEvent(tokenEvents,
"gw-authorize")` at lines 813 and 1058, which reads like a survivor but is not:
813 uses the event's mere existence as a downstream-liveness probe
(`exchangeProvenDownstream`) and 1058 pulls `filterChain` off it. Neither
re-derives the authorize decision, which is the fact this entry was about.

### [x] 2026-08-18 — The chain's Exchange hop reads "in flight" after a finished run

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — the
`exDone` computation added by #1966.

**What's wrong:** on the dashboard's typed-chat path (AG-UI, `POST
/api/agent/run`), a completed run renders:

```
5 MCP  tools/list 401   status 401
6 MCP  tools/list       tools permitted 20
7 LLM  LLM              tokens used prompt 0
8 BFF  Exchange         in flight      <-- never resolves
9 LLM  Reply            no token change
```

The run is over — Reply is rendered — and the Exchange hop still reads "in
flight". #1966 fixed the case where an exchange HAD completed by keying `exDone`
on downstream evidence (`gw-authorize`, `gw-filter-chain`, an MCP result). Here
the model answered without calling a tool, so no downstream evidence exists and
none ever will, and the hop sits unresolved forever.

**Why it matters:** a viewer cannot tell "still working" from "this never
happened". That is the same complaint that started the visibility work — if the
chain stops, it must say why.

**RESOLVED 2026-08-18** — the wording was decided ("Not required") and the hop
now reads `not required` with the reason attached: "No token exchange was needed
— the agent answered from context without calling a tool, so no delegated MCP
token was ever requested."

Two things shaped the fix, and both are worth knowing before touching it again:

- It reuses the existing `notinpath` STATUS rather than introducing a new one.
  Roughly fifteen surfaces bucket statuses (TokenFlowDetailModal,
  TokenTopologyPanel, TraceStepCard, TokenChainPresenter, the clinical panes…);
  a new status string would have rendered unlabelled or unstyled on every one of
  them. Only the node rail's one-line fact is overridden, keyed on
  `detail.notRequired`.
- `buildLiveTokenChainSteps` drops everything that is not active/done/error while
  a trace is incomplete — and live traces usually never set `outcome`. Left
  alone, the fix would have made the Exchange hop VANISH mid-run instead of
  explaining itself, which is worse than the "in flight" it replaced. The filter
  now keeps a hop that carries `notRequired`.

Guarded by two tests in `FocusModeChainRenders.test.jsx` — one that the hop says
"not required" after a reply with no tool call, one that a genuinely in-flight
exchange still says "in flight" so the fix cannot over-reach. Verified to FAIL
with the fix reverted.

`npm run test:e2e:real -- chain-hops-visible` still prints
`[ui] UNRESOLVED after reply:` if the old symptom ever returns live.

### 2026-08-18 — The agent's action chips cannot render on any production route (RESTORED)

**Where:** `demo_api_ui/src/components/AIAgent.js` — `renderActionGroups()`
(~line 1002) and its single call site (~line 10909).

**What's wrong:** `renderActionGroups()` has exactly one call site, and it sits
inside `{!useActionsPopout && (…)}`. But:

```js
const useActionsPopout =
  !isInline || Boolean(distinctFloatingChrome && isInline);
```

Every production mount makes that true — `App.js` (`distinctFloatingChrome`),
`AgentPage.js` (`mode="inline" distinctFloatingChrome`), `PublicRoutes.js`
(`distinctFloatingChrome`), `DemoGuidePopout.jsx` (not inline). So the branch
that renders the chips is unreachable, and no `.ba-action-chip` exists anywhere
in the running app. Confirmed live on `/dashboard`: 0 `.ba-action-chip`, 0
`.ba-action-group`, 0 `.ba-chips-toolbar`, both before and after opening the
`More` trigger (which holds Topology / Floating token chain / Script).

The name is now a lie: `useActionsPopout` reads as "actions live in a popout",
but Task 7 deleted that popout — a comment in the same file says the trigger was
removed because `ba-actions-popout` "no longer exists anywhere in this file". The
flag's real current meaning is "render no actions at all".

Two loose ends confirm it was left behind rather than decided:

- The welcome copy read **"Type a message or use Actions to explore."** with no
  Actions affordance on that surface. Corrected to "Type a message, or open Use
  Cases to explore." — the stale instruction is gone, but the orphaned chip code
  below is untouched and still the open question.
- `renderActionGroups`, `ACTION_GROUPS`, `useCustomChips`, `verticalSuggestionChips`
  and the `.ba-action-chip` / `.ba-action-group` CSS are all still carried.

**Measured 2026-08-18.** Every production mount sets the flag:

| mount | props | `useActionsPopout` |
|---|---|---|
| `App.js:1705` | `distinctFloatingChrome` | true |
| `pages/AgentPage.js:13` | `mode="inline" distinctFloatingChrome` | true |
| `routes/PublicRoutes.js:134` | `mode="inline" distinctFloatingChrome` | true |
| `components/DemoGuidePopout.jsx:84` | no `mode` — not inline | true |

What that strands:

- `renderActionGroups` — `AIAgent.js` lines 1002–1106 (~105)
- the JSX branch holding its only call site — lines 10696–11065 (~370)
- 34 chips in `ACTION_GROUPS`
- 60 rules in `AIAgent.css` matching the chip classes

**Two corrections to the first pass, both of which change the "delete" option.**

*`agentActions.js` is NOT fully dead.* The entry above implies it is. `ACTIONS` is
read at `AIAgent.js:1217` to label a completed HITL consent, and
`getStepSkipExplanation` is passed to a child at `AIAgent.js:11527`. Both are
reachable and have nothing to do with chips. Only the `ACTION_GROUPS` uses at
lines 859/866 (chip collapse state) and those inside `renderActionGroups` are
dead. Deleting the module would break the consent label.

*The unreachable branch is not only chips.* It also contains the session-refresh
row, `ba-suggestion`, the guest chip grid **including the login prompt**,
`ba-left-auth`, and the track chips. All equally unreachable — so the guest-mode
login affordance in there is dead too — but "delete the chips" really means
deleting the entire left column.

**So delete is not the small option.** It is a real refactor of a ~370-line branch
with the reachable pieces (`ACTIONS`, `getStepSkipExplanation`) preserved.
Restoring is cheaper to try: flip the gate for the dashboard mount and look at
what renders.

**Why it matters beyond dead code:** chips are the deterministic tool-call path
(`forceHeuristic`). With no chip in the DOM, a UI-level test cannot drive a tool
call at all, which is why `chain-hops-visible.real.spec.js` can assert only the
discovery leg and has to report the tools/call and gateway hops instead of
asserting them.

**RESOLVED — restored.** The owner chose restore over delete. `useActionsPopout`
is now `!isInline`: the condition says what it means, and the popout it was named
for is gone. Inline mounts (dashboard, AgentPage, PublicRoutes) get the left
column back — chips, the session-refresh row, the suggestion chip, and the guest
grid with its sign-in prompt, which had been unreachable too. Float mode keeps
its own chrome and is untouched.

Guarded by three tests in `AIAgent.chips.test.js` pinning the mount shapes the
real routes use, including one asserting float grows no left column. The
dashboard one is verified to FAIL with the old condition restored — without that
check it would pass for the wrong reason, since bare `mode="inline"` always
worked.

**How to check:** log in, open `/dashboard`, and count
`document.querySelectorAll('.ba-action-chip').length`. Non-zero means this was
resolved. Measured today: 0, before and after opening the `More` trigger (which
holds Topology / Floating token chain / Script, not chips).

### 2026-08-18 — Concurrent deploys raced on one Docker project and one stamp (FIXED)

**Where:** `scripts/deploy-live.sh`.

**What happened:** several agent sessions share one machine, one Docker compose
project (`ai-demo`) and one `.git/deploy-live.last`. Two runs overlapped and
broke each other twice over:

1. `docker compose` renames the old container before creating the new one, so the
   second run collided mid-swap and died:

   ```
   Conflict. The container name "/<hash>_ai-demo-mcp-gateway" is already in use
   by container "<id>"
   ```

   Exit 1, having restarted nothing it was asked to — the `ui` service in that
   run's plan was never reached.

2. The stamp is global. The OTHER session's run finished and wrote the new sha,
   so the failed run's next attempt read `OLD == NEW` and announced
   `containers already serve <sha> — nothing to deploy` while `ui` still served
   the previous bundle. **A failed deploy presented as a completed one.** It was
   caught only by loading the page and reading the copy, which was still the old
   string.

The timeline is what settled it — the stamp's mtime was ~1 minute AFTER the last
command of the failing session, so that session did not write it:

| time | event |
|---|---|
| 07:11:44 | session A deploy — exit 1, nothing restarted |
| 07:12:24 | session A retry — "already serve abd0377d" |
| 07:12:42 | session A restarts `ui` by hand |
| 07:13:40 | stamp written — by session B |

**Fixed by** an atomic `mkdir` lock at the top of the script. A second run refuses
with a message naming the holder's pid instead of racing; a lock whose recorded
pid is gone is reclaimed automatically. Refusal happens BEFORE the `EXIT` trap is
installed, so a refused run cannot delete the live holder's lock — verified, not
assumed. A refusing run also never touches the stamp, so the range stays intact
for the next attempt.

**Why refuse rather than queue:** a waiting run would resume with a range computed
before the other run moved the stamp, which is the same wrong answer arrived at
more slowly.

**Related:** #2010 documents a DIFFERENT hole in the same script — the `OLD != NEW`
path silently deploying `PRE..NEW`. That one is about the fallback being
unreliable; this one is about two runs corrupting each other. Both end the same
way: a stale service under a success line.

### 2026-08-18 — Three test-authoring traps that each read as a real failure

Small, but each one cost a debug cycle by producing an error that pointed
somewhere other than the mistake. Grouped because they share a cause: this repo
runs two assertion libraries and two test runners, and the failure text does not
say which one you are in.

**1. `expect` takes one argument in jest, two in vitest/playwright.**
`demo_api_ui` (vitest) and `tests/e2e` (playwright) both allow
`expect(value, "message").toBe(...)`. `demo_api_server` is jest, which rejects it
with:

```
Expect takes at most one argument.
```

That reads as a problem with the value being asserted, not with the call shape.
Put the diagnostic inside the assertion instead — `expect(list).toContain(x)`
prints the list on failure anyway.

**2. Playwright's `expect.poll` does not evaluate a function `message`.**

```js
await expect.poll(fn, { message: () => `saw: ${calls.join(', ')}` })
```

On failure Playwright prints the SOURCE of that arrow function rather than its
value, so the diagnostic you wrote specifically for the failing case is the one
thing you cannot read. Use a static string and `console.log` the dynamic part as
it arrives — a live run's diagnostics have to be emitted before the assertion
that needs them.

**3. `.ba-welcome` only renders when the transcript is empty.**
Conversation continuity persists the last 30 messages per user+vertical, so on a
real stack the agent panel usually has history and the welcome copy is absent —
`$$eval('.ba-welcome')` returns `[]`, which looks exactly like "the copy is
missing" when verifying a copy change. Click `.ba-start-over-btn` first. Applies
to any live check of first-run UI.

**Why this is here rather than in a test README:** all three were hit while
verifying other work today, and each briefly looked like a product bug. The cost
is not the mistake, it is the detour.

### 2026-08-18 — deploy-live stamped ranges it had not deployed (FIXED)

**Where:** `scripts/deploy-live.sh`.

**What was wrong:** the stamp is a claim that the containers serve a given SHA,
and it was written without checking whether that was true. Two paths let it lie,
both hit live:

1. `filter_running` selected services with `docker ps`, which lists only RUNNING
   containers. A service sitting in `Created` or `Exited` looked exactly like an
   optional profile service that is deliberately off: skipped with a note, and
   the run then stamped the new SHA as deployed. `ping-gateway` sat in `Created`
   while the next run reported `containers already serve <sha> — nothing to
   deploy`. Its changes were recorded as shipped and would never have been
   retried.
2. Nothing verified the outcome. `run-docker.sh restart` returned success having
   left a container in `Created`, and the stamp went in on that success.

**Fixed by** distinguishing *broken* from *absent*, and by verifying before
stamping:

- a container that EXISTS but is not running is now an error, not a skip — it has
  changes it cannot take, so the stamp is withheld and the run exits non-zero
  naming the service
- after deploying, docker is re-read to confirm every touched service is up;
  if any is not, the stamp stays at the old SHA so the next run retries the range
- a container that does not exist at all still skips quietly, which is the
  legitimate case the original behaviour was written for

**Found while fixing it — `filter_running` ran in a subshell.** It is called as
`X="$(filter_running "$X")"`, and command substitution forks: every variable it
assigned was discarded on return. That silently disabled the function's own
`note()` calls, so *every* "changed but its container is not running" warning
this script has ever produced was thrown away before anyone could read it. The
first version of this fix inherited the same bug and did nothing — the guard
never fired because `BROKEN_SET` never reached the parent. Side effects now go
through temp files.

**Still true, and not fixed here:** the stamp remains global. It records what the
containers serve, not what each service serves, so it cannot express "ui is
current but ping-gateway is two commits behind". The verification above closes
the way that state was reached silently; per-service stamps would be the way to
represent it directly, and that is a real refactor of the path→service mapping,
which resolves one range against one service set.

**How to check:** stop a service that has pending changes and run `deploy-live`.
It must exit non-zero, name that service, and leave `.git/deploy-live.last`
untouched. Verified 2026-08-18 with a `Created` container.

### 2026-08-18 — The MCP Inspector cannot invoke the tools it lists

**Where:** `demo_api_server/routes/mcpInspector.js` (`POST /api/mcp/inspector/invoke`).

**What's wrong:** the Inspector's catalog returns 242 tools, and invoking the
FIRST one fails:

```
[inspector] invoking catalogued tool: get_my_accounts
[inspector] invoke status=502
{"error":"mcp_invoke_failed","message":"Insufficient scope for tool 'get_my_accounts'"}
```

This is not the out-of-vertical case. `list_invoices` also 502s there, but
correctly — it is a sporting-goods tool and the Inspector's catalog is banking,
so "Insufficient scope" is the scope check working. `get_my_accounts` is a core
banking tool the Inspector itself offers, and tools run fine through the agent
path.

The route resolves its token with `forceDirectMcpAudience: true`, dialling the
MCP server directly rather than through PingGateway, so it carries a different
token than every other surface. That is the first place to look.

**Why it matters:** this is a demo surface whose whole purpose is showing the
real protocol. It advertises 242 tools and runs none of them.

**Found by** `demo_api_ui/tests/e2e/mcp-inspector.real.spec.js`, added 2026-08-18
— nothing drove this page before, which is why a 502 on its primary action went
unnoticed. That spec deliberately takes the tool FROM the catalog rather than
naming one: an earlier version hardcoded `list_invoices` and would have reported
working scope enforcement as a bug.

**Status:** the third test in that spec is RED on purpose. It states the bar —
whatever the Inspector lists, it must be able to invoke — rather than being
softened to match current behaviour.
