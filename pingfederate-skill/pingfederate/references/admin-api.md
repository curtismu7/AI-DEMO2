# PingFederate Admin API Reference

Base: `https://<host>:9999/pf-admin-api/v1`

## Authentication

PF Admin API auth (11.x+): the API itself is secured by OAuth. Obtain a bearer token from PF's own token endpoint using a client with admin entitlement:

```bash
# client_credentials token from PF runtime token endpoint
curl -sk https://$PF_HOST:9031/as/token.oauth2 \
  -d grant_type=client_credentials \
  -u "$CLIENT_ID:$SECRET" \
  -d scope=PingFederateAdmin
```

The client needs the **PingFederate Administrator** role granted via an OAuth client setting (`grantTypes`, `clientAuth`, and admin role assignment in client settings or via an access token manager mapping that grants the admin scope).

Older setups may use HTTP Basic (`admin.api.authentication.method=basic` in `run.properties`). Check what works before assuming.

## Error format

```json
{
  "resultId": "...",
  "message": "Resource validation failed",
  "validationErrors": [
    { "errorId": "property_name_invalid", "propertyName": "clientId", "message": "..." }
  ]
}
```

Always surface `validationErrors` — they identify the exact property.

## Idempotent upsert pattern

```bash
upsert() {  # upsert <collection> <id> <file.json>
  local coll=$1 id=$2 file=$3
  code=$(curl -sk -o /tmp/pf-out.json -w '%{http_code}' \
    -X GET "$BASE/$coll/$id" -H "Authorization: Bearer $TOKEN")
  if [ "$code" = 404 ]; then
    curl -sk -X POST "$BASE/$coll" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' -X POST --data @"$file"
  else
    curl -sk -X PUT "$BASE/$coll/$id" -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' --data @"$file"
  fi
}
```

Note: some PUTs require the resource in the body to match; some collections don't accept client-supplied IDs on POST (e.g., authentication policies use generated IDs — GET the list to find yours).

## Key endpoints by task

### OAuth client
- `GET/POST /oauth/clients` — list/create
- `GET/PUT/DELETE /oauth/clients/{id}`
- Important fields: `clientId`, `name`, `grantTypes[]` (`authorization_code`, `refresh_token`, `client_credentials`, `token_exchange`…), `clientAuth` (`type: secret|certificate|private_key_jwt`), `redirectUris[]`, `allowedScopes[]`, `requireSignedRequests`, `tokenEndpointAuthMethod`.
- To change a client secret: PUT the whole client with `clientAuth.clientSecret` set. GET responses omit the secret — you must supply it.

### Access token managers
- `/oauth/accessTokenManagers` — `type: ` embedded (JWT), reference (introspection).
- JWT manager key fields: `jwks`, signing algorithm, `attributeMappings` (incl. token exchange subject mapping under `extendedAttributes`/`oauthAccessTokenAttributeMappings` depending on version).

### RFC 8692 / 8693 token exchange
- Grant type `token_exchange` must be on the client.
- Requires an access token manager with token exchange mapping (subject token → new token attribute mapping). Configure under the token manager's `attributeContract`/`tokenExchangeMapping` (names vary 11.x → 12.x; inspect the GET response schema first — PF returns helpful validation errors).

### SAML connections
- IdP connections (PF acting as IdP to downstream SP): `/idp/connections`
- SP connections (PF acting as SP to upstream IdP): `/sp/connections`
- Fields: `entityId`, `baseUrl`, `saml20Profile` (SP init/IdP init), `credentials` (certs), `attributeMapping`.
- Metadata import: `POST /sp/metadata` / `POST /idp/metadata` with the remote entity metadata XML → returns a partial connection JSON.

### Certificates
- `/serverSettings/certificates` — list/upload. Trusted JWKs for JWKS URL validation use `PUT /oauth/clients/{id}` `jwksSettings`.

### Authentication policies
- Selectors: `/authenticationPolicies/authenticationSelectors`
- Policies: `/authenticationPolicies` (PUT whole policy; fragments under `/authenticationPolicies/fragments`).

### Export
- Per-connection: `GET /connections/export?type=...&id=...` (or the export endpoint on the individual connection — version dependent).
- Full archive: `GET /configArchive/export` → zip.

## Operational notes

- **Cluster**: admin API writes apply to the admin node and propagate; `GET /cluster/status` shows replication state. Big config pushes take a moment to reach runtime nodes.
- **Version drift**: 12.x moved/renamed some token-exchange and client-auth fields. When a field isn't accepted, GET one existing object of that type and mirror its schema exactly.
- **Licensing/limits**: creating many clients is fine; changing default server settings (key rotation, etc.) is high blast radius — always snapshot first.
