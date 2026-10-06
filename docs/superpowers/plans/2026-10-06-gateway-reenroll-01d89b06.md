# Re-enroll the Privilege gateways into 01d89b06

**Goal:** keep the three agentless gateways and their load balancer, but make `01d89b06` (the main demo environment) the tenant they are enrolled in and sign users in against, so `0428ba4f` and the External IdP federation can be retired.

**Supersedes:** Phase 2 of `2026-09-08-single-namespace-single-tenant.md`. That phase assumed repointing the gateway's OIDC client was enough. It is not (see "Why the OIDC-only repoint failed"). Phase 1 of that plan (namespace move) is not part of this work; the gateways stay where they are.

**Status: PLANNED. Phase 0 prep started 2026-10-06; nothing in the cluster has changed.**

## Why the OIDC-only repoint failed (measured 2026-10-06)

`agentless-mcpgw` (Helm rev 65) was pointed at a new "AI Gateway" OIDC app in `01d89b06`
(`f03578d3-c068-4448-a5fd-d27c5fc9df44`, secret in the vault as
`PRIVILEGE_GATEWAY_OIDC_CLIENT_SECRET`). Login worked and skipped the federation hop, but every call to
`opensearch22` was refused:

```
policy denied 1583af47-... access to opensearch22 (agent=false): user not found in system:
  User/0428ba4f-.../default/1583af47-...
```

The gateway resolves the token's `sub` against the tenant it ENROLLED in (`0428ba4f`), by user ID. A
`01d89b06` user ID does not exist there. The federation only worked because it created a linked shadow user
in `0428ba4f` that the policies name. Rolled back to rev 64 and restarted; the federation hop returned.

The new OIDC app and vault entry are kept: this plan uses them.

## Current state (verified 2026-10-06)

| Release | Namespace | Rev | OIDC tenant |
|---|---|---|---|
| `agentless-mcpgw` (gateway 1) | `ping-devops-curtismuir` | 64 (after rollback) | `0428ba4f` |
| `agentless-mcpgw3` | `ping-devops-curtismuir` | 9 | `0428ba4f` |
| `agentless-mcpgw2` | `ping-devops-cmuir` | 19 | `0428ba4f` |

All three share one OIDC client, one Redis registry and one mesh cluster (`ai-demo-cmuir`), so they must move
together. Saved pre-change values for all three are in the session scratchpad (`mcpgw-rollback/`, mode 600).

## Global constraints

- Public hostnames do not change (`mcpgw.ai-demo.ping-devops.com` and the others in the old plan).
- NEVER rotate `a6219652-47af-4ed2-8dea-20e9940b3377` (Privilege service client).
- NEVER print a secret. Pass secrets with `--set-file` from an owner-only file; check key names and lengths only.
- `helm upgrade` does not restart the pod when only a Secret changes, and the Secret is a single-file mount.
  Always `kubectl rollout restart`, then read the config inside the container.
- Subcommand before the global flag (`helm upgrade --kube-context us ...`), or the permission rule misses.
- Nothing in `0428ba4f` is deleted until a week after cutover.

## Phase 0: gate and prep

Owner: console steps are the operator's; read-only work and backups are the agent's.

- [ ] **0.1 Console gate (operator).** In the `01d89b06` Privilege console confirm: Agentic Apps exists; a Mesh
  Cluster can be created (proposed ID `ai-demo-main`); **Gateways, Add New, AI GW (Docker command)** works. A
  cluster `ai-demo-mine` existed there on 2026-08-12 and may be reusable. Any "no" stops the plan; the
  federation keeps working.
- [ ] **0.2 Inventory (agent, read-only).** With the operator's console `auth_token` cookie in a file, run
  `scripts/privilege-console-probe.mjs` against `0428ba4f` to list every Agentic App (name, backend, mesh
  cluster) and every policy (principal, time-box). This is the re-creation checklist for Phase 1.
- [ ] **0.3 Backups (agent).** Done: `.env`, `demo_api_server/.env`,
  `ping-mcpgw/procyon/config/proxy-token.env`, `pingone.env` copied to the scratchpad (`reenroll-backup/`,
  mode 600). Still to do: each node's enrollment files from its SSL volume (`agentless-mcpgw-ssl`, the same
  copy the 2026-10-04 re-enroll made into `backup-cmuir2`). Reading a pod's volume needs `kubectl exec`, which the
  classifier blocked once; the operator may need to run it.
- [ ] **0.4 Identify principals.** Which `01d89b06` users need policy: at minimum the user in the denial above
  (`1583af47-...`). List the demo users and groups before Phase 1.

## Phase 1: build the new side (operator, console only; no effect on live gateways)

- [ ] 1.1 Create the Mesh Cluster and three gateway nodes; keep each node's proxy token in an owner-only file.
- [ ] 1.2 Re-create every Agentic App from 0.2 in `01d89b06`. Every backend must end in `/mcp` (an `/sse`
  backend pins the entry path and 404s POSTs).
- [ ] 1.3 Re-create the policies for the 0.4 principals, time-boxed. `opensearch22` keeps its 3-month box;
  `opensearch` stays deliberately policy-less (the known-deny twin).
- [ ] 1.4 Re-issue anything bound to the enrolled tenant: A2A agent keys and the LLM virtual keys
  (`PRIVILEGE_LLM_VIRTUAL_KEY_*`).
- [ ] 1.5 The OIDC app `f03578d3-...` already exists with the old client's grants plus `REFRESH_TOKEN`.
  Confirm its redirect URI is unchanged (`https://mcpgw.ai-demo.ping-devops.com/callback`).

## Phase 2: cutover (agent), one short window

Order: gateway 3, gateway 2, gateway 1. For each node:

- [ ] 2.1 Copy the node's enrollment files out of the SSL volume (kept for rollback).
- [ ] 2.2 `helm upgrade` the release with its saved values, the `01d89b06` auth/token/user URLs,
  `--set oidc.clientId=f03578d3-...`, `--set-file oidc.clientSecret=<file from vault>`,
  `--set-file proxyToken=<this node's new token>`.
- [ ] 2.3 `kubectl rollout restart`, then read `/var/lib/procyon/config/pingone.env` inside the container:
  auth URL names `01d89b06`, scopes include `offline_access`, enrollment shows the new cluster.

The load balancer serves mixed nodes during the window. Parking the other nodes first removes that, but it is a
shared-resource change the classifier asks the operator to name explicitly.

## Phase 3: prove it

- [ ] Login probe: `/opensearch22/authorize` goes straight to the `01d89b06` sign-on page, no `providerId` hop.
- [ ] A real browser login as the demo user: one password prompt, `tools/list` returns 200 on `opensearch22`.
- [ ] No `user not found in system` lines in the gateway log.
- [ ] One sidecar app and one A2A agent-key call succeed; `opensearch` still returns 403.
- [ ] The token response carries a `refresh_token`.
- [ ] Switching nodes through the load balancer still lists tools (a fresh sign-in is the accepted cost).

## Phase 4: files on disk

Gitignored, edited locally (backups first; BFF restart and scoped SE deploy after):
- `.env`: `PRIVILEGE_PROXY_TOKEN`
- `demo_api_server/.env`: `PRIVILEGE_CONSOLE_ENV_ID`, `PRIVILEGE_LLM_VIRTUAL_KEY_*`; verify `PRIVILEGE_SSO_ENV_ID`
- `ping-mcpgw/procyon/config/proxy-token.env`, `pingone.env` (local optional mcpgw)
- k8s `ai-demo-secrets` via `create-secrets.sh`; vault entries

Tracked, one PR:
- `scripts/privilege-console-probe.mjs` (`DEFAULT_TENANT`)
- `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` (console link, ~line 54)
- `demo_api_ui/src/components/PrivilegeFirstGatewayPage.jsx` (label, ~line 84), `PrivilegeMcpLearningPage.jsx`
- `demo_api_server/routes/privilegeMcpClient.js` (comment ~line 2710; confirm the decode logic hardcodes no tenant)
- tests `privilegeMcpClient.consoleEnvId.test.js`, `gatewayEvents.test.js`
- docs: `privilege/CURRENT-CONFIGURATION.md`, `LESSONS-LEARNED.md`, `GATEWAY-LOAD-BALANCER.md`,
  `NEW-DEMO-ENVIRONMENT.md`, `docs/FAQ.md`, `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`,
  `.claude/skills/privilege-cloud-mcp/SKILL.md`, `REGRESSION_PLAN.md`
- `grep -rn 0428ba4f` finds only historical narrative afterwards

## Rollback

Per node: `helm upgrade` with the saved values from the scratchpad, restore its enrollment files into the SSL
volume, `rollout restart`, verify in the container. The `0428ba4f` apps, policies and the External IdP federation
are untouched until a week after cutover, so the old path works the moment a node is restored. Restore the `.env`
backups for the files in Phase 4.

## Success criteria

- All three nodes enrolled in a `01d89b06` cluster; the load balancer unchanged.
- Gateway login uses the `01d89b06` page with no tenant hop; `opensearch22` returns 200 for the demo user.
- No live configuration names `0428ba4f`.
