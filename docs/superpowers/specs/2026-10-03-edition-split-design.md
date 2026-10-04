# Edition split: P1-AI-DEMO and PF-AI-DEMO

Date: 2026-10-03 · Status: draft for review

## Goal

Produce two standalone demos from AI-DEMO2 without changing AI-DEMO2 itself:

- **P1-AI-DEMO** — PingOne issues all tokens.
- **PF-AI-DEMO** — PingFederate issues all tokens; PingOne stays behind it as the user directory and for MFA, Authorize, DaVinci, Protect and Privilege.

## Decisions (settled with the user)

- AI-DEMO2 stays intact: both providers, runtime `OAUTH_PROVIDER` switch, nothing deleted. It is the only place code is written.
- Editions are **generated** by an export script, one-way. Nobody edits them directly; updates come from re-running the export.
- Both new repos are **private**: `P1-AI-DEMO` and `PF-AI-DEMO`.
- PF edition may keep every PingOne service. No PingOne replacement work.
- No shared package and no `git subtree` (subtree only splits one directory).
- **Each edition gets its own new PingOne environment**, separate from AI-DEMO2's. Nothing in an edition may depend on AI-DEMO2's environment, worker apps, users, DaVinci flows, Authorize policies or vault secrets.
- Assumption to confirm: one stack runs per machine at a time, so ports and hostnames are unchanged.

## Measured facts that shaped the design

- `OAUTH_PROVIDER` (`pingone` | `pingfederate`) is compared in 36 non-test source files (BFF services/routes/middleware, 8 UI files, `oauth-mcp/src/tools/TokenResolver.ts`).
- BFF source files: 452 mention only PingOne, 60 both, 10 only PingFederate. About 95 files repo-wide are PF-named.
- PF already runs as its own compose project (`scripts/pingfederate/docker-compose.local.yml`); its config lives in a container volume and `~/pingfederate-profile`, not Git. A fresh volume has zero OAuth clients.
- `demoReadinessCatalog.js` already maps each of the 82 use cases to a PF flow or `not-applicable`; a PF readiness lane exists.
- Known PF gaps: A2A loses the `act` claim under PF; PingGateway introspection rejects PF tokens unless `FF_MCP_GATEWAY_JWKS=true`.

## Design

### Phase 0 — Fresh PingOne environment is reproducible (AI-DEMO2)
Existing: `setup:fresh`, `pingone:bootstrap` (`--recreate-apps`, `--wipe-environment`), `provisionVerticalGroups.js`. Unverified: whether they also create DaVinci flows, Authorize (P1AZ) policies, Protect policies, Privilege gateway/agentic apps, MFA policies, and the PF-to-PingOne gateway connection (`scripts/pingfederate/create-pingone-connection.js`, needs an Environment Admin bootstrap worker). Audit each against a throwaway new environment and list every gap; gaps become provisioning scripts or documented manual steps.
Also: environment IDs, client IDs and secrets must come only from per-edition config/vault; a grep of the export for AI-DEMO2's environment ID must return nothing.
**Done when:** a brand-new PingOne environment plus one command (or a short, documented manual list) reaches a working Super Sports sign-in and one agent chip, with AI-DEMO2's environment untouched.

### Phase 1 — PF baseline (AI-DEMO2, no code change)
Run the PF readiness lane; record pass / fail / not-applicable for all 82 use cases. Failures are fixed in AI-DEMO2 because the PF edition inherits them.
**Done when:** a committed results table covers all 82 use cases.

### Phase 2 — Reproducible PF (AI-DEMO2)
Extend `scripts/pingfederate/` so a wiped PF volume reaches the working state with one command: JDBC client storage, all clients, token managers (`aiDemoPfJwtAtm`, `aiDemoPfMcpGatewayJwtAtm`, `aiDemoPfAgentGwJwtAtm`), exchange policies. Secrets come from the vault, never Git.
**Done when:** wipe PF volume, run the command, and the Phase 1 pass list is unchanged.

### Phase 3 — Edition manifests (AI-DEMO2)
`editions/pingone.json` and `editions/pingfederate.json`, each listing: provider pin, paths to remove, use-case ids to drop, README/CLAUDE.md identity.
- P1: remove PF pages/routes/tests, `scripts/pingfederate/`, PF readiness lane, PF-only use cases (UC40, PF AI Agent, PF DaVinci kit, SPIFFE-PF).
- PF: remove use cases Phase 1 marks not-applicable, and the provider toggle.
- Files still imported by retained code stay in, pinned and unreachable. The export does not rewrite the 36 branch files.
- Removed use cases must also leave every use-case source of truth (`auth-requirements.json`, nav, etc.) or `authz:verify` fails.
**Done when:** each manifest's removals leave no dangling import (checked in Phase 4).

### Phase 4 — Export script (AI-DEMO2)
`scripts/export-edition.sh <pingone|pingfederate> <target-dir>`: `git archive` of `main`, apply the manifest, write the provider pin. Refuses to finish unless, inside the exported tree: secret scan is clean, `npm run build` (UI) passes, scoped BFF jest passes, `npm run authz:verify` passes. Must satisfy the repo-root allowlist and not copy gitignored files, `.env`, or vault data.
**Done when:** both editions export and pass those gates.

### Phase 5 — Publish
Create private repos `P1-AI-DEMO` and `PF-AI-DEMO`, export into each, push. Acceptance: a clean clone of each, pointed at its own new PingOne environment, brings the stack up and a Super Sports sign-in plus one agent chip works.

## Order and size
P1 edition can ship after Phases 0, 3 and 4 without waiting for Phases 1–2. Phase 0 is now the largest unknown: DaVinci, Authorize and Privilege setup are often partly manual, so budget 1–2 weeks and expect it to size the whole project. Phases 1–2: about a week, carries the risk. Phases 3–5: about a week. Each edition needs its own Phase 0 run (own environment), though the scripts are shared.

## Known costs
- Two more PingOne environments to create and maintain, each with its own worker apps, secrets and vault.
- Each edition still contains unreachable code for the other provider.
- Fixes to shared code reach editions only by re-export; editions drift until then.
- Repo history size, and the earlier secret exposure in AI-DEMO2 (rotation outstanding): exports use `git archive` (no history) so exposed secrets in old commits do not travel.

## Out of scope
Replacing PingOne in the PF edition; collapsing the 36 provider branches; a shared library; automatic re-export on merge (add later if drift hurts).
