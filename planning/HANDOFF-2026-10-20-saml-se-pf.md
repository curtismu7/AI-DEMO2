# Handoff 2026-10-20: SAML ID-JAG, SE PingFederate, diagrams

Written at the end of a long session. Facts are marked **verified** (seen in output or code), **assumed**, or **unknown**. Nothing here contains secret values.

## 1. Where things live

| | |
|---|---|
| Mirror (cloud agents work here) | `curtismu7/AI-DEMO2`. Merge commits only, never force-push. |
| Source repo | `cmuir_pingcorp/AI-DEMO2`. Gets the mirror via `~/saml-live-setup.sh --only=sync` (merge `curtismu7/main`, push `origin main`). |
| `gh` on the Mac | Signed in as the Enterprise Managed User. It **cannot** act on the mirror ("Enterprise Managed User" error). Merge mirror PRs on the web or ask the cloud agent. |
| Cloud agent limits | No `kubectl`, no network to `*.ping-devops.com`, no Mac files. Every cluster or `.env` step is a command the owner runs. |
| SE app | `https://ai-demo.ping-devops.com`, namespace `ping-devops-cmuir`. |
| Issuing PingFederate (SE) | namespace `ping-devops-curtismuir`, public `https://cmuir-pf.ping-devops.com`. Holds the SP connections and the SAML objects. |
| Second PingFederate (Acme) | namespace `ping-devops-cmuir`, host `cmuir-pf-acme.ping-devops.com`. Not used by any config yet. |
| Local app | `https://local.ping-devops.com:4000` (passkey sign-in only works on this host). |

## 2. Merged this session (mirror `main`)

- Diagrams in the Ping style: delegation pages, named pages, UC configs (`UC8, UC20, UC23, UC29, UC30, UC31, UC32, UC39, UC-LEARN11, UC-LEARN15`, pilot `UC-NHI2`), Overview (#3371), System Flow (#3370, plus the height fix #3372), PF login figure split in two (#3373). Checklist of URLs: `CONVERTED-DIAGRAMS-URLS.md` (owner has it; it is not in the repo).
- SAML: server assertion + `/issue` (#3354), UI toggle (#3353), PingFederate provisioning script (#3352), processor DN fix (#3377).
- Scripts: `scripts/saml-live-setup.sh` (#3365, #3369, #3376), `scripts/worktree-cleanup.sh` (#3367), `scripts/se-pf-overrides.sh` (#3374).
- SE config: opt-in PingFederate override in `k8s/create-secrets.sh` and `SE_OAUTH_PROVIDER` in `k8s/aws/deploy.sh` (#3375). Gateway audience list aligned with docker-compose (#3379).
- **Open: #3378** (playground step 4 "List tools" button uses the primary red style). One class; merge it.

## 3. State of SE (last known)

| Item | State |
|---|---|
| PingFederate objects `aidemosamlca`, `aiDemoSaml`, `aiDemoSamlPolicy`, `ai-demo-pf-saml`, and the mapping on `aiDemoPfIdJagSp` and `aiDemoPfIdJagLocalPfSp` | **verified** applied; second run showed only `keep`. |
| The three SAML keys in `ai-demo-secrets` | **verified** present (after one full rebuild). |
| Images | demo-api-server `sha-2dbb8df18…` (contains the SAML server code, verified), frontend `sha-c0db2040…`. |
| Provider pin (`OAUTH_PROVIDER` in `ai-demo-config`) | Restored to `pingone` after a crash loop. **Unknown** whether it has been un-pinned again. |
| PF values in `ai-demo-secrets` | **Unknown / likely local-Docker values** again: each `update config` run rebuilds the secret from the Mac's `.env` and stops at the vault check before the SE override. Restore with `se-pf-overrides.sh --apply`. |
| Playground steps 1-3 (sign in, ID-JAG, redeem) | **verified** passed once, after the audience fix. |
| Step 4 (call MCP through the Node gateway) | Failed with `invalid_aud` (token `mcpserver.ping.demo`; gateway list lacked it). Gateway list fixed (#3379, ConfigMap already carries it, gateway restarted). **Retry result unknown.** |
| pf-pf mode | Does not work on SE (see section 5). |

## 4. Two environments, one `.env`

`demo_api_server/.env` on the Mac is the **local Docker** config. SE secrets are built from it by `create-secrets.sh`, then SE overrides apply on top.

| | Local Docker | SE |
|---|---|---|
| Login PingFederate (`PF_ISSUER`) | `https://local.ping-devops.com:9031` | `https://cmuir-pf.ping-devops.com` |
| pf-pf issuer / resource AS | SE PF issues, local PF redeems | not set up |
| Provider toggle | saved in the container's storage | saved in the pod's storage; **pinned to PingOne** by `deploy.sh` unless `SE_OAUTH_PROVIDER` is set |
| Config source | `.env` | `.env` + `SE_*` overrides |

SE overrides (add to `demo_api_server/.env`, ignored locally):
```
SE_PF_ISSUER=https://cmuir-pf.ping-devops.com
SE_OAUTH_MCP_URL=https://cmuir-mcp.ping-devops.com
```
`SE_OAUTH_PROVIDER` goes on the **command line**, not in `.env` (deploy.sh reads the shell): `SE_OAUTH_PROVIDER= ./run-pingaws.sh update config` un-pins; unset keeps the PingOne pin.

## 5. Gotchas that cost hours

1. **Never run the plain `./run-pingaws.sh`.** No argument = build and push images from the Mac, then deploy. Use `update config` for config.
2. **`update config` / `create-secrets.sh` overwrites `ai-demo-secrets`** with `.env` values and, until the vault check passes, stops before the SE override. That is how the PF values flipped back twice and caused a crash loop (provider un-pinned + wrong PF address = failing health check).
3. **Safe order for PF changes on SE:** restore values first (`se-pf-overrides.sh --apply`), prove discovery works from the pod, **then** un-pin. If the server crash-loops: patch `ai-demo-config` `OAUTH_PROVIDER` back to `pingone` and restart.
4. **The vault is not authoritative.** `PINGONE_AGENT_CLIENT_SECRET`: seven service `.env` files agree, the vault differs. A PingOne token request with the `.env` value authenticated (post method returned `invalid_scope`, i.e. past client auth), so the **vault entry is stale**. Fix = update the vault, not the `.env` files. The vault file is `<repo root>/secrets.vault` (not under `demo_api_server/`). Back it up first. Four other differences remain (`AGENT_CLIENT_ID`, langchain agent secrets, `ENTERPRISE_IDP_SIGNING_KEY_PEM`); the guard may flag one next.
5. **pf-pf is built for the local app.** It uses `PF_ISSUER` as the resource AS ("local PF") and `PF_IDJAG_ISSUER_PF_URL` as the issuer. With `PF_ISSUER` pointing at the SE PingFederate, SE asks itself for an ID-JAG whose audience is itself (`invalid_target`). On SE use oauth-mcp mode. Possible later: use the Acme PingFederate as the resource AS (needs login clients, an SP entity, and a `PF_ISSUER` decision).
6. **oauth-mcp's embedded AS only asserts its own audience** (`mcpserver.ping.demo`, `TokenIssuer.resolveOwnAudience`). Changing the ID-JAG resource does not change `aud`. The gateway must accept it (done, #3379).
7. **SE image tags:** Build images is diff-driven. HEAD often has no image for a service. `saml-live-setup.sh --only=deploy` now walks history per service (`SHA_WALK`, `IMAGE_SHA` pins). Needs `docker login ghcr.io`.
8. **zsh:** `#` comments and apostrophes in pasted blocks open a `quote>` prompt. Paste commands without comments. Use `${b}` in loops.
9. **Repo hooks:** writes in the shared main checkout are blocked; work in a worktree. Pre-commit blocks main-checkout commits (`--no-verify` only for parking edits).
10. **CI:** self-hosted runners; "Hygiene + topology gates" has been flaky/cancelled. `check-fresh-clone-hygiene` rejects hardcoded `/Users/...` paths.

## 6. Next steps, in order

1. **Vault:** back up `secrets.vault`, then `vault:set PINGONE_AGENT_CLIENT_SECRET` from the hitl `.env` value, check the fingerprint (`d89bba0854`). Details in the session log; command block is in section 8.
2. Check `.env` has the two `SE_*` lines, then `SE_OAUTH_PROVIDER= ./run-pingaws.sh update config`. Success line to look for: `SE PingFederate override (SE_PF_ISSUER set): PF_ISSUER …`.
3. Verify from the pod: PF discovery returns 200 and the issuer matches `PF_ISSUER`.
4. Un-pin if still pinned, then hard-reload, sign in as admin; the P1/PF toggle only shows for admins.
5. Playground, oauth-mcp mode: OIDC then SAML. Step 4 should now pass the gateway.
6. Merge #3378. Close nothing else; no other PR is open.
7. Run `scripts/saml-live-setup.sh --only=sync` regularly so the mirror's merges reach the source repo.

## 7. Open decisions and loose ends

- Cedar mapping (tool to group/user for allow, hold, deny) and the note to the Mac session (checklist 6.1, 6.2).
- Remaining ~57 use-case configs (6.3: wait for review of the 11 converted). Remaining diagrams: System Flow and Overview done; hand-built UC40 figure on `/pingfederate-id-jag/implementation` not converted.
- Cloudflare plan questions (checklist section 7). Slack reply and HAR skim (8.3, 8.4). Worktree cleanup with `scripts/worktree-cleanup.sh` (9.1). Ping `kid` answer (9.2).
- **gitleaks:** `leaks found: 40981`. Almost certainly mostly noise; the rule and file breakdown has not been looked at. Run the JSON report and count by rule and file before rotating anything.
- A script `…/scratchpad/fix.js` from another Claude session on the Mac changed a scope list (`read mcp:invoke` to `mcp:invoke accounts:read read`). Not from this session; target unknown. Worth finding out what it changed.
- `run.sh` local edit parked on branch `wip/run-sh-edit` (replaced ~1,850 lines with ~76; check before restoring).

## 8. Command blocks

```
# SE state check (read-only)
kubectl -n ping-devops-cmuir get pods | grep -E "demo-api-server|mcp-gateway|frontend"
kubectl -n ping-devops-cmuir get configmap ai-demo-config -o jsonpath='OAUTH_PROVIDER={.data.OAUTH_PROVIDER}{"\n"}'
for k in PF_ISSUER PF_USER_REDIRECT_URI PF_ID_JAG_AUDIENCE PF_ID_JAG_RESOURCE; do printf '%s=' $k; kubectl -n ping-devops-cmuir get secret ai-demo-secrets -o jsonpath="{.data.$k}" | base64 -d; echo; done

# Restore SE PF values (plan first, then --apply; add --unpin only after discovery passes)
git fetch curtismu7 main && git show curtismu7/main:scripts/se-pf-overrides.sh > ~/se-pf-overrides.sh && chmod +x ~/se-pf-overrides.sh
~/se-pf-overrides.sh
~/se-pf-overrides.sh --apply

# Vault fix (from the repo root; back up first)
VP=$(grep -E '^VAULT_PATH=' demo_api_server/.env | cut -d= -f2- | tr -d '"'); VP=${VP:-./secrets.vault}; cp "$VP" "$VP.bak-$(date +%s)"
cd demo_api_server && export VAULT_PASSWORD="$(grep -E '^VAULT_PASSWORD=' .env | cut -d= -f2- | tr -d '"')"
grep -E '^PINGONE_AGENT_CLIENT_SECRET=' ../demo_hitl_service/.env | head -1 | cut -d= -f2- | tr -d '"\n' | npm run -s vault:set -- PINGONE_AGENT_CLIENT_SECRET
```

## 9. Known unverified things

- The SAML token processor now sends its two optional DN tables empty, so any certificate chaining to a CA PingFederate trusts could sign for it; the exchange still needs the `ai-demo-pf-saml` client credentials. `--issuer-dn=<DN>` tightens it, but the DN format PingFederate expects is unconfirmed.
- Whether SE's saved provider choice survives a pod restart (pod storage not checked).
- Whether the PingFederate config survives a PingFederate pod re-creation (volume not checked).
- Whether the authz sidecar change in #3379 was needed (read from `decision.js`, not tested on SE).
- Two diagram PRs (#3370, #3371) had no real-browser check. After a drag, 8 of 219 System Flow cases and the BFF/PingGateway boxes on Overview can still leave a crossing; both are pinned in tests or `TECH_DEBT.md`.
- `gen-service-topology.js check` fails on `main` for two hand-added lines inside the generated ConfigMap block (`BFF_INTERNAL_TOOL_URL`, `MCP_GATEWAY_RESOURCE_URI`). Not fixed; running `generate` would delete them and SE needs them.
