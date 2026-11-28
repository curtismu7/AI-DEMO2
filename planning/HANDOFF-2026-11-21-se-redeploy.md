# Handoff — 2026-11-21: SE redeploy, vault drift, allowlist

Machine rebooting after this session. Read this before touching the SE cluster
or `demo_api_server/.env`.

## What was done today

### 1. SE cluster redeployed (partial — see §3)

The SE cluster (`ping-devops-cmuir`, `https://ai-demo.ping-devops.com`) was
running images from 198 commits back (`sha-5b49c6390`, PR #3508), predating the
CIBA diagram page (b73c4b60d, #3664) and the walkthrough-controls fix
(26330179d, #3669).

**Rolled to `sha-0113172980b55df2ec3106c10f289a2b71151406`** (= main at
011317298) by direct `kubectl set image` on:

- `frontend` → `ghcr.io/curtismu7/ai-demo2-frontend:sha-011317298…`
- `demo-api-server` → `ai-demo2-demo-api-server:…`
- `mcp-server` → `ai-demo2-mcp-server:…`
- `mcp-gateway` → `ai-demo2-mcp-gateway:…`

All four rolled out clean. Verified: `/` and `/ciba-approval-sequence` → 200,
hosted-access policy endpoint 200.

`llama-tier1/3/5` and `embeddings` were scaled to 0 to release an RWO model PVC
blocking the seed job, then scaled back to 1 after the roll. They were still
`ContainerCreating` at handoff — check `kubectl get pods -n ping-devops-cmuir`
first thing.

### 2. Vault drift resolved (10 values)

`create-secrets.sh` refused to deploy: 10 vault-managed keys had drifted from
the local service `.env` files. All 8 service `.env` files were **aligned to
the vault** (vault treated as canonical, per the guard's own guidance).

Guardrails left behind:

- Pre-fix values appended to
  `~/.config/demo-kit/env-backups/ai-demo2-env-admin-secret-2026-11-21.bak`
  — **only 1 line made it in before the script was rerouted**; treat it as
  incomplete, not a real backup.
- The rewrite script re-quoted the multi-line `ENTERPRISE_IDP_SIGNING_KEY_PEM`
  in `demo_api_server/.env` (`bash -n` passes on all 8 files now).

### 3. ⚠️ Unverified: PINGONE_ADMIN credentials are dead

During deploy debugging, **every** PINGONE_ADMIN_CLIENT_SECRET candidate
returned 401 on the PingOne token endpoint (worker pair still returns 200, so
the test method is sound):

- `.env` value (client `e1e33bbe-…`) → 401
- vault value (same client id) → 401
- SE-secret pair (client `8a711944-…`) → 401

This did **not** block the runtime: the demo's sign-in path uses the
front-door OAuth client, not the admin worker. But **provisioning/reset
scripts that use `PINGONE_ADMIN_*` will fail until someone rotates that
secret in the PingOne admin console and puts the new value in the vault**
(`cd demo_api_server && VAULT_PASSWORD=… node scripts/vault.js set
PINGONE_ADMIN_CLIENT_SECRET <new>`), then re-aligns the `.env` copies.

### 4. Allowlist (live + persisted)

`HOSTED_ACCESS_ALLOWED_IDENTIFIERS` on SE now includes
`cjmuir@pingidentity.com` and `chrisarmstrong@pingidentity.com`
(`tarunmadiraju@…` was already there). Applied live via configmap patch AND
persisted into `k8s/aws/deploy.sh` defaults (PR #3670, merged `011317298`).

Wall config on SE: gate enabled, domains `pingidentity.com,pingone.com`,
`HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL=false`.

## Next steps for whoever picks this up

1. **Confirm the LLM tiers came up** (`kubectl get pods -n ping-devops-cmuir |
   grep -E 'llama|embeddings'`). If CrashLoopBackOff: `kubectl logs
   deploy/llama-tier1 -n ping-devops-cmuir` — the seed job timed out earlier
   (`seed-llm-models` job shows `Failed 0/1`); models were believed already on
   the PVC from prior deploys, but verify.
2. **Optional clean full redeploy**: the `run-pingaws.sh deploy` run was
   aborted mid-way (user reboot). The four critical deployments were hand-rolled
   to the right images; a fresh `SE_NAMESPACE=ping-devops-cmuir
   COMPOSE_PROFILES=demo-auth,agents ./run-pingaws.sh deploy` should now pass
   the secrets guard and finish the remaining bits (remaining agents, configmap
   patches — those already applied). If the seed job Multi-Attach-errors again,
   scale the llama tiers to 0 first, then re-run.
3. **Rotate `PINGONE_ADMIN_CLIENT_SECRET`** (see §3) before any provisioning
   work.
4. **Undeploy when demo sessions end** — SE is shared:
   `./run-pingaws.sh undeploy` (Privilege gateways `agentless-mcpgw*` are
   exempt and stay).

## Also today (unrelated to SE)

### Meridian Air lab (`docs/privilege-one-airlines/`) — real-mode wiring requirement

The "Airline That Runs on Agents" one-demo plan (`docs/privilege-one-airlines/PLAN.md`,
mock prototype served from that dir at `http://localhost:8799/mock.html`) builds out as a
new standalone `meridian-air-LAB` under `curtismu7`, per `~/Development/STANDALONE-RULES.md`.
**The build MUST wire the rule-19 Mock/Real toggle, not mock-only** (PLAN.md build step 4
says "mock/real mode per rule 19"):

- `POST /api/mode` with `{source: "mock"|"real"}`, `GET /api/info` returning `source` +
  `realAvailable`; visible pressed-state toggle in the header; Real = actual servers + real
  login from the lab's own untracked `.env` beside its compose file (never live creds in
  agents' hands); Real-not-configured → disabled button + 409.
- Rule 26 corollary: never strip or bypass the toggle on rebuilds; after any rebuild, verify
  mode didn't regress real→mock via `/api/info`, and copy the canonical
  `standalone/<lab>/.env` before building in a fresh checkout.
- Tests: both switch directions, 409, data reload on switch.

### Other merges

- AI-DEMO2 PR #3669 merged: diagram walkthrough §8f (Prev/Next from fresh start
  paused at step 1) — shared `DiagramControls` + `useDiagramStepper`, 5 bespoke
  simulators converted. Full unit suite green, live-verified on :4000 and on SE.
- Fleet `shared/json/JsonPane.css` pressed-toggle red→neutral/blue committed
  (AI-DEMO-Standalone `b806531`).
- **§8f fleet sweep NOT started** — only diagram-studio-LAB (done previously)
  and AI-DEMO2 are compliant. `diagram-studio-backport` still has stale
  JsonPane; ~84 labs have vendored JsonPane with the old red pressed-toggle if
  that matters fleet-wide.
