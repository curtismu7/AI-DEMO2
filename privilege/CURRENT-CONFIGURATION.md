# PingOne Privilege MCP: current configuration index

Verified 2026-09-02. **There is now exactly one gateway.** The Agentless/Agent
split below the fold is history: the per-owner gateways were torn down on
2026-09-01 and replaced by a single AI Gateway (the product's own new name for
what this repo called "agentless").

## The current deployment

| | |
|---|---|
| Operational guide | `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` (source of truth) |
| Namespace | `ping-devops-curtismuir` |
| Helm release | `agentless-mcpgw` (chart `pingone-privgateway-helm-main/agentless`) |
| Mesh cluster | `ai-demo-cmuir` |
| PingOne tenant | `0428ba4f-169c-436b-aff9-b230496e0e3b` ("AI Agent") |
| Agentic App | `opensearch22` |
| MCP client URL | `https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp` |
| Backend registered as | `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse` |
| Authentication | Gateway-managed OAuth: RFC 7591 dynamic registration + PKCE, no client id configured on the client |

## Rules that still bite

- **Register the backend with `/sse`, never `/mcp`.** The gateway's discovery
  client speaks the SSE transport — it issues a `GET` and waits for the SSE
  `endpoint` event, and never POSTs `initialize`. `/mcp` answers 200 and the
  handshake then dies, which the console reports as
  `Error discovering MCP server: calling "initialize": Unauthorized`. This
  corrects the previous version of this file, which said to use `/mcp`.
- **`svc.cluster.local` is the backend, not a client URL.** It resolves only
  inside the cluster; a client pointed there hangs. Clients use the client URL
  above.
- **The chart adds no release prefix.** Objects are `opensearch-mcp-server`,
  `opensearch`, `agentless-mcpgw`. Any `cm-mcpgw-*` or `ping-mcpgw-*` name is
  from a deleted release.
- **The gateway's DCR registry is in memory** — restarting it invalidates every
  registered client. The BFF re-registers automatically; standalone MCP clients
  must be removed and re-added.
- **Policies are per Agentic App and time-boxed.** A new app starts with none.
  Read `deployment/agentless-mcpgw -c log-tailer` for the real denial reason;
  the empty `Email=` in `User identity resolved` is cosmetic and never the cause.

## All apps registered on this gateway today (verified 2026-09-07)

| App | Type | Backend | Status |
| --- | --- | --- | --- |
| `opensearch22` | MCP Server (subdomain) | `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse` | Working — 9 tools |
| `opensearch` | MCP Server (subdomain) | same, older duplicate registration | Working — 9 tools |
| `pingone-mcp-server-2` | MCP Server (subdomain) | unrelated, pre-existing app kept for its own purpose | Not part of this demo — see the note below, this is NOT the demo's PingOne MCP |
| `mcp-brave-search` | Catalog sidecar | Privilege's own `mcp/brave-search:1.0.0` image, reaching our `mcp-brave` sidecar via the mesh | Working after the 2026-09-07 gateway restart (was stuck in a "Tenant not found" registration retry loop) |
| `mcp-grafana` | Catalog sidecar | Privilege's own `mcp/grafana:1.0.0` image → our `mcp-grafana` sidecar via the mesh | Working after the same restart |
| `openapi2` | OpenAPI MCP | Privilege's own `mcp/openapi:latest` image → our `mcp-banking-rest` sidecar via the mesh → AI-DEMO2's `mcp-resource-server` in `ping-devops-cmuir` | **Tools not discovering as of 2026-09-08** — see "The banking door: `banking-rest2` → `openapi2`" below |

**`pingone-mcp-server-2` is not the demo's PingOne MCP — do not go looking for a
backend behind it.** The name invites the assumption and the table above has been
read that way at least once, costing a session's work: someone concluded the demo
had no working PingOne MCP, went looking for one in `ping-devops-cmuir` and
`ping-devops-curtismuir` (neither has one), and started building a replacement
that already existed.

The demo's PingOne MCP is the **`mcp-pingone`** sidecar
(`ghcr.io/curtismu7/ai-demo-mcp-pingone`), which wraps PingOne's own MCP server
behind a stdio-to-HTTP bridge. It arrives with PR #2913 and is absent from the
table above only because that PR is unmerged — add its row when it lands.

One measured constraint from that work, worth knowing before anyone designs
around it: the gateway does **not** relay MCP elicitation, so PingOne's
interactive device-code prompt never reaches a human and a caller arriving
through the gateway hangs on "Waiting for authorization..." forever
(measured 2026-09-07).

### Two registration mechanisms, and why "localhost" shows up in the console

**Plain "MCP Server" apps** (`opensearch22`, `opensearch`) get their own
subdomain and a directly-editable backend URL — the `/sse`-not-`/mcp` rule
below applies to these.

**Catalog and OpenAPI-MCP apps** (`mcp-brave-search`, `mcp-grafana`,
`openapi2`) work completely differently, and the console's "localhost"
fields are not a mistake: Privilege runs its **own** adapter image
(`public.ecr.aws/n2z2g8w6/mcp/...`) somewhere in its own infrastructure, and
that adapter's `localhost:<port>` is tunneled through the mesh back to *this
gateway's own registered node* — i.e. to a sidecar running in the
`agentless-mcpgw` pod itself (`extraContainers` in the Helm chart, see the
skill). That is the entire reason these three run as sidecars in this pod at
all: "apps added from the Privilege catalog pin their backend to
`http://localhost:8080/mcp` and that field is not editable" (see
`demo_mcp_grafana/server.js`'s own header comment). Confirmed live 2026-09-07
by reading each app's actual saved config off the gateway pod's disk
(`/procyon/ssl/app-containers/*.json` inside the `agentless-mcpgw` container —
this is the ground truth, not the console's field styling, which is
indistinguishable between a real value and a placeholder at a glance).

**The port has to match the actual sidecar, and nothing checks that for you.**
`banking-rest2` shipped with `OPENAPIMCP_ENDPOINT=http://localhost:8081` (our
`mcp-grafana` sidecar's port) while its own `OPENAPIMCP_SPEC_URL` correctly
used `:8082` (`mcp-banking-rest`'s port) — a copy-paste-from-the-grafana-app
bug. Fixed by editing the app in the console to `http://localhost:8082`.

**Do not confuse the two "resource server" deployments.** AI-DEMO2's own
`demo_mcp_resource_server` runs as the `mcp-resource-server` service in
**`ping-devops-cmuir`** (part of the full app stack) and is the one with the
banking-rest OpenAPI feature (PR #2861). A separate, unrelated handoff project
(`curtismu7/mcp-resource-server`, a different GitHub repo entirely, config-driven
verticals, only 3 PRs) runs as `mcp-config-standalone-mcp-resource-server` in
**`ping-devops-curtismuir`** — same-looking name, same port (8081), zero
banking-rest code. `mcp-banking-rest`'s `BANKING_UPSTREAM_URL` must point at
the `ping-devops-cmuir` one:
`http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081`. Pointing
it at the local `curtismuir` one (an easy mistake — it's same-namespace as the
gateway, which looks like the "tidier" choice) 404s on every real route.

### The banking door: `banking-rest2` → `openapi2`

`banking-rest2` was **deleted** on 2026-09-08 and re-created from scratch as
`openapi2` (same Mesh Cluster, same sidecar, same spec). Anything still naming
`banking-rest2` is stale — its client URL now 404s. `mcpProfileStore.js`'s
`built-in-privilege-mcp` profile was repointed at `/openapi2/mcp`; the profile
**id** deliberately did not change, because `routes/mcpPrivilegeAuth.js`'s
post-login redirect deep-links to it.

Two settings on this app type that cost hours, both verified live:

- **`OPENAPIMCP_ENDPOINT` takes no `/mcp` suffix.** The adapter appends the
  spec's own paths to it, so `http://localhost:8082` + `/banking` is the real
  call. With `/mcp` on the end you get `…/mcp/banking`, which 404s. (The `/mcp`
  convention belongs to the catalog apps — Brave, Grafana — which really do
  speak MCP JSON-RPC at that path.)
- **The console's "Backend Name" field is not this setting** and does not sync
  with it. Only the `Configuration` block (`OPENAPIMCP_*`) drives behaviour;
  "Backend Name" sat at a stale `http://localhost:8080/mcp` the whole time the
  live config was correct. Read the app-container JSON on the pod, not the form.

**Still unresolved as of 2026-09-08: `openapi2` discovers no tools.** The
gateway itself is healthy (`LinkStatus:Active`, certs valid, enrollment PVC
intact) and the config on the pod is correct. Two open leads, neither confirmed:
the Privilege console's own API returns `401` on
`/api/<tenant>/v1/github-account` (the call `OverviewTab.jsx` makes to render
the Tools panel) reproducibly in a clean incognito session with `isadmin:true`;
and the local Mac agent's device cert is rejected by Ping's regional proxy
(`remote error: tls: unknown certificate`), though that agent's control-plane
connection reports READY, so it may be unrelated. Do **not** chase
`has same NodeURL` — the skill documents it as cosmetic, and a session was lost
to it.

**The packaged chart `.tgz` goes stale silently.** See
`.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`'s "packaged `.tgz` goes
stale silently" section — a 16-day-stale `.tgz` dropped all three sidecars and
the GHCR pull secret from a live `helm upgrade` on 2026-09-07, while
`helm get values` kept reporting them as present. Always upgrade against the
chart source directory, or repackage after every template/values edit.

## Doors that are deliberately dark

`mcpFacade.js`'s `agentless` (banking) door still points at torn-down
infrastructure. `openapi2` (above) is its replacement and is correctly
configured as of 2026-09-08, but the BFF's own facade config
(`MCP_FACADE_AGENTLESS_URL`/`_AS`, `PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING`) has
not been repointed at it yet, and no policy has been authored on the app —
which cannot be done until it discovers tools. See the 2026-09-01 entry in
[`../TECH_DEBT.md`](../TECH_DEBT.md) for the remaining steps.

The `agent` and `agent-cmuir` (agent-mode) doors were **removed** 2026-09-05.
They hung rather than failing fast: their `*.applications.procyon.ai:8643`
frontends still resolve through the Priv Agent's DNS proxy while nothing serves
the mesh port. Restoring agent mode needs inbound mesh exposure this chart does
not ship; the live client path is the `privilege-gateway` door.

Historical investigation and product reference material remains indexed in
[`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md); `AGENTLESS-CONFIGURATION.md` and
`AGENT-CONFIGURATION.md` describe the retired two-gateway split and are kept for
history only. Dated files do not override this index or the skill.
