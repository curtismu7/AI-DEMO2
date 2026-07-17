# 2026-07-17 — Session report: policy-status fix, direct-chip heuristic leak, and related PRs

## Original asks — status

| Ask | Status |
|---|---|
| Audit `docs/superpowers/plans/` for what's not implemented | Done — [Plan Ledger artifact](https://claude.ai/code/artifact/ded62e4c-7b8e-4051-b7af-168bc1dc88b8): 150 plans, 131 implemented, 14 partial, 3 not built |
| Recapture the wiped "public-vs-auth-tools" plan | Done — implemented, merged as PR #521 |
| Check sibling "fallback-chips" plan | Already fully implemented on `main`, no work needed |
| Review PR #529 | Done — 7 findings reported |
| Fix findings #1/#2 from that review | Done — PR #540, merged |
| `mcp-tool-schemas.json` drift found via local checks | Already fixed by someone else (PR #533) before it could be pushed here |

## Fixes — table with URLs to test

Local demo: UI `https://api.ping.demo:4000`, BFF `https://api.ping.demo:3001`.

| # | Fix | PR | Status | Test URL / path | How to verify |
|---|---|---|---|---|---|
| 1 | 5 new public MCP tools (`list_account_types`, `list_transaction_types`, `show_supported_currencies`, `get_fee_schedule`, `list_verticals`) | [#521](https://github.com/curtismu7/AI-DEMO2/pull/521) | Merged, live | `https://api.ping.demo:4000` → sign in → open AI Agent chat | Ask *"what account types do you offer"* or *"what currencies do you support"* — should answer with no login prompt |
| 2 | 🔐 lock icon on auth-required tools in the MCP Tools list | [#521](https://github.com/curtismu7/AI-DEMO2/pull/521) | Merged, live | Admin Dashboard → AI Agent → Actions → **MCP Tools** (requires MFA step-up the first time) | 🔐 appears on `get_my_accounts` etc., not on the 5 new public tools |
| 3 | `mcp-tool-schemas.json` regenerated (was stale, broke `topology:verify`) | [#533](https://github.com/curtismu7/AI-DEMO2/pull/533) | Merged, live | — internal build artifact, no user-facing surface | `npm run topology:verify` locally |
| 4 | `policy_not_found` now shows the real friendly message instead of "Transfer failed" (real Authorize engine returns 503, UI only checked 403) | [#540](https://github.com/curtismu7/AI-DEMO2/pull/540) | Merged, live | `https://api.ping.demo:4000/dashboard` → attempt a transfer/deposit/withdrawal | Needs a real policy-drift condition to trigger (no matching PingOne Authorize policy) — not reachable by just clicking around; the PR's own automated test (`UserDashboardPing2026.test.js`) is the reliable way to confirm it |
| 5 | `nlIntentParser.js` — `direct`-mode chip messages no longer leak into heuristic matching (with the message-collision fix for chips that share text with a `both`-mode chip) | [#540](https://github.com/curtismu7/AI-DEMO2/pull/540) | Merged, live | `https://api.ping.demo:4000/dashboard` → switch to **Retail** vertical | Click the "List my orders" chip (`both`-mode) and the "🔌 Direct MCP" chip — both should still work correctly |

## Known gap, deliberately left open

The `policy_not_found` bug (fix #4 above) also exists in the sibling `demo_api_ui/src/components/UserDashboard.js`, which renders by default when `ff_customer_skin_ping2026` is OFF. That file is byte-for-byte frozen by its own sha256 canary test (`UserDashboardPing2026.test.js` test #8) and was **not** touched. Only the `ff_customer_skin_ping2026` ON path (`UserDashboardPing2026.js`) got the fix. Breaking that freeze to fix the default path is a separate decision — ask if you want it done.

## Review findings from PR #529 not yet acted on

Full detail in the original review; the two most substantive were fixed here (#4/#5 above). The rest, still open on `main`:

- `REGRESSION_PLAN.md` (~line 1187) and a `server.js` comment (~line 970) still document the old "unauthenticated by default" contract for `/api/admin/feature-flags` — the shipped code has been fail-secure since an earlier commit. Doc-only drift, not a functional bug.
- An untouched e2e spec (`demo_api_ui/tests/e2e/all-chips-pipeline.real.spec.js`) lost coverage for 3 direct-dispatch chips when `extractChips.js`'s bucket split landed — low urgency, that spec only runs in manual/nightly real-login jobs, not default CI.
- A demo user's genuine "$600 transfer to my brother" can get silently hijacked into a hardcoded checking→savings demo scenario (`transfer_600_test` in `demo_api_server/config/verticals/banking/index.js`), ignoring their stated destination — a demo-UX collision risk, not a production security bug.
- Two independent regexes in `banking/index.js` both map to `test_wrong_scope` with no shared source of truth beyond a comment — fragile pattern, will need repeating for every future oddly-worded chip.
