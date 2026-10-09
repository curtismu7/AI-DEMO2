# Navigation and diagram progress

Use this checklist to track the PingOne platform navigation and use-case diagram work.

## Navigation foundation

- [x] Create a single Agent Privilege group.
- [x] Move Protected RAG into Agent Privilege.
- [x] Rename the user-facing Privilege terminology to Agent Privilege.
- [x] Place AI Guard inside Agent Privilege.
- [x] Create one DaVinci group for widget, login, SDK, and orchestration experiences.
- [x] Place Headless Identity / PingCLI under PingOne Products.
- [x] Keep Identity Journeys separate from PingOne Products.
- [x] Keep Authorize separate.
- [x] Keep Delegation & Consent separate.
- [x] Create Utilities for test, debug, setup, and reference tools.
- [x] Create Observability for reports, logs, traces, service flow, and monitoring.
- [x] Keep MCP & Integrations separate from AI Experiences.
- [x] Keep generic platform diagrams under Architecture & Learning.
- [x] Remove duplicate navigation destinations.

## Diagram ownership

- [x] Move Login Flow Diagram to Identity Journeys.
- [x] Move Agent Onboarding diagrams to AI Experiences.
- [x] Keep System Flow in Observability.
- [x] Keep generic token/platform/deployment diagrams in Architecture & Learning.
- [x] Keep DaVinci orchestration content in DaVinci.
- [x] Keep Agent Privilege enforcement and Protected RAG content in Agent Privilege.

## Diagram build backlog

Build diagrams around the use case they explain, not around the implementation technology.

- [x] DaVinci orchestration overview (`/davinci-orchestration` already exists)
  - [x] App or SDK entry point
  - [x] DaVinci flow/orchestration execution
  - [x] PingOne identity step
  - [x] Callback/session result links to the live SDK/widget experiences
  - [x] Error and branch handling is represented by the risk branch and step-up path

- [x] Identity journey map (`/login-flow`)
  - [x] Registration
  - [x] Login
  - [x] MFA step-up
  - [x] Recovery and completion states
  - [x] Static journey map is the blank-on-load default
  - [x] `Refresh` restores the last captured login trace from the browser session
  - [x] `Clear` hides the live trace without changing the static map

- [x] Delegated access proof (`/academy/delegation/guided`, surfaced as Architecture & Learning)
  - [x] Human identity
  - [x] Agent token exchange
  - [x] `act` claim and scope narrowing
  - [x] Gateway and Authorize decision
  - [x] Tool execution and evidence
  - [x] Deny / step-up branch
  - [x] Live tenant and recorded-path links

- [x] Protected RAG authorization flow (`/code-search`, owned by Agent Privilege)
  - [x] User or agent request
  - [x] Agent Privilege retrieval authorization
  - [x] Document/search boundary
  - [x] Grounded response and citations
  - [x] Denied retrieval path

- [ ] Enterprise MCP / ID-JAG flow
  - [ ] Enterprise group policy
  - [ ] ID-JAG issuance
  - [ ] MCP authorization-server redemption
  - [ ] Scoped MCP access token
  - [ ] Centralized revocation

- [ ] Personal Agent registration and delegation
  - [ ] Agent registration
  - [ ] MFA/high-assurance user authentication
  - [ ] RFC 8693 delegation
  - [ ] Personal-agent tool access
  - [ ] Revocation path

- [ ] Agent tool-boundary diagram
  - [ ] Model response versus available tools
  - [ ] Tool authorization boundary
  - [ ] Human-review-only actions
  - [ ] Unauthorized commitment prevention

## Verification for each diagram

- [ ] Page has a clear use-case title and owner group.
- [ ] Happy path is visible without explanation from the presenter.
- [ ] Security decision points are labeled.
- [ ] Deny, step-up, consent, or failure paths are shown where applicable.
- [ ] Diagram links to the relevant live demo or evidence view.
- [ ] Diagram has focused tests.
- [ ] Navigation catalog and route metadata are updated.
- [ ] UI unit tests and production build pass.

## Current implementation status

- Navigation and regrouping: **complete**
- Diagram ownership pass: **complete**
- DaVinci orchestration diagram: **complete — existing page validated**
- Identity journey diagram: **complete — `/login-flow` now presents the full map and live trace**
- Delegated access diagram: **complete — promoted RFC 8693 lesson with gateway/policy/tool proof**
- Protected RAG diagram: **complete — `/code-search` now shows the authorization path and deny branch**
- Enterprise MCP / ID-JAG diagram: **queued**
- Personal Agent diagram: **queued**
- Agent tool-boundary diagram: **queued**
