# Scheduled chats control center

## Purpose

Give a presenter or account owner one clear place to understand, pause, edit,
and manually run the three unattended demo workflows. The page should make the
difference between a run completing and a business action completing impossible
to miss.

## Audience and job

The primary user is someone preparing a demo or handing it to another person.
They need to answer four questions quickly:

1. What will run, and what will it do?
2. Is it currently enabled?
3. When will it run next, in which timezone?
4. What happened the last time it ran, and does it need attention?

## Proposed page

Route: `/scheduled-chats` in LibreChat's existing control-panel navigation.

The page opens with a compact status summary, followed by one row per schedule.
Each row has the schedule name, plain-language explanation, agent, cadence,
next-run time, last-run outcome, and explicit controls. Selecting a row opens a
right-side details panel without losing the list context.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Scheduled chats                                      3 schedules         │
│ Automated demos for this account                     0 running            │
│                                                                         │
│ [All schedules] [Needs attention]                         [New schedule] │
│                                                                         │
│ MORNING BALANCE REPORT                         Enabled                  │
│ Summarizes balances and the last five transactions                     │
│ Everyday Banking · Every day · 08:00 America/Chicago                    │
│ Next run ... · Last run Success                              [Run now]  │
│                                                     [Pause] [Details]    │
│                                                                         │
│ WEEKLY SAVINGS SWEEP                             Paused                  │
│ Attempts a $750 checking-to-savings transfer; step-up may be required   │
│ Money Movement · Mondays · 07:00 America/Chicago                        │
│ Last run Completed with step-up required                     [Edit]     │
│                                                     [Run now] [Details]  │
└─────────────────────────────────────────────────────────────────────────┘
                                      ┌──────────────────────────────────┐
                                      │ Weekly savings sweep             │
                                      │ What it does                     │
                                      │ Run schedule                     │
                                      │ [time] [timezone]                │
                                      │ [Save changes]                    │
                                      │ Run history                       │
                                      └──────────────────────────────────┘
```

## Schedule records

The current seed defines these records. The UI should display the explanation
as product language, while retaining the exact prompt in an advanced/details
section.

| Schedule | Plain-language explanation | Cadence | Important outcome |
| --- | --- | --- | --- |
| Morning balance report | Reads the account balances and the five most recent transactions. | Daily at 08:00 | Read-only; a successful run produces a chat. |
| Daily rentals check | Checks active equipment rentals through the Super Sports gateway. | Daily at 09:00 | Requires the seed account to connect to `super-sports-gateway`. |
| Weekly savings sweep | Attempts to transfer $750 from checking to savings. | Mondays at 07:00 | A successful run can still stop at step-up; this does not mean money moved. |

All times use `America/Chicago` by default. The page should show the timezone
next to every time and in the editor, never rely on the browser's local timezone
silently.

## Controls and behavior

### Enable and pause

- Each row has an accessible switch labeled `Enable <schedule>` or
  `Pause <schedule>`.
- Pausing prevents future cadence-triggered runs but does not delete history.
- `Run now` remains available while paused, with confirmation text explaining
  that it runs once and does not enable the schedule.
- A running schedule shows `Running` and replaces `Run now` with `Stop run`.
- Stopping is cooperative: the UI reports `Stopping` until the server confirms
  the run ended. It must not claim that a downstream tool call was rolled back.

### Edit time

The editor supports:

- Frequency: daily or weekly.
- Time: hour and minute.
- Weekday selection for weekly schedules.
- Timezone, defaulting to `America/Chicago`.
- Prompt and agent are visible but read-only for these seeded demos.

Saving updates the existing schedule by ID. It must not create a second record,
reset the enabled state, or erase the last-run record. On success, show the
updated next-run time and a concise `Schedule updated` confirmation.

### Explanation panel

The details panel contains:

- What this schedule does.
- What it can change, if anything.
- What a normal success looks like.
- What can stop it and what the user should do next.
- The exact prompt and selected agent under a collapsed “Technical details”.

Use explicit outcome language:

- `Success — chat created` means the agent run completed.
- `Completed with step-up required` means the transfer was attempted but did
  not complete without additional authentication.
- `Needs connection` means the MCP gateway sign-in is missing.
- `Failed` means the schedule engine could not complete the run for another
  reason.

## Safety and error states

- Never imply that a transfer happened merely because a scheduled run succeeded.
- Before `Run now` on the savings sweep, show a lightweight confirmation:
  “This will attempt a $750 transfer and may ask for step-up approval.”
- If a schedule is disabled, use a neutral paused state rather than a failure
  color.
- If the last run failed, show the server's actionable reason and a recovery
  action when one exists, such as `Connect gateway`.
- Preserve server truth after refresh; optimistic toggles must roll back if the
  API rejects the change.
- Respect the existing per-user limit of three schedules and hourly minimum
  interval. A new-schedule control may remain hidden or disabled until creation
  is implemented.

## Data contract (proposed)

The existing schedule endpoints are sufficient for the first page:

- `GET /api/schedules` — list schedule summaries.
- `GET /api/schedules/:id` — fetch one schedule and its last-run metadata.
- `PATCH /api/schedules/:id` — update cadence, timezone, prompt, or enabled
  state according to server policy.
- `POST /api/schedules/:id/run` — start one run.
- `POST /api/schedules/:id/stop` — request cancellation of an active run.

The list response should expose `lastRun`, `runCount`, `failureCount`, and
`nextRunAt` (or an equivalent server-computed value). The client should not
reconstruct next-run times independently when the server can provide them.

## Acceptance criteria for implementation

- A user can see all three seeded schedules without opening separate chats.
- A user can pause and resume a schedule, with the persisted state surviving a
  refresh.
- A user can edit the time and weekday, and reseeding updates that same record
  without duplicating it or resetting the user's enabled choice.
- A user can run a paused schedule once and see the resulting chat or failure.
- The rentals failure is explained as missing gateway authentication.
- The savings result distinguishes run success from transfer completion and
  displays step-up/HITL status.
- Stop behavior is visible while a run is active and does not promise rollback.
- Keyboard navigation, visible focus, screen-reader labels, mobile layout, and
  reduced-motion behavior are covered.

## Review decisions requested

1. Should the page live as a top-level LibreChat control-panel item, or inside
   the existing Scheduled chats view?
2. Should `Stop run` be included in the first implementation, or should the
   first version only pause future runs and show in-flight status?
3. Should seeded agents remain read-only in the editor, as shown here?
