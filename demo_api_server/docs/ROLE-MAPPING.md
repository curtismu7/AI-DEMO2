# Role Claim Mapping

Configure how the BFF determines admin vs customer role from token claims. Supports any IDP that expresses roles/groups as a token claim — string or array, exact value or URI suffix.

## Quick start

Set the claim name and the value that means "admin":

```bash
OAUTH_ROLE_CLAIM_NAME=app_roles        # which claim contains role info
OAUTH_ROLE_CLAIM_VALUE_ADMIN=admin     # value that means admin
OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=user   # value that means customer (optional)
OAUTH_ROLE_CLAIM_IS_ARRAY=true         # true if claim is an array
```

## Default (PingOne)

PingOne uses `population_id` to distinguish admin and customer users:

```bash
OAUTH_ROLE_CLAIM_NAME=population_id
OAUTH_ROLE_CLAIM_VALUE_ADMIN=<admin-population-uuid>
OAUTH_ROLE_CLAIM_IS_ARRAY=false
```

The admin population UUID is visible in PingOne Console → Identities → Populations.

## PingFederate

Configure based on which attribute Federate includes in the userinfo or ID token:

```bash
OAUTH_ROLE_CLAIM_NAME=groups
OAUTH_ROLE_CLAIM_VALUE_ADMIN=banking-admins
OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=banking-users
OAUTH_ROLE_CLAIM_IS_ARRAY=true
```

Token example:
```json
{ "groups": ["banking-admins", "all-staff"], "sub": "alice" }
```

## Azure AD (app_roles)

Azure AD app roles are included as an array in the access token:

```bash
OAUTH_ROLE_CLAIM_NAME=app_roles
OAUTH_ROLE_CLAIM_VALUE_ADMIN=admin
OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=user
OAUTH_ROLE_CLAIM_IS_ARRAY=true
```

Token example:
```json
{ "app_roles": ["admin", "user"], "oid": "user-uuid" }
```

## Auth0

Auth0 role claims are typically URI strings:

```bash
OAUTH_ROLE_CLAIM_NAME=roles
OAUTH_ROLE_CLAIM_VALUE_ADMIN=admin
OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=customer
OAUTH_ROLE_CLAIM_IS_ARRAY=true
```

Token example:
```json
{ "roles": ["https://banking-demo.auth0.com/roles/admin"] }
```

The resolver matches by URI suffix — `admin` matches `.../roles/admin`.

## Okta (groups)

```bash
OAUTH_ROLE_CLAIM_NAME=groups
OAUTH_ROLE_CLAIM_VALUE_ADMIN=banking-admins
OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=banking-users
OAUTH_ROLE_CLAIM_IS_ARRAY=true
```

## Resolution logic

1. If `OAUTH_ROLE_CLAIM_VALUE_ADMIN` is empty, the resolver returns `null` (no opinion) and legacy signals (`admin_population_id`, `admin_role_claim`, username allowlist) take over
2. For array claims, `admin` is checked before `customer` — admin wins if both are present
3. URI suffix matching: `admin` matches any URI ending in `/admin`
4. Matching is case-sensitive

## Relationship to existing signals

The resolver is **Signal 5** in the user OAuth callback. The existing signals still apply:
1. Username allowlist (`admin_username`)
2. PingOne population ID (`admin_population_id`)
3. Custom claim (`admin_role_claim` / `admin_role`)
4. Existing dataStore record (don't downgrade)
5. **Role claim resolver** — `oauth_role_claim_*` config

Any signal returning admin is sufficient. Use Signal 5 for new IDP configurations and leave the others unconfigured.
