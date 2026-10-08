# Statements & Obligations

Statements are how a rule modifies the request/response on a decision (e.g., injecting a query parameter on PERMIT). This is a live-tested confirmation of which statement `code` values actually work.

## Confirmed working: `modify-query`

```json
{
  "name": "verify-department",
  "code": "modify-query",
  "obligatory": true,
  "appliesTo": "ANYTHING",
  "appliesIf": "PATH_MATCHES",
  "attributes": [],
  "payload": "{\"department\": \"{{8892d298-9d13-40a9-8162-39153077cf44}}\"}"
}
```

Key structural facts:
- `payload` is a **JSON string** (not a nested JSON object) containing `{{attribute-uuid}}` interpolation tokens.
- **`attributes` should be left as an empty array `[]`.** It is only a dependency declaration and does not control what gets interpolated — the `{{uuid}}` tokens inside the `payload` string are the only thing that's actually load-bearing. This is a common source of confusion: editing `attributes` while forgetting to also update `payload` silently keeps resolving the old value.
- Attach statements to a **rule**, not the parent policy node — statements at the policy level don't fire the same way.
- `appliesTo: "PERMIT"` (or `"ANYTHING"`, tested working) determines when the statement fires relative to the decision.
- The interpolated value must resolve to a **scalar**. If the referenced attribute resolves to a non-scalar (an object, or an un-indexed array — see the array-wrapping gotcha in `resolvers-and-attributes.md`), the statement throws `500 UNEXPECTED_ERROR` rather than failing gracefully or interpolating something reasonable. A cleanly-absent/null value interpolates to an empty string with no error — it's specifically a *present-but-non-scalar* value that breaks it.

## Confirmed NOT working on PERMIT (don't retest these)

All five tested live, multiple configurations, including with correctly-resolving Trust Framework attributes:

- `custom-attributes`
- `set-header`
- `url-rewrite`
- `add-query-parameters`
- `auth-challenge`

If you need behavior that sounds like one of these (e.g., "set a response header," "reject with a custom challenge"), it does not currently work via a PERMIT-side statement in this API generation. `modify-query` is the confirmed, working injection mechanism — if your use case can be reshaped as "inject a query parameter the downstream service reads," that's the path that works.

## `custom-attributes`/`set-header`/etc. on other appliesTo values

These were only tested on `PERMIT`. If a future need requires testing them on a different `appliesTo` (e.g. `DENY`), that's genuinely untested territory — don't assume the same negative result carries over without checking, but also don't assume it'll suddenly work either. Verify live.

## Debugging a statement that isn't firing

In order of likelihood, based on real incidents on this project:

1. **The `payload` string still references the old/wrong attribute UUID**, even though the `attributes` array looks right. Re-GET and read the literal `payload` string.
2. **The interpolated value is an array or object, not a scalar** — check the source attribute against the array-wrapping gotcha in `resolvers-and-attributes.md`. Symptom: `500 UNEXPECTED_ERROR`, but only when the underlying value is actually present (absent/null values interpolate fine as empty string).
3. **Deploy hasn't landed.** Confirm `authorizationVersionId` changed since your last PUT, per `ea-api-operational-quirks.md`.
4. **The rule containing the statement never matched** — check the rule's `condition` and see `condition-evaluation-and-nulls.md` if it involves any attribute that might be missing (not just empty) on the evaluated entity.
