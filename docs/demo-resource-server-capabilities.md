
# Demo Resource Server — Tool-to-Use-Case Map

## Architecture

| Service | Port | Auth Mechanism | Role |
|---------|------|----------------|------|
| `demo_mcp_server` | (embedded in BFF) | RFC 8693 token + scope topology | Main tool registry (40+ banking, 199 vertical) |
| `demo_mcp_gateway` | 7474 | Token introspection + audience binding | Enforces auth, rate limits, dispositions |
| `demo_mcp_weather` | 8896 | None (internal bridge) | HTTP-to-stdio wrapper for weather MCP |
| `demo_mcp_invest` | 8081 | `invest:read` scope + RFC 8693 | **MCP Resource Server** — investment portfolio tools |
| `demo_mortgage_service` | 8082 | X-API-Key (SHA256 constant-time) | **API Resource Server** — gateway swaps OAuth bearer for API key |
| `demo_authz_server` | 8081 | (simulated) | PingOne Authorize decision simulator |

---

## Core Banking Tools (read scope)

| Tool | Chip / Trigger | Use Case | Expected Outcome |
|------|----------------|----------|------------------|
| `get_my_accounts` | "show my accounts" | UC1, UC3, UC4, UC17 | PERMIT — delegated access proof |
| `get_account_balance` | "what is my balance" | UC1, UC3, UC4, UC17, UC20, UC33 | PERMIT — foundation scenario |
| `get_account_nickname` | (part of account lookup) | — | Display helper |
| `get_sensitive_account_details` | (consent gate) | UC9 | Requires `sensitive:read` + `Banking_Privileged` group |
| `get_my_transactions` | "recent transactions" | UC34 | PERMIT — transaction analysis |
| `search_transactions` | (LLM-driven filter) | UC34 | PERMIT — pattern detection |
| `get_transaction_detail` | (drill-down) | — | Single record lookup |
| `get_branch_hours` | "branches near me" | UC24 | PERMIT — public catalog, no auth |
| `sequential_think` | (reasoning) | UC34, UC35 | Step-by-step analysis |
| `query_user_by_email` | — | — | Email-based user lookup |

## Write Tools (amount-gated by PingOne Authorize)

| Tool | Trigger | Use Case | Outcome |
|------|---------|----------|---------|
| `create_transfer` ≥ $2,500 | "transfer $2500" | UC6 | **DENY** — exceeds policy ceiling |
| `create_transfer` $500–$2,000 | "transfer $600" | UC7 | **STEP_UP** — MFA required (p1mfa) |
| `create_transfer` $250–$500 | "transfer $300" | UC8 | **HITL** — consent ticket + dashboard approval |
| `create_transfer` < $250 | "transfer $150" | UC22 | **CIBA** — out-of-band approval |
| `create_transfer` (within PAR cap) | — | UC14b | **PERMIT** — intent verified via authorization_details |
| `create_transfer` (over PAR cap) | — | UC14 | **DENY** — RFC 9396 cap exceeded |
| `create_deposit` / `create_withdrawal` | — | — | > $250 requires consent |
| `update_contact_email` | — | — | Account management |
| `request_fee_waiver` | — | — | Customer service |

## Admin Tools (vertical = admin)

| Tool | Scopes Required | Purpose |
|------|-----------------|---------|
| `lookup_customer` | `admin:read` + `users:read` | Search by name/email |
| `get_customer_profile` | `admin:read` + `users:read` | Full customer profile |
| `get_customer_accounts` | `admin:read` + `users:read` | Customer's accounts |
| `get_customer_transactions` | `admin:read` + `users:read` | Transaction history |
| `freeze_account` | `admin:write` + `users:manage` | Toggle account status |
| `reset_customer_password` | `admin:write` + `users:manage` | Force password reset |
| `adjust_balance` | `admin:write` + `users:manage` | Seed/correct transaction |
| `delete_customer` | `admin:write` + `admin:delete` + `users:manage` | Permanent deletion (confirm: true) |

## Third-Party MCP (Weather — UC30–UC32)

| Tool | Trigger | Use Case | Outcome |
|------|---------|----------|---------|
| `get_weather` | "weather in Austin, TX" | UC30 | **PERMIT** — Texas in-scope |
| `get_weather` | "weather in Miami" | UC31 | **DENY** — Florida out-of-scope |
| `get_weather` | (after admin reconfigure) | UC32 | Policy flipped live via Allowed State dropdown |

---

## Vertical Tools (9 verticals, 199 tools total)

Each vertical exposes Read, Write (amount-gated), and A2A-Delegated tool tiers with the same threshold behavior as banking.

| Vertical | Read Tool / Chip | Write Tool / Chip | A2A Sensitive Tool / Chip | Delegated Scope |
|----------|-----------------|-------------------|---------------------------|-----------------|
| Healthcare | `view_coverage` / "check my coverage" | `pay_bill` / "pay my $[amt] bill" | `sensitive_patient_records` / "show my sensitive patient records" | `records:read` |
| Retail | `list_orders` / "list my orders" | `checkout` / "checkout headphones for $[amt]" | `sensitive_order_history` / "show my sensitive order history" | `records:read` |
| Government | `view_permits` / "show my permits" | `pay_fee` / "pay the $[amt] fee" | `sensitive_tax_record` / "show my sensitive tax record" | `tax:read` |
| University | `view_courses` / "show my enrolled courses" | `pay_tuition_balance` / "pay $[amt] tuition" | `sensitive_student_finance` / "access my sensitive student finance" | `finaid:read` |
| Workforce | `view_benefits` / "my benefits" | `submit_expense` / "submit a $[amt] expense" | `sensitive_payroll_details` / "show my sensitive payroll details" | — |
| Sporting Goods | `list_gear` / "my gear" | `extend_rental` / "extend my rental $[amt]" | `sensitive_membership_details` / "show my sensitive membership details" | — |
| Manufacturing | `view_work_orders` / "show my work orders" | `approve_purchase_order` / "approve a $[amt] purchase order" | `sensitive_supplier_contract` / "show my sensitive supplier contract" | `supplier:read` |
| Investment | `view_portfolios` / "show my portfolios" | `large_trade` / "execute a large trade of $[amt]" | `sensitive_holdings` / "show my sensitive holdings" | — |
| PingOne Admin | `list_pingone_tools` | `call_pingone_tool` | — | — |

### A2A Delegation (UC2 / UC2.5)

RFC 8693 nested-act token exchange with scope narrowing at each hop. Generalist agent → Specialist agent with narrowed delegated scope. UC2.5 uses CrewAI orchestrator for autonomous delegation routing.

---

## Feature/Vertical API-Key Tools (gateway-swapped → API Resource Server)

| Tool | Disposition | Backend |
|------|-------------|---------|
| `show_mortgage` | api_key | demo_mortgage_service |
| `show_health_record` | api_key | demo_mortgage_service |
| `show_investment` | api_key | demo_mortgage_service |
| `show_gear_order` | api_key | demo_mortgage_service |
| `show_expense_report` | api_key | demo_mortgage_service |
| `show_permit` | api_key | demo_mortgage_service |
| `show_enrollment` | api_key | demo_mortgage_service |
| `show_work_order` | api_key | demo_mortgage_service |
| `show_large_purchase` | api_key | demo_mortgage_service |

Gateway intercepts the OAuth bearer token, validates the tool scope, then substitutes an X-API-Key for the downstream service call.

---

## Investment Tools (MCP Resource Server — demo_mcp_invest)

| Tool | Description |
|------|-------------|
| `get_investment_accounts` | List investment accounts |
| `get_investment_balance` | Balance + holdings per account |
| `get_portfolio_summary` | Full portfolio with allocation/performance/holdings (period: 1d/1w/1m/3m/1y/ytd) |
| `get_investment_transactions` | Recent trades (default limit 20) |

Auth: `invest:read` scope required.

---

## Attack / Security Scenarios

| UC | Attack Vector | Detection Point | Result |
|----|--------------|-----------------|--------|
| UC5 | Token theft & replay | Audience binding + DPoP key-binding | DENY 401 |
| UC10 | CIBA approval violation | CIBA nonce validation | DENY |
| UC13 | Confused-deputy / rogue actor injection | Native `act` claim (non-spoofable) vs header fallback | DENY |
| UC14 | PAR intent violation | RFC 9396 authorization_details cap | DENY |
| UC15 | Intent-token tampering | Signature + expiry validation | DENY 401 |
| UC16 | Impersonation without delegation | OBO requires act claim | DENY 401 |
| UC18 | Rate-limit burst | Per-agent/per-tool quota at gateway | DENY 429 |
| UC29 | OAuth outage (fail-closed) | RFC 7662 introspection on request path | DENY 503 |

---

## Reference Data (public, no auth)

| Tool | Description |
|------|-------------|
| `list_account_types` | Checking, savings, loan, credit, investment |
| `list_transaction_types` | Deposit, withdrawal, transfer, payment, purchase |
| `show_supported_currencies` | USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR, MXN |
| `get_fee_schedule` | Fee schedule with optional category filter |
| `list_verticals` | All supported industry verticals |
| `get_branch_hours` | Public branch/ATM catalog |

---

## User Groups & Entitlements

| Group | Effect |
|-------|--------|
| `Banking_Privileged` | Access `get_sensitive_account_details` (UC9) |
| `Banking_Delegates` | Authorized to act as agent |
| `Banking_PremiumTier` | Higher limits ($50k vs $2k), wire transfer tools (UC21) |

---

## Use Case Index

### Foundations
UC1 (delegated proof), UC2 (A2A), UC2.5 (orchestration), UC3 (act gate), UC19 (identity lifecycle), UC20 (audit), UC33 (mortgage), UC34 (pattern detection), UC35 (explain denial)

### Controls
UC4 (overscoped), UC6 (deny), UC7 (step-up), UC8 (HITL), UC9 (privilege), UC17 (JIT tokens)

### Attacks
UC5, UC10, UC13–UC16, UC18, UC29

### HITL / Integration
UC21 (premium tier), UC22 (CIBA), UC23 (guided journey), UC24 (public catalog), UC25 (enterprise MCP), UC26 (workspace agent), UC27 (self-transfer), UC28 (cross-vertical)

### Learning Hub
UC30 (weather permit), UC31 (weather deny), UC32 (live policy flip)

---

## Code References

| Area | Path |
|------|------|
| Banking tool definitions | `demo_mcp_server/src/tools/BankingToolRegistry.ts` |
| Vertical tools (generated) | `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` |
| Investment tools | `demo_mcp_invest/src/tools/investTools.ts` |
| Use cases (SoT) | `demo_api_server/config/useCases.js` |
| Scopes | `demo_api_server/config/scopes.js` |
| Scope topology | `scope-topology.json` |
| Vertical configs | `demo_api_server/config/verticals/` |
| Intent token service | `demo_api_server/services/intentTokenService.js` |
| Intent token validator (gateway) | `demo_mcp_gateway/src/intentTokenValidator.ts` |
| RS interstitial component | `demo_api_ui/src/components/ResourceServerInterstitial.jsx` |
| RS journey page (Alt B) | `demo_api_ui/src/pages/ResourceServerJourneyPage.jsx` |
| RS journey CSS (light/dark) | `demo_api_ui/src/pages/ResourceServerJourneyPage.css` |
| RS journey routes | `/rs/olb`, `/rs/invest`, `/rs/api` in `demo_api_ui/src/App.js` |
| BFF vertical-record endpoint | `demo_api_server/routes/resourceServer.js` (`GET /vertical-record`) |
| Feature data generator | `scripts/gen-feature-data.js` |
| Generated feature records | `demo_mortgage_service/feature-records.generated.json` |

---

## Intent Token Binding (UC15, UC17)

The BFF mints a signed JWT (`X-Intent-Token` header) before every tool call. The gateway validates it on the request path.

| Stage | Component | Action |
|-------|-----------|--------|
| 1. Extract | BFF (`agentRun.js`) | NLP extracts `intent` + `confidence` from user prompt |
| 2. Mint | BFF (`intentTokenService.js`) | Signs JWT with `{userId, sessionId, intent, confidence, permitted_tools[]}` |
| 3. Attach | BFF | Sets `X-Intent-Token` header on outbound MCP request |
| 4. Validate | Gateway (`intentTokenValidator.ts`) | Verifies signature, expiry, checks tool ∈ `permitted_tools` |
| 5. Enforce | Gateway | If `INTENT_TOKEN_REQUIRED=true` and invalid → DENY 401 |

Feature flag: `ff_intent_token_enabled` (default on). Gateway enforcement: `INTENT_TOKEN_REQUIRED` env var.

---

## Resource Server Page Routing

Three dedicated RS journey pages show tool results in a split-view UI (token/credential on the left, data on the right) with a light/dark mode toggle. Each vertical routes at least one use case to an RS page instead of returning text to the agent chat.

### The 3 Resource Server Journey Pages

| RS Page | Route | Backend Service | Left Panel | Right Panel |
|---------|-------|-----------------|------------|-------------|
| **MCP Server (OLB)** | `/rs/olb` | `demo_mcp_server` | RFC 8693 exchanged token claims (sub, aud, scope, act) | Account list from banking DB |
| **MCP Resource Server** | `/rs/invest` | `demo_mcp_invest` | RFC 8693 exchanged token claims (audience: mcp-invest.ping.demo) | Portfolio summary cards |
| **API Resource Server** | `/rs/api` | `demo_mortgage_service` | Credential swap proof (Bearer → X-API-Key) | Vertical-specific record (9 verticals) |

### Vertical → RS Page Mapping

| Vertical | Route | Trigger Tool | Record Data |
|----------|-------|-------------|-------------|
| Banking (OLB) | `/rs/olb?tool=get_my_accounts` | `get_my_accounts` | Accounts + balances |
| Investment | `/rs/invest?tool=get_portfolio_summary` | `get_portfolio_summary` | Portfolio holdings |
| Banking (Mortgage) | `/rs/api?tool=show_mortgage&vertical=mortgage` | `show_mortgage` | Loan details, payment schedule |
| Healthcare | `/rs/api?tool=show_health_record&vertical=healthRecord` | `show_health_record` | Patient record, labs, medications |
| Sporting Goods | `/rs/api?tool=show_gear_order&vertical=gearOrder` | `show_gear_order` | Gear order, shipping status |
| Retail | `/rs/api?tool=show_large_purchase&vertical=largePurchase` | `show_large_purchase` | Purchase detail, warranty, delivery |
| Workforce | `/rs/api?tool=show_expense_report&vertical=expenseReport` | `show_expense_report` | Expense line items, approval status |
| Government | `/rs/api?tool=show_permit&vertical=permit` | `show_permit` | Permit record, inspection status |
| University | `/rs/api?tool=show_enrollment&vertical=enrollment` | `show_enrollment` | Enrollment, GPA, tuition balance |
| Manufacturing | `/rs/api?tool=show_work_order&vertical=workOrder` | `show_work_order` | Work order, production progress |
| Investment (API) | `/rs/api?tool=show_investment&vertical=invest` | `show_investment` | Portfolio via API key path |

### Feature Data Coverage

All 9 API RS verticals have `feature-data.json` in `demo_api_server/config/verticals/<id>/`:

`banking`, `healthcare`, `sporting-goods`, `retail`, `workforce`, `government`, `university`, `manufacturing`, `investment`

Generated into `demo_mortgage_service/feature-records.generated.json` via `node scripts/gen-feature-data.js generate`.

### Design

- **Alt B split view**: token/credential on left, data on right (no timeline)
- **Light/dark mode toggle**: persisted to `localStorage` (`rsj-theme`), CSS custom properties for all colors
- **Per-RS badge colors**: OLB (blue), MCP RS (green), API RS (gold)

### Demo Point

Agentic tool calls **navigate the user to a dedicated RS page** — not just return text to the chat. The RS page displays the resource server's response with full token inspection, showing exactly which RS processed the request and how the credential was presented.

---

## TODO

- [x] Wire `ResourceServerInterstitial` to navigate to `/rs/*` pages after countdown (`buildRsRoute` + `useNavigate`)
- [x] Add all 9 vertical `feature-data.json` files (was 4, now 9)
- [ ] Docker service renames: `demo_mcp_invest` → `demo_mcp_resource_server`, `demo_mortgage_service` → `demo_api_resource_server`
- [ ] Add per-vertical custom card layouts in RS page right panel (currently generic k/v renderer for all API RS verticals)
- [ ] Add RS page links to the existing `/resource-server` page (cross-navigation)
- [ ] E2E tests for RS page routing (navigate to `/rs/api?tool=show_mortgage`, verify data renders)
