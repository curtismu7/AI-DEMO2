# Agent terminology and Academy alignment

## Goal

Align the application’s visible agent vocabulary with the Academy preview and
Ping’s agent identity model, while preserving all runtime IDs, OAuth clients,
PingOne application names, token-exchange behavior, and authorization behavior.

Reference: `demo_api_ui/public/academy-preview.html`.

## Canonical vocabulary

| Concept | User-facing term | Implementation rule |
| --- | --- | --- |
| Primary agent | Banking Agent | Use this as the main user-facing agent name. |
| Primary A2A role | Generalist agent | Use for the initiating agent in a delegation chain. |
| Planning role | Planner | Use only when explaining orchestration; it is not a second identity. |
| Delegated A2A role | Specialist agent | Append the configured specialist display name where available. |
| PingOne identity | Agent identity | Keep separate from the runtime/framework label. |
| Framework/process | Agent runtime | Show LangGraph, OpenAI Agents SDK, Mastra, or Pydantic AI as secondary metadata. |
| Simulated evidence | Mock replay | Never present simulated frames as live tenant activity. |
| Captured evidence | Recorded run | Use for shipped/replayed traces. |
| Tenant execution | Live run | Use only when the application actually performs the live operation. |
| A2A metadata | Agent Card | Describe capability and protocol metadata, not authorization. |

## Implementation sequence

1. **Terminology contract** — add one UI config module for shared display labels,
   role labels, provenance labels, and evidence-frame labels. Add contract tests.
   Do not rename internal IDs or credentials.
2. **Primary-agent surfaces** — update the dashboard agent, runtime cards,
   flow diagrams, guides, CIBA examples, and broker examples to use the contract.
3. **A2A surfaces** — use the server specialist registry as the identity source;
   remove or reduce duplicated UI specialist metadata and consistently render
   `Generalist agent → Specialist agent`.
4. **Evidence presentation** — align live and recorded token-chain views with
   the preview’s frame model and provenance indicators, reusing
   `TokenChainFilmstrip`.
5. **Learning copy and registry** — make the identity/protocol distinction
   explicit and separate agent identity, runtime, Agent Card, and authority in
   registry and Academy views.

## Item 1 design

Create `demo_api_ui/src/config/agentTerminology.js` with immutable constants:

- `PRIMARY_AGENT`: stable internal key plus `Banking Agent` display name
- `AGENT_ROLES`: `generalist`, `planner`, and `specialist`
- `RUN_PROVENANCE`: `mock`, `recorded`, and `live`
- `EVIDENCE_FRAME_LABELS`: shared labels for prompt, route, exchange,
  authorization, execution, and reply
- `formatAgentLabel()` for combining a friendly display name with optional
  technical runtime metadata without exposing implementation IDs as the main
  label

This module is a display vocabulary contract, not a replacement for the
server-side specialist registry or scope topology.

## Protected behavior

- Do not change browser token custody or BFF session behavior.
- Do not change OAuth redirect origins, token exchange, scopes, audiences, or
  authorization requirements.
- Do not rename PingOne applications, client IDs, environment keys, or runtime
  routing IDs.
- Preserve the existing emoji allowlist and both-theme UI standards.

## Verification

- Run the new terminology contract test first and observe the expected failure.
- Run the focused terminology test after implementation.
- Run `cd demo_api_ui && npm run test:unit`.
- Run `cd demo_api_ui && npm run build`.
- Run `git diff --check` and verify only the plan and item-1 files changed.
