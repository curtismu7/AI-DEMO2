# User Stories

INVEST-compliant stories for approved requirements (FR/NFR).

---

## US-01 — View account nickname via chip
**As** P2 (retail user)  
**I want** to click **Account nickname** in the Actions strip  
**So that** I see my account display name without asking in natural language

**Maps to**: FR-005, FR-006, FR-007

### Acceptance criteria
- [ ] Chip `id` is stable (e.g. `account_nickname`); label **Account nickname**
- [ ] Chip is in `ACTION_GROUPS.account` and listed in `API_DIRECT_CHIPS`
- [ ] Success shows human-readable text (not raw JSON) via existing format path
- [ ] If nickname missing, user sees type + masked number (e.g. `Checking …1234`)

---

## US-02 — Nickname without accountId
**As** P2  
**I want** the tool to default to my primary/first checking account when I do not pass `accountId`  
**So that** the chip works in one click

**Maps to**: FR-003

### Acceptance criteria
- [ ] `accountId` optional in inputSchema
- [ ] Resolution order documented: primary checking → first checking in list
- [ ] Error if user has no checking account (clear tool error, not empty bubble)

---

## US-03 — Agent calls get_account_nickname
**As** P3 (integrator)  
**I want** `tools/call` for `get_account_nickname` through the gateway  
**So that** agents can fetch a single nickname field with least privilege

**Maps to**: FR-001, FR-004, NFR-008

### Acceptance criteria
- [ ] Tool registered in `BankingToolRegistry` with `readOnly: true`, `requiresUserAuth: true`
- [ ] `TOOL_SCOPES` includes `get_account_nickname: ['read']`
- [ ] Gateway accepts delegated token; no new auth surface

---

## US-04 — Safe brownfield delivery
**As** P1 (presenter)  
**I want** zero changes to token exchange / session / PingOne login  
**So that** the demo does not regress protected auth flows

**Maps to**: NFR-001, NFR-002, NFR-004

### Acceptance criteria
- [ ] No diffs under protected paths in REGRESSION_PLAN §1
- [ ] Handler uses existing `getMyAccounts` / balance APIs only
- [ ] Construction committed from a dedicated worktree

---

## US-05 — Regression tests
**As** P1  
**I want** automated tests for MCP registration and chip presence  
**So that** refactors do not drop the pilot feature

**Maps to**: FR-008

### Acceptance criteria
- [ ] Unit tests: handler fallback logic, registry contains tool, scope map entry
- [ ] UI test or assertion: chip appears in account group / API_DIRECT_CHIPS
