---
name: privilege-console-api
description: Automate the PingOne Privilege console REST API — full CRUD on applications, policies, tag policies, and tenant API keys without the console UI. Use whenever the task reads, creates, renames, deletes, or re-points Privilege Agentic Apps, MCP doors, PAC policies, or tags, or when anything mentions the Privilege console, procyon, imodel swagger, tenantapikeys, x-api-key/x-api-secret, auth_token cookie, local.procyon.ai:8643, or console.privilege.pingone.com. Also use when a script or doc claims the key/secret "doesn't work" — the scheme differs per host and is documented here.
---

# Privilege Console REST API

The console UI is slow and partly undrivable by automation; its REST API is not. Every
operation below was proven live (latest 2026-10-11). The swagger spec is at
`https://console.privilege.pingone.com/swagger/imodel.swagger.json` (UI:
`console.privilege.pingone.com/swagger/`) — Swagger 2.0, full CRUD, **but it declares no
securityDefinitions**, so auth is the first thing to figure out. This skill is that answer.

## Step 1 — Determine which host you are automating

Two hosts serve the same API surface. The credential scheme is **different per host** and
a credential minted on one does not work on the other (wrong audience → 401 everywhere).

| | LOCAL console | CLOUD console |
|---|---|---|
| URL | `https://local.procyon.ai:8643` | `https://console.privilege.pingone.com` |
| Cert | self-signed — use `curl -k` / `NODE_TLS_REJECT_UNAUTHORIZED=0` | normal CA |
| Auth | **key/secret headers** (see Step 2) | **browser `auth_token` cookie** (see Step 3) |
| Served by | the PingOne Privilege desktop app on this Mac | Ping cloud |

**Uptime dependency (local):** `local.procyon.ai:8643` is served by the PingOne Privilege
desktop app. If API calls fail with "fetch failed", check `lsof -nP -iTCP:8643` and
`open -a "PingOne Privilege"`. If the app is running but wedged, quit + relaunch it from
the menu bar. It is not a VPN and does not need one.

## Step 2 — Local console: get key/secret from the Privilege UI

This is the credential a user can obtain themselves, with no devtools:

1. Open the **PingOne Privilege** desktop app (or `https://local.procyon.ai:8643` in a
   browser that trusts the self-signed cert).
2. Go to **Settings → For Developers**.
3. Create/copy the **API Key** and **API Secret**. The secret is shown once — store it in
   your secret manager. Keys have an expiry (`NotAfter`) — check it before blaming auth.

Wire scheme (this is the part the public docs omit):

```bash
TENANT='<tenant-uuid>'        # shown in the console URL / settings
BASE='https://local.procyon.ai:8643'
curl -sk "$BASE/api/$TENANT/v1/applications?ObjectMeta.Namespace=default" \
  -H "x-api-key: $KEY" -H "x-api-secret: $SECRET" \
  -H "x-procyon-session-id: $(uuidgen)" -H 'accept: application/json'
```

- `Authorization: Basic <key>:<secret>` also works.
- `x-procyon-session-id` is **structurally required but its value is unvalidated** — any
  random UUID passes (omit it → 400 "Procyon required header is missing"). Treat it as a
  correlation id, not a credential.
- The **cloud** host (`console.privilege.pingone.com`, `privilege.pingone.com`) still 401s
  this key/secret pair in every probed header/cookie/HMAC shape — do not burn time
  re-probing; use the cookie route there.

## Step 3 — Cloud console: get the `auth_token` cookie from the browser

`console.privilege.pingone.com` cannot mint its own session. Sign in through PingOne:

1. Open `https://console.pingone.com/?env=<privilege-env-uuid>` (the bare
   `console.pingone.com` URL errors with "Invalid Sign-on URL"), authenticate as the Ping
   SSO admin, and launch **PingOne Privilege** from that environment.
2. In devtools: Network → any XHR to `console.privilege.pingone.com` → Request Headers →
   copy the **`auth_token` cookie** value (60-min TTL). This is the cookie to copy — the
   console stores several (e.g. `pur:` / `oauth_info`), and pasting the wrong one is a
   known time sink.

```bash
TOK='<auth_token cookie value>'
SID=$(uuidgen)
curl -s "https://console.privilege.pingone.com/api/$TENANT/v1/applications?ObjectMeta.Namespace=default" \
  -b "auth_token=$TOK" -H "x-procyon-session-id: $SID" -H 'accept: application/json'
```

**Expiry masquerades as failure:** when the token expires the console does not say so — it
renders "Gateway Unreachable — Showing Cached Data" and replays stale values, which reads
exactly like a live failure. 401 or stale data → grab a fresh cookie.

**Agent-mode (no human devtools):** run a browser agent to open the console tab, then
call the API **from inside the page** so the browser carries the cookie:
`fetch('/api/<tenant>/v1/...', {credentials:'include', headers:{'x-procyon-session-id':crypto.randomUUID()}})`.

## API surface (same on both hosts)

All paths: `/api/{tenant}/v1/...`

| Collection | Object | Notes |
|---|---|---|
| `applications` | imodelApplication | Agentic Apps + MCP doors. `Spec.McpAppConfig` (FrontEndName, Backends, MeshCluster, EntryPath, AuthMode, ResourceOAuth, AIGuardConfig, Members) for MCP apps; `Spec.HttpAppConfig` for remote agents |
| `pacpolicys` | imodelPacPolicy | Access policies; `Spec` = modelPolicyRuleSpec (`Description`, free-form `ActionMap`). One app per rule (`ObjectRef` is a plain map — arrays are a 400) |
| `tagpolicys` | tag policy | `PolicyOrigin` enum: Default\|Approver; KindMap values are STRINGS |
| `tenantapikeys` | imodelTenantAPIKeySpec | The "For Developers" key/secret (ApiKey, ApiSecret, TimeDuration, NotAfter, CntrlEP) |

Key collection URLs:
`applications?ObjectMeta.Namespace=default` (→ `{Applications:[...]}`),
`applications/default/{name}`, `pacpolicys`, `tagpolicys`.

PUT semantics: **read-modify-write the whole object** (GET it, mutate `Spec.*`, PUT it
back). `POST /session-token` on either host returns a session_id even for garbage
credentials — its 200 is **not** an auth signal.

## Hard-won gotchas

- **App names are immutable.** Rename = DELETE + recreate (name drives the frontend URL).
  Back up the full object first (GET → save to file) so you can restore it.
- **EntryPath recompute:** PUT + delete/create do NOT recompute `McpAppConfig.EntryPath`.
  To force it, PUT the app with `McpAppConfig.EntryPath: ''` and let the gateway recompute.
- **Aggregate members:** `McpAppConfig.Members.Members[].AppRef.RefID` =
  base64(`{tenant}@@@default@@@{appName}`); `Alias` = member display name. ToolFilter
  `Elems` are bare tool names (no `<alias>__` prefix), matched per member and
  **intersected with the key's policy grant** — empty Elems = all tools (there is no
  "empty means none"; for a zero-tool door filter in a non-existent tool name).
- **Tags:** apply via API PUT with `ObjectMeta.CTags: {Map:{k:v}}` — persists and shows in
  the "Tags And Labels" panel for http/Remote-Agent apps, but MCP Server apps show
  "No Procyon tags" even when set (UI bug, API state correct). The Create-Tag wizard UI is
  undrivable by synthetic clicks; the API is not. Tag policies created via API do not
  decorate existing apps.
- **AI Guard is per-KEY** (`agentaccesskeys` `Spec.AIGuardConfig`), not per-app.
- **Policy propagation:** gateway changes take ~4 min to propagate; don't re-test sooner.
- **No-policy = DENY ALL.** An ungoverned twin needs an explicit allow-all policy.
- **Session-id hygiene:** mint a fresh UUID per call; never log the key/secret or cookie.

## Related skills / docs in this repo

- `privilege-mcpgw-agent-k8s` — deploying/verifying the gateway itself on k8s.
- `privilege/PRIVILEGE-MCP.md` — the full narrative (console API recipe ~line 594).
- Bootstrap example: `privilege/scripts/bootstrap-hostile-governed.mjs`.
