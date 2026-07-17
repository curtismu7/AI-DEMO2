---
name: chip-correctness-testing
description: Use when verifying that agent chips return the RIGHT ANSWER — real values from the store, correct routing params, and the same result in heuristics and every LLM mode. Use when asked "does the LLM return real data", "is it hallucinating", "do the chips work in <vertical>", when adding a chip or vertical, or before a demo. Covers what to assert, where ground truth lives, and the traps that make a chip test silently prove nothing.
---

# Chip Correctness Testing

## The problem this exists to solve

**Every existing test in this repo proves the PIPELINE runs. None proves the ANSWER is right.**
Verified 2026-07-17:

| existing check | what it asserts | what it misses |
|---|---|---|
| `verticalCoreChipSuite` | `source`, `executed === true` | the values |
| `assertMcpPipelineCustomerProof` | status 200/403/428, RFC 8693 event | the values |
| `mcpResultHasPayload` | `Object.keys(payload).length > 0` | the values |
| `evidence-screenshots.real` | reply is not an error card | the values |

`grep -rn "toBe(2668\|balance.*toBe(" tests/` → **nothing**. A hallucinated balance passes
every test in the repo. That is the demo's central claim, untested.

## The only three things that can be wrong

Data never comes from the LLM. It flows store → MCP tool → gateway → BFF. The LLM only
**routes** (picks action+params) and **narrates**. So:

| # | failure | example | assert |
|---|---|---|---|
| 1 | **Routing params** | say "$300", it moves $600 | resolved `params.amount === 300` |
| 2 | **Tool data** | tool returns a stale/wrong figure | tool payload == seed/store |
| 3 | **Narration** | tool says $2,668.42, prose says "about $2,700" | every money figure in the reply appears in that turn's `/api/mcp/tool` payload |

Test at the **API level** (`/api/demo-agent/nl` + `/api/mcp/tool`) for 1 and 2 — fast, no
browser flake. Only 3 needs a browser, because only a browser sees rendered prose.

## Trap 1 — chips never reach the LLM (this invalidates naive "cross-mode" tests)

The BFF's heuristic floor answers a matched chip phrase **before calling the LLM**, in
**every** mode, whenever `ff_heuristic_enabled` is on (`geminiNlIntent`: `llmModeSelected →
heuristicRoutingEnabled = heuristicEnabled` → early return). Proof:

```bash
curl -sk -X POST https://api.ping.demo:3001/api/demo-agent/nl -H 'Content-Type: application/json' \
  -d '{"message":"pay my $300 bill","provider":"llamacpp","vertical":"healthcare"}'
# -> {"source":"heuristic", ...}   # llamacpp requested; heuristic answered. ZERO llama calls.
```

Confirm with `docker logs --since 2m ai-demo-llm-proxy | grep -c "POST /v1/chat/completions"` → `0`.

**Consequence:** "same result in heuristics and llamacpp" passes **trivially** for chips —
both ran the same heuristic. It proves nothing about the LLM.

- To test **chip** routing → heuristics is the only path; test it once.
- To test **LLM** routing → use a phrase that does NOT match a heuristic (then `source`
  becomes `llamacpp_fallback` / `helix` and the LLM really ran).

## Trap 2 — two result shapes; reading the wrong one silently yields null

```jsonc
// banking
{ "source":"heuristic", "result": { "kind":"banking", "banking": { "action":"accounts", "params":{} } } }
// EVERY other vertical
{ "source":"heuristic", "result": { "kind":"vertical", "vertical":"retail", "action":"list_orders", "params":{} } }
```

Reading only `result.banking.action` returns `null` for every vertical chip — the test then
"passes" while asserting nothing. Always normalise:

```js
const action = r.banking?.action ?? r.action ?? null;
const params = r.banking?.params ?? r.params ?? null;
```

## Where ground truth lives

| vertical | store | money keys |
|---|---|---|
| banking | `demo_api_server/data/runtimeData.json` (`users`/`accounts`, match `userId`) | `balance` |
| retail (**Great Buy**) | `config/verticals/retail/seed.json` → `orders`, `rewards` | `amount` |
| healthcare (**CareConnect**) | `config/verticals/healthcare/seed.json` → `billingHistory`, `claims` | **`amountDue`** — NOT `amount` |

**Key names differ per vertical.** A generic `/^(amount|balance|total)$/` scan finds **0**
money in healthcare and wrongly reports "no ground truth". Check the seed's real keys first:

```bash
python3 -c "import json;d=json.load(open('demo_api_server/config/verticals/healthcare/seed.json'));print(list(d.keys()))"
```

Vertical ids ≠ display names: `retail`=Great Buy, `healthcare`=CareConnect,
`investment`=Meridian Wealth, `government`=CivicPermit, `sporting-goods`=Super Sports.
`greatbuy` is **not** a valid id.

Never hard-code a balance — transfers legitimately move money and the number rots. Read the
store (or better, that turn's tool payload) at assert time.

## Harness gotchas (each one cost a debugging cycle)

- **`ignoreHTTPSErrors: true` is mandatory.** The stack serves a mkcert cert Playwright's TLS
  client won't trust. `browser.newPage()` without a context ⇒ the app's own fetches fail
  silently and **no `/nl` request is ever made** — you get a 90s timeout, not a TLS error.
  Use `browser.newContext({ ignoreHTTPSErrors: true })`.
- **A worktree has no `.env`** (gitignored). `. ../demo_api_server/.env` from a worktree
  loads nothing, `E2E_CUSTOMER_*` end up empty, and `requireRealLoginEnv()` makes every test
  **skip** — which looks like success. Source the MAIN checkout's `.env` and assert
  `${DEMO_USER_USERNAME:+YES}` before running.
- **Run from the worktree's `demo_api_ui`.** `playwright.real.config.js` uses
  `testDir: './tests/e2e'`; a wrong cwd gives "No tests found" (or silently runs the main
  checkout's specs).
- **The config defaults to the AWS deployment.** Always set `E2E_BASE_URL` or you test the
  wrong stack.
- **`test.skip()` on missing env reads as green.** Check the summary says `passed`, never
  `skipped`.

## Recipe

```bash
set -a && . /Users/cmuir/Development/AI-DEMO2/demo_api_server/.env && set +a
cd <worktree>/demo_api_ui
E2E_BASE_URL="https://api.ping.demo:4000" \
E2E_CUSTOMER_USERNAME="$DEMO_USER_USERNAME" E2E_CUSTOMER_PASSWORD="$DEMO_USER_PASSWORD" \
npx playwright test tests/e2e/vertical-chip-correctness.real.spec.js \
  --config=playwright.real.config.js --reporter=line
```

Get a vertical's real chips (never invent phrases):

```bash
cd demo_api_server && node -e "
const { USE_CASES, resolveUseCase } = require('./config/useCases.js');
for (const u of USE_CASES) { const r = resolveUseCase(u.id,'retail')||u; const t=r.trigger||{};
  if (t.type==='chip' && t.text) console.log(u.id, JSON.stringify(t.text)); }"
```

## What this catches (real finds, first run)

- **`pay my $300 bill` → `params: {amount:300, recordId:"300"}`.** Amount right; `recordId`
  wrong — the heuristic reuses the dollar figure as a record id. Real patient record ids are
  `101`–`106`; **there is no record 300.** No existing test could see this: routing
  "succeeded" and the pipeline returned 200.
- healthcare seed exposes money as `amountDue`, so a generic scan reports "no ground truth"
  and a naive test asserts nothing.

## Rules

1. **Assert a value, or you have tested nothing.** Status codes and `executed === true` are
   plumbing.
2. **Ground truth = that turn's tool payload** (tightest), else the seed/store. Never a
   literal.
3. **Cross-mode equivalence only means something for non-chip phrases.** For chips, both
   modes run the identical heuristic.
4. **Prove the LLM ran** before claiming you tested it:
   `docker logs --since 2m ai-demo-llm-proxy | grep -c "POST /v1/chat/completions"` > 0.
5. **Normalise the result shape** (`banking.action ?? action`) or vertical chips silently
   assert `null`.

Related: `agent-demo-triage` (when a chip misbehaves), `verify-ai-demo2` (worktree/jest and
proving a rebuild landed).