# Privilege Naming Convention (Agentic Apps, Agent Keys, Policies)

**Purpose:** every agent that creates, renames or cleans up objects in the PingOne Privilege
tenant (local console `https://local.procyon.ai:8643`, tenant `5bfb4e12-8d71-4b81-8ef8-940b91728c05` from 2026-11-24; was `ea040334-d50b-4ded-8d98-4d5cd14dbd4d`)
follows this pattern. Established 2026-11-23 in the great tenant cleanup (PR curtismu7/AI-DEMO2#3686);
this file is the rulebook going forward.

**How to read this as an agent:** before you POST an `applications`, `agentaccesskeys` or
`pacpolicys` object, derive its name from §1. If the name you want doesn't fit any family,
§5 is the escape hatch — do not invent a new shape silently.

---

## 0. This is a standard (binding, all future development)

- **Who and where.** Every agent and every person, in every repo (AI-DEMO2, AI-DEMO-Standalone, all `*-LAB` repos, the rebuild runbooks), whenever a
  Privilege app, agent key, policy or gateway is created, renamed or removed. Pick the name from §1-§3 and §8 before you create anything.
- **It changes with the apps.** If your change adds a system word (§1), a family (§5 and `FAMILIES` in `apply-tag-schema.mjs`), a rename (the `APPS` / `KEYS`
  tables in `cleanup-rename-apps.mjs`) or a gateway, **edit this file in the same PR** and add a dated line to the change log (§9). A PR that adds or renames
  objects without touching this file is incomplete.
- **How it is enforced.** `demo_api_server/tests/privilegeNamingConvention.test.js` fails when: a name declared in `cleanup-rename-apps.mjs` breaks the grammar
  or fits no family (the static form of `orphan 0`); a `tag-map-*` family exists in the script but not in §5, or the reverse; the system words in §1 are not
  the ones the grammar accepts; or this file lost its change log or stopped being linked from `CLAUDE.md`. On the live tenant, `apply-tag-schema.mjs` must report `orphan 0`.
- **Exceptions are written down.** Unprefixed production-plumbing names stay as they are until the owner says otherwise (§1). Any other exception gets a line in §9
  with the reason, or it is a defect.

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
- A door that accepts **PingFederate tokens** has its name in more places than Privilege. Renaming `pftoken` and deleting `testobo` on 2026-11-23 left every token
  minted for the old URLs useless (gateway `token_not_found`, PingFederate `invalid_target`). When you rename or recreate such a door, move the door URL in all of:
  the console identity's audience (`PFtoken`, `PFtoken-testobo`), the PingFederate access token manager's Audience Claim Value (and Resource URI where it has one;
  `routeCTestAtm`, `testoboAgentAtm`), the token-exchange SP connection's entity ID and resource URI (`aiDemoPfPrivilegeOboSp`), the token processor's Allowed Audiences
  (`aiDemoPfAccessSubjectProcessor`), and the lab's door URL. Then confirm a live call: 200 with a real token, 401 with a made-up one.
- Console-made policies (the generated `<Name>River-<hex>` ones, issued to an identity) hold their rules by app and key **name**, and a rename or delete leaves them
  pointing at nothing: the gateway then logs `policy <River…> has no rule matching this application and principal` and the door answers 403 even though the token is
  accepted. After a rename, list every policy and repoint those rules (`KarunRiver` for `PFtoken`, `StillwaterRiver` for `PFtoken-testobo`). A key-bound grant written
  before a key was deleted and recreated also stays stale; recreate it after the key.
- An `obo` door's **client secret is write-only**: a copy made from a backup has no secret, and the gateway's own exchange fails with `invalid_client` (door answers 502).
  Re-enter it in the console (for the PingFederate client `privilege-gw-obo` it is the vault secret `PF_GW_OBO_CLIENT_SECRET`) after every recreate.
- A key that authenticates by an identity's token must have the **identity as its custodian** (`CustodianRef` kind `NonHumanIdentity`) and no `VirtualKey`; a stored
  virtual key cannot be cleared by PUT, so a key built from a user-custodian template has to be deleted and recreated under the same name. `lab-pftoken-key` and
  `lab-obo-pf-key` are bound to `PFtoken` and `PFtoken-testobo` this way.

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

Every `tag-map-*` family currently in the script (the drift test keeps this list identical to the script; add a name here in the same edit as the script):
`tag-map-banking`, `tag-map-aggregate`, `tag-map-opensearch`, `tag-map-hostile`, `tag-map-a2a`, `tag-map-catalog`, `tag-map-infra`, `tag-map-idjag`,
`tag-map-meridian`, `tag-map-muse`, `tag-map-key-aggregate`, `tag-map-key-a2a`, `tag-map-key-lab-banking`, `tag-map-key-llm`, `tag-map-key-logging`,
`tag-map-key-idjag`, `tag-map-key-obs`, `tag-map-pol-lab-banking`, `tag-map-pol-lab-idjag`, `tag-map-pol-river`, `tag-map-pol-opensearch`,
`tag-map-pol-aggregate`, `tag-map-pol-a2a`, `tag-map-scratch`, `tag-map-key-spiffe`, `tag-map-pol-spiffe`, `tag-map-key-hitl`, `tag-map-pol-hitl`,
`tag-map-banking-hitl`.

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

## 8. Gateways (decided 2026-11-23)

Gateway names never contain a PingOne environment name, because the environment behind a gateway changes. Scheme: **`mcpgw-<where>-<role><n>`**.

| Part | Values |
|---|---|
| `where` | `cm` = Kubernetes namespace `ping-devops-cmuir`, `ct` = `ping-devops-curtismuir`, `local` = the owner's Mac |
| `role` | `lb` front door, `pool` behind the load balancer and takes traffic, `spare` running but parked, `dev` development/demo outside the pool, `retired` old-tenant gateway scaled to 0 |

Every Deployment carries the labels `ping.demo/gateway`, `ping.demo/where`, `ping.demo/role` and the annotation `ping.demo/purpose`. List them with
`kubectl get deploy -A -l ping.demo/gateway`. The cluster ID in the console stays `ai-demo-cmuir` for every node of a tenant (it cannot change after registration);
nodes are told apart by the names above. The per-gateway table (host, HAProxy backend, image) is kept in the rebuild runbook's `GATEWAY-INVENTORY.md`.
HAProxy backend names are the gateway names too (`loadBalancer.ownName` and `peers[].name` in `gateway1-lb.values.yaml`): `mcpgw-ct-retired1` (own, parked),
`mcpgw-cm-pool1`, `mcpgw-cm-spare1` (parked), `mcpgw-ct-pool2`. The names are written into the HAProxy config and into the OAuth callback strip, so they may only use
letters, digits, `-` and `_`, start with a letter or digit, be at least 6 characters and unique, and keep their order when renamed (it sets the consistent-hash positions); the chart refuses anything else. Since PR
`chart/haproxy-backend-names` the strip is built from the configured names (old names go in `loadBalancer.legacyNodeNames` so logins in flight still complete; `gateway-<n>` tags are always stripped). The live cluster still runs the old
names until the owner applies the overlay (`helm upgrade --reuse-values -f gateway1-lb.values.yaml`, dry-run first); then `gateway-pingid-1/2/3` and `gateway-old-1` are gone.

## 9. Change log (add a line whenever the names, families or rules change)

| Date | Change | Why |
|---|---|---|
| 2026-11-23 | Rulebook created: grammar, full/limited/blocked trio, key rules, rename procedure, families (PRs #3686, #3687) | Tenant cleanup after the Pingid-privilege rebuild |
| 2026-11-23 | Made binding for all repos and agents (§0); drift test added; §8 gateway scheme added; full family list recorded in §5 | Owner request: one naming standard, kept current as apps change |
| 2026-11-23 | HAProxy backends take the gateway names (chart: callback strip built from the configured node names; overlay updated to `mcpgw-cm-pool1`, `mcpgw-cm-spare1`, `mcpgw-ct-pool2`, `mcpgw-ct-retired1`); not yet applied to the cluster | Gateway naming scheme decided earlier the same day; the fixed `gateway-<n>` regex was the only blocker |
| 2026-11-23 | `lab-obo-pf` (door), `lab-obo-pf-permit`, `lab-obo-pf-key`, `lab-obo-pf-key-grant` added for the PingFederate on-behalf-of lab (system `obo`, variant `pf`, a feature word); `lab-pftoken-key` rebuilt with the identity `PFtoken` as custodian; new traps (PingFederate-side audiences, River policies, write-only OBO secret) | The cleanup renamed `pftoken` and deleted `testobo`, which broke the live OBO lab; recreated under this convention |
| 2026-11-24 | Tenant changed to `5bfb4e12-8d71-4b81-8ef8-940b91728c05` ("Pingid_Privillege"); names and rules unchanged. Objects are replayed under these names during the move | Owner moved Privilege to a new console-made environment; `ea040334` is retired after the move |
| 2026-11-25 | A2A lab keys renamed on the new tenant: `main-agent` → `lab-a2a-main-key`, `worker-agent` → `lab-a2a-worker-key`; grant `MainAgentA2aMcpTools` recreated as `lab-a2a-main-key-grant`; River policies `BeniRiver-334766334b4b` and `WisconsinRiver-717544326454` repointed in place; `tag-map-key-a2a` / `tag-map-pol-a2a` regexes updated, and `lab-hitl-mfa*` folded into the HITL families (script §5). Lab `.env` (`privilege-a2a-anthropic-demo-LAB`) migrated to the fresh key values | Bring the A2A lab's keys into the naming standard (rename procedure §4) |
