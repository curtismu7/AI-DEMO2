# Tag policies in depth

What tag policies are, what they are not, and how tags actually get onto
resources in the PingOne Privilege console. Everything below was probed live
on our tenant (2026-10-11) — the console UI and the swagger both leave this
partly undocumented, and one behavior is the opposite of what the feature
name implies.

Tested live 2026-10-11. Companion docs: [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md)
("Tag map" section) for the live per-resource tag assignments;
[.claude/skills/privilege-console-api/](../.claude/skills/privilege-console-api/SKILL.md)
for the API recipe itself.

## Two different things: tag policies vs tags

| | Tag **policies** (`tagpolicys`) | **Tags** (`ObjectMeta.CTags`) |
|---|---|---|
| What it is | A name-regex → tag-set rule, scoped by resource type (`KindMap`) | Key/value pairs on a resource object |
| Where it lives | Its own `tagpolicys` collection | On each application / agent key / PAC policy object |
| What it does at runtime | **Nothing.** No reconciler, no apply endpoint (see below) | Shows in the console "Tags And Labels" panel; readable via API |
| How to create | API `POST /api/{tenant}/v1/tagpolicys` (the Create-Tag wizard UI is undrivable by automation) | API PUT with `CTags: {Map:{k:v}}` on the object |

The console's tags page (Admin → Tags) lists tag policies — it is the
*policy* inventory, not the per-resource tags:

![Tag policies list — one demo-map-* policy per app family, with regex and tag set](../docs/screenshots/privilege-console-setup/tag-policies-list.png)

Per-resource tags live on each object's detail page under the **Tags And
Labels** tab (Remote Agent apps):

![Tags And Labels panel on the hostile-a2a app showing demo and purpose tags](../docs/screenshots/privilege-console-setup/app-tags-panel.png)

## What tag policies are

A tag policy is a declarative rule: *objects whose name matches this regex
SHOULD carry these tags*. The `Spec` shape (from the imodel swagger and
verified live):

```json
{
  "RegExPattern": "^hostile-mcp",
  "KindMap": { "Map": { "Application": "true" } },
  "Tags": { "Map": { "demo": "redteam-hostile-mcp", "purpose": "hostile-redteam" } },
  "FixedPatterns": { "Elems": [] },
  "PolicyOrigin": "Default"
}
```

- `KindMap` values are **strings** (`"true"`), not booleans — a real boolean
  unmarshals as a 400. `Application` is the resource type we use; `PolicyOrigin`
  is an enum: `Default` | `Approver`.
- `FixedPatterns` exists but we have not found a use for it; it stays empty.
- Regexes are anchored name patterns, so one policy covers a whole app family
  (e.g. `^banking-`).

## What they don't do (measured, not assumed)

**Tag policies do not auto-tag anything.** A probe app created with a
policy-matching name (`hostile-mcp-tagprobe` against `^hostile-mcp`) got:

- zero `CTags` at create,
- still zero on a touch PUT afterwards,
- still zero after 5+ minutes.

There is no apply/evaluate endpoint in the swagger — CRUD only. There is no
reconciler. The wizard's "Apply Tags" step was never drivable (its
Resource-Types combobox ignores synthetic *and* CDP clicks), so its semantics
were never learned.

**Treat tag policies as documentation the console keeps about the intended
mapping** — a self-describing record of "objects named like this should carry
these tags" — not as an automation. The actual tags are set by hand via the
CTags PUT below.

## How tags actually get on (the CTags PUT)

Read-modify-write the whole object with `ObjectMeta.CTags` set:

```
GET  /api/{tenant}/v1/applications/default/{name}
     → add/replace ObjectMeta.CTags: {Map: {"demo": "...", "purpose": "..."}}
PUT  /api/{tenant}/v1/applications/default/{name}
```

Per-resource quirks, all measured:

- **Applications** — PUT works plain (`applications/default/{name}`), 200 and
  persists. MCP Server apps hold tags correctly in the API but the console's
  Tags And Labels panel shows "No Procyon tags" for them anyway (display bug,
  API state is correct — verify by GET, not by staring at the UI).
- **Agent access keys** — only the **namespaced** PUT route works:
  `/api/{tenant}/v1/agentaccesskeys/default/{name}`. PUT by bare name, UUID,
  base64 ID, or on the collection all 401 (RBAC) even with an admin session.
  The console UI has zero CTags code for keys — keys were never taggable from
  the UI.
- **PAC policies** — taggable via the same read-modify-write PUT.
- **User vaults / cloud agents** — PUT returns 200 but the server **strips
  CTags**; not taggable. Not a miss — a platform limit.
- Full-console result: 21/21 applications, 8/8 agent keys, 10/10 policies
  tagged; uservaults/cloudagents excluded by the platform.

The console UI path is a dead end for writes: the Create-Tag wizard fights
synthetic clicks, per-row edit/delete is all the tags list offers, and there
is no create button on the admin tags page. Do CRUD via the API; use the UI
only for reading (and only for Remote Agent apps — see the display bug above).

## Our live policy set

**2026-11-18: the schema moved to the 4-key set (`env` / `source` /
`capability` / `protection`), applied by
`scripts/apply-tag-schema.mjs`.** 17 `tag-map-*` policies now cover every
application, agent access key, and PAC policy in the tenant (69 resources,
0 orphans, verified idempotent by re-running with `--dry-run`). The 4 keys
answer: which environment it belongs to, where it is managed from, what it
can do, and what its policy posture is. The legacy `demo` / `purpose` tags
below are preserved alongside (merged, never replaced). Re-run the script
after adding or renaming any resource:

```bash
node privilege/scripts/apply-tag-schema.mjs --tenant <uuid> \
  --token '<x-auth-token cookie JSON>' --dry-run   # drop --dry-run to apply
```

Key families (`tag-map-key-*`, `tag-map-pol-*`) cover agent keys and PAC
policies that don't share the app's name; the script reports any resource
matching no family (exit 2) so drift surfaces instead of hiding.

### The 4-key schema

| Key | Values | Answers |
|---|---|---|
| `env` | `demo` \| `redteam` \| `sandbox` | Which environment / blast radius |
| `source` | `ai-demo2` \| `manual` | What manages it (sync target) |
| `capability` | `banking-transfers`, `a2a-agent-chain`, `hostile-redteam`, … | What it can do |
| `protection` | `governed` \| `hostile` | Policy posture at a glance |

### `tag-map-*` policy families (2026-11-18)

App families: `tag-map-banking` (`^(banking-mcp|banking-openapi|banking-aggregate)$`),
`tag-map-aggregate` (`^aggregate(-limited|-none)?$`), `tag-map-opensearch`
(`^opensearch(-hitl2?)?$`), `tag-map-hostile`
(`^(hostile-mcp|hostile-mcp-governed|hostile-a2a|libre)`), `tag-map-a2a`,
`tag-map-catalog`, `tag-map-infra`, `tag-map-idjag`, `tag-map-meridian`,
`tag-map-muse`, `tag-map-scratch` (`^agg222$`). Key families:
`tag-map-key-aggregate`, `tag-map-key-a2a`, `tag-map-key-idjag`,
`tag-map-key-obs`, `tag-map-meridian`, `tag-map-muse`, `tag-map-a2a`.
Policy families: `tag-map-pol-river` (console-generated `*River-*` /
`*Fork-*` / `*Mersey-*` principal policies, `source=manual`),
`tag-map-pol-opensearch`, `tag-map-pol-aggregate`, `tag-map-pol-a2a`.
The authoritative machine-readable list is the `FAMILIES` array in
`scripts/apply-tag-schema.mjs` — edit there, not here.

## Legacy `demo-map-*` set (2026-10-11, superseded but still live)

The original 10 `demo-map-*` policies were per-app-family records of the
old two-key schema. They still exist in the tenant; the `tag-map-*` set
above supersedes them and they can be deleted once nothing reads them.

| Policy | Regex | Tags |
|---|---|---|
| `demo-map-a2a` | `^(worker-agent\|langchain-midagent\|refused-agent\|a2a-mcp-tools)$` | `demo=step-26-a2a-chain` / `step-25-26-a2a`, `purpose=a2a-agent` |
| `demo-map-aggregate` | `^aggregate$` | `demo=act5-discovery-demo`, `purpose=demo-aggregate` |
| `demo-map-brave` | `^(brave\|mcp-brave-search)$` | `demo=uc41-brave-search`, `purpose=brave-door` |
| `demo-map-catalog` | `^mcp-(brave-search\|grafana)$` | `purpose=catalog-sidecar` |
| `demo-map-hostile-a2a` | `^hostile-a2a$` | `demo=redteam-hostile-a2a`, `purpose=hostile-redteam` |
| `demo-map-hostile-mcp` | `^hostile-mcp` | `demo=redteam-hostile-mcp`, `purpose=hostile-redteam` |
| `demo-map-infra` | `^(agent-gateway\|pingone-admin-local)$` | `purpose=gateway-infra` |
| `demo-map-libre` | `^libre$` | `demo=redteam-hostile-mcp`, `purpose=hostile-redteam` |
| `demo-map-mcp` | `^banking-` | `demo=banking-demo`, `purpose=banking-demo` |
| `demo-map-opensearch` | `^opensearch$` | `demo=step-25-access-review`, `purpose=demo-opensearch` |

## Maintenance rule

**Rename or add an app → update its family's regex in
`scripts/apply-tag-schema.mjs` and re-run it, in the same change.**
A policy whose regex matches only dead names silently stops matching anything
and nothing complains — this already happened once (demo-map-a2a matched the
four pre-rename names until it was fixed 2026-10-11). Because policies never
apply tags themselves, a stale policy costs nothing at runtime and everything
at read time: the next person who trusts the console's record of the intended
mapping gets lied to. The script's orphan report (exit 2) is the tripwire.

## Why tag at all

Tags are how the console answers "what is this for" when the name alone
doesn't. The 4-key schema (above) is the current standard: `env` says which
blast radius a resource sits in, `protection` says whether a real agent can
be pointed at it (`governed`) or it is a red-team fixture (`hostile`),
`capability` says what it does, and `source` says what manages it. The
legacy `demo` / `purpose` tags remain the index into demo steps — see the
"Tag map" section of [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md).
