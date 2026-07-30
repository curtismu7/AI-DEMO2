# PingOne Privilege MCPGW — design

Date: 2026-07-29
Status: approved design, not yet implemented
Scope: wire `ping-mcpgw/` into the stack as a running service, locally and on the Ping SE cluster

---

## 1. Problem

`ping-mcpgw/` has existed since PR #816 as documentation only — a README, a
`.gitignore`, and `config/pingone.env.example`. Nothing runnable. The README
instructs `docker compose --profile mcpgw up ping-mcpgw`, but no such service
exists in `docker-compose.yml`, and `MCPGW_IMAGE` appears nowhere in the repo.

The goal is a real PingOne Privilege MCPGW container in front of the existing
`mcp-server`, demonstrating two things the current gateways cannot:

1. **JIT least-privilege denial** driven by policy authored in the Privilege
   cloud console rather than in git.
2. **Full MCP session recording** visible in that same console.

Both halves in one flow: an agent asks for something, Privilege denies it
just-in-time, and the whole exchange is captured.

### What already exists

Substantially more than the empty `ping-mcpgw/` directory suggests:

| piece | location | state |
|---|---|---|
| MCP client UI | `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` (291 lines), route `/privilege-mcp-client` | built, wired |
| MCP client BFF | `demo_api_server/routes/privilegeMcpClient.js` (18KB), mounted `server.js:1136` | built, wired |
| Privilege SE hub | `/privilege-demo`, `demo_api_ui/src/config/privilegeDemoConfig.js` | built, real shared env IDs |
| SE setup guide | `docs/resources/SE1-Privilege-Shared-Demo.md` | written |
| MCPGW container | `ping-mcpgw/` | **missing — this spec** |

The client page takes an `mcpUrl` at runtime and already speaks JSON-RPC with an
SSE event log. The gap is purely the gateway it points at.

### Adjacent finding (in scope only because we must edit the file)

`k8s/aws/se-ingress.yaml` routes `/mcp` to a `demo-mcpgw` Service whose
Deployment (`k8s/74-demo-mcpgw-deployment.yaml`) is **never applied** by
`k8s/deploy.sh` — that file is not in deploy.sh's explicit apply list. The path
503s today. Decision: **delete the dead rule** in the same edit that adds the
MCPGW Ingress. `demo_mcpgw/` itself stays on disk, unwired, untouched.

### Not to be confused with

- `demo_mcpgw/` — PingGateway (IG), open source, one route, policy in git. A
  stripped teaching copy of `ping-gateway`. Different product entirely.
- `ping-gateway/` — the running IG at :3036 with 9 MCP routes. Stays unchanged.

---

## 2. Decisions

| question | decision |
|---|---|
| Privilege tenant + wizard image | available |
| demo story | denial **and** session recording, one flow |
| deploy targets | local Compose and SE cluster together |
| AWS exposure | `/mcpgw` path prefix on the existing `ai-demo.ping-devops.com`, via a second Ingress object with a scoped `rewrite-target` |
| local hostname | `local.ping-devops.com:8623` — same host as the app, different port |
| client surface | preconfigure the existing page; no new UI |
| dead `/mcp` ingress rule | remove |
| sequencing | scaffold everything, plug the image in last (approach A) |
| `service-topology.json` | skip registration until the image is proven |

### Consequence of approach A

Every mount path, env var name, and internal port in the vendor README is
unverified. Approach B (run the wizard's `docker run` by hand first, then encode
what actually worked) was recommended and not taken. The mitigation is
containment, not avoidance: all vendor-specific assumptions live in exactly two
places — the Compose service block and the k8s Deployment. If the real image
disagrees, those two blocks change and nothing else does.

---

## 3. Architecture

### Local

```
browser ──── https://local.ping-devops.com:4000 ──── ui (:4000)
   │
   │  page: /privilege-mcp-client
   ▼
demo-api-server (:3001)   routes/privilegeMcpClient.js
   │   server-side fetch; NODE_EXTRA_CA_CERTS trusts the mkcert CA
   ▼
https://local.ping-devops.com:8623/mcp      ← compose network alias resolves
ping-mcpgw (:8623)                             this name to the MCPGW container
   │   policy + session recording from the
   │   PingOne Privilege cloud control plane
   ▼
http://mcp-server:8080/mcp     (banking tools — unchanged, still shared with ping-gateway)
```

### The network alias, and why it is load-bearing

Two different callers must reach MCPGW by the same URL:

- the **browser**, for OAuth redirects
- the **BFF**, which relays JSON-RPC server-side
  (`privilegeMcpClient.js:94-96` does `fetch(session.config.mcpUrl)`)

`demo-api-server` trusts the mkcert CA (`NODE_EXTRA_CA_CERTS`,
`docker-compose.yml:351`), so its `fetch` verifies TLS normally — which means the
hostname must be a SAN on the serving cert.

The existing cert already covers the name we want:

```
certs/api.ping.demo+2.pem
  DNS:api.ping.demo, DNS:local.ping-devops.com, DNS:demo-api-server,
  DNS:localhost, IP:127.0.0.1
  notAfter = Oct 18 2028
```

So `ping-mcpgw` gets a compose network **alias** of `local.ping-devops.com`.
Inside the compose network that name resolves to the MCPGW container; from the
browser it resolves via `/etc/hosts` to 127.0.0.1 and the published port. One URL
string, correct for both callers, TLS verifies on both paths.

Two facts make this safe:

- Precedent: `demo-api-server` already uses this pattern with alias
  `api.ping.demo` (`docker-compose.yml:244`).
- `local.ping-devops.com` appears container-side exactly once, as a CORS origin
  string (`docker-compose.yml:627`). It is never fetched, and CORS matching is a
  string compare on the `Origin` header, unaffected by DNS.

Rejected alternatives:

- **Regenerate the cert to add a `ping-mcpgw` SAN.** Workable — the cert has only
  one consumer (`demo-api-server`, `docker-compose.yml:94-95`), so the blast
  radius is small. Rejected because it needs an mkcert re-run plus a restart on
  every machine that runs the demo, and it still leaves two different URLs for
  the two callers. The alias needs neither.
- **Disable TLS verification in the BFF.** Unacceptable.
- **`host.docker.internal:8623`.** Not a cert SAN either, so it fails the same
  way.

Port 8623 is free and collides with none of the 26 published ports in
`docker-compose.yml`.

### AWS

Everything stays on the existing host. No new DNS name.

```
https://ai-demo.ping-devops.com/mcpgw/…  ──nginx──▶ [strip /mcpgw] ──▶ ping-mcpgw :8623
https://ai-demo.ping-devops.com/         ──nginx──────────────────────▶ frontend  :4000
```

`pathType: Prefix` forwards the **full** path, so `/mcpgw/mcp` would reach the
container as `/mcpgw/mcp` and 404. The prefix must be stripped:

```yaml
nginx.ingress.kubernetes.io/rewrite-target: /$2
nginx.ingress.kubernetes.io/use-regex: "true"
# path: /mcpgw(/|$)(.*)   pathType: ImplementationSpecific
```

#### This requires a second Ingress object, not a second rule

`rewrite-target` is an **Ingress-level** annotation — it applies to every path in
the object that carries it. Adding it to the existing `ai-demo-ingress` would
also rewrite the `/` rule and break the frontend. So MCPGW gets its own Ingress
resource on the same host, with the annotations scoped to it. Kubernetes permits
multiple Ingress objects per host and nginx merges them.

`k8s/aws/deploy.sh:220` applies `se-ingress.yaml` through
`sed 's|<<NAMESPACE>>|$NS|g' | kubectl apply -f -`, which handles multi-document
YAML. The second Ingress therefore lives as another `---` document in that same
file and inherits the namespace substitution for free.

There is no `rewrite-target` anywhere in `k8s/` today, so this is the first — no
in-repo example to copy. The old `/mcp` rule needed none: it passed the full path
through and let IG strip it internally via `UriPathRewriteFilter`.

#### Consequences of local and AWS differing

- Local reaches MCPGW at a **port**, AWS at a **path**. Two `SERVER_URL` values,
  two `PRIVILEGE_MCPGW_URL` values (§5), and two redirect URIs on the one
  Agentic App.
- On AWS nginx terminates TLS, so the container's own cert is unused there;
  locally the container terminates its own TLS. Same image, two TLS postures —
  a likely source of "works locally, 502 on AWS". TLS config stays in one env
  block so flipping it is a one-line change.
- The path approach depends on the **bearer-only** assumption below. If MCPGW
  insists on its own browser login, its `/callback` must also survive the
  rewrite, and the open risk stops being local-only.

### Open risk: two OIDC surfaces

These are **not** the same flow:

| | who authenticates | callback |
|---|---|---|
| MCPGW's own login | MCPGW, from `pingone.env` | `${SERVER_URL}/callback` |
| existing client page | the BFF | `/api/privilege-mcp/auth/callback` (`privilegeMcpClient.js:237`) |

The client page mints its own PingOne token and presents it as a bearer. Whether
MCPGW accepts that bearer, or insists on its own browser login first, **cannot be
determined from the vendor README**. This is the single largest unknown deferred
by approach A.

If MCPGW rejects the bearer (tell: 401 at `/mcp` with a token that is otherwise
valid), the fallbacks in preference order are:

1. Complete MCPGW's own login in the browser first, then let the client page
   relay — works if MCPGW issues a session cookie the relay can carry.
2. Point the client page at MCPGW's own token endpoint instead of PingOne's.
3. Drive the demo from MCPGW's built-in UI and use the client page only for the
   contrast case against `ping-gateway`.

None of these are scoped here. Hitting this means a new round of design.

This risk now gates **AWS as well as local**. The `/mcpgw` path approach assumes
bearer-only auth, so MCPGW's own `/callback` never fires. If it does fire, that
callback has to survive the nginx rewrite and match a registered redirect URI —
a second problem stacked on the first.

---

## 4. File inventory

No UI file changes. The client page reads its config from the BFF's `/state`
response, so seeding the default server-side is sufficient. This keeps the work
out of REGRESSION_PLAN §0 UI rules and off the vitest/build gate.

### New (2)

| file | contents |
|---|---|
| `k8s/75-ping-mcpgw-deployment.yaml` | Deployment + ClusterIP Service on 8623, `envFrom` the OIDC secret. Ingress lives in `se-ingress.yaml`, not here, so it picks up the namespace substitution. Mirror `74-demo-mcpgw-deployment.yaml` for namespace/label conventions — it is the direct analogue |
| `docs/superpowers/specs/2026-07-29-ping-mcpgw-design.md` | this document |

### Modified (9)

| file | change |
|---|---|
| `docker-compose.yml` | `ping-mcpgw` service — profile `mcpgw`, network alias `local.ping-devops.com`, `8623:8623`, read-only `./certs` directory mount, `env_file: ping-mcpgw/config/pingone.env`, `image: ${MCPGW_IMAGE:?...}`. Plus `PRIVILEGE_MCPGW_URL` on `demo-api-server` |
| `run-docker.sh` | four spots — `OPTIONAL_GROUP_NAMES`, `FULL_STACK_PROFILE_ARGS`, `_optional_group_profiles` (own case and `all`), `_optional_group_services` |
| `k8s/aws/se-ingress.yaml` | delete the dead `/mcp` block from `ai-demo-ingress`; append a second `---` Ingress document (`ai-demo-mcpgw-ingress`) on the same host with `rewrite-target` + `use-regex` scoped to it |
| `k8s/deploy.sh` | one `kubectl apply` line for the new manifest |
| `k8s/create-secrets.sh` | create the OIDC secret from `ping-mcpgw/config/pingone.env` |
| `demo_api_server/routes/privilegeMcpClient.js` | line 19: `mcpUrl: ''` becomes `process.env.PRIVILEGE_MCPGW_URL \|\| ''` |
| `ping-mcpgw/README.md` | correct to reality — cert reuse, real hostnames, `run-docker.sh` usage |
| `ping-mcpgw/config/pingone.env.example` | concrete `SERVER_URL` |
| `CHANGELOG.md` | entry, including the removed dead ingress rule |

### Deliberately untouched

`mcp-server`, `ping-gateway`, `demo_mcpgw`, every UI file, `service-topology.json`.

---

## 5. Config and secrets

### Local flow

```
root .env                     MCPGW_IMAGE=<from the Privilege gateway wizard>
                                  │ compose auto-reads root .env
docker-compose.yml            image: ${MCPGW_IMAGE:-set-MCPGW_IMAGE-from-the-pingone-privilege-gateway-wizard}
                                  │
ping-mcpgw/config/pingone.env     SERVER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
                                  OIDC_AUTH_URL, OIDC_TOKEN_URL, OIDC_USER_URL, OIDC_SCOPES
                                  │ read-only DIRECTORY mount of ping-mcpgw/config
                                  │ ──▶ /var/lib/procyon/config  — NOT env_file:,
                                  │     NOT environment:
                              ping-mcpgw container

certs/api.ping.demo+2{,-key}.pem  ──read-only file mounts──▶  /var/lib/procyon/ssl/mcpgw-{cert,key}.pem
```

The default is a **sentinel that names its own fix**, not `${MCPGW_IMAGE:?...}`.
An earlier version of this design used the required-variable form to fail loudly,
and it failed too loudly: Compose interpolates the whole file before selecting
services, so it broke every compose command in the repo — including
`docker compose up -d demo-api-server` — even with `ping-mcpgw` profile-gated and
unselected. With the sentinel, only an actual `mcpgw` start fails, at pull time,
with the required action in the image name.

`scripts/check-fresh-clone-hygiene.js` (Check 6b) now rejects
`${VAR:?...}`/`${VAR?...}` anywhere in `docker-compose.yml`.

### Corrected: the OIDC file is mounted, not injected

An earlier draft of this spec routed the OIDC values through Compose `env_file:`.
The vendor's own `pingone.env.example` header says otherwise — *"This file is
mounted into the container at `/var/lib/procyon/config/pingone.env`"* — so MCPGW
**reads the file directly** and never sees the values as environment variables.
`ping-mcpgw/config` is therefore bind-mounted as a directory (per-file mounts are
mis-detected on host-file replace, the hazard this compose file already documents
for the IG service).

The repo's general rule below still holds everywhere else; it is simply
**not applicable to this service**, because this service uses neither mechanism.

### Repo rule (not applicable here): `env_file` only, never `environment`

A key listed under `environment:` as `FOO: "${FOO:-}"` **overrides and blanks**
the same key supplied via `env_file`. This repo has been bitten by it before. For
services that do use env injection, the keys go in `env_file` only — listing them
in both places yields a service that starts cleanly and then fails auth with empty
credentials, an expensive thing to debug from the symptom.

### Certs: mount, never copy

Read-only mounts of the existing `certs/api.ping.demo+2.pem` pair — no second
copy of a private key to keep in sync or rotate. These are **per-file** mounts
because the vendor expects the exact filenames `mcpgw-cert.pem` / `mcpgw-key.pem`
under `/var/lib/procyon/ssl/`; the replace-hazard that argues for directory mounts
elsewhere does not apply, since this pair is stable until Oct 2028. The cert
already covers `local.ping-devops.com`. `ping-mcpgw/ssl/` stays in the
`.gitignore` as a harmless leftover should anyone later want a dedicated cert.

### AWS

The same `pingone.env` on the operator's machine becomes a k8s Secret via
`create-secrets.sh` — one key (`pingone.env`) holding the whole file, built with
`--from-file`, **not** the `secret_from_envfile` helper (which would produce one
key per variable, i.e. env vars). The Deployment mounts that secret as a file at
`/var/lib/procyon/config`, mirroring the Compose bind mount. Credentials never
appear in `75-ping-mcpgw-deployment.yaml`, which is committed.

Values that differ by environment:

| | local | AWS |
|---|---|---|
| `SERVER_URL` | `https://local.ping-devops.com:8623` | `https://ai-demo.ping-devops.com/mcpgw` |
| `PRIVILEGE_MCPGW_URL` (BFF) | `https://local.ping-devops.com:8623/mcp` | `https://ai-demo.ping-devops.com/mcpgw/mcp` |
| redirect URI (only if MCPGW's own login is used) | `https://local.ping-devops.com:8623/callback` | `https://ai-demo.ping-devops.com/mcpgw/callback` |

Note the asymmetry: locally the container sees the path it is given, because the
port carries the routing. On AWS nginx strips `/mcpgw` first, so the container
sees `/mcp` either way. `SERVER_URL` still carries the prefix on AWS because it
is what MCPGW advertises to clients, not what it listens on — if MCPGW instead
derives advertised URLs from the inbound Host and path, this value is wrong and
the rewrite needs revisiting.

### Secret hygiene

Every path is already guarded; no new gitignore rules needed.

| path | guard |
|---|---|
| `ping-mcpgw/config/pingone.env` | `ping-mcpgw/.gitignore:2` |
| root `.env` | `.gitignore:62` and a hard block in `.husky/pre-commit:83` |
| `certs/` | `.gitignore:44` |
| staged diffs | gitleaks, `.husky/pre-commit:92` |

Nothing is rotated. Existing provisioned values are used as-is; new registrations
are added alongside.

---

## 6. Console prerequisites

External to the repo. Ordered — later steps consume earlier outputs.

1. **Agentic App `MCPGW`** — AI Security > Agentic Apps. Toggle on. Scopes
   `openid`, `email`, `profile`. Both redirect URIs from §5. Yields
   `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`.
2. **Gateway registration** — Privilege > Cloud > Gateways > Add New > Add via
   Wizard. Yields the proxy cluster and **`MCPGW_IMAGE`**. Blocks everything
   runnable.
3. **MCP Server tile** — MCP Server URL `http://mcp-server:8080/mcp`, bound to
   the mesh cluster from step 2. Frontend URL is per environment:
   `https://local.ping-devops.com:8623` locally,
   `https://ai-demo.ping-devops.com/mcpgw` on the SE cluster. If one tile cannot hold
   both, register two.
4. **Tool policy producing a DENY** — the first half of the demo.
5. **Session recording enabled** — the second half.

Steps 4 and 5 are the demo's actual payload and live entirely in the cloud
console. The repo work makes them reachable; it cannot make them true. A green
test suite therefore does **not** mean the demo works. This is inherent to
demonstrating a commercial product whose policy is not authored in git, and it is
the sharpest contrast with `ping-gateway`, whose policy is fully reproducible
from the repo.

---

## 7. Success criteria

### Achievable before the image arrives

- `docker compose --profile mcpgw config` resolves
- the same command fails with the intended message when `MCPGW_IMAGE` is unset
- `./run-docker.sh optional start mcpgw` reaches the compose invocation
- `cd demo_api_server && CI=true npm test -- --forceExit` green, including the
  new `PRIVILEGE_MCPGW_URL` test
- `kubectl apply --dry-run=client -f k8s/75-ping-mcpgw-deployment.yaml` passes
- no backend in `se-ingress.yaml` lacks a matching applied Deployment

### Requires the image

- container boots and stays up
- browser reaches `https://local.ping-devops.com:8623` with a valid cert, no warning
- **BFF reaches it server-side, proven from inside the container** —
  `docker exec ai-demo-api-server` performing a real fetch. Reaching 8623 from
  the host proves nothing about the alias, and the alias is the one clever part
  of §3
- `tools/list` through MCPGW returns `mcp-server`'s banking tools
- a policy-blocked tool call returns a deny the client page renders
- that session appears in the Privilege console recording view
- both repeat against `https://ai-demo.ping-devops.com/mcpgw`
- `https://ai-demo.ping-devops.com/` still serves the frontend unchanged —
  proof the `rewrite-target` stayed scoped to the second Ingress object

### Tests

One new BFF test: `PRIVILEGE_MCPGW_URL` set means `/state` returns it as
`config.mcpUrl`; unset means empty string. Nothing else here is unit-testable
without the image.

---

## 8. Expected failure modes

| symptom | cause |
|---|---|
| `ECONNREFUSED` from the BFF while the browser works | network alias missing — the BFF resolved the name to 127.0.0.1 inside its own container |
| `ERR_TLS_CERT_ALTNAME_INVALID` | reached by a name absent from the cert SAN list |
| MCPGW up, auth fails, credentials look empty | OIDC keys listed under `environment:` as well as `env_file` |
| 401 at `/mcp` with an otherwise valid PingOne token | the §3 open risk — MCPGW wants its own login, not the client page's bearer |
| 502 on AWS only | nginx terminated TLS; the container still expects HTTPS |
| 404 at `/mcpgw/mcp` on AWS, works locally | `rewrite-target` missing or its regex not capturing — the container is seeing `/mcpgw/mcp` instead of `/mcp` |
| the whole app breaks on AWS after deploy | `rewrite-target` landed on `ai-demo-ingress` instead of its own Ingress object, rewriting the `/` frontend rule too |
| MCPGW returns links pointing at `/mcp` without the prefix | MCPGW derives advertised URLs from the inbound request rather than `SERVER_URL` |
| container pulls something unexpected | `MCPGW_IMAGE` set to a stale wizard value |

---

## 9. Non-goals

- wiring `demo_mcpgw`
- any change to `ping-gateway` or `mcp-server`
- any UI file change
- `service-topology.json` registration
- secret rotation of any kind

---

## 10. Working constraints

- Implementation happens on a git worktree branch; the main checkout hard-blocks
  `Write`/`Edit`.
- Stage explicitly with `git add <files>`; never `git add -A`.
- Invoke the `regression-guard` skill before editing, since this adds a published
  port and touches deploy scripts.
- Emoji allowlist per REGRESSION_PLAN §0.
