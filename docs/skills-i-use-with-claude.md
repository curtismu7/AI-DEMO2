# Skills I use with Claude (on my own machine)

Claude Code skills extend the AI with specialized knowledge, workflows, and tools — scoped to specific domains so the right guidance loads at the right time. Below are the skills I currently run, grouped by how they install. There is some overlap between sections as skills evolved; use at your own risk.

Privacy note: every skill in the downloadable bundle has been sanitized — no environment IDs, worker credentials, client secrets, decision-endpoint IDs, or other tenant-specific values are included. The PingOne skills reference values by their .env variable names only; supply your own. Project skills live in the public AI-DEMO2 repo (`.claude/skills/`); the downloadable zip bundle is still the June 2026 build and does not yet include the newer project skills.

GitHub: https://github.com/curtismu7/CDN/tree/96542ce632abfdffde215143183f77b1ab5fa908/claude-skills

## How to Install Skills

There are three install paths depending on the skill:

### 1. Official Plugins (Claude Code plugin system)

Some skills ship as official Claude Code plugins. Install them inside Claude Code with:

```bash
/plugin install <plugin-name>@<marketplace>
```bash

Or via the command line:

```bash
claude plugin install <plugin-name>@<marketplace>
```bash

The plugin-based general skills below come from the superpowers, skill-creator, code-review, commit-commands, and other official marketplaces. Ping skills come from the official `ping-identity` marketplace.

### 2. Manual Skills (copy to your skills directory)

Download claude-skills-bundle.zip, unzip it, then copy the skill folder(s) you want into `~/.claude/skills/` and restart Claude Code.

```bash
unzip claude-skills-bundle.zip
cp -r claude-skills-bundle/general/graphify ~/.claude/skills/
```bash

To install every manual skill at once:

```bash
unzip claude-skills-bundle.zip
cp -r claude-skills-bundle/general/* ~/.claude/skills/
cp -r claude-skills-bundle/pingone/* ~/.claude/skills/
```bash

### 3. Project Skills (copy from the AI-DEMO2 repo)

The AI-DEMO2 project skills live in the repo at `.claude/skills/`. Clone the repo and copy the folder(s) you want into your own project's `.claude/skills/` (or `~/.claude/skills/` to load them everywhere). Many are AI-DEMO2-specific but encode reusable Ping identity patterns.

After copying, restart Claude Code so the new skills are discovered.

## General Purpose Skills — Plugins

Useful to any Claude Code user regardless of project or stack. These install through the plugin system.

| Skill | Install | What It Does |
|---|---|---|
| verification-before-completion | Plugin: superpowers | Enforces evidence before success claims — requires running verification commands and confirming output before marking any work complete or creating a PR. |
| brainstorming | Plugin: superpowers | Structured ideation before implementation. Explores options, constraints, tradeoffs, and success criteria before choosing an approach. |
| test-driven-development | Plugin: superpowers | Guides red-green-refactor workflow: write failing tests first, implement the smallest fix, and refactor only after tests pass. |
| systematic-debugging | Plugin: superpowers | Systematic debugging workflow for reproducing issues, forming hypotheses, adding diagnostics, isolating root causes, and verifying fixes. |
| writing-plans / executing-plans | Plugin: superpowers | Turns a spec into a phased implementation plan, then executes it — inline or via subagents. The same plugin also covers git worktrees, parallel-agent dispatch, and code-review handoffs. |
| skill-creator | Plugin: skill-creator | Create new skills from scratch, improve existing ones, run evals to test trigger accuracy, and benchmark skill performance. |
| code-review | Plugin: code-review | Reviews the current diff or a PR for correctness bugs, plus reuse/simplification/efficiency cleanups, at a chosen effort level. |
| code-simplifier | Plugin: code-simplifier | Refines recently modified code for clarity, consistency, and maintainability while preserving functionality. |
| commit-commands | Plugin: commit-commands | Slash commands for creating commits, commit-push-PR, and cleaning gone branches — with consistent message conventions. |
| mgrep | Plugin: mgrep | Semantic code/search replacement for Grep/Glob/WebSearch — meaning-based matching instead of keyword matching. |
| playwright | Plugin: playwright | Drives a real browser: navigate, click, fill forms, screenshot, read console/network — for testing web apps end to end. |
| context7 | Plugin: context7 | Pulls up-to-date library documentation into context so code suggestions use current API versions instead of training-data guesses. |

Also installed and worth a look: **ponytail** (minimal-diff coding discipline), **ralph-loop** (long-running autonomous loops), **watch** (video), **obsidian** (vault integration), **ui-ux-pro-max** (design systems, branding, slide styling), **tdd-guard** (enforces TDD during edits).

## General Purpose Skills — Manual

| Skill | Install | What It Does |
|---|---|---|
| impeccable | Manual | Design, redesign, audit, or polish any frontend interface. UX review, visual hierarchy, accessibility, typography, color, motion, micro-interactions, and design systems — with real working code. |
| frontend-design | Manual | Create distinctive, production-grade frontend interfaces; avoids generic AI aesthetics when building pages and components. |
| graphify | Manual | Turn any codebase, docs, papers, or media into a persistent knowledge graph with community detection, god nodes, and query/path/explain tools. Best entry point for architecture questions. |
| mcp-builder | Manual | Build high-quality MCP (Model Context Protocol) servers — FastMCP (Python) and MCP SDK (TypeScript), tool design, error handling, integration patterns. |
| static-analysis | Manual | Semgrep, CodeQL, and SARIF-parsing skills (plus scanner subagents) for running and interpreting static security analysis. |
| agent-sandbox | Manual | Operate E2B sandboxes from the CLI — run untrusted code, test packages, and inspect binaries in isolation. |
| notebooklm | Manual | Full programmatic API for Google NotebookLM — create notebooks, add sources, generate artifacts (including podcast-style outputs) beyond the web UI. |
| supermemory | Manual | Add persistent memory, user profiles, and semantic search to apps you build — the Supermemory API/SDK integration guide. |
| webapp-testing | Manual | Playwright-based toolkit for testing local web applications — UI verification, screenshots, browser log inspection, DOM interaction. |
| theme-factory | Manual | Apply professional font/color themes to any artifact — slides, docs, reports, HTML pages. 10 preset themes plus on-the-fly generation. |
| docx | Manual | Create, read, and edit Word documents — formatting, tables, images, tracked changes. |
| xlsx | Manual | Create, read, and edit spreadsheets — formulas, charts, data cleaning. |
| pptx | Manual | Create, read, and edit PowerPoint decks — slides, templates, speaker notes. |
| pdf | Manual | PDF processing — extract text/tables, merge/split, rotate, watermark, OCR, fill forms. |

Note: the June bundle's tighten-prompt, cheapest-model, agent-tool, and supergoal skills have been retired from my setup (superseded by plugin equivalents and Claude Code's built-in Agent tooling).

## PingOne / Identity Skills

### Official Ping Identity Plugin (recommended starting point)

Ping now ships an official Claude Code plugin from the `pingidentity` marketplace — it supersedes most of my original hand-built PingOne bundle:

| Skill | What It Does |
|---|---|
| ping-foundation | Orientation and routing — "where do I start", which Ping product fits, migration guidance. Use before the other Ping skills when the platform is unknown. |
| ping-quickstart | Set up, configure, and administer any Ping platform — PingOne, Advanced Identity Cloud, PingAM/PingFederate/PingAccess/PingDirectory/PingID. Tenant setup, app registration, worker apps, M2M service accounts. |
| ping-identity-for-ai | AI agents + identity: agent machine identity, client credentials for agents, Verified Trust, PingGateway as MCP gateway, CIBA human-in-the-loop approvals, bot detection with PingOne Protect. |
| ping-app-integration | App/SDK integration — Android/iOS/JavaScript SDKs, OIDC + PKCE flows, token management, ForgeRock SDK migration, redirect/CORS/refresh troubleshooting. |
| ping-orchestration | Design authentication flows and orchestration — DaVinci flows, AIC journeys, PingAM trees, MFA/step-up/passwordless, social login. |
| ping-universal-services | Shared services at policy level — PingOne Protect (risk), Verify (KYC), MFA, Credentials (verifiable credentials), IGA, Authorize, Privilege. |

### Manual (user-level, install from bundle or repo)

| Skill | What It Does |
|---|---|
| pingone-mcp | Read/update PingOne resources through the hosted PingOne MCP server — apps, populations, users, DaVinci flows, env config. Covers connecting Claude Code/Cursor/VS Code, the MCP-first vs Management-API fallback rule, and interactive-OAuth vs worker client_credentials auth. |
| pingone-mcp-install | Install PingOne MCP into Cursor or VS Code and create the PingOne Worker apps it needs — redirect callbacks, mcp.json wiring, worker client_credentials, and the common install failures. |
| pingone-remote-mcp-connect | Connect IDE MCP clients to the PingOne hosted Remote MCP Server — port 7474 OAuth callback, Worker app for MCP client auth, troubleshooting missing PingOne MCP tools. |
| pingone-sample-apps | Build, run, and troubleshoot the PingOne devdocs sample apps (custom-admin-role, m2m-credentials, mfa-demo, user-registration × go/js/python/react/angular) — worker roles, 401/403/406/415 handling, pi.flow architecture. |
| par | PAR (Pushed Authorization Request, RFC 9126) — understand the flow, verify PingOne PAR endpoint configuration, and test authorization intent binding live. |

Retired from the June bundle: oauth-pingone, pingone-api-calls, pingone-mfa, pingone-recognize, pingone-session-termination, ciba, authz-server, authz-server-parity, and pingone-authorize-configure. The official plugin and the project skills below now cover this ground; the zip bundle still ships the old set if you want the originals.

## AI-DEMO2 Project Skills

Repo-specific skills that encode hard-won patterns from building the AI-DEMO2 identity demo. Copy from `.claude/skills/` in the repo. Most are useful as templates even outside this project.

### Identity & Ping Products

| Skill | What It Does |
|---|---|
| pingfederate-install | Stand up PingFederate (zip, Docker/Compose, or Kubernetes) — licence, ports, Java, admin console first-run, readiness checks. |
| pingfederate-id-jag | Configure PingFederate 13.1+ to issue/accept ID-JAG (Identity Assertion JWT Authorization Grant, cross-app access) via RFC 8693 token exchange — processor policies, SP connections, JWT Bearer Grant debugging. |
| creating-pingfederate-id-jag-resource-server | Build the resource-server side of ID-JAG enterprise-managed MCP authorization — receiving and validating exchanged tokens. |
| pingid-ai-demo | PingID MFA — device enrollment, authentication policy, user experience, IdP integration. |
| pingone-davinci-orchestration | DaVinci widget and Orchestration SDK flows — collectors, multi-screen progression, callbacks, PKCE, embedded/pop-out runners, safe flow debugging. |
| pingone-protect-ai-demo | PingOne Protect / Signals risk integration — risk evaluations, risk policy inputs, risk-result handling. |
| pingone-authorize-ea-api-build | Build PingOne Authorize policies, Trust Framework attributes, resolvers, and AAM rules against the Early Access Admin API — including sideband decision debugging with PingGateway/Kong. Captures many undocumented API behaviors. |
| p1az-import-generator | Generate a PingOne Authorize snapshot import file from plain-language rules ("deny if amount over 2000", "require step-up MFA over 500") — produces schema-correct JSON. |
| pingauthorize-aam-ai-demo | PingOne Authorize API Access Management — Sideband decisions, API services, operations, Gateway integration route. |
| pingaccess-ai-demo | PingAccess as a web/API access enforcement layer, and how it differs from PingGateway. |
| pingdirectory-ai-demo | Connect demos to PingDirectory — LDAP identity lookup, user/group data, schema, replication, TLS. |
| a2a-protocol | Agent2Agent protocol work — distinguishes RFC 8693 nested-act identity from the Linux Foundation A2A wire protocol (Agent Cards, JSON-RPC handoff, bearer auth on the A2A hop). |

### Agent & AI

| Skill | What It Does |
|---|---|
| bedrock-agentcore-pingone | Deploy an AI agent to AWS Bedrock AgentCore Runtime with PingOne as OAuth IdP — both M2M (client_credentials) and user-federation (3LO login) flows. The gotchas here are from real debugging, not docs. |
| oauth-teaching-agent | Teach or demonstrate OAuth 2.0/2.1, OIDC, scopes, token exchange, delegation, and human approval through an interactive teaching agent. |
| agent-demo-triage | Diagnose demo-agent misbehavior — wrong-mode replies, unknown-action toasts, gateway 502/503s, scope denials — and review routing/flag/scope changes safely. |
| chip-correctness-testing | Verify agent UI chips return the RIGHT answer — real values from the store, correct routing, identical results in heuristics and every LLM mode. Includes the traps that make chip tests silently prove nothing. |

### Ping Privilege

| Skill | What It Does |
|---|---|
| privilege-mcpgw-agent-k8s | Deploy, repair, and verify the PingOne Privilege AI Gateway on Kubernetes from the helm package — Agentic App registration, policy authoring, proving the chain from an MCP client. |
| privilege-new-demo-environment | Stand up a fresh, separate Privilege demo environment — own PingOne env, own gateway, own apps/agents; turns a one-off setup into a repeatable handover. |
| privilege-cloud-mcp | Privilege Cloud MCP integration — the Privilege Gateway, the BFF MCP client relay, and extension patterns. |
| privilege-admin-config-ui | Recipe for building Privilege-facing admin/config pages — config store, thin Express route, themed React component wired into an existing page. |

### Demo Engineering

| Skill | What It Does |
|---|---|
| regression-guard | Enforce the demo's do-not-break contract before/during changes to OAuth/login, token exchange, BFF sessions, role enforcement, HITL consent, ports/hosts, or the UI — even for one-liners. |
| verify-ai-demo2 | Prove a code/env change actually took effect in the running stack — the repeat failure where a feature is merged but inert because the code sits where requests never go. Worktree-aware. |
| generate-tests | Write new unit/integration tests in this repo — routes to the right runner per service, applies repo error-shape/mocking conventions, flags jest/vitest traps that cause false green/red runs. |
| se-k8-deploy | Deploy/undeploy the demo to the SE DevOps Kubernetes cluster — build, GHCR push, kubectl context, health checks. |
| inspector-template | Build or convert admin/dev-tool pages onto the shared MCP-Inspector-style layout (left tool tree, middle param form, right tabbed output) instead of re-hand-rolling it. |
| karpathy-guidelines | Behavioral guidelines to reduce common LLM coding mistakes — surgical changes, no overcomplication, surfaced assumptions, verifiable success criteria. |
| pingcli-demo-page | Build a UI demo page that showcases PingCLI commands — command display, live execution, terminal-style output pane, nav wiring. |

### Workflow Skills (new — Oct 2026)

| Skill | What It Does |
|---|---|
| docker-local-deploy | Local Docker deploy on OrbStack — run-docker.sh builds, PROD_MODE vs dev, and the three silent failures of a fresh checkout/worktree (gitignored certs/ and .env files, image-baked MCP config). |
| brand-compliance | Ping Brand Refresh 2026 — Montserrat, official 2026 logo, Ping Red gradients, the three hardcoded font stacks that must stay in sync, and the documented exceptions. |

Last updated: 10 October 2026. 16 plugins, 14 manual general-purpose skills, 5 user-level Ping skills, and 29 AI-DEMO2 project skills. The zip bundle still contains the June 2026 set — a rebuild including the new project skills (sanitized) is pending.
