# UI Changes — Status & Test URLs

Tracks the UI-visible fixes shipped from the original 7/16 punch-list triage
(this agent's work only — see note at the bottom on unrelated fixes that
landed on `main` from a separate parallel session while this work was in
progress).

Base URLs: local `https://api.ping.demo:4000`, or the hosted demo at
`https://ai-demo.ping-devops.com`. Paths below are relative to either.

| # | Update | Status | URL to test |
|---|---|---|---|
| 1 | Agent Onboarding Flow diagram's floating panel was missing its close button (`onClose` never wired, so the X never rendered) | Merged (#523, main) | `/agent-onboarding-flow` — open any step's detail panel, confirm the X closes it |
| 2 | `/code-search` Ask tab showed a raw `JSON.parse` SyntaxError on a non-JSON error response; now shows a clean "assistant unavailable (status ###)" message | Merged (#523, main) | `/code-search` → Ask tab — trigger a backend error (e.g. stop the code-search service) and confirm the message is clean, not a stack trace |
| 3 | Admin vertical ops console had no way to jump to the token-chain panel past a long record list; added a "Jump to token chain" button | Merged (#523, main) | `/admin/banking`, `/admin/healthcare`, `/admin/retail`, `/admin/sporting-goods`, or `/admin/workforce` — with a long record list, confirm the jump button scrolls to the token chain |
| 4 | `/graphify` read as a live-run feature; added a banner stating it's a showcase (no Run button, no backend) and tightened the "Try it" copy | Merged (batch 2, main) | `/graphify` — confirm the banner appears right after the page thesis |
| 5 | `/delegation` had 4 leftover `may_act` UI-copy mentions; swept to "act claim" language to match the rest of the app (backend `may_act` PingOne attribute itself is untouched) | Merged (batch 2, main) | `/delegation` — read the page copy, confirm no `may_act` wording remains |
| 6 | `/logs` Debug tab's Details column was always empty; logger now passes a real structured `detail` field | Merged (batch 2, main) | `/logs` → Debug tab — trigger any logged action, confirm the Details column is populated, not blank |
| 7 | Settings duplication: global thresholds and feature flags were editable in two places that could silently disagree; `confirm_stepup_threshold_usd` was never registered in `configStore.FIELD_DEFS`, silently breaking the `device_picker` HITL gate | **PR #546 open, not yet merged** — not testable on `main`/the hosted demo yet | (once merged) Dashboard → Admin/Settings panel → Threshold Controls section |

## Known open items (diagnosed, not fixed)

Investigated during the original triage but the leading root-cause theory
didn't survive verification — left open rather than shipping a guess (logged
in `REGRESSION_PLAN.md` §4):

- `/check` — reports servers down when they're up (root cause not confirmed)
- `/admin/verticals` — a rendering issue with the embedded editor (root cause not confirmed)

## Note on unrelated parallel work

While item 7 (and a separate AI Attack Demos consolidation effort) was in
progress, a different agent session independently shipped ~15 other PRs
directly to `main` (#503 token-exchange-tester empty panels — also from the
original punch list; #543, #545, #547, #549–558, etc.). None of that is this
agent's work and it isn't listed above; ask if you'd like it tracked
separately.
