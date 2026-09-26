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
  grant URI).
- `spiffe-te-client.json` → POST `/oauth/clients` (client
  `ai-demo-spiffe-te`, TOKEN_EXCHANGE only).

SPIRE server config adds `jwt_issuer = "https://local.ping-devops.com:8443"`
so minted JWT-SVIDs carry an `iss` claim (SPIRE omits it by default and PF's
JWT Token Processor 2.0 requires it). After any SPIRE data-volume reset, re-run
`docker compose --profile spiffe run --rm spire-registration` so the workload
entries point at the current agent's join-token SPIFFE ID.
