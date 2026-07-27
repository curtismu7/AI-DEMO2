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

pac.jar needs **Java 21+** and is 33MB, so it is not committed.

```bash
brew install openjdk          # keg-only; the wrapper adds it to PATH itself
export PAC_JAR=/path/to/pac.jar
```

Deploy credentials come from `~/.pac/endpoints.json`, keyed by alias
(`demo` by default, override with `PAC_ENDPOINT_ALIAS`):

```json
{
  "endpoints": {
    "demo": {
      "decisionEndpointUrl": "https://api.pingone.com/v1/environments/<envId>/decisionEndpoints/<endpointId>",
      "clientId": "<worker client id>",
      "clientSecret": "<worker client secret>"
    }
  }
}
```

The client needs `deployments:create` on the target environment. The demo
worker app already has it.

## Usage

```bash
./scripts/pac-deploy.sh                          # deploy pac/policies/amount-gate.yaml
./scripts/pac-deploy.sh pac/policies/other.yaml  # deploy a specific file
```

The wrapper validates, runs the policy's own `tests:` block, and only then
deploys. It refuses to deploy a file whose tests did not run — an empty
`tests:` block would otherwise pass silently and ship an unverified package.

To edit with the bundled Monaco editor (syntax highlighting, live validation):

```bash
java -jar "$PAC_JAR" edit pac/policies/
```

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
