
# Demo Resource Server — Tool-to-Use-Case Map

## Core Banking Tools

| Tool | Chip / Trigger | Use Case | Expected Outcome |
|------|----------------|----------|------------------|
| `get_my_accounts` | "show my accounts" | UC1, UC3, UC4, UC17 | PERMIT — delegated access proof |
| `get_account_balance` | "what is my balance" | UC1, UC3, UC4, UC17, UC20, UC33 | PERMIT — foundation scenario |
| `get_account_nickname` | (part of account lookup) | — | Display helper |
| `get_sensitive_account_details` | (consent gate) | UC9 | Requires `sensitive:read` + group entitlement |
| `get_my_transactions` | "recent transactions" | UC34 | PERMIT — transaction analysis |
| `search_transactions` | (LLM-driven filter) | UC34 | PERMIT — pattern detection |
| `get_transaction_detail` | (drill-down) | — | Single record lookup |
| `get_branch_hours` | "branches near me" | UC24 | PERMIT — public catalog, no auth |
| `sequential_think` | (reasoning) | UC34, UC35 | Step-by-step analysis |

## Write Tools (amount-gated)

| Tool | Trigger | Use Case | Outcome |
|------|---------|----------|---------|
| `create_transfer` $2,500 | "transfer $2500" | UC6 | **DENY** — exceeds policy ceiling |
| `create_transfer` $600 | "transfer $600" | UC7 | **STEP_UP** — MFA required |
| `create_transfer` $300 | "transfer $300" | UC8 | **HITL** — consent modal |
| `create_transfer` $150 | "transfer $150" | UC22 | **CIBA** — out-of-band approval |
| `create_transfer` (within PAR cap) | — | UC14b | **PERMIT** — intent verified |
| `create_transfer` (over PAR cap) | — | UC14 | **DENY** — PAR exceeded |
| `create_deposit` / `create_withdrawal` | — | — | >$250 requires consent |
| `update_contact_email` | — | — | Account management |
| `request_fee_waiver` | — | — | Customer service |

## Admin Tools

| Tool | Scope | Use Case | Purpose |
|------|-------|----------|---------|
| `lookup_customer` | admin:read | Admin vertical | Search by name/email |
| `get_customer_profile` | admin:read | Admin vertical | Full profile |
| `get_customer_accounts` | admin:read | Admin vertical | Customer's accounts |
| `get_customer_transactions` | admin:read | Admin vertical | Transaction history |
| `freeze_account` | admin:write | Admin vertical | Toggle account status |
| `reset_customer_password` | admin:write | Admin vertical | Force reset |
| `adjust_balance` | admin:write | Admin vertical | Seed transaction |
| `delete_customer` | admin:delete | Admin vertical | Permanent deletion |

## Third-Party MCP (Weather)

| Tool | Trigger | Use Case | Outcome |
|------|---------|----------|---------|
| `get_weather` | "weather in Austin, TX" | UC30 | **PERMIT** — Texas in-scope |
| `get_weather` | "weather in Miami" | UC31 | **DENY** — Florida out-of-scope |
| `get_weather` | (after admin reconfigure) | UC32 | Policy flipped live at gateway |

## Vertical Tools (per-vertical chip triggers)

| Vertical | Read Tool / Chip | A2A Tool (UC2) / Chip |
|----------|-----------------|----------------------|
| Healthcare | `view_coverage` / "check my coverage" | `sensitive_patient_records` / "show my sensitive patient records" |
| Retail | `list_orders` / "list my orders" | `sensitive_order_history` / "show my sensitive order history" |
| Government | `view_permits` / "show my permits" | `sensitive_tax_record` / "show my sensitive tax record" |
| University | `view_courses` / "show my enrolled courses" | `sensitive_student_finance` / "access my sensitive student finance" |
| Workforce | `view_benefits` / "my benefits" | `sensitive_payroll_details` / "show my sensitive payroll details" |
| Sporting Goods | `list_gear` / "my gear" | `sensitive_membership_details` / "show my sensitive membership details" |
| Manufacturing | `view_work_orders` / "show my work orders" | `sensitive_supplier_contract` / "show my sensitive supplier contract" |
| Investment | `view_portfolios` / "show my portfolios" | `sensitive_holdings` / "show my sensitive holdings" |

## Attack / Security Scenarios (no tool dispatched)

| Use Case | Attack Vector | Detection Point | Result |
|----------|--------------|-----------------|--------|
| UC5 | Insufficient scope | Token missing write scope | DENY 403 |
| UC10 | Cross-owner account | Resource owner mismatch | DENY |
| UC11 | Wrong token audience | `aud` claim mismatch | DENY 401 |
| UC12 | Token theft / replay | DPoP binding | DENY 401 |
| UC13 | Rogue actor injection | Native `act` validation | DENY |
| UC14 | PAR overage | Amount > authorization_details | DENY |
| UC15 | Intent tampering | Signature verification | DENY 401 |
| UC18 | Rate-limit burst | Per-agent quota | DENY 429 |
| UC29 | Introspection down | OAuth backend unreachable | DENY 503 (fail-closed) |

## Reference Data (public, no auth)

| Tool | Description |
|------|-------------|
| `list_account_types` | Checking, savings, loan, credit, investment |
| `list_transaction_types` | Deposit, withdrawal, transfer, payment, purchase |
| `show_supported_currencies` | USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR, MXN |
| `get_fee_schedule` | Fee schedule with optional category filter |
| `list_verticals` | All supported industry verticals |

## Additional Resource Servers

| Server | Port | Auth | Tools |
|--------|------|------|-------|
| `demo_mcp_invest` | 8081 | JWT + RFC 9728 | `get_investment_accounts`, `get_investment_balance`, `get_portfolio_summary`, `get_investment_transactions` |
| `demo_mortgage_service` | 8082 | X-API-Key (gateway-swapped) | Per-vertical REST endpoints (mortgage, healthcare, retail, etc.) |
