---
name: p1az-import-generator
description: Generate a PingOne Authorize (P1AZ) snapshot import file from plain-language authorization rules given by the user (e.g. "deny if amount over 2000", "require step-up MFA if amount over 500 and no MFA yet", "otherwise permit"). Use when the user wants a policy/rule file to import into PingOne Authorize's console, or asks to add/change a rule in one. Produces a JSON file matching PingOne's snapshot export/import schema, using reference/example-import.snapshot.json as the structural template to copy and modify.
metadata:
  format_reverse_engineered_from: AI-DEMO2 repo snapshots/*.snapshot.json + snapshots/gen-authorize-snapshot.js
  extracted: 2026-07-21
---

# PingOne Authorize (P1AZ) Import File Generator

PingOne Authorize has no API for authoring policy logic (comparison
conditions) — policies are built by importing a **snapshot** file through the
console (environment → Authorize → policy editor → kebab menu → Import). This
skill turns a user's plain-language rules into that file.

`reference/example-import.snapshot.json` is a complete, working, generic
3-rule example (deny over a limit / permit-with-step-up-obligation / permit
otherwise). **Copy it and modify it** rather than building the structure from
scratch — it's the fastest way to avoid a malformed import.

## Workflow

1. **Get the rules.** If the user's request is incomplete, ask before
   generating:
   - What fields will the caller send on each decision request (their names
     and types — number/string/boolean), e.g. `Amount`, `Country`,
     `RiskScore`?
   - What are the actual thresholds/values for each rule?
   - For each non-permit outcome: is it a hard **DENY**, or a **PERMIT with an
     obligation** (step-up MFA, HITL/consent approval)? These are different
     shapes (see step 4).
   - Is there always exactly one fallback ("otherwise permit" / "otherwise
     deny")? A policy needs exactly one rule whose `condition` is `{"empty":
     {}}` so nothing falls through unresolved.

2. **Enumerate attributes** — one per field the rules read. Copy the
   `ATTRIBUTE` shape from the reference file. Each needs:
   - `valueType`: `STRING`, `NUMBER`, or `BOOLEAN`.
   - `defaultValue`: **always set one that fails safe.** If a rule's
     condition reads an attribute the caller omitted and there's no default,
     the comparison is unresolved and the whole decision goes
     `INDETERMINATE` instead of a clean PERMIT/DENY. Match the default to the
     safe side of the rule (e.g. a boolean "has completed MFA" flag defaults
     `false`, not `true`).
   - `resolvers`: always `[{"attributeResolverType": "request", "condition":
     {"empty": {}}, "valueProcessor": null, "name": null}]` — this means "read
     it off the incoming decision request's parameters," matching whatever
     the caller sends (e.g. a `p1az.evaluateTransaction()`-style call's
     `parameters` object).

3. **Build one CONDITION per boolean gate** a rule needs. Condition grammar
   confirmed working in the reference file:
   - `{"comparison": {"left": {"attribute": {"id": ...}}, "op": "Equals" |
     "NotEquals" | "GreaterThan", "right": {"constant": {"value": ...}} |
     {"attribute": {"id": ...}}}}` — compare an attribute to a literal or to
     another attribute.
   - `{"and": {"conditions": [...]}}` / `{"or": {"conditions": [...]}}` —
     combine sub-conditions.
   - `{"not": {"condition": {...}}}` — negate.
   - `{"reference": {"id": <condition id>}}` — reuse a CONDITION defined
     elsewhere (rules reference conditions this way rather than inlining
     comparisons directly).
   - `{"empty": {}}` — always true. Used for the policy's own top-level
     condition and for a rule's catch-all.
   - Only `Equals`/`NotEquals`/`GreaterThan` are attested here. If a rule
     needs e.g. `LessThan` or a substring/contains check, verify it in the
     PingOne console's condition editor before assuming it exists — don't
     invent operator names.

4. **Build one Statement per distinct outcome.** A Statement is what's
   actually returned to the caller when a rule fires:
   - Hard deny reason: `"appliesTo": "DENY"`.
   - Obligation (step-up / HITL / consent) or plain approval: `"appliesTo":
     "PERMIT"`.
   - `"appliesIf": "PATH_MATCHES"` always (only value seen).
   - `"code"`: short, stable, machine-readable — this is what the calling
     application matches on (e.g. `"step_up_required"`,
     `"amount_limit_exceeded"`). Pick codes the caller's own gate logic
     expects; ask the user if unspecified.
   - `"payload"`: a human-readable message. Interpolate attribute values with
     `{{<attribute-id>}}` (see the reference file's deny statement).
   - `"obligatory": false` in every example seen, including for step-up/HITL
     statements — don't set `true` without evidence it changes behavior.

5. **Build one Rule per outcome**, in this shape (see reference file for all
   three variants):
   - **Hard deny rule**: `condition` = `{"and": {"conditions": [{"reference":
     {"id": <gate condition>}}]}}`; `effectSettings` = `{"type":
     "conditionalDenyElsePermit", "condition": <same condition again>}`;
     `statements` = `[<deny statement id>]`.
   - **Permit-with-obligation rule** (step-up/HITL/consent): `condition` =
     `{"and": {"conditions": [{"reference": {"id": <gate condition>}}]}}`;
     `effectSettings` = `{"type": "unconditionalPermit"}` (no nested
     condition needed — the rule's own `condition` already gates it);
     `statements` = `[<obligation statement id>]`.
   - **Catch-all permit rule**: `condition` = `{"empty": {}}`;
     `effectSettings` = `{"type": "unconditionalPermit"}`; `statements` =
     `[<approved statement id>]`. Every policy needs exactly one of these,
     listed last.
   - `shared: false`, `disabled: false`, `targets: []` in every example seen.

6. **Wrap rules in one Policy**: `children` = ordered `{id, type: "Rule"}`
   refs (deny rules and obligation rules before the catch-all, for
   readability — `combiningAlgorithm: {"algorithm": "DenyOverrides"}` means
   any DENY wins regardless of list order, but keep deny-first for humans
   reading it), `condition: {"empty": {}}` (or a target condition if this
   policy should only run in some context — see note below), `statements:
   []`.

7. **Wrap the policy in one PolicySet**: `children` = `{id, type: "Policy"}`
   refs, `combiningAlgorithm: {"algorithm": "DenyOverrides", "evaluateAll":
   true}`, `condition: {"empty": {}}`, plus the `managedEntity` block from the
   reference file (copy verbatim — `{"owner": {"service": {"name": "Editor
   Service"}}}`).

8. **Assemble the full file** in this order (matches the reference file and
   every real export seen):
   1. `{"@class": "DataStreamHeader", "kind": "SnapshotHeader", "version": 2}`
   2. `{"type": "SnapshotPackageFile$PackageHeader", "snapshotId": <new
      UUID>, "snapshotFileVersion": 2, "applicationVersion": "P1AZ-1.0.0.0"}`
   3. All ATTRIBUTE entries
   4. All CONDITION entries
   5. All Statement entries
   6. All Rule entries
   7. `{"type": "SnapshotPackageFile$PackageSeparator"}`
   8. All Policy entries, then all PolicySet entries
   9. `{"type": "SnapshotPackageFile$PackageSeparator"}`
   10. `{"type": "SnapshotPackageFile$EndOfPackage"}`
   11. `{"@class": "DataStreamFooter", "digest": <any stable label string>}`

   Real-world exports interleave rules/statements/conditions more freely than
   this (IDs are resolved by reference, not by array position), but nothing
   examined contradicts this simpler grouped order — use it unless you have a
   specific reason not to.

9. **IDs**: generate a fresh random UUID (v4) for every object's `id` and a
   *different* fresh random UUID for its `version`. There's no functional
   link required between an object's `id` and `version` format — the source
   repo this was reverse-engineered from uses a readable prefix convention
   (all attribute IDs share one prefix block, etc.) purely as a *human*
   debugging aid; it is not a PingOne requirement. **Never reuse an ID from
   the reference file or from a previous import** — importing an existing ID
   updates that object in place; a new object needs a new ID.

10. **Write the output** as a single JSON array, one object per line (matches
    the reference file's formatting — cosmetic, but makes future diffs
    readable): `"[\n  " + entries.map(JSON.stringify).join(",\n  ") + "\n]\n"`.

11. **Tell the user how to use it**: PingOne Admin Console → their
    environment → Authorization (Authorize) → the policy editor's kebab
    menu → Import → upload the generated file. There is no API path for this
    (the policy-editor endpoints reject client-credentials worker tokens) —
    console import is the only route.

## Common mistakes to avoid

- Forgetting the catch-all permit rule (`condition: {"empty": {}}`) — without
  it, an action matching none of the explicit rules resolves to
  `INDETERMINATE`, which most callers treat as a fail-closed DENY (surprising
  if the user only asked for one deny rule and expected everything else
  permitted).
- Attribute with no `defaultValue` — same `INDETERMINATE` failure mode when
  the caller omits that field.
- Confusing a rule's own `condition` (its target/applicability — "does this
  rule even fire") with `effectSettings.condition` (only present on
  `conditionalDenyElsePermit`, and in every example seen it's a byte-identical
  copy of the rule's own condition — set both, don't leave one out).
- Reusing an ID across two different objects, or across two separate import
  files meant to create distinct objects.
