# Jev Demo Gallery — Live URLs

All 8 demos score against the live von-1.3.0 model. Look for **Live: von-1.3.0**
in the summary line; "Simulated" means the von-jev container is down.

- **PR Review** — https://local.ping-devops.com:4000/jev-demos/pr-review
- **Computer Use** — https://local.ping-devops.com:4000/jev-demos/computer-use
- **Internal Links** — https://local.ping-devops.com:4000/jev-demos/internal-links
- **Doc Sorting** — https://local.ping-devops.com:4000/jev-demos/doc-sort
- **Game Agent** — https://local.ping-devops.com:4000/jev-demos/game-agent
- **Context Compaction** — https://local.ping-devops.com:4000/jev-demos/compaction
- **Trading Bot** — https://local.ping-devops.com:4000/jev-demos/trading
- **Paper Organizer** — https://local.ping-devops.com:4000/jev-demos/papers

Index (redirects to PR Review): https://local.ping-devops.com:4000/jev-demos

## How to run each demo

One button per page — Run / Decide / Classify / Score — then the table fills
with keyword-baseline vs Jev verdicts:

| Demo | Button | What shows |
|------|--------|-----------|
| PR Review | Run 6 checks on the diff | 6 rows + escalation-band slider; count line `N block · N escalate · N pass` |
| Computer Use | Decide next action | Screen tabs; Jev picks click/type/navigate with confidence |
| Internal Links | Score 4 page pairs | link/decline per pair |
| Doc Sorting | Classify 5 pages | w2 / 1099 / invoice / unknown + confidence |
| Game Agent | Run the runner | 6 frames, graded stay/left/right/jump/slide |
| Context Compaction | Score the transcript | 8 turns, keep/drop |
| Trading Bot | Run the trading loop | 5 ticks, buy/sell |
| Paper Organizer | Classify 5 papers | security / rag / reasoning / other + confidence |

## Gotchas

- **20 req/min shared limit** on `/api/demo/jev/*` — a full pass is fine;
  rapid re-clicking 429s for up to a minute.
- **A failed row** renders as "score failed" with the upstream reason and
  `· N failed` in the count line (fixed in PR #1193; it used to crash the page).
- **von-jev down?** `docker compose -p ai-demo --profile jev up -d von-jev` —
  allow ~2 min for model load after start. A wedged instance needs
  `docker compose -p ai-demo up -d --force-recreate von-jev`, not restart.
