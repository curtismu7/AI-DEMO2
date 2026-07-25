# Sub-project A — Agent Skills card on the PingCLI page

**Date:** 2026-07-25
**Status:** design, awaiting user approval
**Sub-project of:** "Ping AI-first headless identity" demo (4 pillars: CLI, MCP,
Agent Skills, Terraform). This is piece 1 of 4; B (Mgmt API runner), C
(MCP-in-the-loop), D (headless auth flows) follow in their own spec→plan cycles.

## Why

Ping's official developer story
([build-with-ai](https://developer.pingidentity.com/build-with-ai/index.html))
frames "AI-first headless identity" around four execution pillars: **Ping CLI,
MCP Servers, Agent Skills, Terraform** — all natural-language driven from an
IDE/AI agent. The demo already covers CLI (the working `/pingcli` page) and MCP
(hosted PingOne MCP + `pingone-mcp` skill). The **Agent Skills** pillar is not
yet shown.

`pingcli` 1.2.0 ships a first-class `agent-skills` command
(`list` / `install`) — the CLI can enumerate and install Ping's composable
agent skills into `.claude/skills`. Surfacing it on the existing `/pingcli`
page demonstrates the Agent Skills pillar with zero new infrastructure.

Note: the originally-requested "Config-as-Code / Terraform export" is **not
possible** via this CLI build — there is no `platform export`/HCL command;
Terraform is a separate Ping provider (own binary, not in our container).
Terraform stays a candidate for a later, heavier sub-project. This piece
substitutes the `agent-skills` capability, which is the smallest, most
on-theme first step. (User-approved reframe, 2026-07-25.)

## What it does

Add one new collapsible category — **"AI Agent Skills"** — to the existing
`/pingcli` page, with two cards:

1. **List agent skills** — runs `pingcli agent-skills list -O json` live;
   output streams into the existing terminal pane. Verified live in-container:
   returns `pingcli-usage - Complete command reference for Ping CLI dev.`
2. **Install an agent skill** — demonstrates
   `pingcli agent-skills install pingcli-usage`. See open decision below for
   run-vs-copy behavior.

No new page, no nav change, no hub refactor. Page structure ("hub vs separate
pages") is deferred until a later sub-project adds a second page.

## Components & changes

Two files, mirroring the existing add-a-command pattern exactly.

### Backend — `demo_api_server/routes/pingcli.js`

Add to the `COMMANDS` map:

```js
agent_skills_list:    { label: 'pingcli agent-skills list -O json',
                        args: [...configFlag, 'agent-skills', 'list', '-O', 'json'],
                        runnable: true },   // no auth: catalog is local, no token needed
agent_skills_install: { /* see open decision */ },
```

- `list` needs **no** `auth` bootstrap — the skills catalog is bundled/local,
  not a PingOne management call (verified: `list` succeeds with no `auth login`).
- Reuse the existing `resolveArgs` / `execFile` / `spawn` paths unchanged. The
  JSON envelope parser at `/run` already handles the `{status,message,data}`
  shape (this command puts skill names in `message`, `data:null` — renders fine
  as pretty JSON).

### Frontend — `demo_api_ui/src/components/PingCliPage.js`

Add one entry to the `CATEGORIES` array (line ~237):

```js
{
  title: 'AI Agent Skills',
  commands: [
    { key: 'agent_skills_list',    label: 'List Agent Skills',
      desc: 'pingcli agent-skills list -O json' },
    { key: 'agent_skills_install', label: 'Install Agent Skill',
      desc: 'pingcli agent-skills install pingcli-usage' },
  ],
},
```

`labelForCommandKey`, section collapse/persist, Copy, and Run/stream wiring all
work off `CATEGORIES` + `/commands` automatically — no other frontend change.

## Open decision — `install` behavior

`pingcli agent-skills install <name>` **copies files** into
`<output-dir>/<skill-name>` (default `.claude/skills` in CWD). Running it
server-side installs into the container, which is not the presenter's IDE.
Two options:

- **(Recommended) Live sandboxed run.** Card runs
  `agent-skills install pingcli-usage --output-dir <tmp>` into a throwaway
  temp dir so the copy is demonstrably real and non-destructive; the card
  *label* shows the clean canonical command
  (`pingcli agent-skills install pingcli-usage`) for the presenter to run on
  their own machine. Matches the route's existing "label ≠ internal args"
  convention (it already hides `--config`). Slightly more backend code
  (`resolveArgs` must inject the temp `--output-dir`, or add a dedicated arg).
- **Copy-only.** Mark `agent_skills_install` `runnable:false`; the route's
  existing `copy_only_command` path returns the command to copy. Least code,
  reuses the pattern used today for non-runnable commands. Less live "wow".

Default to the recommended option unless the user prefers copy-only.

## Success criteria

- `/pingcli` shows a new **"AI Agent Skills"** section with two cards.
- Clicking **List Agent Skills** streams real JSON listing `pingcli-usage`
  (exit 0) into the terminal pane — verified in the running stack, not just unit.
- **Install** behaves per the chosen option (live copy into temp dir, or
  copy-to-clipboard) with no error and no write to any real `.claude/skills`.
- No regression to existing pingcli cards (all still run live).
- UI build gate passes; emoji allowlist respected (no new emoji needed).

## Out of scope

- Terraform / Config-as-Code export (separate provider — future sub-project).
- Sub-projects B, C, D.
- Any hub-page refactor or nav restructuring.
- Adding skills to Ping's catalog (we only list/install what the CLI serves).

## Test plan

- Backend: extend the existing pingcli route jest suite — assert
  `agent_skills_list` is `runnable`, `auth:false`, and that `/commands`
  includes both new keys with correct labels.
- Live: run List in-browser against the running stack; confirm JSON output +
  exit 0. Confirm Install per chosen option.
- Regression: existing cards (users/apps/environments list) still return live
  data.
