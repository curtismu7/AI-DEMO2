# Plan: Connect PingOne for Enterprise env `ea040334-d50b-4ded-8d98-4d5cd14dbd4d` ("p14e") to the SE K8s PingFederate

Status: plan only — nothing has been run against the environment.
Date: 2026-11-23
Tier: 1 (prototype / lab, owner-facing)
Source: https://docs.pingidentity.com/pingoneforenterprise/pingone_for_enterprise/p14e_connect_pf.md
(Connection to PingOne for Enterprise — PingFederate as the identity repository)

## Goal

Make the SE cluster PingFederate (`https://cmuir-pf.ping-devops.com`, namespace
`ping-devops-curtismuir`) the identity repository of the p14e environment, via the standard
PingOne for Enterprise connection: activation key generated in P14E, entered in PingFederate
under **System > External Systems > Connect to PingOne for Enterprise**, then attribute mapping
assigned in P14E.

## Phase 0 — Prerequisites

### Network (PingFederate server must reach)
- `admin-api.pingone.com` (administration)
- `ore-routingsvc.pingone.com` (P14E monitoring of PF)
- `ohi-routingsvc.pingone.com` (P14E monitoring of PF)
- `scim.connect.pingidentity.com` (provisioning)

Confirm from inside the cluster (`kubectl exec` a PF pod, curl each host) before starting — a
blocked egress is the most likely failure on a K8s install.

### Access
- P14E console: **Setup > Identity Repository** (Environment Admin in env
  `ea040334-d50b-4ded-8d98-4d5cd14dbd4d`).
- PingFederate: admin console + admin API. Known blocker risk: the SE PF-lane admin credential
  was rotated 2026-11-05 and not recorded (`docs/editions/pf-baseline.md`). If PF login fails,
  restoring PF admin access comes first.
- PingFederate license: full license (SE runs 13.1.x; Bridge licenses only exist for ≤10.3).
  Instructions are the same as Bridge except where noted.

## Phase 1 — P14E side: generate the activation key

1. P14E console: **Setup > Identity Repository > Connect to an Identity Repository** → select
   **PingFederate** → **Next**.
2. Select **existing PingFederate installation** → **Next**.
3. Copy the single-use **Activation Key**. Keep it in memory / a scratchpad — single-use, do not
   commit it anywhere.
4. Leave the P14E wizard open at the "Install and Configure PingFederate" panel.

## Phase 2 — PingFederate side: enter the key

1. Log in to the SE PF admin console.
2. **System > External Systems > Connect to PingOne for Enterprise** (the already-configured
   install path — not the first-page setup).
3. Paste the activation key, follow the wizard, save.
4. Verify "Enable Monitoring of PingFederate from PingOne" is enabled (default) in
   **System > External Systems > PingOne for Enterprise Settings** — without it the PF node never
   appears in P14E.

## Phase 3 — Back in P14E: verify + map attributes

1. When P14E reports the connection verified, click **Next**. (Verification fails until the PF
   connection config is saved — order matters: save in PF first.)
2. Assign the PingFederate → PingOne for Enterprise attribute mapping. This mapping feeds only
   the default P14E attributes (dock); per-application mappings are configured separately later.
   Choose an advanced mapping only if needed.
3. The new PF node appears. Optionally rename it / adjust its admin-page link.
4. **Settings** on the node shows the config summary; download the **Active Signing
   Certificate** and **Encryption Certificate**, and copy the **PingOne Metadata URL** — these
   are the artifacts other sides will want.
5. Optional: clustered PF — add other nodes for monitoring.

## Phase 4 — Verification

1. P14E shows the PF node as connected; PF **System > External Systems** shows the P14E
   connection active (not errored).
2. Provisioning path: confirm SCIM traffic to `scim.connect.pingidentity.com` in PF logs; a test
   user visible/usable in P14E if provisioning is expected.
3. Monitoring: PF node telemetry visible from P14E (ore/ohi routingsvc).
4. Record what was configured, when, and by whom (this file, updated with results).

## Traps

- **Order:** activation key is generated in P14E and consumed in PF; P14E verification only
  succeeds after PF saves. Do the wizard halves in that order.
- Activation key is single-use — a failed attempt needs a fresh key.
- Egress from the K8s PF pod to the four PingOne domains must be open before starting.
- The old plan in git history (PING_FEDERATE gateway API / `create-pingone-connection.js`) is a
  **different product flow** (PingOne MFA adapter connection) — do not mix them up.
- Never commit the activation key, certificates' private material, or PF admin credentials.
- Work in a git worktree; stage only intended files (`git add <paths>`, never `-A`).
- GitHub ops under `curtismu7` only.
- PF admin credential rotation is a live blocker risk (see Phase 0).

## References

- Docs: p14e_connect_pf.md (link at top)
- `docs/editions/pf-baseline.md` (PF admin credential rotation, 2026-11-05)
- `k8s/pingfederate/` (the SE PF install: `k8s/pingfederate/pingfederate.yaml`, README)
- `docs/runbooks/idjag-pfpf-se.md` (SE PF admin port-forward pattern)
- PF admin API ref: `docs/reference/pf-13.1.2-openapi.json` (identity repository / P14E endpoints,
  including the "updating the identity repository overwrites the existing P14E repository" caution)
