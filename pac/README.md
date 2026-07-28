# PingOne Authorize — Policy as Code

Authoring path for P1AZ policy that lives in git as YAML, compiles to a
PingAuthorize deployment package, and deploys over the Management API.

This runs **alongside** the existing snapshot path, not instead of it.
`snapshots/gen-authorize-snapshot.js` remains the source of truth for the
Transactions and MCP-first-tool policies. Nothing in this directory touches
those endpoints.

## Endpoints

| Endpoint | ID | Authored by |
|---|---|---|
| Super Banking Demo - Policy as Code | `ad5fc1d4-0227-45c6-8612-bd982bb6593e` | `pac deploy` from `pac/policies/*.yaml` |
| Super Banking Demo — Transactions | `c9e87348…` | snapshot import (console) |
| Super Banking Demo — MCP first tool | `1f9e9c71…` | snapshot import (console) |

All three are in environment `01d89b06`.

`pac deploy` does a **PUT of a whole deployment package**. It replaces
everything at the target endpoint — it does not merge. That is why PaC gets a
dedicated endpoint: pointing it at `c9e87348` would wipe the transaction
authorization policy on the first deploy.

The corollary: do not author policy for the PaC endpoint in the console. The
next deploy overwrites it. YAML in `pac/policies/` is the only source.

## Prerequisites

**Java 21+.** pac.jar is built for Java 21 (its MANIFEST says so); an older JVM
dies with `UnsupportedClassVersionError`. The scripts check the major version
up front and say so plainly rather than letting that surface.

```bash
brew install openjdk    # keg-only — the scripts add it to PATH themselves
```

Note macOS ships `/usr/bin/java` as a stub that exists on `PATH` even with no
JDK installed; it only prints "Unable to locate a Java Runtime". The scripts
probe by running `java -version`, not with `command -v`, for that reason.

**pac.jar** is a 33MB Ping-supplied binary and is not committed. Point
`PAC_JAR` at your copy:

```bash
export PAC_JAR=/path/to/pac.jar
```

**Credentials** come from `demo_api_server/.env`
(`PINGONE_ENVIRONMENT_ID`, `PINGONE_WORKER_CLIENT_ID`,
`PINGONE_WORKER_CLIENT_SECRET`). The worker app needs `deployments:create` on
the target environment — the demo worker already has it.

There is deliberately **no `~/.pac/endpoints.json`**. pac reads connection
details, including the worker client secret, from `$HOME/.pac/endpoints.json`
in cleartext; writing it there leaves a second long-lived copy of a live
PingOne credential outside the gitignored `.env` files. Instead
`scripts/pac-common.sh` builds that file under a `mktemp` directory, points the
JVM at it with `-Duser.home`, and shreds it on exit. `.env` stays the single
source of truth.

`demo_api_server/.env` is gitignored, so it does not exist inside a worktree.
The scripts fall back to the main checkout's copy via the shared git dir;
override with `PAC_ENV_FILE` if needed.

## Usage

```bash
./scripts/pac-deploy.sh                          # deploy pac/policies/amount-gate.yaml
./scripts/pac-deploy.sh pac/policies/other.yaml  # deploy a specific file
```

The wrapper validates, runs the policy's own `tests:` block, and only then
deploys. It refuses to deploy a file whose tests did not run — an empty
`tests:` block would otherwise pass silently and ship an unverified package.

Environment overrides: `PAC_JAR`, `PAC_ENV_FILE`, `PAC_ENDPOINT_ALIAS`,
`PAC_DECISION_ENDPOINT_ID`, `PAC_EDIT_PORT`.

## The demo: local editor

```bash
./scripts/pac-edit.sh          # http://127.0.0.1:9099
```

Serves the jar's Monaco editor over `pac/policies/`: edit YAML with live
validation, run the policy's tests, visualise the decision tree (`/viz`), and
deploy to the PaC endpoint — the whole authoring loop on one page. It picks up
the same ephemeral endpoint config, so its Deploy button targets `ad5fc1d4…`
and the secret still never lands in your home directory.

> **Run this locally only.** The editor serves an **unauthenticated** REST API
> (`/api/file`, `/api/deploy`, `/api/generate`, `/api/shutdown`, …). Anyone who
> can reach the port can read and write policy files on disk and deploy policy
> to the live PingOne environment using the worker credentials. The jar binds
> `127.0.0.1` only — verified with `lsof` — but that is the jar's behaviour, not
> something the script enforces, and there is no bind-address flag. Do not
> reverse-proxy it, iframe it from the demo UI, or run it on the SE AWS cluster.
> Run it beside the demo on the presenter's machine and screen-share it.

`pac-edit.sh` deliberately does not `exec` the JVM: `exec` would replace the
shell and discard the cleanup trap, leaving the ephemeral credential file on
disk after the editor stops.

`/api/generate` (natural language → PAC YAML) needs `ANTHROPIC_API_KEY` in the
environment, or Bedrock config. It is not required for the demo loop above.

## Fallback

If the pac path fails — no Java, no jar, missing `deployments:create` — the
fallback is the `p1az-import-generator` skill: it turns the same plain-language
rules into a snapshot JSON that a human imports through the console
(Authorize → policy editor → kebab menu → Import). `scripts/pac-deploy.sh`
prints this instruction on any failure.

## Verifying a decision

```bash
curl -X POST "https://api.pingone.com/v1/environments/$ENV_ID/decisionEndpoints/ad5fc1d4-0227-45c6-8612-bd982bb6593e" \
  -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"parameters":{"amount":"150"}}'
```

Current `amount-gate.yaml` returns PERMIT below 100, DENY at 100 and above.

Note on `NOT_APPLICABLE`: if a request matches no rule, the engine returns that
rather than a decision. The BFF collapses it to DENY
(`pingOneAuthorizeService._normalizeDecision`), so it fails closed — but a
policy that relies on this is deciding by omission. Keep an explicit
`rule DefaultDeny: deny` so the DENY is visible in the decision tree.
