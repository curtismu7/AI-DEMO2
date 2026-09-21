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
