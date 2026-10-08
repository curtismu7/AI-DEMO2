# Policy & Rule Authoring — Console Shell + API Workflow

## Step 1 — Human creates the shell policy (console only, one time per location)

**You cannot place a new policy into a managed AAM Custom node via the Management API, period.** Confirmed multiple independent ways: PingOne's own documentation states the tree structure is system-owned and read-only for placement; empirical testing across multiple sessions confirms `POST /authorizationPolicies` with `parent: {id: <custom-node-id>}` either returns an error or silently succeeds while dropping the policy into the flat `Policies` library instead of the intended location; `PUT` directly on a managed node returns `CONSTRAINT_VIOLATION`.

This is **not** a case where you keep trying API approaches — there is no workaround. Every managed AAM Operation has this tree shape:

```
Operation "get-vendor-contract"  [managed, readOnly]
  └─ Inbound Request             [managed, readOnly]
       ├─ Basic Rules            [managed, readOnly]
       └─ Custom                 [managed, readOnly]   ← target
```

**Console steps (one per Operation/location that needs a policy):**
1. Console → Authorize → API Services → `<your API Server>`
2. Expand Operation → Inbound Request (or Outbound Response) → Custom
3. Click **+ Add Policy** (or the equivalent "+" control) — name it anything
4. Save. Do not add rules or statements in the console — everything from here is API-driven.

Once this shell exists, it has `managedEntity: false` and is **fully writable via API** — this is the key unlock. The managed boundary is exactly one level deep: you cannot cross *into* a managed node via API, but anything non-managed already placed inside one is entirely yours.

If instead you're authoring a free-standing policy in the general `Policies` library (not bound to a specific Operation's Custom node), you can `POST` it directly via API — no console step needed. The console-only step is specifically for placement into a managed AAM tree location.

## Step 2 — Discover the shell policy's UUID

Walk the tree from the Decision Endpoint's root policy, or use `scripts/walk_policy_tree.py`:

```bash
TOKEN=<worker-app-bearer-token>
ENV=<environment-id>
ROOT_POLICY_ID=<de-root-policy-id>   # from GET /decisionEndpoints/{deId} -> policy.id

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.pingone.com/v1/environments/${ENV}/authorizationPolicies/${ROOT_POLICY_ID}" \
  | python3 -c "
import sys,json
def walk(n, d=0):
    print('  '*d + n.get('id','') + '  ' + n.get('name',''))
    for c in n.get('children',[]): walk(c,d+1)
walk(json.load(sys.stdin))
"
```

Find your shell policy's UUID as a child of the `Custom` node under your Operation.

## Step 3 — GET the shell policy for version fields

PUT requires **two separate version fields** if you're updating an existing rule: the parent policy's own `version`, and (if updating rather than creating) the rule's own `version`. Both only come from a fresh GET — always re-GET immediately before every PUT, since version changes on every successful write.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.pingone.com/v1/environments/${ENV}/authorizationPolicies/${SHELL_POLICY_ID}"
```

Key fields: `id`, `version` (policy-level), `children[0].id` and `children[0].version` (if a rule already exists and you're editing it).

**Rules are not standalone, individually-addressable API resources.** `GET /authorizationPolicies/{rule-id}` returns `NOT_FOUND` for a rule UUID — even one you just saw embedded in a parent's `children` array. `POST /authorizationPolicies` with `"type": "RULE"` returns `"Invalid type id"`. **The only way to create, modify, or delete a rule is to PUT the entire parent policy with an updated `children` array.**

## Step 4 — PUT the policy with rule(s) and statement(s)

```python
import json, urllib.request

STATEMENTS = [
  {
    "name": "verify-personSub",
    "code": "modify-query",
    "obligatory": True,
    "appliesTo": "ANYTHING",
    "appliesIf": "PATH_MATCHES",
    "attributes": [],   # leave empty -- see SKILL.md "payload string vs attributes array trap"
    "payload": "{\"personSub\": \"{{<attribute-uuid>}}\"}"
  },
]

rule = {
    "type": "RULE",                                # REQUIRED on write; GET responses omit it entirely -- see gotcha table below
    "id": "<existing-rule-uuid>",                   # omit entirely if creating a NEW rule
    "version": "<existing-rule-version>",           # omit entirely if creating a NEW rule
    "name": "my-rule-name",
    "enabled": True,
    "effectSettings": {"type": "UNCONDITIONAL_PERMIT"},   # yes, even for conditional rules -- see below
    "condition": {"type": "EMPTY"},                 # or a real AND/COMPARISON condition -- see condition shape below
    "statements": STATEMENTS
}

# Build PUT body from a fresh GET -- strip read-only/server-managed fields
put_body = {k: current[k] for k in current if not k.startswith('_')}
for drop in ('environment', 'managedEntity', 'parent'):
    put_body.pop(drop, None)
put_body['children'] = [rule]   # full replacement of children array, not an append

req = urllib.request.Request(
    f"https://api.pingone.com/v1/environments/{ENV}/authorizationPolicies/{SHELL_POLICY_ID}",
    data=json.dumps(put_body).encode(), method='PUT',
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as r:
    result = json.loads(r.read())
```

**The `children` array is a full replacement, not a merge/append.** If the policy already has other rules you want to keep, include them (with their existing `id`/`version`) alongside the new one in the same array.

### Real conditional rule shape

```json
"condition": {
  "type": "AND",
  "conditions": [{
    "type": "COMPARISON",
    "left": {"type": "ATTRIBUTE", "id": "<attribute-uuid>"},
    "comparator": "EQUALS",
    "right": {"type": "CONSTANT", "value": "raw_materials"}
  }]
}
```

**Read `condition-evaluation-and-nulls.md` before writing any conditional rule** — a condition referencing an attribute that's missing (not empty, missing) on the evaluated entity throws and DENIES rather than evaluating false.

## Every field that differs from a naive guess (all confirmed via live GET/PUT testing)

| Field | Wrong guess | Correct value |
|---|---|---|
| `type` on a rule child | (often omitted, since GET doesn't show it) | `"RULE"` — **required on write, silently stripped on read.** GET responses for existing rules never include `type`; you must add it back yourself for any child you're writing, new or existing. |
| `effectSettings.type` for a conditional rule | `"CONDITIONAL_PERMIT"` | `"UNCONDITIONAL_PERMIT"` — always, even when the rule has a real condition. The effect is always PERMIT or DENY; conditionality lives entirely in the `condition` field, not `effectSettings`. |
| `condition.type` for a boolean AND | `"CONDITION_SET"` | `"AND"` |
| the AND's combining field | `"conditionSetAlgorithm"` | does not exist as a field — don't send it |
| `right.type` inside a COMPARISON | `"VALUE"` | `"CONSTANT"` |
| policy `version` on PUT | omittable | **required** — omitting returns `"version must not be null"` |
| rule `version` when updating an existing rule | omittable | **required if the rule already exists** — omitting returns `CONSTRAINT_VIOLATION: An attempt was made to update an outdated version` |
| policy `id` in the PUT body | URL alone is enough | **must also be in the body** — omitting returns `"id must not be null"` |

## Step 5 — Deploy

A successful PUT changes the policy object, but the Decision Endpoint keeps serving whatever `authorizationVersion` was last deployed. Nothing is live until deploy happens. See `ea-api-operational-quirks.md` for the exact deploy mechanics (console vs. API, and why AAM API Servers currently need console).

**Verification, always:** after deploy, `GET /environments/{envId}/apiServers/{apiServerId}/deployment` and confirm `authorizationVersionId` actually changed from its pre-deploy value. If it didn't change, the deploy was effectively a no-op (e.g. the policy hash matched what was already deployed) and nothing new is live — don't trust a sideband test until this is confirmed.
