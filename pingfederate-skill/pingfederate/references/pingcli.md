# PingCLI Reference (`pingcli pingfederate`)

PingCLI (`brew install pingcli` / Ping Identity downloads) is the preferred tool for PF admin automation when installed — it manages authentication, token storage, and TLS so scripts stay simple.

## First-time setup

```bash
# Guided wizard: prompts for host, admin API path, auth type, credentials
pingcli init

# Or configure directly (non-interactive)
pingcli config set service.pingfederate.httpsHost https://pf-admin.example.com
pingcli config set service.pingfederate.authentication.type oauth
pingcli config set service.pingfederate.authentication.clientCredentials.clientID <admin-client-id>
pingcli config set service.pingfederate.authentication.clientCredentials.clientSecret <secret>
# Optionally trust a private CA:
pingcli config set service.pingfederate.caPemFiles ./pf-ca.pem
```

Auth types: `oauth` (client_credentials against PF), `accessTokenAuth` (external token), `basicAuth`. The OAuth client needs the PingFederate Administrator entitlement.

## Login / session

```bash
pingcli pingfederate auth login     # authenticate (tokens stored in OS keychain by default)
pingcli pingfederate auth status    # check session
pingcli pingfederate auth logout
```

## Sending API requests

`pingcli pingfederate api` (alias `pf api`) is a curl-like wrapper with auth filled in:

```bash
# GET (method is GET by default)
pingcli pingfederate api oauth/clients -O json

# Create with JSON from a file
pingcli pingfederate api -m POST --data ./client.json oauth/clients

# Update
pingcli pingfederate api -m PUT --data ./client.json oauth/clients/my-client

# Delete (add -f to fail the shell on non-2xx)
pingcli pingfederate api -m DELETE -f oauth/clients/my-client

# Filter JSON output with JMESPath
pingcli pingfederate api -O json --query 'items[?enabled].clientId' oauth/clients
```

Useful flags:
- `-O json` — machine-readable output (also `ndjson` variants)
- `--query '<jmespath>'` — server-side-of-the-output filtering (requires JSON output)
- `-f` / `--detailed-exitcode` — make failures visible to scripts (exit 1 on error, 2 on warnings with `-D`)
- `--debug` — stack traces + transaction IDs when a request fails
- `-P <profile>` — target a different PF environment without changing the active profile

## Idempotent upsert with PingCLI

```bash
pingcli pingfederate api -O json oauth/clients/my-client >/dev/null 2>&1 \
  && pingcli pingfederate api -m PUT -f --data ./client.json oauth/clients/my-client \
  || pingcli pingfederate api -m POST -f --data ./client.json oauth/clients
```

(For strict correctness, distinguish 404 from other GET failures — add `-f` to the GET and check the exit code.)

## When to drop to raw curl

- Reproducing runtime (not admin) OAuth/SAML flows — PingCLI is admin-API-only; troubleshooting needs direct runtime calls to `:9031`.
- Debugging TLS or header-level behavior where the CLI's abstraction hides the wire.
- PingCLI not installed on the target machine.
