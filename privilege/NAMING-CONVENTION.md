# Privilege Naming Convention (Agentic Apps, Agent Keys, Policies)

**Purpose:** every agent that creates, renames or cleans up objects in the PingOne Privilege
tenant (local console `https://local.procyon.ai:8643`, tenant `ea040334-d50b-4ded-8d98-4d5cd14dbd4d`)
follows this pattern. Established 2026-11-23 in the great tenant cleanup (PR curtismu7/AI-DEMO2#3686);
this file is the rulebook going forward.

**How to read this as an agent:** before you POST an `applications`, `agentaccesskeys` or
`pacpolicys` object, derive its name from §1. If the name you want doesn't fit any family,
§5 is the escape hatch — do not invent a new shape silently.

---

## 1. The name grammar

```
<prefix>-<system>-<variant>
```

| Part | Values | Meaning |
|---|---|---|
| `prefix` | `lab-` \| `demo-` \| nothing | `lab-` = test/standalone-lab object, disposable. `demo-` = customer-facing demo object, treated as semi-permanent. No prefix = production demo plumbing (AI-DEMO2 core), never renamed without an owner go. |
| `system` | `banking`, `agg`, `opensearch`, `obo`, `pftoken`, `a2a`, `meridian`, `muse`, `hostile`, `infra` | which backend/system the door fronts |
| `variant` | `full`, `limited`, `blocked`, or a feature word (`hitl`, `governed`, `worker`) | what makes this object different from its siblings |

Examples: `lab-banking-full`, `lab-banking-limited`, `lab-banking-blocked`,
`lab-agg-limited`, `lab-pftoken-key`, `demo-banking-full` (a future customer-facing triple).

## 2. The two-versions rule (allow-all + half-tools)

Every demo/test **door trio** comes in three variants — this is the standing pattern:

| Suffix | Tools policy | Policy object |
|---|---|---|
| `-full` | ALL tools (`[".*"]` in the grant's tool Capabilities) | `<app>-permit`, issued to demoAdmin, demouser, aidemo |
| `-limited` | the 7 read-only tools: `list_entitlements`, `who_has_role`, `get_access_grants`, `get_portfolio_summary`, `get_investment_accounts`, `get_investment_balance`, `get_investment_transactions` | `<app>-permit` with that tool list |
| `-blocked` | NO policy at all (no policy = deny all) | none — that is the point |

Key-bound grants follow the same split: `<key>-grant` for `-full`/`-limited`, nothing for `-blocked`.

## 3. Agent keys

```
lab-<system>-key            # unconstrained caller for the -full door
lab-<system>-<role>-key     # role-scoped: lab-agg-delegate-key, lab-agg-guest-key
```

- An MCP key must have `Spec.Scopes = { Elems: ["mcp"] }` and **no** `Provider` field.
  A key with `Provider: anthropic` / scopes `["llm"]` is an LLM-proxy key — never clone one
  to serve as a door key (the API 400s).
- LLM proxy keys keep provider names: `anthropic`, `openai`, `ollama`, `pgc-agent-llm`.
- Key names are referenced as `PGC_GW_KEY_<NAME_UPPER_SNAKE>` in lab `.env` files
  (`lab-banking-full` → `PGC_GW_KEY_LAB_BANKING_FULL`). The lab resolves that mapping
  dynamically; keep the two in sync.

## 4. The rename procedure (names are immutable)

Never PUT a new name onto an existing object. Rename = **backup → create new → migrate → delete old**:

1. **Backup** every touched object: `GET <collection>/default/<name>` → save full JSON to
   `/tmp/priv-cleanup/` (or the session scratchpad). This is the restore path.
2. **Dry run** first: the reference script `privilege/scripts/cleanup-rename-apps.mjs`
   prints `would create ...` with no `--apply`. Copy its structure for new renames.
3. **Create** the new object from the backup of the old one (strip
   `UUID/CreatedAt/UpdatedAt/RevisionID`, replace the name in `ObjectMeta.Name`,
   `ObjectMeta.ID` = base64(`{tenant}@@@default@@@{name}`), and in every
   `*.applications.procyon.ai` URL).
4. **Migrate consumers** (`.env` files, lab code, docs, tests) to the new names **before**
   deleting the old object, and restart the consuming lab.
5. **Delete** the old object — and any old policies/grants that named it.
6. **Re-run** `node privilege/scripts/apply-tag-schema.mjs --tenant <T> --key ... --secret ...`
   and require `orphan 0`. Add/extend a `tag-map-*` family in that script if the new name
   matches none.

### Traps learned 2026-11-23 (do not rediscover these)
- A key and its grant share a **custodian identity**: creating a second key for the same
  identity while the old one still exists → 409 "a token cannot select between two keys
  sharing one identity". Delete the old key first.
- Cloning an LLM-shaped key into an MCP role → 400. Rebuild from a known-good MCP key template.
- Policy propagation to the gateway takes **~4 minutes**; don't judge a rename broken before that.
- `McpAppConfig.EntryPath` does not recompute on PUT; a fresh create sets it right.
- A POST that already exists → 500 (app) or 409 (key), not a friendly duplicate error.
  Make scripts idempotent: skip create when the new name is already present.

## 5. Families and the tag map

Every object must match exactly one `tag-map-*` family regex in
`privilege/scripts/apply-tag-schema.mjs`. Current families (keep this table in sync when you edit the script):

| Family | Matches | Tags |
|---|---|---|
| `tag-map-banking` | `banking-mcp`, `banking-openapi`, `lab-banking-*` | banking-transfers / governed |
| `tag-map-aggregate` | `aggregate*`, `lab-agg-*` | multi-server-aggregate / governed |
| `tag-map-opensearch` | `opensearch(-hitl2?)` | access-review-search / governed |
| `tag-map-hostile` | `hostile-*`, `libre` | hostile-redteam / **hostile** |
| `tag-map-a2a` | `worker-agent`, `langchain-midagent`, `refused-agent`, `a2a-mcp-tools`, `workeragentdemo2`, `aws-agent-*` | a2a-agent-chain / governed |
| `tag-map-infra` | `agent-gateway`, `pingone-admin-local` | gateway-infra / governed |
| `tag-map-idjag` | `obo-*`, `pftoken*`, `lab-obo-*`, `lab-pftoken-*` | id-jag-test / **sandbox** |
| `tag-map-meridian` | `meridian-*` | payments-demo / governed |
| `tag-map-muse` | `muse-*` | content-demo / governed |
| key families | `*-key`, provider names, `priv-log-agent`… | inherit their app family |
| policy families | `<app>-permit`, `<key>-grant`, River principals | inherit their app family |

Adding a family: edit `FAMILIES` in the script, follow the existing comment style
("Edit HERE when apps are added or renamed"), then re-run and require `orphan 0`.

## 6. Verification before you call it done

- [ ] Dry run printed the expected create plan.
- [ ] All new objects answer (app POST 200, key has a `VirtualKey`, grant exists).
- [ ] Live call through the gateway: `-full` 200, `-limited` tools/list = the 7 tools, `-blocked` 403.
- [ ] Old objects and old policies deleted; listing counts match the plan.
- [ ] `apply-tag-schema.mjs` → `orphan 0`.
- [ ] Consuming labs' tests pass after the rename (e.g. `privilege-gateway-client-LAB`:
      server `npm test`, web `npx vitest run`), and the lab was restarted to pick up new `.env` values.
- [ ] Browser check of the affected lab through the lab proxy (not curl only).
- [ ] Docs/READMEs that name the objects updated; historical capture data left as-is.

## 7. Reference implementation

`privilege/scripts/cleanup-rename-apps.mjs` (this repo) implements the whole pattern for the
2026-11-23 cleanup: APPS + KEYS tables at the top are declarative; the rest is generic.
Copy it, edit the two tables, dry-run, apply.
