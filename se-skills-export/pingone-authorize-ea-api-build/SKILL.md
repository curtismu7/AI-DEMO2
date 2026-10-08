---
name: pingone-authorize-ea-api-build
description: Build, wire, and debug PingOne Authorize policies, Trust Framework attributes, resolvers, statements, and API Access Management (AAM) rules against PingOne's Early Access (EA) Admin API — not the snapshot-file/import workflow. Use this whenever the user is calling PingOne Authorize's Management API directly (authorizationAttributes, authorizationPolicies, apiServers, decisionEndpoints, sideband/request), debugging a sideband decision, writing a Trust Framework attribute resolver (Path Parameters, Query Parameters, Headers, PingOne User, HTTP Service), authoring a modify-query or other obligation statement, hitting a confusing PUT/POST error against authorizationPolicies, seeing an unexpected DENY or 500/403 from a decision endpoint, or working with PingGateway's PingAuthorizeFilter or Kong's kong-plugin-ping-auth sideband integration. Push hard to consult this before writing any live API call against PingOne Authorize's EA endpoints — this API has many non-obvious, undocumented behaviors that are expensive to rediscover and are all captured here.
---

# PingOne Authorize — EA Admin API Build & Debug

This skill is for **live, incremental authoring against PingOne Authorize's Early Access Admin API** — creating attributes, writing policies and rules, wiring statements, deploying, and verifying via real sideband calls. It is NOT the snapshot-generation workflow (author-offline, generate a JSON file, import once) — if the user wants that instead, look for a snapshot/import-oriented skill.

This skill exists because the EA API has a long list of behaviors that are either undocumented or documented misleadingly, and getting them wrong produces **silent wrong results**, not helpful errors, most of the time. Follow the verification discipline in this file religiously — it's not optional ceremony, it's the difference between real evidence and a false result that looks identical to a correct one.

## The core mental model

Everything in PingOne Authorize's policy tree splits into two zones:

1. **System-owned / managed nodes** — the `API Access Management` tree, and specifically the `Custom` node under each Operation's `Inbound Request`/`Outbound Response`. These have `managedEntity.restrictions.readOnly: true`. **You cannot place a new policy into these via the API, ever.** `POST .../authorizationPolicies` with `parent: {id: <custom-node-id>}` either errors or silently drops the policy into the flat `Policies` library instead. No workaround exists. This requires one console click, per Operation, one time.
2. **Your own policies, once they exist** — anything you (or a human, via console) create *inside* a Custom node, or anywhere in the free-standing `Policies` library. These are `managedEntity: false` and **fully writable via API** — including adding/editing rules, conditions, and statements.

The practical workflow is therefore always: **one console action to create an empty shell policy inside the right Custom node → everything else (rules, conditions, statements, iteration) via API.** See `references/policy-and-rule-authoring.md` for the exact console steps and API PUT mechanics.

## Non-negotiable verification discipline

This project lost real time, repeatedly, to results that *looked* correct but weren't — a fabricated UUID silently producing a stale test result for two full sessions; a `payload` string left pointing at the wrong attribute while the `attributes` array looked right; a deploy that never actually landed because the wrong field was checked for confirmation. Follow this every time, no exceptions:

- **Before wiring any attribute UUID into anything:** `GET` it directly, print the full response, confirm the `id` matches exactly. Never trust a UUID from memory, a truncated 8-char prefix, or a variable name.
- **Never suppress command output** (no `-o /dev/null`, no discarding stderr) on any call that writes state. Print everything. A swallowed `400`/`INVALID_VALUE` is how silent failures happen.
- **After every PUT, re-GET the resource** and confirm the written fields — especially the `payload` string inside statements, not just the `attributes` array — actually changed to what you intended. See "the payload string vs. attributes array trap" below.
- **Deploy confirmation uses `authorizationVersionId`** from `GET /environments/{envId}/apiServers/{apiServerId}/deployment` — **not** the policy object's own `version` field, which reflects configuration state, not deployed-engine state. Confirm this value actually changed, immediately before treating any sideband test as evidence.
- **When a hypothesis seems confirmed by one clean result, test a second, structurally different case before trusting it.** Several false conclusions in this project's history came from one round of testing that later turned out to be invalid (stale deploy, wrong UUID) — a second independent confirmation is cheap insurance.

## The payload string vs. attributes array trap

In a `modify-query` (or other) statement, the `attributes` array is only a dependency declaration — it does **not** control what value gets injected. The actual reference is the `{{attribute-uuid}}` token embedded in the `payload` string. **Leave `attributes: []` empty; the payload string's `{{uuid}}` is the only thing that's load-bearing.** If you swap which attribute you're testing by editing the `attributes` array but forget the `payload` string, every test will keep silently resolving the old attribute — this exact bug cost two full debugging sessions on this project. Always re-GET and read the literal `payload` string after any change, not just the array.

## Quick-reference: what's confirmed working vs. broken

| You want to... | Use | Reference |
|---|---|---|
| Extract a value from a path segment (`/vendors/{id}`) | Path Parameters system attribute, plain JSONPath (`$.vendorId`), no index needed | `resolvers-and-attributes.md` |
| Extract a value from a query string (`?vendorId=6`) | Query Parameters system attribute, JSONPath **with `[0]` index** (`$.vendorId[0]`) | `resolvers-and-attributes.md` |
| Extract a value from a request header | Request Headers system attribute, JSONPath **with `[0]` index** (`$['x-header-name'][0]`) | `resolvers-and-attributes.md` |
| Read a PingOne user's custom attribute | PingOne User resolver, direct — no HTTP Service workaround needed | `resolvers-and-attributes.md` |
| Inject a value into the outbound request on PERMIT | `modify-query` statement — confirmed working | `statements-and-obligations.md` |
| ~~Inject via `set-header`, `url-rewrite`, `custom-attributes`, `add-query-parameters`, `auth-challenge`~~ | **Confirmed NOT working on PERMIT** — don't retest these | `statements-and-obligations.md` |
| Guard a condition against a possibly-missing attribute | **No `IS_PRESENT`/`EXISTS`/`NOT_NULL` exists.** A missing attribute throws, not evaluates false. See below. | `condition-evaluation-and-nulls.md` |

## The single most important gotcha: missing attributes DENY, they don't evaluate false

If a rule's condition references an attribute (e.g. `department EQUALS "raw_materials"`) and that attribute **doesn't exist** on the evaluated user/request (as opposed to existing with an empty value), PingOne does **not** evaluate the comparison as `false`. It throws `PROCESSING_ERROR` at the JSONPath resolution layer, which propagates as an **indeterminate** result. Under `FIRST_APPLICABLE` combining, an indeterminate result **halts the chain** — it does not fall through to the next rule. The parent's `DENY_OVERRIDES` algorithm then converts indeterminate to a hard `DENY`.

**This means:** every user/entity evaluated by a policy must have a non-null value for **every** attribute any rule in that policy's chain references — even attributes structurally irrelevant to that entity's role — or they'll get an unexpected DENY. There is no policy-level guard against this (no presence comparator exists). The only two confirmed mitigations are (a) provisioning discipline — give every entity a placeholder value for attributes that don't apply to them — or (b) restructure with `OR` (a resolving branch can rescue an indeterminate via permit-override semantics, but this merges match paths into one rule, which may not fit your design). Full detail, including everything ruled out, in `condition-evaluation-and-nulls.md` — **read this before writing any conditional rule.**

## Workflow

1. **Build/confirm Trust Framework attributes first**, fully via API (`POST /environments/{envId}/authorizationAttributes`), verified individually via direct sideband/decision-endpoint calls before wiring them into any rule. See `resolvers-and-attributes.md` for resolver types and the array-indexing gotcha.
2. **If targeting an AAM Custom node**: get the human to create the empty shell policy in console (one-time, per Operation). If targeting the free-standing `Policies` library: skip straight to API.
3. **Author rules via API** against the shell policy — full PUT of the parent with an updated `children` array (rules are not individually addressable; see `policy-and-rule-authoring.md` for exact field requirements, most of which differ from a naive reading of the GET response).
4. **Deploy.** For AAM API Servers, this currently requires console (the API deploy path needs a gateway `client-token`, not a Worker Bearer token — see `ea-api-operational-quirks.md`). For free-standing policies bound to a Worker-token-accessible Decision Endpoint, `POST /apiServers/{id}/deployment` works directly.
5. **Confirm `authorizationVersionId` changed**, then verify with a real sideband call — print the full raw response, not just a derived summary field.
6. **If something looks wrong, don't guess.** Check `references/ea-api-operational-quirks.md` first — most confusing errors here have already been hit and documented. If it's genuinely new, apply the verification discipline above before concluding the platform is broken.

## Gateway-specific notes

The core content above is gateway-agnostic — it's true whether PingGateway, Kong, or a raw `curl` is making the sideband call. A short set of gateway-specific facts (PingGateway's `PingAuthorizeFilter` config surface and a dead-config trap; Kong's `kong-plugin-ping-auth` vs. DIY alternatives) is in `references/gateway-specific.md` — only read this once the core policy/attribute work is solid and you're wiring an actual gateway in front of it.

## Reference files

- `references/resolvers-and-attributes.md` — attribute resolver types, the array-indexing gotcha, PingOne User/HTTP Service resolvers, generated attributes
- `references/policy-and-rule-authoring.md` — the console-shell-then-API workflow in full, exact PUT body shapes, every field that differs from a naive guess, version-field requirements
- `references/statements-and-obligations.md` — which obligation codes work, which don't, the non-scalar-interpolation failure mode
- `references/condition-evaluation-and-nulls.md` — the indeterminate-propagation finding in full, everything tested to guard against it, what actually works
- `references/ea-api-operational-quirks.md` — rate limiting, deploy mechanics, auth mechanics, and other operational traps
- `references/gateway-specific.md` — PingGateway and Kong integration specifics

## Helper script

`scripts/walk_policy_tree.py` — walks a policy tree from a Decision Endpoint's root policy ID and prints every node's id/name/depth. Useful for locating a shell policy's UUID after console creation, or for getting oriented in an unfamiliar tree. See the script's own docstring for usage.
