# PingOne Privilege — MCP Gateway

Everything written about the Privilege MCP Gateway integration: the investigation
record, console runbooks, demo scripts, design specs, diagrams, and Postman probes.

**Docs only.** The running code lives elsewhere — see [Where the code lives](#where-the-code-lives).

This page is the one-screen orientation. The **full index of every Privilege artifact**,
including Ping's SE enablement storyboards and the code paths, is
[`PRIVILEGE-MCP.md` § Map](PRIVILEGE-MCP.md#map--every-privilege-artifact-and-what-to-read-when).

## Start here

| Read | When |
|---|---|
| [`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md) | The canonical record. Architecture, protocol per hop, every blocker and how it was ruled out, dated newest-last. Long, but the trap list at the end of each section is what saves the time |
| [`PRIVILEGE-MCP-CONSOLE-STEPS.md`](PRIVILEGE-MCP-CONSOLE-STEPS.md) | Doing console work. These steps cannot be automated or tested from this repo |
| [`runbooks/ping-mcpgw.md`](runbooks/ping-mcpgw.md) | Standing the gateway up locally |
| `.claude/skills/privilege-cloud-mcp/` | The condensed operator version. If it disagrees with `PRIVILEGE-MCP.md`, **the doc wins** |
| `~/Downloads/priv_for_ai_image_first_se_storyboard_v2_corrected.html` | Ping's SE storyboard — architecture, flows, troubleshooting order. Not committed (~13 MB of embedded images) |

## Layout

```
privilege/
├── PRIVILEGE-MCP.md                  canonical investigation record
├── PRIVILEGE-MCP-CONSOLE-STEPS.md    console-side steps (not automatable)
├── PRIVILEGE-MCP-STATUS-2026-08-02.md  point-in-time snapshot, superseded
├── SE1-Privilege-Shared-Demo.md      SE shared-environment guide
├── MCP Privilege Gateway Technical Summary v3.pdf
├── demo/         customer-facing demo script + setup
├── design/       plan + specs (2026-07-29 gateway, 2026-08-10 tools table)
├── diagrams/     mermaid source + rendered SVG/PNG flows
├── postman/      collections: Gateway, Gateway-SE (tokenless), Simple relay, Debug probes
└── runbooks/     ping-mcpgw, renew-token, mcpgw-nginx
```

## Status

The **console-token chain works end to end** — auth, Host routing, per-app policy,
session recording, `tools/call` against the backend MCP server. That is the whole
Privilege value proposition demonstrated.

What does not work is a **PingOne-issued** client token. The gateway compares the
token's `kid` against an infra-root key fetched from Privilege's internal Notary PKI
(`ValidateInfraJwt`), so no PingOne token — worker, user, `id_token`, or self-signed —
can ever match. `IssuerPublicKey` lives on `OidcServer`, which `cyctl` exposes as
`get`/`list` only — there is no per-app write and no customer path to it. Full reasoning
and the complete ruled-out list: `PRIVILEGE-MCP.md` §2026-08-09 onward.

⚠️ Two recurring false alarms. A tokenless `401 Bearer Token not found.` proves
nothing about routing — the bearer check runs first. And console policies can be
created time-boxed (1–2h); an expired one returns `403` identically to one that never
existed.

**Ruled out — do not re-chase** (§2026-08-11):

| Lead | Why it is dead |
|---|---|
| `scripts/set-privilege-frontend-oauth.sh` | `ResourceOAuth` is the *outbound* challenge + DCR config, not inbound issuer trust. Populated live 2026-08-10; changed nothing |
| PingOne Privilege **Agent** | A TPM/Secure-Enclave desktop app minting device-bound mTLS for SSH/RDP/k8s. Adopting it means authenticating MCP clients as Privilege devices, not PingOne OAuth clients |
| `AppUserToken` | Guest-agent metadata envelope (`--guest-meta-*` flags only). Mints nothing |
| `AIAgentAccount` | Shadow-AI inventory connector (Bedrock/Salesforce/Azure/Vertex/Copilot). Mints nothing |

The MCP gateway feature GA'd **2026-07-13 with zero configuration documentation** in the
Privilege TOC. Every config fact here was recovered from the binary, the `cyctl` flag
surface, the console API and gateway logs. A config that looks wrong here is more likely
undocumented than misconfigured.

### Open lead — untested

`PRIVILEGE-MCP.md` concludes the OAuth challenge flow "is not compiled into any build
we can pull," based on `privilege-proxy` / `cyonproxy`. A **second ECR repo** ships a
purpose-built MCP gateway binary that was never tested:

```
public.ecr.aws/s7q1z8z4/privilege-mcpgw   ->  /procyon/bin/mcpgw
```

Its flag set is a strict superset of `cyonproxy` (adds `-mcpconfpath`, `-mcpgw`), and
it contains the challenge-emission strings `cyonproxy` has **zero** of:
`Bearer realm=`, `MCP OAuth Server`, `authorization_uri`, `resource_metadata`,
`/.well-known/oauth-protected-resource`.

Not yet run live. `ValidateInfraJwt` is still present in it, so this is a lead, not a
fix. The gate is unchanged: a tokenless `POST` returning `WWW-Authenticate` means the
wall is down. Second untested lever: `cyctl object idprovider create` — the only
customer-authorable object that plausibly populates `IssuerPublicKey`.

## Where the code lives

Deliberately **not** moved here — these are bind-mounted, deployed, or imported:

| Path | What |
|---|---|
| `ping-mcpgw/procyon/` | Gateway config tree, bind-mounted to `/var/lib/procyon` |
| `demo_mcpgw_nginx/nginx.conf` | Front door; rewrites `Host` to the registered Frontend Name |
| `demo_api_server/routes/privilegeMcp{Client,Simple}.js` | BFF relay — the actual MCP client |
| `demo_api_ui/src/pages/PrivilegeMcp*.jsx`, `src/components/privilege/` | UI |
| `scripts/privilege-smoke.sh` | Five-assertion end-to-end check (manual — needs a console token) |
| `scripts/set-privilege-frontend-oauth.sh` | Writes `ResourceOAuth` via `cyctl` |
| `k8s/helm/mcpgw`, `k8s/aws/deploy.sh` | SE cluster deploy (Helm, verified 2026-08-13) — see [`deploy-whole-stack.prompt.md`](deploy-whole-stack.prompt.md) |
| `k8s/75-ping-mcpgw-deployment.yaml`, `k8s/aws/mcpgw-agentless-ingress.yaml` | Untested `mcpgw`-binary path — not applied by `deploy.sh` |
| `docker-compose.yml` | `ping-mcpgw` + `mcpgw-nginx` services, profile `mcpgw` |
