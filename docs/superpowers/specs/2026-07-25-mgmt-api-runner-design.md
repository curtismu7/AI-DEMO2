# Sub-project B — PingOne Management API Runner (Inspector page)

**Date:** 2026-07-25
**Status:** design, awaiting user approval
**Sub-project of:** "Ping AI-first headless identity" demo. Piece 2 of 4
(A = agent-skills card, shipped PR #874; C = MCP-in-the-loop; D = headless auth).

## Why

Ping's AI-first headless story rests on driving identity config through APIs,
not the console. Sub-project A showed the CLI pillar. B shows the **raw
Management API** pillar: a worker-token REST playground that runs allow-listed
PingOne Management API operations live, shows the equivalent `curl`, and renders
the JSON response — including a full **create → 201 → delete** CRUD round-trip
that leaves the shared demo env unchanged.

## Scope decisions (user-approved 2026-07-25)

- **Mutations = create + auto-cleanup.** Create operations create a tagged
  resource, show the `201`, then immediately `DELETE` the exact id returned.
  A failed cleanup surfaces a loud ⚠️ with the leaked id. No lasting pollution
  of the shared demo env `01d89b06`.
- **Presentation = InspectorShell template.** Left tool tree, middle param
  form, right tabbed output. Reuses `demo_api_ui/src/components/shared/
  InspectorShell.jsx` + `InspectorTabs.jsx` + `InspectorListItem.jsx`. Follow
  the `inspector-template` skill at implementation time.
- **Operation set (as proposed):** Applications (List, Create+cleanup) · Users
  (List, Create+cleanup) · Populations (List). No update/edit ops; no resources
  beyond these.

## Architecture

```
Browser (/mgmt-api Inspector page)
  -> GET/POST /api/admin/mgmt-api/*   (authenticateToken; admin)
       -> pingOneClientService.getManagementToken()   (client_credentials, existing)
       -> managementService.initialize(workerToken)
       -> managementService.<op>()  -> PingOne Management API
```

- **Backend route** `demo_api_server/routes/mgmtApi.js`, mounted
  `app.use('/api/admin/mgmt-api', authenticateToken, mgmtApiRoutes)` in
  `server.js` (copy the pingcli mount pattern).
- **Worker token (the WORKING pattern — verified in `routes/pingoneTestRoutes.js`):**
  `const workerToken = await pingOneClientService.getManagementToken();
  managementService.initialize(workerToken);` — `getManagementToken()` mints a
  worker token via client_credentials against
  `https://auth.pingone.${region}/${envId}/as/token`. Do NOT use the no-arg
  `managementService.initialize()` — it reads `PINGONE_MANAGEMENT_API_TOKEN`,
  which is unset in this deployment and throws.
- **Management service** `services/pingoneManagementService.js` already has
  `getApplications`, `createApplication(name, description, type, grantTypes,
  redirectUris=[])`, `validateConnection`, `getHeaders()`, `handleError(err,op)`,
  and `this.baseURL = https://api.pingone.${region}/v1/environments/${env}`.
  Add: `deleteApplication(id)`, `getPopulations()`, `getUsers(limit)`,
  `createUser({populationId, username, email})`, `deleteUser(id)` — following the
  existing `axios` + `getHeaders()` + `handleError(err, op)` style, using
  `this.baseURL`.

  Note (out of scope): the existing `routes/adminManagement.js`
  (`/api/admin/management`) calls the no-arg `initialize()` and so appears to
  depend on the unset `PINGONE_MANAGEMENT_API_TOKEN` — a pre-existing issue B
  does not touch or fix.

## Backend — route contract

`GET /operations` → the allow-listed operation catalog for the tool tree:
```json
[{ "key": "apps_list", "group": "Applications", "label": "List Applications",
   "method": "GET", "path": "/environments/{env}/applications", "mutates": false,
   "params": [] },
 { "key": "apps_create", "group": "Applications", "label": "Create Application",
   "method": "POST", "path": "/environments/{env}/applications", "mutates": true,
   "cleanup": true,
   "params": [ {"name":"name","type":"text","default":"demo-mgmt-api-<ts>"},
               {"name":"type","type":"select","options":["OIDC_WEB_APP","SINGLE_PAGE_APP","WORKER"],"default":"SINGLE_PAGE_APP"} ] },
 { "key": "users_list", ... "mutates": false },
 { "key": "users_create", ... "mutates": true, "cleanup": true,
   "params": [ {"name":"email","type":"text","default":"demo-mgmt-api-<ts>@example.com"},
               {"name":"populationId","type":"select","optionsFrom":"populations_list"} ] },
 { "key": "populations_list", ... "mutates": false } ]
```

`POST /run` → `{ operationKey, params }`. Returns:
```json
{ "operation": "Create Application", "curl": "curl -X POST ... -H 'Authorization: Bearer $TOKEN' ...",
  "steps": [ {"label":"POST .../applications","status":201,"body":{...,"id":"<id>"}},
             {"label":"DELETE .../applications/<id>","status":204} ],
  "response": {…final or created body…}, "cleanedUp": true, "leakedId": null }
```
- `curl` string always redacts the token as literal `$TOKEN` (never the real
  bearer).
- For read-only ops: single step, `response` = the list JSON, `cleanedUp` n/a.
- For create ops: step 1 = create (expect 201, capture `id`); step 2 = delete
  that id (expect 204). If step 2 fails, `cleanedUp:false`, `leakedId:<id>`,
  and the response carries a ⚠️ note.
- 15s timeout per HTTP call. Non-2xx returns the PingOne error body in the step,
  not a thrown 500 (mirror the pingcli route's "show the error" behavior).

## Frontend — `/mgmt-api` Inspector page

New `demo_api_ui/src/components/MgmtApiRunnerPage.jsx` (+ `.css` if needed)
built on `InspectorShell`. Wire per the `inspector-template` skill:
- **Left (tool tree):** operations grouped by `group` (Applications / Users /
  Populations), from `GET /operations`.
- **Middle (param form):** render `params` for the selected op; a `select` with
  `optionsFrom:"populations_list"` fetches populations to fill the dropdown;
  `<ts>` in a default is replaced with a timestamp client-side.
- **Right (tabbed output):** `InspectorTabs` — **Response** (pretty JSON +
  the step log for create round-trips) and **curl** (the returned curl string).
- Routing: add the route in `App.js` (copy an existing inspector page's route,
  e.g. `McpInspectorPage`) and a nav entry (same nav file the other admin
  tools use). Admin-only, consistent with the pingcli page.

## Success criteria

- `/mgmt-api` renders the Inspector layout with the three operation groups.
- **List** ops return live JSON from env `01d89b06` (apps/users/populations).
- **Create Application** shows `POST 201` then `DELETE 204`; a follow-up
  `List Applications` shows the env is unchanged (no leaked demo app).
- **Create User** shows `POST 201` (into the chosen population) then
  `DELETE 204`; env unchanged.
- **curl** tab shows a correct, copyable curl with `Bearer $TOKEN` redacted.
- A forced cleanup failure surfaces `leakedId` + ⚠️ (not a silent success).
- Admin-only; UI build gate passes; emoji allowlist respected.

## Out of scope

- Update/PATCH/PUT operations; delete-as-a-standalone op.
- Sub-projects C (MCP-in-the-loop — note `PingOneMcpInspector.js` already
  exists) and D.
- Any change to sub-project A / the pingcli page.
- Region handling beyond what `pingoneManagementService` already does.

## Test plan

- **Backend jest** (`demo_api_server/tests/mgmtApi.route.test.js`, mock
  `pingoneManagementService` + `clientCredentialsTokenService`):
  - `GET /operations` returns the catalog with correct keys/groups/`mutates`.
  - `POST /run` read-only op calls the right service method, returns its JSON.
  - `POST /run` create op calls create then delete with the returned id;
    `cleanedUp:true`.
  - create op where delete rejects → `cleanedUp:false`, `leakedId` set.
  - `curl` string never contains a real token (only `$TOKEN`).
- **Live**: in the running stack, run each list op (real data), each create op
  (201 then 204), verify env unchanged via a follow-up list. Screenshot.
- **Regression**: pingcli page + existing inspector pages unaffected.
