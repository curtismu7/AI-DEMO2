# Agent kill mechanisms — session-scoped flag + loop halt, and nonce-hardened revoke

**Status:** IN PROGRESS — captures what's agreed so far. Not all sections
finished; open items are marked explicitly. Do not treat this as a green
light to implement beyond what each section marks as approved.

## Context

Today's kill switch (`killSwitchService.js`, shipped across PRs #1555,
#1565, #1586, #1588–#1592, #1597 on 2026-08-10) revokes a caller-supplied
`agentId` string — every UI trigger built so far either hardcodes it
(`"default-agent"`) or derives it loosely (`live.id`). Two problems this
doesn't solve:

1. **Coarse targeting.** Two different users clicking "Stop Agent" on a
   shared-string surface (e.g. the Use Cases page, Demo steps dropdown)
   both target the literal string `"default-agent"` — no real per-user
   isolation.
2. **Denies access, doesn't halt compute.** The enforcement flag
   (`agentRateLimit.js`'s `isAgentRevoked`) stops the *next* PingOne/MCP
   call, but if the agent is a runaway loop (e.g. reordering every 15s) or
   a hijacked process, nothing tells the loop itself to stop running —
   only its next real network call fails.

Two scenarios in scope: a benign runaway loop (bug, no attacker), and a
compromised agent (attacker has valid credentials). See
`project-killswitch-instance-scope` and today's REGRESSION_PLAN §4 entries
for the existing mechanism this builds on.

## Approach 1 — Session-scoped flag + self-checking loop

**Status: architecture APPROVED. Components/data-flow presented, one open
question blocking finalization (see below). Error handling and testing not
yet designed.**

### Architecture (approved)

Replace the caller-supplied `agentId` string with a server-derived key.
`killAgent(agentId, ...)`, `isAgentRevoked(agentId)`, and every enforcement
check keep their existing signatures and storage mechanism (the generic
`express-session` Store interface — `get`/`set` — already built today) —
what changes is *what string gets passed in* as that key, and *who decides
it*.

- New: `deriveAgentKey(req)` — if the caller is hitting a route tied to a
  real, named live agent (e.g. the Super Banking live agent), returns its
  real id (unchanged behavior). Otherwise returns
  `session:<truncated-hash-of-req.sessionID>` — a real per-user, per-login
  key instead of a shared label.
- `routes/admin.js`'s kill-switch route, and `agentRateLimit.js`'s
  `isAgentRevoked` check, both call the same `deriveAgentKey(req)` instead
  of trusting a client-supplied `:agentId` param. The URL param becomes
  display/backward-compat only, not the enforcement key.
- The running loop (self-checking half) polls the *same* flag via the same
  `isAgentRevoked`/`deriveAgentKey` call at the top of each cycle — so
  "denied" (auth layer) and "halted" (process layer) are backed by the
  literal same read, not two mechanisms that could drift apart.

### Components & data flow (presented, not yet finalized)

1. **`services/sessionKeyService.js` (new, small)** — houses
   `deriveAgentKey(req)`. Single source of truth so `routes/admin.js`,
   `killSwitchService.js`, and `agentRateLimit.js` can't quietly disagree
   on what "the agent" means.
2. **`routes/admin.js`'s kill-switch route** — swap
   `const { agentId } = req.params` for `const agentId = deriveAgentKey(req)`.
3. **`agentRateLimit.js`'s `isAgentRevoked` check** — same swap.
4. **The runaway-loop code itself** — gets one new call at the top of each
   cycle: `if (await killSwitchService.isAgentRevoked(deriveAgentKey(loopContext))) return;`

**Data flow:** `Stop Agent click → POST /kill-switch → deriveAgentKey(req)
→ same key for BOTH the enforcement-flag write AND whatever the running
loop reads` — closes the loop between "who clicked stop" and "which
running process notices."

### OPEN QUESTION — blocks finalizing this approach

Where does the 15s-reorder loop actually live?

- If it's a persistent server-side process (a `setInterval`/cron-like job
  in `demo_api_server`), step 4 above is straightforward: add a check to
  an existing loop.
- If "the agent" here is actually the LangChain/conversational loop that
  runs per-request rather than a persistent background process, there is
  no persistent loop to instrument — this scenario needs a different
  mechanism than polling (possibly: the per-request handler itself checks
  the flag before starting work, which is closer to today's existing
  auth-layer denial than a new capability).

This needs an answer before Components/data-flow, error handling, and
testing can be finalized for Approach 1.

### Not yet designed

- Error handling (what happens if `deriveAgentKey` can't resolve a session —
  fallback behavior, logging).
- Testing strategy (unit coverage for `deriveAgentKey`, integration test
  proving two different sessions get isolated flags).

## Approach 3 — Nonce-per-launch token (adversarial-hardened)

**Status: one-paragraph pitch only. Not designed.**

Best answer for "hacker got hold of it" specifically — a flag-based
approach (Approach 1) still trusts the running process to check it
honestly; a fully hijacked, non-cooperative process could ignore the flag
entirely (the auth-layer denial still backstops this on the *next* real
network call, but doesn't halt local compute). Idea: embed a random nonce
in the agent's token at mint time; kill = blocklist that one nonce via the
RFC 8693 `act`-claim delegation chain already used in this app. Survives a
process that ignores every flag, since the credential itself becomes
unusable. Heaviest of the three original menu items — touches token
minting, not just revocation-checking. Full architecture/components/data-
flow/error-handling/testing sections still to be written.

## Next steps

1. Answer the open question above (where the loop lives) to finalize
   Approach 1's components/data-flow.
2. Design Approach 1's error handling and testing sections.
3. Design Approach 3 in full (architecture through testing).
4. Spec self-review once both approaches are complete.
5. User reviews the finished spec.
6. Invoke `writing-plans` to turn the approved spec into an implementation
   plan — no implementation before that.
