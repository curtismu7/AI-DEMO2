# Airline booking rules: two rules, one tool, owner-run import

> **Status: UNVERIFIED until imported.** Everything here was read from source and exercised
> against the local mock engines and unit tests. No PingOne tenant, no real decision endpoint, no
> gateway on port 3036 and no hosted service was called. The snapshot has not been imported
> anywhere.

Two rules stop a `book_airline_flight` call. Both are enforced by PingOne Authorize, reached
through PingGateway, and each is reported by its own statement code.

| | RULE A: user preference | RULE B: airline control |
|---|---|---|
| Plain language | No tickets bought by an AI agent over $500 | Only premium members can book over $750 |
| Owner | The user | The airline |
| Applies to | Only when an agent is acting (`ActClientId` is present) | Every caller, agent or not |
| Denies when | Fare is more than the user's `AgentSpendLimit` (default 500) | Fare is more than 750 and the member's tier is not premium |
| Rule name | `MCP Deny — Agent Booking Over User Limit` | `MCP Deny — Airline Premium-Only Over $750` |
| Statement code | `mcp-airline-agent-spend-limit` | `mcp-airline-premium-only` |

Exactly 500 and exactly 750 are allowed (both rules say "over", strict `>`). When both fail, the
booking is stopped once and both rules are listed. A booking that passes both rules still meets
the existing consent gate (`RequiresHitlConsent`) unless it is pre-approved by the user's own
limit (next section); the BFF airline demo (UC48) does not send the pre-approval and is unchanged.

## Inside the user's limit: pre-approved, no human-approval hold (X-Hitl-Preapproved)

Without this, a booking that passed both rules was still held: `book_airline_flight` is on the
consent-gated list, so Authorize answered PERMIT with an unfulfilled HITL obligation and the gateway
returned `428 consent_pending` (the MCP server was never reached). Owner decision: a booking
**inside the user's own dollar limit counts as pre-approved by that limit**, so it goes straight through.
Over the limit nothing changes: Authorize's user-limit rule (RULE A) still denies it with its reason.

- **Header:** `X-Hitl-Preapproved: user-limit` (exact value, case-sensitive). Optional second header
  `X-Agent-Spend-Limit: <dollars>`: a strict positive number, digits and at most one decimal point, at
  most 7 characters (`300`, `500.01`); anything else (`NaN`, `-5`, `1e9`, ` 500`, `500,0`, `0x1F`, `0`) is ignored.
- **Who may send it:** only a caller presenting the correct `x-internal-gateway-secret` (the same
  trusted-caller gate as `X-Authz-Simulated`). From any other caller both
  headers are ignored and stripped, and the booking is held exactly as before.
- **The rule** (`decideHitlPreapproval` in `p1az-decision.groovy`): pre-approved only when the caller is
  trusted AND the tool is `book_airline_flight` AND the header is exactly `user-limit` AND there is no
  `_hitl_challenge_id` (a real receipt always takes the receipt path) AND the **catalogue fare** (the
  gateway's own amount, never the caller's `amount`) is **less than or equal to** the limit. The limit is
  `X-Agent-Spend-Limit` when valid, else the data-file default (`agentSpendLimitUsd`, 500). A missing fare
  or limit fails closed: no pre-approval. Exactly equal to the limit IS pre-approved (RULE A is strict `>`).
- **Effect:** the gateway sets `HitlApproved=true` in the Authorize request, so `RequiresHitlConsent` does
  not attach the HITL obligation. Both headers are removed before the request is proxied to the MCP server.
- **Audit:** `X-Gw-Audit-Trail` gets `hitlPreapproved: {basis:'user-limit', fare, limit, limitSource:'header'|'default'}`
  only when granted; otherwise the field is `null`.
- **The header can only skip the hold, never widen what is allowed.** The DENY is Authorize's: the
  attribute resolved from the PingOne user field `agentSpendLimit` is the source of truth for RULE A, and
  Authorize denies an agent booking over it whatever this header says. The gateway still sends
  `AgentSpendLimit` (from the data file) unchanged; a request parameter is ignored by an attribute that
  resolves from the PingOne user. A header limit higher than the PingOne limit therefore pre-approves
  nothing that Authorize will not also deny; a lower one is more conservative (the booking is held instead).
- **UC48 unaffected:** the BFF airline booking demo does not send `X-Hitl-Preapproved`, so it keeps the
  tenant's human-approval hold (428, then the receipt retry) unchanged. Rule B (premium-only over 750) is untouched.
- **UNVERIFIED:** that the live tenant, with the PingOne `agentSpendLimit` attribute in place, returns a plain
  PERMIT for a booking carrying `HitlApproved=true` (policy source: `RequiresHitlConsent` is false when
  `HitlApproved` is true). The Groovy decision is executed offline in tests; no tenant or gateway was called.

## Where the facts come from (the caller never sets the price or the tier)

**The member tier is a custom field on the PingOne user, read by Authorize.** It is the user-schema
attribute `airlineMemberTier` (STRING). It already exists in the owner's tenant and the demo user is
already set to `Premier Gold`. In the Trust Framework the attribute `MemberTier` (STRING, default
`none`) resolves from that PingOne user attribute, keyed on `UserId` (the token `sub`). Nothing on
the request path supplies a tier: not the caller, not PingGateway, not a data file.

- **Premium** = an `airlineMemberTier` value in the explicit set `premiumTiers`
  (`demo_mcp_resource_server/seed/airline-booking-policy-data.json`, currently `["Premier Gold"]`;
  the generator turns it into RULE B's condition, the mock engines mirror it, a test pins them).
- **Everything else is NOT premium (fail closed):** another tier such as `Premier Silver`, an empty
  value, `none`, a different spelling or case, a user without the attribute, an unknown user. An
  unmapped or tier-less user is NOT premium (the old "unmapped user is the default member and is
  premium" behaviour is gone).
- The owner does not care whether the top tier is called Gold or premium; to change the name, change
  the value on the user and the entry in `premiumTiers`, then regenerate (`npm run snapshot:generate`).

The gateway still supplies the other two facts, from one data file,
`demo_mcp_resource_server/seed/airline-booking-policy-data.json` (fares, `premiumTiers`, the default
agent spend limit and optional per-user limits). `node scripts/sync-airline-booking-data.js` copies it
byte for byte to `ping-gateway/config/airline-booking-policy-data.json` (`--check` fails when they differ).

For a `tools/call` of `book_airline_flight`, `ping-gateway/scripts/groovy/p1az-decision.groovy`:

- looks up the fare by `arguments.flight_number` and **overwrites** `Amount` and
  `TransactionAmount` with it (the caller's `amount` is ignored for the decision; a difference is
  recorded as `fareOverride` in `X-Gw-Audit-Trail`);
- adds `AgentSpendLimit` from the record for the token `sub`, else `defaultMember` (recorded as
  `bookingFacts`; it holds no tier);
- sends **no `MemberTier`**. It already sends `UserId` (and `ClientId`) = the token `sub` on every
  request, which is the only thing the PingOne user resolver needs;
- fails closed with HTTP 403 before P1AZ is asked: `unknown_flight_fare` (flight not in the
  catalogue, or `flight_number` missing or odd) and `booking_data_unavailable` (file unreadable).

The airlines resource server re-checks the quote: a quote that differs from the catalogue fare is
refused with `reason: fare_mismatch` and nothing is booked. The server is not a policy engine: it
books a 940 fare if asked; the rules live at the gateway.

Other callers (the Node gateway, the BFF) still send the caller's amount and no limit, so the cloud
default applies (`AgentSpendLimit` = 500). The tier is read from the PingOne user for them too, so a
standard user is denied over 750 on every path. Known gap, out of scope: those paths still trust the
caller's amount.

In PingFederate mode the token `sub` is a username, not a PingOne user id; a resolver keyed on it may
not find the user (UNVERIFIED), which fails closed (see "Risks" below).

## Assumptions the owner must confirm

1. **Premium = `Premier Gold` only.** `Premier Silver`, any other value and a missing value count as
   standard. The set is `premiumTiers` in the data file; the generator reads it.
2. **The user's $500 preference is gateway-side data for now** (`agentSpendLimitUsd`, default 500,
   optional per `members` entry keyed by token `sub`). Moving it to a PingOne user attribute is a later step.
3. `book_airline_flight` is flagged `requiresAgentMediation`, so the existing identity rules
   (mock `missing_act`, cloud `HasValidActorChain`) can deny a call with no agent before RULE B is
   reached. Not changed here. The mock tests of direct callers use the existing opt-out
   `REQUIRE_ACT_FOR_AGENT_TOOLS=false`.

## Owner steps (agents do none of these)

Do **not** import the full regenerated snapshot over the live tree. A P1AZ publish replaces the
whole authorization version (see the header of `snapshots/merge-mcp-amount-bands.js`). Merge the
rules into an export of the live policy instead.

1. Review and merge the branch. From the repo root:
   ```bash
   node snapshots/gen-authorize-snapshot.js --check      # snapshot up to date
   node scripts/sync-airline-booking-data.js --check     # gateway copy in sync
   ```
2. **Create the `MemberTier` attribute in the Authorize console first (UNVERIFIED until you do).**
   No PingOne User resolver exists anywhere in this repo, so the snapshot-file form of that resolver
   is a best reading, not copied from an export. Safest route, in the console under
   **Authorize → Trust Framework → Attributes**:
   - name `MemberTier`, type STRING, default value `none`;
   - resolver: **PingOne User**, user identified by the existing `UserId` attribute, value read from
     the user attribute `airlineMemberTier` (JSONPath `$['airlineMemberTier']` if the console asks);
   - confirm the PingOne connection / service the resolver uses can read users in this environment
     (UNVERIFIED how it authenticates: check the console wording).
3. Export the live Authorize policy (the Import/Export feature under **Authorize → Trust Framework**;
   the same place the existing snapshot is imported, see `docs/PINGONE_AUTHORIZE_SETUP_GUIDE.md`
   Part 3 and `docs/LIVE-PINGONE-RUNBOOK.md` section 3). Save it as `export.json`.
4. Merge:
   ```bash
   node snapshots/merge-airline-booking-rules.js export.json airline-booking-rules.merged.snapshot.json
   ```
   It adds `AgentSpendLimit`, 2 conditions, 2 statements and 2 rules, and attaches both rules to the
   MCP Delegation policy ahead of its catch-all permit. An attribute that already exists under the same
   name (your console-made `MemberTier`) is kept **exactly as exported** and the rules are pointed at
   it. If the export has no `MemberTier`, the merge adds the generator's version (the UNVERIFIED
   resolver shape above); check it in the console after import. It refuses (exit 1, nothing written)
   when the export lacks `ToolName`, `Amount` or `ActClientId`, the MCP Delegation policy, the shared
   denied statement, has anything other than one policy set, **or has a `MemberTier` that is still
   resolved from the request** (left over from the earlier gateway-side design: change its resolver or
   delete it). Running it on its own output changes nothing.
5. Import `airline-booking-rules.merged.snapshot.json` the way the existing snapshot is imported,
   then publish. PingOne skips an object whose `version` is unchanged; the merge gives the policy a
   new version so the new children attach.
6. Restart the local PingGateway (it reads the Groovy script and the synced data file) and the
   airlines resource server (it adds flights `SH101`..`SH109` to an existing database without
   touching other rows).
7. **Demo RULE B by flipping the demo user's tier.** The demo user is `Premier Gold` (premium). Make
   the user standard with the owner-run script (dry run by default, so read first; it needs the worker
   credentials in `demo_api_server/.env` and a worker role that can edit users and the user schema):
   ```bash
   node scripts/set-airline-member-tier.js <demo username> "Premier Silver"            # dry run: shows the plan
   node scripts/set-airline-member-tier.js <demo username> "Premier Silver" --apply    # writes
   ```
   It makes sure the user-schema attribute `airlineMemberTier` exists (it does already), then sets
   that one user. Now a direct booking over 750 is denied by RULE B, and an agent booking at 940 is
   denied by A and B. Flip back with `"Premier Gold" --apply`. Change `agentSpendLimitUsd` (or add a
   `members` entry keyed by the user's token `sub`) to show RULE A following the user's preference.
   Expect a short delay before a change shows: no caching is configured by this change, but whatever
   the PingOne User resolver caches is UNVERIFIED.
8. Prove it against the real endpoint (this is what turns UNVERIFIED into verified):
   ```bash
   cd demo_api_server && npm run verify:authorize-parity
   ```
   The two new rows (`mcp-airline-agent-spend-limit`, `mcp-airline-premium-only`) send every
   attribute on the deny and permit side, and choose the user instead of a tier: the rule A row asks
   as `PARITY_PREMIUM_USER_ID` (default: the probe subject, assumed to be the demo user on
   `Premier Gold`), the rule B row asks as `PARITY_STANDARD_USER_ID` (a user whose `airlineMemberTier`
   is not premium, for example the demo user after step 7, or a second user) and is **skipped, not
   failed, while that variable is unset**. Read any row that reports "denies its ALLOWED case too
   (INDETERMINATE)" as a probe attribute problem first, as the header of that script explains.

## Risks to check on the real engine (UNVERIFIED)

- **A user without `airlineMemberTier` may be DENIED, not treated as standard.** The skill notes in
  `.claude/skills/pingone-authorize-ea-api-build/references/condition-evaluation-and-nulls.md` say a
  reference to a missing PingOne user attribute can end as `PROCESSING_ERROR` / INDETERMINATE, which
  `DenyOverrides` turns into DENY. Fail closed is the intent for a tier-less user booking over 750.
  What must be measured: whether the same error also denies a tier-less user on a booking **under**
  750 (the condition is an AND; whether it short-circuits is unknown) and on **other MCP tools** in the
  same policy. If it does, give every user a placeholder value (for example `none`) or limit the
  attribute's use; do not ship it to a tenant where other users lack the attribute until this is measured.
- **Default value:** whether `defaultValue: none` applies when the PingOne user lacks the attribute is
  not documented.
- **An empty token `sub`** sends `UserId` = `''`: the user is not found (fails closed).
- **PingFederate mode:** `sub` is a username, which may not resolve (see above).

## What is still UNVERIFIED after this change

- On a real engine: that each new DENY beats the unconditional-permit consent obligation under
  `DenyOverrides`; that `Amount GreaterThan "750"` and `Amount GreaterThan AgentSpendLimit` compare
  numerically at 500, 500.01, 750 and 750.01; how `statements[]` and `reason` render when both
  custom denies fire together; that `{{attribute}}` renders in the deny payloads; that the live
  tenant equals the checked-in snapshot; that the merge imports cleanly; that a PingOne User resolver
  keyed on `UserId` reads `airlineMemberTier` (the resolver's snapshot-file shape is a best reading).
- That the numbers 500 and 750 and the strings `500.01` / `750.01` survive the Groovy JSON path to
  the decision endpoint (the lookup itself is covered; the HTTP call was never run).
- The mock engine (`demo_authz_server/routes/decision.js`, Rule 3-airline) and the simulated
  engine (`demo_api_server/services/simulatedAuthorizeService.js`) are local stand-ins with the
  same two checks. They read the tier from a mock PingOne user record keyed by the token subject
  (`demo_authz_server/mockPingOneUsers.js`, `setMockPingOneUser`), under the same attribute name
  `airlineMemberTier`, and ignore a `MemberTier` the request carries. They run before the mock's step-up and consent pause, so a deny wins there by
  construction. Pre-existing and unchanged: the mock's step-up uses `>= 500` where the cloud and
  gateway use strict `>`.

## Tests

```bash
node --test snapshots/*.test.js                                       # includes airlineBookingRules.test.js
node --test ping-gateway/scripts/check-airline-booking-data.test.js   # data copy, no tier in the gateway, Groovy source, HITL pre-approval (runs the Groovy in the IG image offline when groovy is absent)
node --test scripts/set-airline-member-tier.test.js                   # owner script against a stubbed PingOne
bash ping-gateway/scripts/check-groovy-params.sh
(cd demo_mcp_resource_server && npx jest tests/airlinesBook.test.ts)
(cd demo_authz_server && node --test decision.airlineBooking.test.js)
(cd demo_api_server && npx jest tests/simulatedAuthorizeAirlineBooking.test.js)
```
