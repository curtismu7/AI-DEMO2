# EA API Operational Quirks

Miscellaneous but important operational facts about PingOne Authorize's Early Access Admin API, confirmed through live use.

## Rate limiting is silent

The EA API has a rate limiter that returns `REQUEST_LIMITED` and silently drops requests under load. **Build a sleep between POSTs** when creating multiple resources (e.g. several Trust Framework attributes) in a loop. Don't assume a missing resource after a batch-creation loop means your logic was wrong — check whether some requests were rate-limited first.

## Worker app authentication requires Basic auth, not body credentials

```bash
curl -u '<client_id>:<client_secret>' \
  -d 'grant_type=client_credentials' \
  https://auth.pingone.com/<env-id>/as/token
```

Passing `client_id`/`client_secret` in the request body instead returns `"Unsupported authentication method"`.

## Deploy mechanics differ by resource type

- **Free-standing policies bound to a Decision Endpoint you fully control:** `POST /apiServers/{id}/deployment` (or the equivalent for the resource type) works directly with a Worker app Bearer token.
- **AAM API Servers:** the deploy path proxies through `http-access-api.pingone.com`, which requires a gateway `client-token` credential — **not** a Worker app Bearer token. Until/unless an API-accessible path using a Worker token is confirmed for this specific case, deploy AAM API Servers from the console (Authorize → API Services → select server → Deploy button).
- **Either way, always confirm deploy actually took effect** via `GET /environments/{envId}/apiServers/{apiServerId}/deployment` and checking that `authorizationVersionId` changed. A PUT to the policy object succeeding does not mean the change is live — the Decision Endpoint keeps serving the previously-deployed version until deploy happens, and a deploy call can be a no-op if the policy hash matches what's already deployed.

## `authorizationServices`/API Service creation via API returns opaque errors

`POST` for creating an API Service directly has returned an opaque `400` with no useful documentation for the exact cause in past use. Prefer creating the API Service via console, then using the API (`GET`) to retrieve its ID and configure everything else (attributes, operations, policies) programmatically from there.

## The flat policy list endpoint ignores `parent` as a filter

Listing policies doesn't reliably filter by parent — individual `GET`s by ID are the authoritative source for tree structure and placement, not a list-with-filter call.

## Including `access_token` in a direct sideband call body switches PingOne into proxy mode

When calling `/sideband/request` directly (bypassing a gateway) to test policy behavior, including an `access_token: {value: ...}` field in the request body changes PingOne's behavior from **sideband mode** to **proxy mode**:

- **Sideband mode** (no `access_token` field in the body — token goes in the `Authorization` header only, matching how a real gateway calls it): PingOne evaluates the policy and returns a response containing the modified `url`/`state` for the caller (gateway) to act on. This is the mode all the resolver/statement verification patterns in this skill assume.
- **Proxy mode** (`access_token` field present in the body): PingOne forwards the request all the way through to the actual upstream/backend and returns the upstream's response wrapped in a `response` envelope. Any `modify-query` injection still happens internally (PingOne sends the modified URL to the backend) but **will not be visible in a top-level `url` field the way sideband mode shows it** — checking `url` for injected values will look like nothing happened, even when the policy is working correctly.

**If a direct test call is returning an unexpected upstream error (e.g. a 401 from the actual backend) instead of a PingOne-native decision response, or injected values aren't showing up in `url` where you expect them, check whether `access_token` is present in the body first.** Omit it — pass the token via the `Authorization` header only — to get back to sideband mode and see the actual policy decision output.

## The `parent` field on POST is ignored for AAM-managed placement

Already covered in `policy-and-rule-authoring.md` in full, repeated here for visibility: `POST /authorizationPolicies` with `parent: {id: <managed-custom-node-id>}` does not place the policy where you asked — it lands in the flat `Policies` library instead, or errors, depending on exact conditions. This is not a bug to route around with a different API call; it requires the console step described in `policy-and-rule-authoring.md`.

## Rules are not individually addressable

Repeated here for visibility since it trips people up in multiple contexts: `GET /authorizationPolicies/{rule-id}` returns `NOT_FOUND` even for a rule UUID you just saw. Rules only exist embedded in a parent policy's `children` array. Any change to a rule requires a full PUT of the parent with the updated array.
