# Tech Debt

Known gaps and architectural smells found while fixing something else —
correct enough to ship, not worth blocking the fix that found them. Not a bug
log (`REGRESSION_PLAN.md` §4 is that); this is "should fix properly later."

Reverse-chronological, newest first. Each entry: what's wrong, why it wasn't
fixed now, what the real fix looks like.

### 2026-08-18 — 687 error-level lint findings, 455 of them false, hiding the real ones

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

### 2026-08-18 — Agent tests pass `user` at first render, so a whole class of auth-timing bug is invisible

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

### 2026-08-18 — `GET /api/mcp/inspector/tools` is unauthenticated, and the UI grouping implied otherwise

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

### 2026-08-18 — Flag arming needs admin, but the steps that need flags are run by any role

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

### 2026-08-18 — `renderActionGroups()` never mounted on `/dashboard` for either role

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

**What the real fix looks like:** establish which surfaces are meant to show
action groups. If `/dashboard` is one, find the ancestor that is not mounting
and fix it. If it is not, move the condition to the call site so it reads
`{isLoggedIn && surfaceShowsActions && renderActionGroups()}` — the current form
claims the only requirement is a session, which is false and cost a
verification.

### 2026-08-18 — Two dispatch paths converge on the resume state but leave through different send functions

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

### 2026-08-17 — Every migrated vertical now has two seed stores and nothing keeps them agreeing

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

### 2026-08-17 — Unrouted resource-server tools declare scopes that exist nowhere, and nothing checks

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

### 2026-08-17 — A guessed authorization outcome is indistinguishable from a real one in the ledger

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

### 2026-08-17 — The P1AZ snapshot generator still pins 7 object versions by hand, and nothing rejects a new one

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

### 2026-08-17 — `abercrombie-fitch` carries render descriptors for tools its own allowlist excludes

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

### 2026-08-17 — Only the invest resource server has an audience no-drift gate; every other audience is still trust-by-convention

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

### 2026-08-17 — Nothing fails a build when a P1AZ request omits an attribute the policy requires

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

**What the real fix looks like:** extract the attribute set the Trust Framework
requires into one checked-in contract (derivable from the snapshot), have every
decision caller — PEP, both verifiers, tests — build its request from it, and add
an offline test that a caller omitting a required attribute fails at build time
rather than at evaluation time. Pair it with a snapshot-parity check so
"policy in the console is older than policy in the repo" is a reported condition
instead of a residual note in `REGRESSION_PLAN.md`.

### 2026-08-17 — `DashboardTokenRail` persists its own default on mount, so every default flip costs a storage-key bump

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

### 2026-08-17 — `demo_agent_service` tests import `demo_api_server`'s vault across the package boundary

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

### 2026-08-17 — `PG_GATEWAY_RESOURCE_ID` is both the token audience and the advertised RFC 9728 metadata URL

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

### 2026-08-17 — `davinciLogin.js`'s `/callback` has no ID-token nonce replay verification

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

### 2026-08-17 — `davinciFlowClient._getApiToken()` is a placeholder, not a real token fetch

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

### 2026-08-16 — `MCP_SERVER_RESOURCE_URI` means two different things across services

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

### 2026-08-16 — Node MCP Gateway's HITL retry path never consumes the receipt

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

### 2026-08-15 — mastra_agent: `req.on('close')` fires before the client actually disconnects

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

### 2026-08-12 — oauth-mcp encrypted-storage CBC mode has no integrity check

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

### 2026-08-12 — oauth-mcp DCR: two follow-ups from the final review

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

### 2026-08-11 — gw-authorize fallback duplicated across two client consumers

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
