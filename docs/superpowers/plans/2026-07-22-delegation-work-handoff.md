# Delegation Work — Handoff / Continuity Doc

**Purpose:** resume this work on a different machine or in a fresh session with zero context loss. Everything below is git-tracked (this file), so `git fetch` + checkout the branch is all a new machine needs — no reliance on this machine's local memory or scratch files.

**Branch:** `worktree-delegation-cleanup` — pushed to `origin`, all commits below are on `origin/worktree-delegation-cleanup`.
**PR:** [#709](https://github.com/curtismu7/AI-DEMO2/pull/709) — open, carries everything in this doc.
**Repo:** `curtismu7/AI-DEMO2`.

## To resume on a new machine

```bash
git fetch origin
git worktree add .claude/worktrees/delegation-cleanup origin/worktree-delegation-cleanup
cd .claude/worktrees/delegation-cleanup
ln -s "$(git rev-parse --show-toplevel)/demo_api_ui/node_modules" demo_api_ui/node_modules  # from the MAIN checkout, not this worktree
```
(Adjust the symlink source to wherever the main checkout's `demo_api_ui/node_modules` lives on the new machine — it's not committed, just needed for `npm run build` / vitest.)

---

## Status summary

| Item | State |
|---|---|
| PR #709 — delegation UI cleanup (3 pages → 1) | **Done, pushed** |
| Design spec — 4-stage delegation demo scenarios | **Done, pushed** |
| Plan B — 4-stage guided tour + talk track | **Done, executed, reviewed, pushed** |
| Plan A — manager-as-approver (stage 4 real approval) | **Not started.** Fidelity + persona decisions locked (below); plan not yet written. |

---

## 1. What's already shipped (this session)

### UI cleanup (commit `b5f966b17`)
Consolidated 3 overlapping delegation surfaces into 1 live page (`/delegation` / `DelegationPage.js`):
- Deleted `/delegated-access` (`DelegatedAccessPage.js` + `.css` + test) — was a mock, in-memory demo, no backend.
- Deleted orphaned `AdminDelegationPage.js` — unrouted dead code.
- `DelegationPage.js` now reads the active vertical's manifest `delegation` block (`pageTitle`, `pageDescription`, `granteeLabel`, `scopeLabels`) instead of hardcoding banking labels — every vertical (healthcare, workforce, etc.) renders its own copy.
- `AdminSideNav.jsx` consolidated to a single all-roles `/delegation` link.
- Removed disallowed emoji (`👥`, `🔍`) per REGRESSION_PLAN §0.

### Design spec (commit `7c5f96247`, then honesty edits `5cacfa28b`)
`docs/superpowers/specs/2026-07-21-delegation-demo-scenarios-design.md` — the SE runbook. **Read this file for the full narrative** (persona Maya, through-line "prove who's acting for me", per-stage click-path + talk track + payoff). 4 stages:
1. **Family** (human→human) — live today.
2. **User→AI agent** — live today (may_act, RFC 8693, HITL).
3. **Agent→agent (A2A)** — live today (`ff_a2a_delegation`, nested-act chain).
4. **Workforce** (manager grants, then approves) — **grant is live; per-action manager approval is NOT built** (this is Plan A).

Open question #1 in that spec is now DECIDED: build a real manager-as-approver (not the HITL/step-up surrogate). See §3 below for the two locked design forks.

### Plan B — 4-stage guided tour (commits `cf21e3fe5` doc, `297f76767`/`5cacfa28b`/`ec5bf97bb` Task 1, `8ec7c31e9` Task 2, `80f6c99ec` Task 3)
Plan doc: `docs/superpowers/plans/2026-07-21-delegation-demo-tour.md` (all 3 tasks fully detailed with exact code, already executed — read only if you need the "why", not to re-do the work).

Built via `superpowers:subagent-driven-development`:
- `DELEGATION_TOUR_STEPS` (5 entries: intro + 4 stages) added alongside the existing general `TOUR_STEPS`; `DemoTourProvider` made multi-tour (`start(tourKey)`), general tour behavior fully preserved.
- `DemoTourModal` renders whichever tour is active (`steps` from context, not a hardcoded import).
- `DelegationPage.js` got a "Run guided delegation demo" launcher button + its inline "Demo Talk Track" script replaced with the 5-step arc.
- One fix round: Stage-4 copy originally overclaimed the manager-approval as live ("gates on", "wired in") — corrected to "grant now, approval next" framing in **both** the tour step and the talk-track step. This is the honesty pattern to preserve in Plan A's own copy.
- Final whole-branch review: **Ready to merge: Yes**, 0 Critical/Important, 2 Minor (both self-assessed cosmetic/by-design — intro CTA self-closes modal; no closing recap step). Not fixed, not blocking.
- Tests: 4/4 pass (`DemoTourContext.test.jsx`, `DemoTourModal.test.jsx`). Build: exit 0.

**The SDD execution ledger** (`.superpowers/sdd/progress.md` in the worktree) is git-ignored scratch and will NOT be on a new machine — reproduced here for the record:
```
Task 1: complete (commits cf21e3f..ec5bf97, review clean after 1 fix round: stage-4 copy overclaim)
Task 2: complete (commit 8ec7c31e9, review clean, no findings)
Task 3: complete (commit 80f6c99ec, review clean; manual click-through unreachable in env, statically verified instead)
Final whole-branch review: complete (cf21e3fe5..80f6c99ec, Ready to merge: Yes, 0 Critical/Important, 2 Minor cosmetic/by-design)
```

### A mock/storyboard artifact (not code, for reference only)
An HTML storyboard mock of the 4-stage arc was published as a Claude Artifact during brainstorming (private link, not part of the repo). Not needed to resume code work — mentioned only so you know it exists if the user asks about "the mock."

---

## 2. Plan A — manager-as-approver (NOT YET WRITTEN — this is the next work)

**Goal:** stage 4 of the demo needs a real second principal (a manager) approving an employee's elevated workforce action — not the employee approving their own action, which is what every existing gate in this codebase does today.

### Locked decisions (do not re-ask the user — these were explicitly chosen)

1. **Fidelity: "Demo-representation."** The manager approves from a **real second browser session** (their own login, their own cookie) — not a fabricated single-session fiction, but also not real PingOne CIBA hardware/push. Concretely:
   - Add an approver-vs-subject model to the CIBA session record and audit event (today both are always the same identity — see §3).
   - Extend the **simulated** CIBA engine (`cibaSimulatedService.js`) to support a distinct approver; do NOT take on a live PingOne CIBA platform dependency (memory: env `01d89b06` has zero CIBA platform provisioning for a second principal; a real fix is a separate, larger PingOne-console task the user has not asked for here).
2. **Personas: "Provision a purpose-built pair."** Create named manager + employee workforce demo users (not a reuse of `demoAdmin`/`demoUser`/`demoDelegate`). This touches PingOne provisioning scripts — see §3.4 for where.

### 3. Exploration findings already gathered (condensed — re-reading these files is NOT necessary before writing Plan A; they're reproduced here in enough detail to draft task briefs directly)

#### 3.1 CIBA flow — `demo_api_server/routes/ciba.js`, `services/cibaService.js`, `services/cibaSimulatedService.js`

- **The chokepoint:** `routes/ciba.js:92-95` —
  ```js
  const loginHint = field('login_hint', 'loginHint')
    || req.user?.email
    || req.session?.user?.email;
  ```
  This single value is used as BOTH the bc-authorize notification target (passed to `cibaService.initiateBackchannelAuth`) AND — via the returned token's `sub` — the audit/approval-receipt subject. There is currently no separate "approver" concept anywhere in this file.
- **Session record shape** (`ciba.js:170-181`, stored at `req.session.cibaRequests[auth_req_id]`):
  ```js
  {
    initiatedAt, expiresAt, loginHint, scope, acr_values, binding_message,
    simulated, amount, fromAccountLabel, toAccountLabel,
  }
  ```
  No `approverEmail`/`approverUserId` field exists. Plan A's core data-model change is adding one, e.g. `approverUserId`, and threading it through `/initiate`, the simulated engine, and the poll/approve response.
- **Simulated engine** (`cibaSimulatedService.js`): `SIMULATED_APPROVE_DELAY_MS = 7000` — a bare 7-second timer, `isSimulatedApproved(pending) = Date.now() - pending.initiatedAt >= 7000`. No human, no session, no approver check at all. This is what must be extended to require an explicit approval action from a second session instead of (or in addition to) the timer.
- **Approve-now / deny routes** (`ciba.js:391-434`, `POST /approve-now/:authReqId` and `POST /deny/:authReqId`): both are session-gated — `req.session.cibaRequests?.[authReqId]` — meaning only the SAME browser session that initiated the request can approve/deny it today. For a manager to approve from their OWN session, these routes (or new ones) need to look up the request by `auth_req_id` in a place BOTH sessions can reach — i.e., NOT purely `req.session`, since sessions are per-browser. This is the biggest architectural fork: CIBA requests need a lookup keyed by something other than "whichever session created it" (e.g., a small server-side store keyed by `auth_req_id`, or LMDB, mirroring the pattern `delegationService.js` already uses for delegation records).
- **Approval receipt / audit** (`ciba.js:290-305` simulated, `:340-352` real): both call `trackTokenEvent({ userId: <acting user's sub>, description: 'CIBA backchannel step-up approved (out-of-band)', additionalData: { grantedVia: 'ciba', ... } })`. Plan A should add the approver's identity into `additionalData` (e.g. `approvedBy: approverUserId`) so the Token Chain / audit panel can show "approved by Sam for Dana" instead of only Dana.
- **Real vs simulated fork** (`ciba.js:126-157`): real bc-authorize is attempted first (`cibaService.initiateBackchannelAuth`, hitting `config/oauth.js`'s real `cibaEndpoint` getter), falls back to `cibaSimulatedService.initiateSimulated` on any error, controlled by `configStore.getEffective('ciba_failover_mode')` (default `'fallback_simulated'`). Per the locked fidelity decision, Plan A works entirely in the simulated branch — no need to touch the real-PingOne branch or `cibaService.js`.

#### 3.2 CIBA trigger / declaration path — `demo_api_server/config/useCases.js`, `services/mcpToolAuthorizationService.js`, `services/useCaseDemoBehaviors.js`

- UC22 (`useCases.js:455-487`) declares the CIBA use case:
  ```js
  {
    id: 'UC22', useCaseId: 'ciba-out-of-band-approval', track: 'hitl',
    trigger: { type: 'chip', text: 'transfer $600 from checking to savings' },  // banking phrasing; workforce gets its own via perVertical
    maturity: 'flag:ff_ciba',
    stepUpMethod: 'ciba',              // the durable, amount-independent trigger
    perVertical: AMOUNT_PER_VERTICAL(600),
    primaryTool: 'create_transfer',
  }
  ```
  `AMOUNT_PER_VERTICAL(amount)` (defined `useCases.js:117-118`) builds per-vertical chip trigger text via `amountTriggerByVertical(amount)` (`:50`) and a per-vertical primary-tool override via `AMOUNT_PRIMARY_TOOL_BY_VERTICAL` (`:96`) — workforce's entry there is `'submit_expense'` and its trigger phrase is `submit a $${n} expense`, so workforce's CIBA-eligible chip phrase is **"submit a $600 expense"** (confirm exact wording by reading `amountTriggerByVertical` / `AMOUNT_PRIMARY_TOOL_BY_VERTICAL` directly — not fully re-quoted here).
- **How `useCaseId` reaches authorization at runtime:** `mcpToolAuthorizationService.js:526` calls `resolveActiveUseCaseId(req)` (defined in `services/useCaseDemoBehaviors.js:29` — read this function next, it was not yet fully read this session) to determine which use case is "active" for the current tool call. That `useCaseId` flows into `resolveStepUpMethod(useCaseId)` (`:275-283`, reads `getUseCaseStepUpMethod` from `config/useCases.js`) and `_applyTransactionPolicy(...)`'s `declaresCiba = getUseCaseStepUpMethod(useCaseId) === 'ciba'` (`:322`), which forces `step_up_method: 'ciba'` in the 428 response regardless of amount-band overlap with UC7 (step-up-required). **Before writing Plan A's trigger task, read `useCaseDemoBehaviors.js:29`'s full body** — it decides whether a workforce "submit a $600 expense" chip actually resolves to `ciba-out-of-band-approval` or to the plain `step-up-required` use case, which determines whether CIBA fires for workforce today at all (prior exploration found NO evidence CIBA is currently wired into the workforce manifest's chips — this needs confirming/fixing as part of Plan A).
- **UI trigger** (`demo_api_ui/src/components/AIAgent.js:4076`): `if (normalized.step_up_method === "ciba") { ... }` opens an approval tab, `POST /api/auth/ciba/initiate` (`:4092`), then polls (`:4119`). This is the acting user's own session — for Plan A, this stays the EMPLOYEE's flow; the NEW piece is a manager-side surface that doesn't exist yet (see §3.5).

#### 3.3 Delegation grant (already live, reuse as-is) — `demo_api_server/routes/delegation.js`, `services/delegationService.js`

- `POST /api/delegation` → `grantDelegation({ delegatorUserId, delegatorEmail, delegateEmail, scopes })` (`delegationService.js`). `VALID_SCOPES` (`:16-22`) = `view_accounts, view_balances, create_deposit, create_withdrawal, create_transfer`.
- Persists an LMDB record (`_db().putSync`, `:200-212`): `{ id, delegator_user_id, delegator_email, delegate_email, delegate_user_id, scopes, status, granted_at, revoked_at }`. This is the "manager grants employee standing scope" half of stage 4 — **already works, no changes needed.** The manager grants `create_transfer` (relabeled "Approve Expenses" for workforce, display-only — the wire scope is still `create_transfer`).
- Syncs the GRANTOR's PingOne `delegatedTo` attribute (`:36-49`, `pingOneUserService.js:393-402`, `PATCH /users/{grantorId} { delegatedTo: subs }`).
- `middleware/delegationGate.js` enforces the grant is still active for any `act.client_id`-bearing token; `middleware/delegationAuditLogger.js` logs sensitive ops. Neither needs changes for Plan A — they're grant-enforcement, not approval-enforcement.

#### 3.4 Workforce demo personas — GAP, must be provisioned

- `demo_api_server/config/verticals/workforce/manifest.json:320-329` `demoUsers` block has only:
  ```json
  "customer": { "hint": "demoUser",  "passwordHint": "Tigers7&" },
  "admin":    { "hint": "demoAdmin", "passwordHint": "Tigers7&" }
  ```
  No manager, no distinct employee. A third identity `demoDelegate` exists but is provisioned globally (not workforce-specific): `services/pingOneGroupProvisionService.js:14` `DEMO_USERNAMES = ['demoUser', 'demoAdmin', 'demoDelegate']`, and `services/pingoneProvisionService.js` around lines 2045-2077 ("Step 14.5: Create demo user demoDelegate + delegation markers") is the pattern to follow for provisioning new named users.
- **Plan A action:** add two new workforce-specific demo users (e.g. `demoWfManager` / `demoWfEmployee`, or better names — this is a naming decision for whoever writes Plan A) following the Step-14.5 pattern in `pingoneProvisionService.js`, and add them to the workforce manifest's `demoUsers` block. This is a **live PingOne provisioning change** — per project convention (CLAUDE.md), read the provisioning script fully before running it, and prefer the PingOne MCP tools for user creation/inspection over raw Management API calls where possible (`pingone-mcp` skill).

#### 3.5 What does NOT exist yet and must be designed in Plan A

No file today lets a manager see "an employee's expense is awaiting my approval" and act on it from their own session. This needs:
- A server-side lookup for pending CIBA-style approval requests that isn't scoped to `req.session` (see §3.1's biggest fork) — likely a small new store (LMDB, matching `delegationService.js`'s pattern) keyed by `auth_req_id`, holding `{ subjectUserId, approverUserId, ... }`.
- A UI surface for the manager to see and act on it — could be a new route/page, or a section on an existing manager-facing page (e.g. a "Pending Approvals" panel). This is a real UX decision — brainstorm it, don't assume.
- A binding from "employee submits $600 expense" → "the SPECIFIC manager who granted their delegation" (not just any admin) — the delegation record's `delegator_user_id` (§3.3) is the natural source for who the approver should be.

---

## 4. How to proceed when resuming

1. Re-read this doc (§2-§3.5) — no need to re-explore the codebase, the file:line references above are current as of commit `80f6c99ec`.
2. Read `useCaseDemoBehaviors.js:29` (`resolveActiveUseCaseId`) in full — the one piece of the trace not yet fully read this session.
3. Confirm (or design, if genuinely undecided) the approval-request storage mechanism and the manager-facing UI surface (§3.5) — these are real open design questions, not yet locked, unlike fidelity/personas which ARE locked.
4. Invoke `superpowers:brainstorming` if the UX/storage design in §3.5 needs user input, otherwise go straight to `superpowers:writing-plans` for Plan A, following the same worktree + `superpowers:subagent-driven-development` execution pattern used for Plan B.
5. This is auth/session-adjacent work — invoke `.claude/skills/regression-guard/` before editing, per project CLAUDE.md, and state the specific invariant being preserved (e.g. "not changing `delegationGate`'s enforcement, only adding an approver field alongside it").
