# Vertical Test Matrix

Source of truth for per-vertical chip configuration, HITL triggers, authz rules, and PingOne app requirements.

**Run the full real test suite:**
```bash
./scripts/run-real-tests.sh          # all verticals + shared
./scripts/run-real-tests.sh smoke    # health only
```

---

## HITL Configuration

| Key | Default | Notes |
|---|---|---|
| `ff_hitl_enabled` | `true` | Set in `.env`; LMDB cleared so FIELD_DEFS default (`true`) applies after restart |
| `confirm_threshold_usd` | `250` | Transfers/deposits ≥ $250 trigger HITL consent |
| `step_up_threshold_usd` | `500` | Transactions ≥ $500 trigger MFA step-up |

HITL is **always on by default**. The UI admin can toggle it off for demos, but `.env` resets it to `true` on server restart.

---

## Per-Vertical Matrix

### Banking (`banking`)
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My accounts | bk1 | both | accounts | No | banking vertical |
| Check balance | bk2 | both | balance | No | get_balance |
| Recent transactions | bk3 | both | transactions | No | get_transactions |
| Transfer money ($100) | bk4 | both | transfer | No (< $250 threshold) | create_transfer |
| **⚠️ Transfer $500** | **bk-hitl** | **both** | **transfer** | **Yes (≥ $250)** | **create_transfer** |
| Deposit | bk5 | both | deposit | Conditional ($250+) | create_deposit |
| Withdraw | bk6 | both | withdraw | Conditional ($250+) | create_withdrawal |
| My mortgage | bk7 | both | mortgage_demo | No | show_mortgage (MCP) |

**HITL trigger:** `bk-hitl` — "transfer $500 from checking to savings"
**Authz:** `transfer/deposit/withdraw` have `authz: { consent: true }` in banking/index.js

---

### Healthcare (`healthcare`) — CareConnect
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My records | hc1 | both | view_records | No | view_records |
| Check coverage | hc2 | both | view_coverage | No | view_coverage |
| My appointments | hc3 | both | list_appointments | No | list_appointments |
| Book an appointment | hc4 | both | book_appointment | No (no authz) | book_appointment |
| **Release my records** | **hc5** | **both** | **release_records** | **Yes (stepUp + consent)** | **release_records** |
| What's my deductible? | hc6 | both | view_coverage | No | view_coverage |
| Upcoming visits | hc7 | both | list_appointments | No | list_appointments |

**HITL trigger:** `hc5` — "release my records"
**Authz:** `release_records` has `authz: { stepUp: true, consent: true }`

---

### Retail (`retail`) — Great Buy
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| List my orders | rt1 | both | list_orders | No | list_orders |
| Where's my order? | rt2 | both | order_status | No | order_status |
| My reward points | rt3 | both | rewards_balance | No | rewards_balance |
| **Checkout** | **rt4** | **both** | **checkout** | **Yes (consent)** | **checkout** |
| Order history | rt5 | both | list_orders | No | list_orders |
| Track my order | rt6 | both | order_status | No | order_status |
| Store credit balance | rt7 | both | rewards_balance | No | rewards_balance |

**HITL trigger:** `rt4` — "checkout"
**Authz:** `checkout` has `authz: { consent: true }`

---

### Sporting Goods (`sporting-goods`) — Super Sports
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My gear | sg1 | both | list_gear | No | list_gear |
| My rentals | sg2 | both | list_rentals | No | list_rentals |
| **Extend my rental** | **sg3** | **both** | **extend_rental** | **Yes (consent)** | **extend_rental** |
| Order status | sg4 | both | gear_order_status | No | gear_order_status |
| My loyalty points | sg5 | both | loyalty_balance | No | loyalty_balance |
| What's due back? | sg6 | both | list_rentals | No | list_rentals |
| Order history | sg7 | both | gear_order_status | No | gear_order_status |

**HITL trigger:** `sg3` — "extend my rental"
**Authz:** `extend_rental` has `authz: { consent: true }`

---

### Workforce (`workforce`) — Helix HR
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My benefits | wf1 | both | view_benefits | No | view_benefits |
| PTO balance | wf2 | both | pto_balance | No | pto_balance |
| My expenses | wf3 | both | list_expenses | No | list_expenses |
| **Submit an expense** | **wf4** | **both** | **submit_expense** | **Yes (consent)** | **submit_expense** |
| **Request time off** | **wf5** | **both** | **request_time_off** | **Yes (stepUp + consent)** | **request_time_off** |
| Sick leave balance | wf6 | both | pto_balance | No | pto_balance |
| Expense history | wf7 | both | list_expenses | No | list_expenses |

**HITL trigger:** `wf4` — "submit an expense" (consent), `wf5` — "request time off" (stepUp + consent)
**Authz:** `submit_expense: { consent: true }`, `request_time_off: { stepUp: true, consent: true }`

---

### Government (`government`) — CivicPermit
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My permits | gv1 | both | view_permits | No | view_permits |
| Fees owed | gv2 | both | view_fees | No | view_fees |
| Filing history | gv3 | both | view_filings | No | view_filings |
| Pay a fee | gv4 | both | pay_fee | No | pay_fee |
| **🔐 Release record** | **gv5** | **both** | **release_record** | **Yes (stepUp + consent)** | **release_record** |
| Permit status | gv-feature | both | vertical_feature_demo | No | show_permit (MCP, API-key) |

**HITL trigger:** `gv5` — "release my permit record" (stepUp + consent)
**Authz:** `release_record: { stepUp: true, consent: true }` in government/index.js
**Feature scope:** `permits:read` (feature tool `show_permit`)

---

### University (`university`) — Super University
| Chip | ID | Mode | Action | HITL? | Tool |
|---|---|---|---|---|---|
| My courses | un1 | both | view_courses | No | view_courses |
| Credit standing | un2 | both | view_standing | No | view_standing |
| Enrollment history | un3 | both | view_enrollment_history | No | view_enrollment_history |
| Register a course | un4 | both | register_course | No | register_course |
| **🔐 Release transcript** | **un5** | **both** | **release_transcript** | **Yes (stepUp + consent)** | **release_transcript** |
| Enrollment status | un-feature | both | vertical_feature_demo | No | show_enrollment (MCP, API-key) |

**HITL trigger:** `un5` — "release my official transcript" (stepUp + consent)
**Authz:** `release_transcript: { stepUp: true, consent: true }` in university/index.js
**Feature scope:** `transcript:read` (feature tool `show_enrollment`)

---

## Token Exchange + Authz Rules

### RFC 8693 Token Exchange Chain (ALL verticals, ALL tool types)

Every tool call — banking AND non-banking verticals — goes through the full pipeline:

```
User browser (cookie only)
  → BFF (demo_api_server) — holds user access token in session
      → PingOne Exchange #1: user token → agent token (actor = MCP exchanger client)
      → PingOne Exchange #2: agent token → MCP token (aud = MCP resource server)
          → MCP Gateway (:3005) — validates MCP token, PingAuthorize decision
              → MCP Server (:8080) — executes tool (banking or vertical handler)
                  → BFF /api/path/vertical-tool (for vertical plugin tools)
                  → BFF /api/... (for banking tools)
```

**Banking tools** use `executeBffTool` → `callMcpToolInternal` → MCP server.
**Vertical plugin tools** use `executePluginToolViaMcp` → `executeBffTool` → same MCP path.
**No tool executes in-process.** All go through RFC 8693 token exchange.

### Token Requirements
| Token | aud | sub | act | scopes |
|---|---|---|---|---|
| User token | BFF resource URI | PingOne user sub | (may be absent) | read, write, openid |
| Agent token | Agent gateway URI | PingOne user sub | agent client_id | agent:invoke |
| MCP token | MCP server URI | PingOne user sub | exchanger client_id | read, write |

**Note:** `act` claim emission depends on PingOne token policy. When absent, the MCP gateway logs `act absent` but continues with the exchange (permissive mode). See `docs/PINGONE_CONFIG.md`.

### Read-Only vs Write Authz
- **Read-only tools** (`view_*`, `list_*`, `pto_balance`, `rewards_balance`) — never trigger HITL
- **Write tools without authz** (`book_appointment`) — execute without consent
- **Write tools with `consent: true`** — trigger 428 HITL when `ff_hitl_enabled=true`
- **Write tools with `stepUp: true`** — trigger MFA step-up challenge

---

## PingOne App Requirements

### Required Applications (provisioned by `npm run pingone:bootstrap`)
| App | Type | Client Auth | Redirect URI | Notes |
|---|---|---|---|---|
| Admin OAuth App | WEB | basic/post | `{host}/api/auth/oauth/callback` | Admin sign-in |
| User OAuth App | WEB | basic/post | `{host}/api/auth/oauth/user/callback` | Customer sign-in |
| MCP Token Exchanger | SERVICE/AI_AGENT | post | N/A | RFC 8693 exchanger |
| Agent Gateway | SERVICE/AI_AGENT | post | N/A | RFC 8693 actor |
| Worker/Management | WORKER | post | N/A | Management API access |

### Required Scopes on Resource Servers
| Resource Server | Required Scopes |
|---|---|
| BFF (enduser) | `read`, `write`, `openid`, `profile` |
| MCP Server | `read`, `write` |
| Agent Gateway | `agent:invoke` |

### Redirect URI Pattern
All redirect URIs must use `PUBLIC_APP_URL` (default: `https://api.ping.demo`), never `localhost:3001` or `localhost:4000`.

---

## Authorization Server Token Validation

### Claims Validated by PingOne (AS)

The PingOne Authorization Server validates these claims on **every token it issues and every introspection call**:

| Claim | Required | Validated by | Notes |
|---|---|---|---|
| `aud` | Yes | AS + BFF `auth.js` | Must match the resource server audience |
| `sub` | Yes | AS | Non-empty user UUID |
| `iss` | Yes | AS | Must match PingOne issuer URL |
| `exp` | Yes | AS + BFF | Token must not be expired |
| `iat` | Yes | AS | Must be in the past |
| `scope` | Yes | AS + BFF | Must include `read` or `openid` minimum |
| `jti` | Yes | AS | Unique token ID (replay prevention) |

### Where Validation Happens

**PingOne AS** validates aud/sub/iss/exp on **every token exchange** (RFC 8693). If the subject token is expired or has wrong `aud`, the exchange fails with `invalid_grant`.

**BFF `auth.js` middleware** validates the user's session token via JWKS (RS256 signature) + audience check on every authenticated request. Expired tokens return 401.

**MCP Gateway** introspects the exchanged MCP token against PingOne `/as/introspect` (RFC 7662) before forwarding to the MCP server. This is the authoritative gate for tool calls.

**MCP Server** re-validates the token's `aud` and `scope` before executing any tool.

### Token Introspection (RFC 7662)

The MCP gateway calls `POST {PINGONE_INTROSPECTION_ENDPOINT}` with the exchanged MCP token before every tool call. The response `{ active: true, sub, scope, exp, aud }` must have:
- `active: true` — token is valid and not revoked
- `sub` — user identity preserved through exchange
- `scope` — includes `read` (and `write` for write tools)
- `exp` — in the future

Test: `tests/real/shared/token-validation.test.js` section B validates introspection via `/api/health/introspection`.

**Note:** If `PINGONE_INTROSPECTION_ENDPOINT` is not configured in `.env`, the MCP gateway skips introspection and relies on JWKS signature validation only. Set this for production.

---

## Test Coverage Map

| What's tested | Test file | Coverage |
|---|---|---|
| Vertical switching + manifest + chips per vertical | `tests/real/shared/vertical-switching.test.js` | All 5 verticals |
| Every chip routes correctly via NL parser | `tests/real/shared/chip-pipeline.test.js` | All both-mode chips + hitlTrigger chips |
| Every chip routes correctly via NL parser (deep, with MCP pipeline assertion) | `tests/real/shared/all-chips-pipeline.test.js` | All verticals × all chips |
| Token exchange chain (session → MCP), read-only authz | `tests/real/shared/token-authz.test.js` | All 5 verticals |
| **JWT expiry, token introspection, scope enforcement, MCP gateway, no-leakage** | **`tests/real/shared/token-validation.test.js`** | **A–H coverage** |
| Token chain E2E claims validation (aud, sub, iss, exp, scope, act) | `tests/real/shared/token-chain.test.js` | Banking |
| HITL enforcement per vertical (hitlTrigger chip → 428) | `tests/real/shared/hitl-per-vertical.test.js` | All 5 verticals |
| HITL enforcement per vertical (route level, $500+ transfer) | `tests/real/{vertical}/hitl.test.js` | All 5 verticals |
| PingOne app config, OIDC discovery, scopes, RFC 8693 | `tests/real/shared/pingone-apps.test.js` | PingOne AS |
| OAuth status endpoints | `tests/real/shared/oauth-status.test.js` | Admin + enduser |
| Vertical manifest shape + terminology | `tests/real/{vertical}/vertical.test.js` | All 5 verticals |
| Account CRUD per vertical | `tests/real/{vertical}/accounts.test.js` | All 5 verticals |
| Transfer + HITL per vertical | `tests/real/{vertical}/transfers.test.js` | All 5 verticals |
| MCP tool call end-to-end (full stack) | `tests/real/shared/mcp.test.js` | Banking |
| Banking balance via MCP (full RFC 8693 → gateway → MCP path) | `tests/real/banking/check-balance-via-mcp.test.js` | Banking |

**Run all:** `./scripts/run-real-tests.sh`

**Total: 367 tests, 55 suites — all passing.**
