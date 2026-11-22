# Local SPIFFE/SPIRE profile

This profile is opt-in and does not change the default stack:

```sh
docker compose --profile spiffe up -d spire-server spire-agent
docker compose --profile spiffe run --rm spire-registration
```

The trust domain is `spiffe://bxfinance.demo`. The server and agent use pinned
SPIRE 1.15.2 images, RSA keys, a local SQLite datastore, and Docker workload
attestation. The BFF can consume files written by `spiffe-helper` when
`FF_SPIFFE_CLIENT_AUTH=true` and the `SPIFFE_*_PATH` values point at the shared
output directory.

This is a local workload-identity foundation. PingOne cannot fetch a local
Docker OIDC discovery endpoint, so replacing a real PingOne client secret with
the local JWKS requires a public HTTPS deployment of the discovery provider.

## PingFederate integration (working, local)

The SPIRE OIDC Discovery Provider terminates TLS with the mkcert pair
(`./certs/api.ping.demo+2.pem`) on host port 8443, so PF's JVM — which already
trusts the mkcert root CA — can fetch the trust domain's JWKS from
`https://local.ping-devops.com:8443/keys`. `scripts/pingfederate/docker-compose.local.yml`
adds `local.ping-devops.com:host-gateway` to the PF container so its JVM
resolves that origin.

PF 13 side (recreate with `spiffe/pingfederate/*.json` against
`https://local.ping-devops.com:9999/pf-admin-api/v1`, basic auth
`administrator` + `PING_IDENTITY_PASSWORD`, `X-XSRF-Header` required):

- `spiffe-jwt-processor.json` → POST `/idp/tokenProcessors` (JWT Token
  Processor 2.0; issuer `https://local.ping-devops.com:8443`, JWKS
  `https://local.ping-devops.com:8443/keys`, audience
  `https://local.ping-devops.com:9031`, Max Future Validity 4320 because PF
  ATM tokens live 60h).
- `pf-access-subject-processor.json` → POST `/idp/tokenProcessors` (validates
  PF-issued access tokens as the exchange subject; requires the ATM
  `Issuer Claim Value` = `https://localhost:9031` and
  `Audience Claim Value` set).
- `spiffe-te-policy.json` → POST `/oauth/tokenExchange/processor/policies`
  (subject = access_token via the PF processor, actor = jwt via the SPIRE
  processor, `spiffeId` extended attr = actor `sub`).
- Access token mapping: POST `/oauth/accessTokenMappings` with
  `spiffe-te-atm-mapping.json` (context `TOKEN_EXCHANGE_PROCESSOR_POLICY`,
  ATM `aiDemoPfJwtAtm`; the context prefix PF prepends is the token-exchange
  grant URI). It emits the actor's SPIFFE ID as `client_id` and `act.sub`
  (`spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent`, the SVID the
  BFF mints for label `workforce-agent`). The mapping is per-policy, so other
  PF exchanges keep their own shape. To apply a change to a running PF, PUT
  the mapping to `/oauth/accessTokenMappings/<id>` instead of POSTing.
- `spiffe-te-client.json` → POST `/oauth/clients` (client
  `ai-demo-spiffe-te`, TOKEN_EXCHANGE only).

SPIRE server config adds `jwt_issuer = "https://local.ping-devops.com:8443"`
so minted JWT-SVIDs carry an `iss` claim (SPIRE omits it by default and PF's
JWT Token Processor 2.0 requires it). After any SPIRE data-volume reset, re-run
`docker compose --profile spiffe run --rm spire-registration` so the workload
entries point at the current agent's join-token SPIFFE ID.

## Restart resilience — what is durable and what is not

All PingFederate state survives any container destroy/recreate:

- `ai-demo-pingfederate-out-classic` → `/opt/out`: every config artifact
  (token processors, token-exchange policy, access token mapping,
  `ai-demo-spiffe-te` client, license, keystore).
- `ai-demo-pingfederate-jvm-security` → `/opt/java/lib/security`: the JVM
  cacerts with the mkcert dev root imported. **Without this volume a recreated
  container loses the CA and every JWKS fetch fails with
  `PKIX path building failed`.**

Recreate PF (both volumes) with:

```sh
docker run -d --name ai-demo-pingfederate \
  -p 9999:9999 -p 9031:9031 \
  -e PING_IDENTITY_ACCEPT_EULA=YES \
  -e PING_IDENTITY_PASSWORD=<PING_IDENTITY_PASSWORD> \
  -v ai-demo-pingfederate-out-classic:/opt/out \
  -v ai-demo-pingfederate-jvm-security:/opt/java/lib/security \
  --network ai-demo_ai-demo --network-alias pingfederate \
  --add-host local.ping-devops.com:host-gateway \
  --restart unless-stopped \
  pingidentity/pingfederate:13.1.2-alpine_3.24.1-al25-edge@sha256:996ad6caba201cbf22bfdfa55d09f4726c0f001c2f7ec60a0b78181f3deaa805
```

If the mkcert CA is ever missing from the volume, re-seed it:

```sh
docker cp certs/mkcert-rootCA.pem ai-demo-pingfederate:/tmp/
docker exec ai-demo-pingfederate /opt/java/bin/keytool -importcert -noprompt \
  -alias mkcert-dev-root -file /tmp/mkcert-rootCA.pem \
  -cacerts -storepass changeit
docker run --rm -v ai-demo-pingfederate-jvm-security:/v \
  --volumes-from ai-demo-pingfederate busybox:1.36.1 \
  sh -c 'cp /opt/java/lib/security/cacerts /v/cacerts'
```

On the SPIRE side, volumes (`spiffe-server-data`, `spiffe-agent-data`,
`spiffe-bootstrap`) persist the CA, keys, and join token; after any agent
container recreation, re-run
`docker compose --profile spiffe run --rm spire-registration` so workload
entries point at the live agent — or just run
`scripts/spiffe-recover.sh`, which does the stop → re-register → start
sequence and waits for the workload API socket.

---

## SPIFFE → Privilege gateway (federated workload identity)

`POST /api/demo/spiffe/privilege/call` (flag `ff_spiffe_privilege`, default
off) presents a workload identity to the Privilege gateway's Non-Human
Identity / Pass Agent Token path — the same setup verified 2026-11-13 in
`privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md` for PingFederate tokens, here
extended to SPIRE-issued identity. Three token shapes are comparable:

| `token_mode` | Token presented | What it tests |
|---|---|---|
| `raw-svid` | SPIRE JWT-SVID, verbatim (`sub` = `spiffe://…`) | Does the gateway verify SPIFFE identity directly? |
| `pf-exchanged` | PF token minted in exchange for that SVID as `actor_token` (`/pingfederate/exchange`) | The composite story: SVID → PF → gateway, with `client_id`/`act.sub` the required-claims pattern expects |
| `pf-client-credentials` | Plain PF client-credentials token | Baseline with no SPIFFE at all |

Request body (all optional): `token_mode` (default `raw-svid`), `resource`
(gateway path, default `/mcp`), `mcp_method` (default `tools/list`),
`audience` (SVID audience, default the gateway URL), `scopes`. The gateway's
HTTP status and body are returned verbatim — a 401/403 **is the demo result**,
not an error.

### Privilege console setup (mirrors the PF pattern)

1. **Non-Human Identities → Register Identity**: issuer = the SPIRE OIDC
   Discovery Provider issuer (`https://local.ping-devops.com:8443` for the
   PF-validated issuer currently configured), key source "Fetch from URL"
   with the discovery provider's JWKS URL.
2. **Agent app**: Agentic Apps → Add Application → MCP Server, Auth Mode
   **Pass Agent Token** (see `privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md`
   part C).
3. **Agent key**: Agent Registry → Add Agent, custodian = the identity from
   step 1 (part D).

### The reachability blocker (raw SVID against the remote gateway)

The gateway fetches the registered JWKS from the **public internet**. The
SPIRE OIDC Discovery Provider currently serves only on
`local.ping-devops.com:8443`, which `mcpgw.ai-demo.ping-devops.com` cannot
reach — so a `raw-svid` call against the remote gateway demonstrates the
**refusal** (JWKS/issuer failure), which is itself a useful demo beat.
Options to get the acceptance path live:

- Deploy the discovery provider behind the SE cluster's public ingress
  (`ai-demo.ping-devops.com`), then re-point the NHI registration's JWKS URL;
  or
- Run the checks against a locally deployed Privilege gateway
  (`privilege/GATEWAY-LOCAL-DOCKER.md`), which can resolve the local host.

The `pf-exchanged` and `pf-client-credentials` modes have no such constraint —
their JWKS is PingFederate's, already public.

### Live results (2026-11-22, laptop SPIRE → `mcpgw.ai-demo.ping-devops.com`)

The blocker above was solved with **inline pinned JWKS** on the NHI
(`spire-ai-demo`, platform `spiffe`) instead of a fetch URL, plus the
generated audience `priv-nhi-l5hp7w677rxl3somiehznpomuyxxlhdr`:

- **`raw-svid`: 200 from the gateway with the real OpenSearch MCP tool
  list**, verified repeatedly — gateway log:
  `workload token accepted for key spire-agent issuer=https://local.ping-devops.com:8443 subject=spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent`.
- **`pf-exchanged` / `pf-client-credentials`: 401 `token_not_found`.**
  The token itself is correct (verified at PF: `spiffeId`, `sub`,
  `act.sub` = the exchanger client). The pinned inline-JWKS NHI
  `pf-local-spiffe` (issuer `https://local.ping-devops.com:9031`, kid
  `aidemopf-idjag-signing`) is upserted on the gateway
  (`llmgw: upserted workload key pf-local-agent … rebuilding 1 key(s)`)
  but never matches — the gateway only ever logs `workloadid:` verifier
  keys for remote JwksURIs. Suspected gateway-side limitation: inline-JWKS
  OIDC-platform NHIs are not loaded as verifier keys. Documented as a
  known gap; the demo UI shows these as honest REFUSED verdicts.

### PF-exchange prerequisite (2026-11-22 fix, do not skip)

The exchange step itself 400s with "Invalid Token" unless PF's
**`aiDemoPfAccessSubjectProcessor`** (the TE policy's subject token
processor) lists the gateway URL in **Allowed Audiences** — the
client-credentials subject token carries `aud` = the gateway resource
URL, and PF validates it. Add
`https://mcpgw.ai-demo.ping-devops.com/spire-mcp/mcp` via the admin API
(`idp/tokenProcessors/aiDemoPfAccessSubjectProcessor`, Allowed Audiences
table) or the admin console. With that fixed, the BFF reaches the
gateway (the 401 `token_not_found` above is the *gateway's* refusal,
which is the honest demo beat).

Also note the config lives in the BFF LMDB config store, not `.env`:
`spiffe_pf_exchange_client_id` = `ai-demo-spiffe-te` (secret in
`spiffe/pingfederate/spiffe-te-client.json`), `spiffe_pf_subject_client_id`
= `ai-demo-pf-standard-agent-exchanger`, `ff_spiffe_pf_exchange` = `true`.

The demo page is **`/spiffe-privilege`** (nav: Architecture & Learning →
"SPIFFE → Privilege Gateway (live)"): runs all three shapes live, shows
the verdict, decoded claims, redacted token, and the full
request/response JSON.
