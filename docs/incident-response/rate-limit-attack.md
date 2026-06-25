# Runbook: Rate-Limit Attack / Agent Abuse

A high volume of agent requests — a runaway agent loop, a replay/flood, or a
deliberate DoS — against the agent endpoints. The platform has a built-in
defense (`middleware/agentRateLimit.js`) that throttles and then auto-kills; this
runbook covers confirming it engaged, responding when it didn't, and recovering.

**Default severity:** SEV-3 (auto-kill already engaged, self-limiting) → SEV-2
(sustained, multiple agents, or the limiter is bypassed).

See [README.md](README.md) for first-response and evidence-capture steps.

---

## How the built-in limiter works

`middleware/agentRateLimit.js`, per agent:

- **Window:** `AGENT_RATE_LIMIT.requests_per_window` requests per 60s
  (env `AGENT_RATE_LIMIT_REQUESTS`, default 10). Over the limit → **HTTP 429**
  with the current count / limit / remaining / violation total.
- **Auto-kill:** once an agent accumulates `auto_kill_violation_threshold`
  (default 5) violations within `violation_window_minutes` (default 5), the
  middleware calls `killSwitchService.killAgent(agentId, 'rate_limit_violations')`
  automatically and returns `429 {error:'agent_killed'}`.
- **Fail-closed:** a revoked agent is rejected up front with
  `401 agent_revoked` (checks `killSwitchService.isAgentRevoked`).

So for a single abusive agent the platform usually contains itself. Your job is
to confirm that, widen the response if it didn't, and recover.

## 1. Detect / confirm

- **Did auto-kill fire?** Look for the kill event:
  ```bash
  curl -sk 'https://api.ping.demo:3001/api/admin/audit-trail?agentId=<AGENT_ID>&hours=1' \
    -H 'Authorization: Bearer <ADMIN_SESSION>'
  ```
  A `kill_reason` of `rate_limit_violations` confirms the limiter engaged.
- **Scope the abuse.** `GET /api/mcp/audit?agentId=<id>` shows the tool-call
  volume/pattern; `auditLogService` rate-limit-violation events show the cadence.
- **One agent or many?** If several agent ids are implicated, treat as a
  coordinated flood (SEV-2) rather than one runaway loop.

## 2. Contain

### a) Single agent, auto-kill already fired
Nothing more to revoke — it's `agent_revoked`. Verify it's rejected and move to
recovery. Don't reset its limit until you understand *why* it looped.

### b) Auto-kill did NOT fire (or you want it dead now)
Manually pull the red button:
```bash
curl -sk -X POST https://api.ping.demo:3001/api/admin/agent/<AGENT_ID>/kill-switch \
  -H 'Authorization: Bearer <ADMIN_SESSION>' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"rate-limit attack — manual"}'
```

### c) Tighten the limit (sustained / multi-agent)
Lower the per-window allowance and restart the BFF so new abusive agents trip
sooner:
```bash
# in the BFF environment
AGENT_RATE_LIMIT_REQUESTS=3
```
(The 60s window and the 5-violations/5-min auto-kill threshold are constants in
`middleware/agentRateLimit.js`; the per-window request count is the env-tunable knob.)

### d) Block at the edge if it's a raw flood
The in-app limiter is **per agent identity**. A flood from unauthenticated or
spoofed clients that never reaches an authenticated agent context should be
dropped upstream (load balancer / ingress / WAF rate rule) — the app limiter is
not a substitute for edge DoS protection.

## 3. Eradicate

- Confirm the offending agent(s) are `agent_revoked` (retry → 401).
- If the cause was a **runaway agent loop** (not an external attacker), find the
  loop: the HITL anti-loop guards and agent-mode routing are the usual suspects —
  read `GET /api/mcp/audit` for the repeating tool/sequence and fix the loop
  condition, not just the symptom.

## 4. Recover

- Once the root cause is fixed, clear the agent's counters with the limiter's
  reset (`resetRateLimit(agentId)` in `middleware/agentRateLimit.js`) or let the
  Redis/store keys expire (60s window, 5-min violation window).
- Re-enable the PingOne user/app if the kill switch disabled them.
- Restore `AGENT_RATE_LIMIT_REQUESTS` to its normal value if you lowered it.

## 5. Post-incident

Run the [README post-incident checklist](README.md#post-incident-checklist-all-incidents).
Rate-limit-specific:
- [ ] Internal loop vs external flood clearly distinguished (different fixes).
- [ ] If a code path let an agent loop unbounded, add a guard + test +
      `REGRESSION_LOG.md` entry.
- [ ] If edge protection was missing for a raw flood, file the infra follow-up.
