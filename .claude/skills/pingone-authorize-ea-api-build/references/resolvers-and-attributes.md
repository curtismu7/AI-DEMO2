# Trust Framework Attribute Resolvers

Attributes are created via `POST /environments/{envId}/authorizationAttributes`. This file covers what resolver type to use for each kind of source data, and the single most expensive-to-discover gotcha in this whole skill: array-wrapping on Query Parameters and Headers.

## The critical gotcha: array-wrapping on Query Parameters and Request Headers

**Path Parameters, Query Parameters, and Request Headers are NOT structurally identical, even though they look like they should be.**

Confirmed via extensive live, harness-verified testing (payload string double-checked, deploy confirmed via `authorizationVersionId` on every test):

- **Path Parameters** (`PingOne.API Access Management.HTTP.Request.Path Parameters`) resolves via `{"type": "REQUEST"}` — a direct resolver — to a plain object: `{"vendorId": "6"}`. A child attribute with JSONPath `$.vendorId` extracts the scalar `"6"` correctly. **No array index needed.**
- **Query Parameters** and **Request Headers** resolve to an object whose **values are arrays**: `{"vendorId": ["6"]}`, not `["6"]` and not `[{"vendorId":"6"}]`. A JSONPath of `$.vendorId` (no index) returns the array `["6"]` itself — not the scalar. If that array-valued result reaches a `modify-query` statement's interpolation, it throws `500 UNEXPECTED_ERROR` (the obligation cannot interpolate a non-scalar into a `{{uuid}}` placeholder in the payload string). **The fix is `$.vendorId[0]`** (Query Parameters) or `$['x-header-name'][0]` (Headers) — explicitly index into the value array to get the scalar.

**A hypothesis that was tested and falsified, worth knowing so it doesn't get resurrected:** it's tempting to think this is about resolver chain type — Path Parameters uses a direct `{"type": "REQUEST"}` resolver, so maybe indirect/chained resolvers are the problem. This was directly tested: Request Headers *also* resolves via `{"type": "REQUEST"}` (confirmed by GETting the system attribute definition directly) and *still* requires `[0]`. **The cause is the array-valued internal representation specifically, not resolver chain type.** Don't waste time investigating chain type as an explanation for a similar failure elsewhere — check for array-wrapping first.

**Symptom checklist if you hit an unexplained `500 UNEXPECTED_ERROR` from a `modify-query` (or similar) statement when the source value IS present, but it works fine (empty string) when absent:** this is almost certainly the array-wrapping issue. Add `[0]`.

## Resolver types, when to use each

### `REQUEST` — direct resolvers

Path Parameters, Request Headers, and the base URL/query-parameters system attributes all resolve this way — no chaining through another custom attribute. Fastest, least error-prone. Prefer building child attributes directly off these system attributes rather than introducing extra indirection.

### `ATTRIBUTE` — chained resolvers

A custom attribute can resolve by referencing another attribute (`{"type": "ATTRIBUTE", "value": {"id": "<parent-attribute-uuid>"}}`) and applying its own `processor` (typically `JSON_PATH`) on top of the parent's resolved value. This is how Query Parameters itself is built internally (chained off the URL attribute) — you don't need to replicate that; just build your own child attribute directly off the `Query Parameters` system attribute's UUID with the `[0]`-indexed JSONPath.

### PingOne User resolver — for user custom attributes

If you need a value off the PingOne user object (a custom attribute like `department` or `vendorAccount`), use the **PingOne User** resolver type directly — do **not** build an HTTP Service workaround for this. It's a first-class, direct resolution path. Typically keyed off a `personSub` attribute (itself an `AccessToken` JSONPath resolver on `$.sub`) to identify which user to look up.

### HTTP Service resolver — for anything requiring a lookup against your own backend

When a value needs to come from your own API rather than the token or request context (e.g., "what category does this vendor belong to, given its ID"), use an HTTP Service resolver — configure it to call your endpoint (e.g. `GET /internal/vendor-category?vendorId={requestedVendorId}`), chaining off whatever attribute supplies the input parameter. This is the same general pattern used for role-lookup-style attributes keyed off a client ID or subject.

### Generated attributes

PingOne can auto-generate a child attribute for a JSON property under a parent attribute or service, adding the JSON Path processor automatically. If the parent has nested properties, generate one level at a time — parent first, then child. Useful as a starting point, but always verify the generated expression against the array-wrapping gotcha above before trusting it on Query Parameters or Headers.

### Operation path-parameter attributes

If an API Operation's path includes a `{paramName}` segment (e.g. `/records/user/{userId}`, configured via `paths: [{type: "PARAMETER", pattern: "..."}]` on the Operation), PingOne automatically populates the Path Parameters attribute for that Operation's requests — this is the mechanism, not something you configure separately per-attribute. This is structurally distinct from a generic top-level Path Parameters check — it's populated specifically because the matched Operation's path pattern declared that parameter.

## Verification pattern for any new attribute

1. `GET` it directly after creation, confirm the `id` and resolver/processor fields match intent.
2. Wire it into a throwaway `modify-query` statement on a test rule (see `policy-and-rule-authoring.md`), with a distinct payload key so its output is unambiguous.
3. Deploy, confirm `authorizationVersionId` changed.
4. Test with the value present and absent, via a real sideband/decision-endpoint call. Print the full raw response.
5. Only then wire it into real policy logic.
