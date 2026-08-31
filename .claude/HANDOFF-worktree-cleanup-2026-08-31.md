# Worktree cleanup — DONE 2026-08-31

Resumed after the owning session (`f7d0521f`) was killed by exit 137 mid-removal-loop.
22 worktrees -> 15. **No work is at risk**: every branch is on `origin`, and
`git worktree remove` never deletes a branch.

Recover any removed tree with:
`git worktree add .claude/worktrees/<name> worktree-<name>`

## Rescued (was uncommitted, would have died)

| Branch | What |
|---|---|
| `worktree-deny-reason-surfacing` | Gateway deny-reason feature + 2 specs, 67 lines. Was in a worktree whose session (pid 94633) was **dead** but whose lock still read as held — and whose directory name no longer matched its branch. |
| `worktree-check-page-fixes` | `serverInventory.js`: IG probe `/` -> `/health`. `acceptAnyStatus` was turning IG's 404 into a green "Up". Since superseded — main already has it. |
| `worktree-bug-tracking-doc` | `BUGS.md` status updates, 2 weeks uncommitted. |

**Status of the three:**

- `worktree-deny-reason-surfacing` — **SHIPPED. PR #2661, merged as `15319bec7`,
  live on Docker and SE K8s.** Worktree and branch removed.
  The rescued WIP failed its own spec (68/69): it wired
  `NL_GATEWAY_REASON_MESSAGES` into only the thrown-`err` path, but a failed tool
  call arrives as a **response envelope**, so every real gateway deny still showed
  the coarse sentence. Fixed at the sibling site in `8ca594cb3`.
  Evidence: `AIAgent.chips` 69/69 · full UI suite 455 files / 3624 tests, 0 failed ·
  `npm run build` exit 0 · CI 4/4 · SE live-bundle grep for the Texas sentence
  went 0 -> 1 (`index-B8tPXV3w.js` -> `index-vRqhLjdg.js`).
- The other two are **inert** — `serverInventory.js` is a no-op against main
  (main already has `/health`), and `BUGS.md` is docs. Nothing to verify; the
  `serverInventory` commit can simply be dropped.

## Decisions settled

- **`se-nginx-aws-facade` — ABANDON.** Its useful half (`/mcp-facade/`, `/oauth/`)
  is already in main; that is why PR #2376 was closed. What remained re-adds
  `location /jaeger/`, which main deliberately removed because Jaeger has no auth
  and proxying it served `GET /jaeger/api/services` to the open internet. It also
  deletes the write-up of the 2026-08-27 Grafana-upstream incident that took the
  whole site down. Worktree removed; branch kept on origin.
- **`check-page-fixes` — FULLY SUPERSEDED. Dropped; worktree removed, branch kept
  on origin.** Main independently reimplemented all three commits (the four
  check-board fixes, the discovery-vs-call-path scope split in
  `McpTokenExchangeClient.ts`, and the `/health` probe).

  An intermediate pass claimed "9 test cases main lacks — port them". **That was
  wrong**, and the error is worth recording: the check extracted test names from
  `git diff` output without stripping the leading `+`, so every `grep -F` searched
  for a string that could never match and reported all 9 as missing. Verified
  properly, main is a strict superset — `ServersPage.test.jsx` and
  `openAccessIsPerHop.test.ts` are **byte-identical**, and
  `mcpTokenExchangeClient.test.ts` has **17 tests in main vs 15 on the branch**.

  Lesson: when a diff-derived check says "none of these exist", suspect the
  extraction before believing the conclusion. Compare whole files, not scraped
  substrings.

## Traps that produced wrong answers here

1. **A lock is not proof of a live session.** Locks embed the owning pid
   (`git worktree list --porcelain`). Two of five were dead, and one dead lock sat
   on the 67 lines above. `ps -p <pid>` is the whole check.
2. **"Adds 0 lines to main" means two opposite things.** With files touched it is
   superseded and safe. With **zero** files touched it is a brand-new worktree that
   has not committed yet — five were minutes old with live sessions inside.
3. **Measure staleness from the merge-base.** `git diff origin/main HEAD` shows
   main's newer work as the branch's deletions (`check-page-fixes` read `-2011`;
   from `git merge-base` it was `+1205/-88`). Neither number was the answer —
   only a content check was.
4. **A ~513-file dirty count is jest artifacts**, not work — `data/step-verification/**`.
   See `feedback-jest-regenerates-artifacts` in agent memory.

## Still open

- `fix-signin-modal-padding` — 1 unpushed commit, no remote, but **pid 20737 is
  alive** and holding it. Left for its own session to push.
- ~9 other branches parked, all pushed and safe; ship/abandon undecided.
