# PingOne Authorize Setup Guide — Banking Demo

> **Who this is for:** Anyone setting up PingOne Authorize policies for this banking demo, including people new to PingOne.
>
> **How to use it:** Work through the sections in order. Every step is clearly labeled as either **automated** (script does it for you) or **manual** (you must click through the PingOne Console). Do not skip the manual steps — there is no API for them.

---

## Quick Summary: What's Automated vs. Manual

| Task | How it gets done |
|---|---|
| Create resource servers and audiences | **Automated** — `npm run pingone:bootstrap` |
| Create scopes on each resource server | **Automated** — `npm run pingone:bootstrap` |
| Create all demo apps (Admin, User, AI Agent, etc.) | **Automated** — `npm run pingone:bootstrap` |
| Assign scopes to apps (resource grants) | **Automated** — `npm run pingone:bootstrap` |
| Create demo users (demoUser, demoAdmin, demoDelegate) | **Automated** — `npm run pingone:bootstrap` |
| Write `.env` credentials | **Automated** — `npm run pingone:bootstrap` |
| Set token attribute `sub` on resource servers | **Automated** — `npm run pingone:bootstrap` (via Management API) |
| Set `may_act` token attribute on resource servers | **Automated** — `npm run pingone:bootstrap` |
| Set `is_delegate` token attribute on Demo API | **Automated** — `npm run pingone:bootstrap` |
| Add PingOne Authorize service to the environment | **Manual** — PingOne Console |
| Create Trust Framework attributes | **Manual** — PingOne Console |
| Create authorization policies and rules | **Manual** — PingOne Console |
| Set amount thresholds in policies | **Manual** — PingOne Console (or configStore for simulated mode) |
| Publish policies to a decision endpoint | **Manual** — PingOne Console |
| Set step-up advice/obligations | **Manual** — PingOne Console |

---

## Part 1 — Before You Start (Prerequisites)

### What you need

1. A PingOne account with admin access.
2. A PingOne **environment** to work in. It should be a **non-production** environment while you're learning.
3. The **PingOne Authorize service** added to that environment (see Step 1.1 below).
4. A **worker application** in PingOne with the `Identity Data Admin` role — this is what gives the bootstrap script permission to create apps and resources via the API.

> **What is a worker application?** It is a special app type in PingOne that authenticates as itself (machine-to-machine), not on behalf of a user. The bootstrap script uses one to call the PingOne Management API.

### Step 1.1 — Add PingOne Authorize to your environment (manual)

You only need to do this once per environment.

1. Log in to the PingOne admin console at `https://console.pingone.com`.
2. Select the environment you plan to use.
3. On the Overview dashboard, click **Add Services** (or **Manage Services** if services are already there).

![PingOne Console Overview — Getting Started panel with Add Services button](screenshots/01-overview-dashboard.png)

4. In the **Add a Service** dialog, scroll down to find **PingOne Authorize** and click **+ Add**.

![Add a Service dialog — PingOne Authorize option](screenshots/02-add-service-authorize-scrolled.png)

5. Click **Save**.

If you do not see PingOne Authorize in the list, contact your Ping Identity account team — it may need to be added to your license.

### Step 1.2 — Create a worker application (manual, one time)

If you already ran `npm run pingone:bootstrap` once, this app was created for you. If you are starting fresh on a new environment, do this:

1. In the PingOne Console, go to **Applications → Applications**.

![Applications list page showing all apps](screenshots/03-applications-list.png)

2. Click the **+** (Add) button at the top right of the list.
3. In the **Add Application** panel that slides in from the right, set the name to `Demo Worker Token App`.
4. Choose **Worker** as the application type.

![Add Application panel — all type options, with Worker highlighted](screenshots/04b-add-application-worker-selected.png)

5. Click **Save**, then open the app and click **Enable** (the toggle at the top right).
6. Go to the **Roles** tab of the app.

![Worker app — Roles tab with Grant Roles button](screenshots/05-worker-app-roles-tab.png)

7. Click **Grant Roles** and add the `Identity Data Admin` role for your environment.
8. Note down the **Client ID** and **Client Secret** from the **Configuration** tab — the bootstrap script will ask for these.

---

## Part 2 — Run the Bootstrap Script (Automated)

This single command provisions everything the demo needs in PingOne via the Management API. It creates resource servers, scopes, all 6 applications, 3 demo users, token attribute mappings, and writes all credentials to `demo_api_server/.env`.

```bash
cd /path/to/AI-Demo
npm run pingone:bootstrap
```

When prompted, enter:
- Your PingOne **Environment ID** (found in PingOne Console → Settings → Environment Properties)
- The **Client ID** of your worker app
- The **Client Secret** of your worker app

The script is safe to re-run — it detects what already exists and skips or patches it.

### What the script creates

| What | Detail |
|---|---|
| Resource server: Demo API | Audience `enduser.ping.demo` |
| Resource server: Demo Agent Gateway | Audience `agentgateway.ping.demo` |
| Resource server: Demo MCP Gateway | Audience `mcpgateway.ping.demo` |
| Resource server: Demo MCP Server | Audience `mcpserver.ping.demo` |
| All scopes | `read`, `write`, `transfer`, `mortgage:read`, `ai:agent:read`, `admin:*`, `users:*`, `mcp:invoke`, and more |
| Demo Admin App | Client ID written to `.env` as `PINGONE_ADMIN_CLIENT_ID` |
| Demo User App | Client ID written to `.env` as `PINGONE_USER_CLIENT_ID` |
| Demo AI Agent | Client ID written to `.env` as `PINGONE_AI_AGENT_CLIENT_ID` |
| Demo MCP Gateway app | Client ID written to `.env` as `MCP_GW_CLIENT_ID` |
| Demo Agent (worker) | Internal service account |
| Demo Worker Token App | Management API access |
| User: demoUser | Password `2Federate!` |
| User: demoAdmin | Password `2Federate!` |
| User: demoDelegate | Password `2Federate!`, `isDelegate=true` attribute |
| Token attribute `may_act` on Demo API | SpEL: `#{'sub': '<AI Agent client ID>'}` |
| Token attribute `may_act` on Demo MCP Server | SpEL: `#{'sub': '<AI Agent client ID>'}` |
| Token attribute `is_delegate` on Demo API | SpEL: `${user.isDelegate}` |

### Verify the bootstrap worked

After the script finishes, run:

```bash
cd demo_api_server
node scripts/verify-act-claims.js
node scripts/verify-scope-configuration.js --manifest-diff
```

Both should exit cleanly with no errors before you proceed to the next part.

---

## Part 2B — What the Bootstrap Does Under the Hood (API Reference)

This section shows the exact Management API calls the bootstrap script makes. You do not need to run these manually — the script does all of it. This is here so you understand what happened and can debug or recreate individual pieces if needed.

All calls below use these variables — set them in your shell first:

```bash
ENV_ID="01d89b06-66d5-430e-9f28-65636843788b"
REGION="com"
MGMT_API="https://api.pingone.${REGION}/v1/environments/${ENV_ID}"

# Get a worker token (replace <client_id> and <client_secret> with your worker app values)
WORKER_TOKEN=$(curl -s -X POST \
  "https://auth.pingone.${REGION}/${ENV_ID}/as/token" \
  -u "<worker_client_id>:<worker_client_secret>" \
  -d "grant_type=client_credentials" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
```

---

### API Step 1 — Create resource servers

One call per resource server. PingOne requires `type: CUSTOM` and `audience` as a string (not an array).

```bash
# Demo API
curl -s -X POST "${MGMT_API}/resources" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking API",
    "description": "Demo Banking API resource server",
    "type": "CUSTOM",
    "audience": "enduser.ping.demo"
  }'

# Demo Agent Gateway
curl -s -X POST "${MGMT_API}/resources" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking Agent Gateway",
    "type": "CUSTOM",
    "audience": "agentgateway.ping.demo"
  }'

# Demo MCP Gateway
curl -s -X POST "${MGMT_API}/resources" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking MCP Gateway",
    "type": "CUSTOM",
    "audience": "mcpgateway.ping.demo"
  }'

# Demo MCP Server
curl -s -X POST "${MGMT_API}/resources" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking MCP Server",
    "type": "CUSTOM",
    "audience": "mcpserver.ping.demo"
  }'
```

Save the `id` field from each response — you need it in the next step.

---

### API Step 2 — Create scopes on each resource server

Replace `<resource_id>` with the ID returned in Step 1.

```bash
RESOURCE_ID="<id from step 1>"

# Create a single scope (repeat for each scope in the list below)
curl -s -X POST "${MGMT_API}/resources/${RESOURCE_ID}/scopes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "read",
    "description": "Read banking data",
    "schema": "urn:pingone:common:scope"
  }'
```

**Scopes for Demo API (`enduser.ping.demo`):**
`read`, `write`, `transfer`, `mortgage:read`, `accounts:read`, `transactions:read`, `ai_agent`, `ai:agent:read`, `users:read`, `users:manage`, `admin:read`, `admin:write`, `admin:delete`

**Scopes for Demo Agent Gateway (`agentgateway.ping.demo`):**
`agent:invoke`, `banking:agent:invoke`

**Scopes for Demo MCP Gateway (`mcpgateway.ping.demo`):**
`read`, `write`, `transfer`, `mortgage:read`, `mcp:invoke`

**Scopes for Demo MCP Server (`mcpserver.ping.demo`):**
`read`, `write`, `mortgage:read`, `mcp:invoke`, `banking:read`, `banking:write`, `banking:mcp:invoke`, `banking:mortgage:read`, `ai:agent:read`, `banking:ai:agent:read`, `users:read`, `users:manage`, `admin:read`, `admin:write`, `admin:delete`

---

### API Step 3 — Create applications

**Important PingOne API rules for applications:**
- `grantTypes` values must be UPPERCASE: `AUTHORIZATION_CODE`, `CLIENT_CREDENTIALS`, `REFRESH_TOKEN`, `TOKEN_EXCHANGE`
- `tokenEndpointAuthMethod` must be UPPERCASE: `CLIENT_SECRET_POST` or `CLIENT_SECRET_BASIC`
- `type: WORKER` apps do NOT get `pkceEnforcement`, `responseTypes`, or `refreshToken` fields
- `type: WEB_APP` apps require `responseTypes: ["CODE"]`

```bash
# Demo User App (customer browser login)
curl -s -X POST "${MGMT_API}/applications" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking User App",
    "description": "Customer browser login",
    "enabled": true,
    "protocol": "OPENID_CONNECT",
    "type": "WEB_APP",
    "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN"],
    "tokenEndpointAuthMethod": "CLIENT_SECRET_POST",
    "pkceEnforcement": "S256_REQUIRED",
    "responseTypes": ["CODE"],
    "redirectUris": ["https://api.ping.demo:4000/api/auth/oauth/user/callback"]
  }'

# Demo Admin App (admin browser login)
curl -s -X POST "${MGMT_API}/applications" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking Admin App",
    "description": "Admin browser login",
    "enabled": true,
    "protocol": "OPENID_CONNECT",
    "type": "WEB_APP",
    "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN", "TOKEN_EXCHANGE"],
    "tokenEndpointAuthMethod": "CLIENT_SECRET_POST",
    "pkceEnforcement": "S256_REQUIRED",
    "responseTypes": ["CODE"],
    "redirectUris": ["https://api.ping.demo:4000/api/auth/oauth/callback"]
  }'

# Demo AI Agent (RFC 8693 actor — Exchange #1)
curl -s -X POST "${MGMT_API}/applications" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking AI Agent",
    "description": "AI Agent actor for RFC 8693 token exchange",
    "enabled": true,
    "protocol": "OPENID_CONNECT",
    "type": "WEB_APP",
    "grantTypes": ["AUTHORIZATION_CODE", "CLIENT_CREDENTIALS", "TOKEN_EXCHANGE"],
    "tokenEndpointAuthMethod": "CLIENT_SECRET_POST",
    "responseTypes": ["CODE"]
  }'

# Demo MCP Gateway (CC actor — Exchange #2)
curl -s -X POST "${MGMT_API}/applications" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking MCP Gateway",
    "description": "MCP Gateway client credentials actor",
    "enabled": true,
    "protocol": "OPENID_CONNECT",
    "type": "WEB_APP",
    "grantTypes": ["CLIENT_CREDENTIALS", "TOKEN_EXCHANGE"],
    "tokenEndpointAuthMethod": "CLIENT_SECRET_POST",
    "responseTypes": ["CODE"]
  }'

# Demo Worker Token App (Management API access — uses CLIENT_SECRET_BASIC)
curl -s -X POST "${MGMT_API}/applications" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Banking Worker",
    "description": "PingOne Management API worker",
    "enabled": true,
    "protocol": "OPENID_CONNECT",
    "type": "WORKER",
    "grantTypes": ["CLIENT_CREDENTIALS"],
    "tokenEndpointAuthMethod": "CLIENT_SECRET_BASIC"
  }'
```

Save the `id` from each response.

---

### API Step 4 — Grant scopes to applications

This links a resource server's scopes to an app. WORKER-type apps do not accept scope grants (they use role assignments instead).

```bash
APP_ID="<id of Demo User App>"
RESOURCE_ID="<id of Demo API resource>"

# First, look up the scope IDs for the scopes you want to grant
curl -s "${MGMT_API}/resources/${RESOURCE_ID}/scopes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}"
# Returns list of {id, name} — copy the ids you need

# Grant scopes to the app
curl -s -X POST "${MGMT_API}/applications/${APP_ID}/grants" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": { "id": "<resource_id>" },
    "scopes": [
      { "id": "<scope_id_for_read>" },
      { "id": "<scope_id_for_write>" },
      { "id": "<scope_id_for_transfer>" }
    ]
  }'
```

> **PingOne rule:** A scope name can only be granted once per app across all resource servers. If two resource servers both have a scope named `read`, you can only grant one of them to a given app.

---

### API Step 5 — Set token attributes (`may_act`, `is_delegate`, `sub`)

This is how the RFC 8693 delegation chain is configured. The `may_act` attribute tells PingOne which client is allowed to exchange a user's token.

```bash
DEMO_API_RESOURCE_ID="<id of Demo API resource>"
AI_AGENT_CLIENT_ID="d21c5124-8ac5-43d1-81f2-31a7ec649b96"

# Set may_act on Demo API — authorises Exchange #1 (user token → gateway token)
curl -s -X POST "${MGMT_API}/resources/${DEMO_API_RESOURCE_ID}/attributes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"may_act\",
    \"value\": \"#{'sub': '${AI_AGENT_CLIENT_ID}'}\",
    \"type\": \"CUSTOM\"
  }"

# Set is_delegate on Demo API — emits the user's delegation flag in the token
curl -s -X POST "${MGMT_API}/resources/${DEMO_API_RESOURCE_ID}/attributes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "is_delegate",
    "value": "${user.isDelegate}",
    "type": "CUSTOM"
  }'

MCP_SERVER_RESOURCE_ID="<id of Demo MCP Server resource>"

# Set may_act on Demo MCP Server — authorises downstream re-exchange
curl -s -X POST "${MGMT_API}/resources/${MCP_SERVER_RESOURCE_ID}/attributes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"may_act\",
    \"value\": \"#{'sub': '${AI_AGENT_CLIENT_ID}'}\",
    \"type\": \"CUSTOM\"
  }"
```

> **Critical:** `may_act` value must be the SpEL map literal `#{'sub': '...'}`. A JSON string like `{"sub":"..."}` causes double-encoding in the JWT and breaks RFC 8693.

---

### API Step 6 — Create demo users

```bash
POPULATION_ID="<default population id — get from GET /populations>"

# demoUser
curl -s -X POST "${MGMT_API}/users" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"demoUser\",
    \"email\": \"demoUser@api.ping.demo\",
    \"population\": { \"id\": \"${POPULATION_ID}\" },
    \"password\": { \"value\": \"2Federate!\", \"forceChange\": false }
  }"

# demoAdmin
curl -s -X POST "${MGMT_API}/users" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"demoAdmin\",
    \"email\": \"demoAdmin@api.ping.demo\",
    \"population\": { \"id\": \"${POPULATION_ID}\" },
    \"password\": { \"value\": \"2Federate!\", \"forceChange\": false }
  }"

# demoDelegate (isDelegate=true is a custom user schema attribute)
curl -s -X POST "${MGMT_API}/users" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"demoDelegate\",
    \"email\": \"demoDelegate@api.ping.demo\",
    \"population\": { \"id\": \"${POPULATION_ID}\" },
    \"password\": { \"value\": \"2Federate!\", \"forceChange\": false },
    \"isDelegate\": \"true\"
  }"
```

---

### API Step 7 — Verify everything was created

```bash
# List all resource servers
curl -s "${MGMT_API}/resources" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  | python3 -c "import json,sys; [print(r['name'], '-', r.get('audience','')) for r in json.load(sys.stdin)['_embedded']['resources']]"

# List all applications
curl -s "${MGMT_API}/applications?limit=20" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  | python3 -c "import json,sys; [print(a['name'], '-', a.get('type','')) for a in json.load(sys.stdin)['_embedded']['applications']]"

# List token attributes on Demo API resource (check may_act + is_delegate)
curl -s "${MGMT_API}/resources/${DEMO_API_RESOURCE_ID}/attributes" \
  -H "Authorization: Bearer ${WORKER_TOKEN}" \
  | python3 -c "import json,sys; [print(a['name'], '=', a.get('value','')) for a in json.load(sys.stdin)['_embedded']['attributes']]"
```

Or run the repo's built-in verifier (easier):

```bash
cd demo_api_server
node scripts/verify-act-claims.js
node scripts/verify-scope-configuration.js --manifest-diff
```

---

## Part 3 — Configure PingOne Authorize (Manual)

Everything in Part 2 was automated. **This part cannot be automated** — PingOne Authorize policies and Trust Framework attributes must be built through the PingOne Console UI. There is no public REST API for creating policies.

### Step 3.1 — Find the Authorize section

1. In the PingOne Console, make sure you are in the correct environment.
2. In the left sidebar, look for **Authorization** (it will only appear if you completed Step 1.1).
3. Click **Authorization** to expand it — you will see **Trust Framework**, **Policies**, **Decision Endpoints**, and more.

![Left nav with Authorization section expanded, showing Trust Framework, Policies, Decision Endpoints](screenshots/06-authorization-nav-expanded.png)

You will see two main sections: **Trust Framework** and **Policies**.

---

### Step 3.2 — Enable decision recording for debugging (manual)

Before writing any policies, turn on recent decision recording. This lets you see exactly what inputs drove each decision while you are building.

1. Go to **Authorization → Decision Endpoints**.

![Decision Endpoints page](screenshots/09-decision-endpoints.png)

2. Open the **Dev** endpoint.
3. Enable **Recent Decisions** (toggle it on).
4. Click **Save**.

> **What is a decision endpoint?** It is the URL your application calls to ask "can this user do this thing?" PingOne Authorize evaluates the policy and returns a decision (Permit, Deny, or an obligation like "require MFA"). The Dev endpoint is for testing — you will promote policies to Test and Prod endpoints later.

---

### Step 3.3 — Create Trust Framework attributes (manual)

Trust Framework attributes are the building blocks policies use to make decisions. Think of them as the input variables. You need to create the ones that your rules will reference.

**How to create an attribute:**
1. Go to **Authorization → Trust Framework**, then click the **Attributes** tab.

![Trust Framework — Attributes tab](screenshots/07b-trust-framework-attributes.png)

2. Click **Add Attribute**.
3. Fill in the name and type, then save.

**Attributes to create for this demo:**

| Attribute Name | Type | Notes |
|---|---|---|
| `amount` | Number | The transaction amount in USD |
| `transaction_type` | String | Values: `transfer`, `deposit`, `withdrawal` |
| `account_creation_date` | Date | When the account was opened |
| `is_delegate` | Boolean | Comes from the PingOne user attribute `isDelegate` |
| `act_sub` | String | The `act.sub` value from the token (actor identity in RFC 8693) |
| `acr` | String | Authentication context class — signals how strong the auth was |

> **Tip:** Only create attributes your first working policy actually needs. You can add more later. It is faster to get one rule working first, then expand.

---

### Step 3.4 — Create the first policy: transfer HITL (manual)

This policy implements the most important rule: **every transfer requires human approval** regardless of amount.

**How to create a policy:**
1. Go to **Authorization → Policies**.

![Policies page showing existing policies and Add Policy button](screenshots/08-policies.png)

2. Click **Add Policy**.
3. Name it `Transfer - Require HITL Consent`.
4. Click **Add Rule**.

**Rule 1 — Require consent for all transfers:**

| Field | Value |
|---|---|
| Rule name | `All transfers require consent` |
| Condition | `transaction_type` equals `transfer` |
| Effect | Permit |
| Obligation/Advice | Add obligation with code: `CONSENT_REQUIRED` |

5. Add a final **fallback rule** at the bottom:

| Field | Value |
|---|---|
| Rule name | `Default deny` |
| Condition | (none — matches everything) |
| Effect | Deny |

> **Why a fallback deny?** PingOne evaluates rules top to bottom and stops at the first match. Without a fallback, a transaction that does not match any rule gets a `Not Applicable` result instead of a clear decision. Always end with a fallback.

6. Click **Save**.

---

### Step 3.5 — Create the withdrawal step-up policy (manual)

This policy handles amount-based thresholds for withdrawals.

1. Add another policy named `Withdrawal - Amount Gates`.
2. Add rules in this exact top-to-bottom order (first match wins):

**Rule 1 — Hard deny above $2,000:**

| Field | Value |
|---|---|
| Rule name | `Deny large withdrawals` |
| Condition | `transaction_type` equals `withdrawal` AND `amount` greater than `2000` |
| Effect | Deny |

**Rule 2 — Step-up (MFA + consent) above $500:**

| Field | Value |
|---|---|
| Rule name | `Step-up for high-value withdrawals` |
| Condition | `transaction_type` equals `withdrawal` AND `amount` greater than or equal `500` |
| Effect | Permit |
| Obligation | Add obligation with code: `STEP_UP_REQUIRED` |
| Advice | Add advice with code: `MFA_REQUIRED` |

**Rule 3 — Consent-only above $250:**

| Field | Value |
|---|---|
| Rule name | `Consent for mid-value withdrawals` |
| Condition | `transaction_type` equals `withdrawal` AND `amount` greater than or equal `250` |
| Effect | Permit |
| Obligation | Add obligation with code: `CONSENT_REQUIRED` |

**Rule 4 — Permit below $250:**

| Field | Value |
|---|---|
| Rule name | `Permit small withdrawals` |
| Condition | `transaction_type` equals `withdrawal` |
| Effect | Permit |

**Fallback:**

| Field | Value |
|---|---|
| Rule name | `Default deny` |
| Condition | (none) |
| Effect | Deny |

---

### Step 3.6 — Create the delegate restriction policy (manual)

This policy blocks users with the `is_delegate` claim from performing write operations.

1. Add a policy named `Delegate User Restrictions`.
2. Add rules:

**Rule 1 — Block delegates from transfers:**

| Field | Value |
|---|---|
| Rule name | `Delegates cannot transfer` |
| Condition | `is_delegate` equals `true` AND `transaction_type` equals `transfer` |
| Effect | Deny |

**Rule 2 — Block delegates from payments:**

| Field | Value |
|---|---|
| Rule name | `Delegates cannot make payments` |
| Condition | `is_delegate` equals `true` AND `transaction_type` equals `payment` |
| Effect | Deny |

**Fallback:**

| Field | Value |
|---|---|
| Rule name | `Default permit` |
| Condition | (none) |
| Effect | Permit |

---

### Step 3.7 — Create the AI agent delegation policy (manual)

This policy checks that agent-driven requests carry a valid `act` claim.

1. Add a policy named `AI Agent Delegation Check`.
2. Add rules:

**Rule 1 — Block agents without act claim:**

| Field | Value |
|---|---|
| Rule name | `Require act claim for agent requests` |
| Condition | `acr` equals `ai_agent` AND `act_sub` is empty |
| Effect | Deny |

**Rule 2 — Permit agents with valid act claim:**

| Field | Value |
|---|---|
| Rule name | `Permit delegated agent` |
| Condition | `act_sub` is not empty |
| Effect | Permit |

**Fallback:**

| Field | Value |
|---|---|
| Rule name | `Default deny` |
| Condition | (none) |
| Effect | Deny |

---

### Step 3.8 — Group policies into a Policy Set (manual)

A Policy Set is a container that groups policies and applies a combining algorithm — how multiple policy decisions are combined into one final answer.

1. Go to **Authorize → Policies**.
2. Click **Add Policy Set**.
3. Name it `Banking Transaction Policy Set`.
4. Set the combining algorithm to **Deny Overrides** (if any policy says Deny, the final result is Deny).
5. Add all four policies from Steps 3.4–3.7 to this set.
6. Click **Save**.

---

### Step 3.9 — Test before publishing (manual)

Use PingOne's built-in test tool before publishing so you catch errors early.

1. Open the `Banking Transaction Policy Set`.
2. Click **Test**.
3. Run these test cases and verify the expected outcome for each:

| Input | Expected Decision | Expected Obligation |
|---|---|---|
| `transaction_type=transfer`, `amount=100` | Permit | `CONSENT_REQUIRED` |
| `transaction_type=transfer`, `amount=5000` | Permit | `CONSENT_REQUIRED` |
| `transaction_type=withdrawal`, `amount=100` | Permit | (none) |
| `transaction_type=withdrawal`, `amount=300` | Permit | `CONSENT_REQUIRED` |
| `transaction_type=withdrawal`, `amount=600` | Permit | `STEP_UP_REQUIRED` |
| `transaction_type=withdrawal`, `amount=2500` | Deny | (none) |
| `is_delegate=true`, `transaction_type=transfer` | Deny | (none) |
| `is_delegate=true`, `transaction_type=deposit` | Permit | (none) |
| `act_sub=<empty>`, `acr=ai_agent` | Deny | (none) |

4. If any test fails, go back to the relevant policy and check the rule order and conditions.

---

### Step 3.10 — Publish to the Dev endpoint (manual)

Once all tests pass:

1. Open the `Banking Transaction Policy Set`.
2. Click **Publish**.
3. Go to **Authorize → Decision Endpoints**.
4. Open the **Dev** endpoint.
5. Set the **Policy** to `Banking Transaction Policy Set` (latest version).
6. Click **Save**.

The demo application's `evaluateMcpFirstToolGate` will now call this endpoint for every MCP tool invocation.

---

## Part 4 — Verify the Full Flow

After completing Parts 1–3, verify everything works end to end.

### Step 4.1 — Start the demo stack

```bash
./run.sh
```

### Step 4.2 — Sign in and make a test call

1. Open `https://api.ping.demo:4000` in a browser.
2. Sign in as `demoUser` (password `2Federate!`).
3. Open the agent panel.
4. Ask: "Make a transfer of $300 from checking to savings."
5. A HITL consent modal should appear — the transfer policy is working.

### Step 4.3 — Check Recent Decisions

1. Go to **Authorize → Decision Endpoints → Dev**.
2. Click **Recent Decisions**.
3. You should see the decision that was just made.
4. Click on it to inspect the **Attributes** tab (what inputs came in) and the **Decision** tab (which rule fired).

### Step 4.4 — Check the Token Chain in the demo UI

1. In the demo, open the **Token Chain** panel.
2. You should see three tokens: T1 (user token), T2 (gateway token), T3 (MCP server token).
3. T1 should show `may_act.sub` set to the AI Agent client ID.
4. T2 and T3 should show `act.sub`.

If the Token Chain shows `act absent`, the `may_act` attribute on the Demo API resource server is not set correctly. Go back to Part 2 and re-run the bootstrap script.

---

## Part 5 — Promoting Policies to Production

When the demo is working correctly in Dev, follow these steps to promote policies.

1. Go to **Authorize → Policies → Banking Transaction Policy Set**.
2. Click **Publish** and add a version label such as `v1-banking-demo`.
3. Go to **Authorize → Decision Endpoints**.
4. Open the **Test** endpoint.
5. Set its policy to the `v1-banking-demo` version (not "latest" — pin to a named version in non-Dev environments).
6. Verify that the test suite from Step 3.9 still passes against the Test endpoint.
7. Repeat for the **Prod** endpoint when ready.

> **Why pin a version?** If you use "latest" in production and someone accidentally saves a broken policy draft, it will be served to real users. Named versions are immutable once published.

---

## Troubleshooting

### "Token audience mismatch — rejecting" in the logs

The `aud` claim on the user's token does not match `enduser.ping.demo`. Either the bootstrap script did not complete, or the Demo User App does not have the correct resource grant.

**Fix:**
```bash
npm run pingone:bootstrap
node scripts/verify-scope-configuration.js --manifest-diff
```

### "act absent" in the Token Chain UI

The `may_act` attribute is missing or wrong on the Demo API resource server.

**Fix:** Re-run the bootstrap, then verify:
```bash
node scripts/verify-act-claims.js
```

The `may_act` SpEL value must be exactly `#{'sub': 'd21c5124-8ac5-43d1-81f2-31a7ec649b96'}` — a map literal, not a JSON string.

### "No decision endpoint found" or policy returns nothing

The policy set has not been published to the Dev endpoint, or `ff_authorize_simulated` is still on (which bypasses PingOne Authorize and uses local rules instead).

**Check feature flags:**
1. Sign in as demoAdmin.
2. Go to `/admin` → **Feature Flags**.
3. Make sure `ff_authorize_simulated` is **off** if you want to use real PingOne Authorize.
4. Make sure it is **on** if you are using the local simulated mode (useful when PingOne Authorize is not yet configured).

### Transfers don't trigger HITL even with the policy set to Permit + CONSENT_REQUIRED

The HITL gate in the BFF is enforced locally by `transactionConsentChallenge.js` and is separate from the Authorize policy decision. Both must be satisfied. Make sure `ff_hitl_enabled` is on in Feature Flags.

### Transfer gets 403 "insufficient_scope: missing banking:transfer"

The Demo User App is missing the `transfer` scope grant. Re-run bootstrap:
```bash
npm run pingone:bootstrap
```

---

## Reference: Environment and Client IDs

| Item | Value |
|---|---|
| Environment ID | `01d89b06-66d5-430e-9f28-65636843788b` |
| Auth base | `https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b` |
| Management API base | `https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b` |
| Demo AI Agent client ID | `d21c5124-8ac5-43d1-81f2-31a7ec649b96` |
| Demo MCP Gateway client ID | `3fc5ec99-48dd-42d2-b5fd-ec34055769d2` |
| Worker Token App client ID | `15881ac7-4d83-4cbf-9ab0-4d7cda31fab8` |

*Full reference: [`docs/PINGONE_CONFIG.md`](user-guide/PINGONE_CONFIG.md) | [`docs/AUTHORIZATION_RULES.md`](AUTHORIZATION_RULES.md)*
