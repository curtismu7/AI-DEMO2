# Requirements Clarification Questions

Pilot: read-only MCP tool `get_account_nickname` + Actions chip.

Answer each question by putting a letter after `[Answer]:` (e.g. `[Answer]: B`).
For **X) Other**, put the letter and your description on the same line or the next line.
When finished, tell the agent: **Answers filled. Continue AI-DLC.**

---

## Question 1
What should `get_account_nickname` return when the account has no nickname / display name?

A) Return empty string and let the chip show a blank label

B) Fall back to account type + masked number (e.g. "Checking …1234")

C) Fall back to `accountId` only

D) Return an error / tool failure if nickname is missing

X) Other (please describe after [Answer]: tag below)

[Answer]: B  # pilot default (applied on Continue)
## Question 2
How should the caller identify the account?

A) Required `accountId` argument only

B) Optional `accountId`; if omitted, use the user's primary / first checking account

C) Accept either `accountId` or `account_type` (checking/savings/…) and resolve one account

X) Other (please describe after [Answer]: tag below)

[Answer]: B  # pilot default (applied on Continue)
## Question 3
Which auth / token surface should this tool use?

A) User-delegated MCP via existing gateway path (TX token, `read` scope) — same as `get_my_accounts`

B) Public / unauthenticated catalog tool (like progressive-trust public tools)

C) Agent-only internal tool (no end-user delegation)

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)
## Question 4
Where should the Actions chip appear?

A) Banking / default Actions strip only

B) All verticals that already show banking read chips

C) Banking Actions strip + Direct MCP teaching set (same vertical as other core banking chips)

X) Other (please describe after [Answer]: tag below)

[Answer]: C  # pilot default (applied on Continue)
## Question 5
Chip label / prompt text?

A) "Account nickname" — short label; tool `get_account_nickname`

B) "Show account nickname" — action-oriented label

C) Reuse wording close to existing account chips (match `get_my_accounts` style)

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)
## Question 6
Is this tool redundant with `get_my_accounts` (which already returns account names)?

A) Still add it — teaching surface for a narrow single-field read tool + chip

B) Cancel pilot — document that nickname should come from `get_my_accounts` instead

C) Add tool but no chip — MCP-only for agents

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)
## Question 7
Empty / error UX in the chat bubble?

A) Same human-readable formatting path as other Direct MCP / heuristic results (no raw JSON dump)

B) Always show structured JSON for this tool (debug-oriented)

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)
## Question 8
Unit / regression test expectation for Construction?

A) MCP unit tests for handler + registry/scope map only

B) MCP unit tests + one UI chip wiring test (or snapshot of chip list)

C) Manual demo verification only for this pilot

X) Other (please describe after [Answer]: tag below)

[Answer]: B  # pilot default (applied on Continue)
## Question 9
Security Baseline extension — enforce SECURITY rules as blocking constraints?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)

B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)
## Question 10
Property-Based Testing extension?

A) Yes — enforce all PBT rules as blocking constraints

B) Partial — PBT only for pure functions / serialization round-trips

C) No — skip all PBT rules (suitable for simple CRUD / thin integration)

X) Other (please describe after [Answer]: tag below)

[Answer]: C  # pilot default (applied on Continue)
## Question 11
Resiliency Baseline extension?

A) Yes — apply resiliency baseline as directional design-time guidance

B) No — skip resiliency baseline (suitable for PoCs / rapid iteration)

X) Other (please describe after [Answer]: tag below)

[Answer]: B  # pilot default (applied on Continue)
## Question 12
Protected-area stance (REGRESSION_PLAN §1)?

A) Hard constraint: zero changes to token exchange, BFF session, or PingOne login paths

B) Allow minimal BFF read endpoint only if MCP cannot get nickname from existing APIs — still no session/TX changes

X) Other (please describe after [Answer]: tag below)

[Answer]: A  # pilot default (applied on Continue)