# Plan: Format Direct MCP results + restore must-have Actions chips per vertical

**Status:** draft  
**Date:** 2026-07-08  
**Branch intent:** `docs/mcp-format-and-vertical-chips`  
**Related:** Actions dropdown `chips10`, Direct MCP (`mode: "direct"`), Security Showcase (separate)

---

## Goals

1. **Keep the Direct MCP chip** — it is the right teaching surface for “agent skipped; typed `tools/call` only.”
2. **Stop dumping raw JSON** into chat when that chip succeeds; show the same human-readable result shape the heuristic path already uses.
3. **Stop “losing” chips** — trim duplicates / no-tool fluff, and ensure each vertical’s Actions set covers the **most important** demo use cases (not every UC).

Out of scope for this plan: redesigning Security Showcase tabs; PingOne Admin chips; full Investment product build beyond a chip-set proposal.

---

## Part 1 — Format Direct MCP (keep the chip)

### Today

| Step | Behavior |
|------|----------|
| Click **Direct MCP** | `AIAgent.onChipClick` → `/api/demo-agent/nl` (heuristic) → resolve tool → `callMcpTool` |
| Success | `JSON.stringify(normalized, null, 2)` into the assistant bubble |
| Heuristic / banking `runAction` | Already uses `formatResult()` (+ optional ResultsPanel) |

**Dump site:** `demo_api_ui/src/components/AIAgent.js` (Direct MCP success branch — currently stringifies the normalized MCP result).

### Target UX

```
Assistant
  [Direct MCP · get_my_accounts]

  Your accounts
  • Checking  … $1,234.56
  • Savings   … $5,678.90

  ▸ Raw MCP response   ← collapsed JsonField (optional, for presenters)
```

Same idea for every vertical’s Direct MCP tool (permits, orders, expenses, courses, …): **formatted first**, raw JSON only behind a disclosure.

### Implementation sketch (minimal)

1. After `normalizeAgentToolResult(mcpResp.result)`:
   - If error → keep current error string.
   - Else → `formatResult(normalized, terminology)` (existing `agentFormatters.js`).
2. Optionally call `inferAgentResultTypeAndData` and open ResultsPanel the same way `runAction` does for accounts/transactions.
3. Append a collapsed **Raw MCP response** via existing `JsonField` / `JsonHighlight` (Token Chain / MCP Inspector already use this pattern).
4. Badge the bubble as Direct MCP (already implied by tool name / caption) so it stays distinct from heuristic replies.

### Acceptance

- Direct MCP chip still present on every core vertical that has it today.
- Chat shows formatted text (or ResultsPanel), not a wall of JSON, for the happy path.
- Presenter can still expand raw JSON in one click.
- Heuristic chips unchanged.

---

## Part 2 — Why chips feel “lost”

| Cause | Effect |
|-------|--------|
| **Authorize tool filter** (`chipPermState`) | Chip with a `tool` not in the live filtered list is **hidden** (e.g. sensitive / cross-vertical tools). |
| **Duplicates** | Same tool twice under different labels (retail order status ×2, workforce expenses ×2, …) — looks busy, adds no use case. |
| **No-tool NL chips** | Labels like “What’s my deductible?” with empty `tool` — fine for LLM mode; in **Heuristics only** they often fail or feel broken. |
| **Investment stub** | Only **1** Actions chip vs ~10–13 elsewhere — biggest gap. |
| **Security Showcase vs Actions** | Showcase chips are separate; customers may think “we lost” MFA/deny chips when looking only at Actions. |
| **Admin-only showcase tab** | PingOne Admin chips hidden for non-admins (by design). |

**Design rule going forward:** Actions ≈ **~7–9 chips** per vertical:

- 4–5 tool-backed heuristic reads/writes  
- 1 HITL / privileged write  
- 1 feature-page / credential-path demo (where the vertical has one)  
- 1 **Direct MCP**  
- 0–2 LLM-tagged questions (explicit `mode: "llm"`)  
- Security Showcase stays its own section  

---

## Part 3 — Must-have Actions chips by vertical

For each vertical: **important use cases** (not exhaustive) → **proposed Actions set**.  
Security Showcase (MFA, Authz DENY, attacks, …) remains shared and is **not** duplicated here.

Legend: `H` = heuristic tool · `HITL` = consent/step-up · `F` = feature / special credential path · `MCP` = Direct MCP · `LLM` = needs model

---

### Super Banking

**Important use cases:** delegated read (UC1), transfer + HITL (UC7/UC8), mortgage/feature path, Direct MCP teaching, LLM spend analysis.

| Chip | Role | Covers |
|------|------|--------|
| My accounts | H | UC1 read |
| Check balance | H | UC1 read |
| Recent transactions | H | UC1 read |
| Transfer $100 | H | write happy path |
| Transfer $500 | HITL | UC7/UC8 |
| My mortgage | F/H | feature / mortgage tool |
| Biggest spending categories | LLM | analysis without inventing tools |
| Direct MCP | MCP | typed `tools/call` on `get_my_accounts` |

**Drop / demote:** duplicate analysis chips that have no tool unless marked `mode: "llm"`.

---

### CareConnect (healthcare)

**Important use cases:** records/coverage (UC1), appointments, release records (HITL), group entitlement / sensitive records (UC9), health-record feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My records | H | UC1 |
| Check coverage | H | UC1 |
| My appointments | H | scheduling read |
| Book an appointment | H | write |
| Release my records | HITL | UC7/UC8 |
| Sensitive records | H (privileged) | UC9 — keep visible when tool is in catalog |
| My health record | F | feature MCP tool |
| Summarize my recent visits | LLM | narrative over visits |
| Direct MCP | MCP | `view_records` / health record |

**Watch:** Sensitive records must stay in the Authorize tool list or it “disappears” via `permState`.

---

### CivicPermit (government)

**Important use cases:** permits/fees (UC1), pay fee, release record (HITL), permit status feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My permits | H | UC1 |
| Fees owed | H | UC1 |
| Pay a fee | H | write |
| Release record | HITL | UC7/UC8 |
| Permit status | F | feature tool |
| Expiring permits | LLM or H+tool | keep only if tool or `mode: "llm"` |
| Direct MCP | MCP | `view_permits` |

**Drop:** no-tool “inspection / renew” chips unless given a tool or LLM mode.

---

### Great Buy (retail)

**Important use cases:** orders/rewards (UC1), checkout HITL (UC8), large-purchase feature, Direct MCP, light LLM compare.

| Chip | Role | Covers |
|------|------|--------|
| List my orders | H | UC1 |
| Where's my order? | H | UC1 |
| My reward points | H | UC1 |
| Checkout | HITL | UC8 |
| My recent purchase | F | feature |
| Compare my last two orders | LLM | analysis |
| Direct MCP | MCP | `list_orders` |

**Drop:** duplicate Track order / Store credit chips that map to the same tools as above.

---

### WX Workforce

**Important use cases:** benefits/PTO/expenses (UC1), submit expense + request PTO (HITL), expense-report feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My benefits | H | UC1 |
| PTO balance | H | UC1 |
| My expenses | H | UC1 |
| Submit an expense | HITL | UC8 |
| Request time off | HITL | UC8 |
| My expense report | F | feature |
| Which expenses are pending? | LLM or H | only if tool or LLM |
| Direct MCP | MCP | `list_expenses` |

**Drop:** Expense history duplicate of My expenses; soft NL-only HR advice chips unless LLM-tagged.

---

### Super Sports (sporting-goods)

**Important use cases:** gear/rentals (UC1), extend rental (HITL), order/loyalty, gear-order feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My gear | H | UC1 |
| My rentals | H | UC1 |
| Extend my rental | HITL | UC8 |
| Order status | H | UC1 |
| My loyalty points | H | UC1 |
| My gear order | F | feature |
| Direct MCP | MCP | `gear_order_status` |

**Drop / LLM-tag:** recommendation chips with no tool (`sg8`–`sg10`) — either `mode: "llm"` or remove from Heuristics-first demos.

---

### Super University

**Important use cases:** courses/standing (UC1), register, transcript release (HITL), enrollment feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My courses | H | UC1 |
| Credit standing | H | UC1 |
| Register a course | H | write |
| Release transcript | HITL | UC8 |
| Enrollment status | F | feature |
| Am I on track to graduate? | LLM | planning question |
| Direct MCP | MCP | `view_courses` |

---

### Precision Works (manufacturing)

**Important use cases:** work orders/inventory (UC1), schedule run, release order (HITL), work-order feature, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| My work orders | H | UC1 |
| Inventory | H | UC1 |
| Schedule a run | H | write |
| Release order | HITL | UC8 |
| Work order status | F | feature |
| Overdue orders | LLM or H+filter | only with tool or LLM |
| Direct MCP | MCP | `view_work_orders` |

---

### Meridian Wealth (investment) — expand from 1 chip

**Important use cases:** portfolio read (UC1), trades, HITL large trade, investment feature / API-key path, Direct MCP.

| Chip | Role | Covers |
|------|------|--------|
| Portfolio status | F | today’s sole chip — keep |
| My portfolios | H | UC1 (needs tool in catalog) |
| Trade history | H | UC1 |
| Large trade | HITL | UC8 |
| YTD performance | LLM | narrative |
| Direct MCP | MCP | e.g. `show_investment` / portfolio tool |
| (+ Security Showcase) | — | currently missing; add shared showcase tabs like other verticals |

This is the largest “lost chips” vertical today.

---

### OAuth Academy (oauth-teaching)

**Important use cases:** OAuth/PKCE/OIDC teaching, token exchange / act chain, HITL concept, token chain — mostly **learning**, not banking tools.

| Chip | Role | Covers |
|------|------|--------|
| What is OAuth? | H/NL | UC-LEARN |
| What is PKCE? | H/NL | UC-LEARN |
| Show token exchange | H/NL | UC-LEARN / RFC 8693 |
| Explain act/may_act | H/NL | delegation |
| Show token chain | H/NL | rail teaching |
| What is HITL? | H/NL | UC8 concept |
| (Optional) Direct MCP | MCP | only if a safe teaching tool exists (e.g. flow diagram) |

Prefer aligning Actions with `OAuthAcademyPage` starter chips rather than inventing banking-style tools.

---

### Cross-cutting (all customer verticals)

Keep **Security Showcase** as the home for:

- Defenses: Authz DENY, bad scope, MFA OTP/FIDO, HITL consent  
- Attacks: confused deputy, injection, HITL replay, …  
- AI reasoning demos  

Do **not** stuff those into `chips10`; that is why Actions felt crowded and then “empty” when filtered.

---

## Part 4 — Suggested delivery slices

| Slice | Work | Done when |
|-------|------|-----------|
| **A** | Direct MCP → `formatResult` + optional ResultsPanel + collapsed raw JSON | No raw JSON wall on Direct MCP success |
| **B** | Manifest cleanup: remove duplicates; mark true LLM chips `mode: "llm"`; ensure HITL + Direct MCP + feature present on each core vertical | Heuristics-only Actions list is scannable (~7–9) and every chip either has a tool or is LLM |
| **C** | Investment (+ showcase) chip expansion to match the table above | Investment no longer a 1-chip stub |
| **D** | Guardrail: chip with `tool` missing from live catalog shows disabled + reason instead of vanishing (optional UX fix for “lost” chips) | Sensitive/privileged chips explain why they’re greyed |

---

## Non-goals

- Replacing Direct MCP with heuristic-only (chip stays).  
- One chip per use-case doc (too many).  
- Changing PingOne Admin / admin-console chip sets in this plan.

---

## Open questions

1. Should Direct MCP always open ResultsPanel when `inferAgentResultTypeAndData` matches, or only format text in chat?  
2. For no-tool question chips: **delete** in Heuristics-first demos, or keep as `mode: "llm"` only?  
3. Investment: implement full tool set now, or ship chip labels + stubs that route to existing `show_investment` until tools land?
