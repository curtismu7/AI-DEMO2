# Privilege AI Platform Accounts: setup guide

*How to connect your AWS or Google Cloud account so the Privilege console
inventories your AI agents and MCP servers — and why you would.*

---

## Why use this at all

An AI agent that calls tools is an unmanaged identity if nobody can answer:

- **What agents exist?** Every AgentCore runtime, registered A2A agent, or MCP
  server in your clouds, discovered automatically — not a spreadsheet.
- **Who owns each one?** Custodian assignment per agent.
- **What can it reach, and how risky is it?** The crawler scores each gateway on
  a 12-check compliance card (authorizer, audience pinning, enforcement,
  WAF, network posture, …) and flags agents (`public-network`,
  `plaintext-secret`, risk severity).
- **What changed?** Re-crawls keep the inventory current — new agents appear on
  their own.

That is the Workload Scanner: you connect a **cloud account once**, and the
console's AI Platform Agents tabs (Overview, Agents, Agent Cards, MCP Servers,
Gateways / Policies) fill from it. Enforcement (policies, agent keys, HITL
approvals) then keys off that inventory.

### Which account type feeds which tab

| You want to see | Connect |
|---|---|
| **Agents** (Bedrock AgentCore runtimes) | AWS account (`AGENTCORE`) |
| **Gateways / Policies** (AgentCore gateways + 12-check scorecard) | AWS account (`AGENTCORE`) |
| **Agent Cards** (A2A discovery documents + skills) | GCP Agent Registry (`AGENT_REGISTRY`) |
| **MCP Servers** (registered MCP endpoints) | GCP Agent Registry (`AGENT_REGISTRY`) |

An AWS account can never fill Agent Cards or MCP Servers; a GCP registry
account cannot see AWS runtimes. Connect both for full coverage.

Two ways to connect: the **console UI** (Workload Agents → Add Application /
AI platform accounts — recommended) or the console REST API (for automation;
see the appendix). Placeholders you must replace are written as
`<YOUR-VALUE>`.

---

## Part 1 — AWS: Bedrock AgentCore account

Use this if your agents run as **Amazon Bedrock AgentCore** runtimes or
gateways.

### What you need

- An AWS account with AgentCore runtimes/gateways deployed
- AWS CLI signed in (`aws login` or your usual credentials flow)

### Step 1 — Create the crawler IAM role (privileged: run yourself)

The Privilege crawler assumes a role in your account. Create one that trusts
Ping's crawler principal, pinned by an external ID:

```bash
# The ExternalId is generated per tenant — copy it from the Privilege console
# when you add the account (the Add-AWS-account dialog shows/creates it).
cat > /tmp/procyon-crawler-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::208980577242:role/prod-privilege"},
    "Action": "sts:AssumeRole",
    "Condition": {"StringEquals": {"sts:ExternalId": "<YOUR-EXTERNAL-ID>"}}
  }]
}
EOF
aws iam create-role --role-name ProcyonAgentCoreFullOps \
  --assume-role-policy-document file:///tmp/procyon-crawler-trust.json
```

Attach a policy granting `bedrock-agentcore:List*` / `bedrock-agentcore:Get*`
on runtimes and gateways (add write actions only if the console should manage
gateways for you).

> **Known failure mode:** if the role trust is wrong (external-ID mismatch,
> stale principal), the crawl silently stops and the account shows
> `Status: Error — failed to assume role`. Fix the trust policy, then
> re-save the account (Step 2) — the next scan recovers.

### Step 2 — Connect the account in Privilege

Console UI: **Workload Agents → Add Application → AI platform account → AWS
AgentCore**. Paste the role ARN, enter the external ID, and select the
**regions** your agents run in.

### Step 3 — Regions: the silent filter

The crawler **only scans the regions listed** on the account. If agents run in
multiple regions and some don't appear, edit the account and add every region
(US East (N. Virginia), US East (Ohio), US West (Oregon), …). Saving the
account triggers a re-scan within about a minute.

### Step 4 — Add an MCP gateway (optional)

An **AgentCore Gateway** fronts your existing MCP servers with AWS-managed
auth and shows up under **Gateways / Policies** with its compliance scorecard.

```bash
# 1. Gateway — needs a service role that trusts bedrock-agentcore.amazonaws.com
#    with SourceArn arn:aws:bedrock-agentcore:*:<YOUR-ACCOUNT>:gateway/*
aws bedrock-agentcore-control create-gateway \
  --name '<YOUR-GATEWAY-NAME>' \
  --role-arn 'arn:aws:iam::<YOUR-ACCOUNT>:role/<YOUR-GATEWAY-ROLE>' \
  --protocol-type MCP \
  --authorizer-type AWS_IAM        # or CUSTOM_JWT for Ping-issued tokens

# 2. Target — point it at an MCP server your agents should reach.
#    For an OAuth-protected backend, create a token-vault provider first
#    (list what exists: aws bedrock-agentcore-control list-oauth2-credential-providers)
aws bedrock-agentcore-control create-gateway-target \
  --gateway-identifier <GATEWAY-ID> \
  --name '<TARGET-NAME>' \
  --target-configuration '{"mcp":{"mcpServer":{"endpoint":"https://<YOUR-MCP-SERVER>/mcp","listingMode":"DYNAMIC"}}}' \
  --credential-provider-configurations '[{"credentialProviderType":"OAUTH","credentialProvider":{"oauthCredentialProvider":{"providerArn":"<PROVIDER-ARN>","scopes":["<SCOPE>"]}}}]'
```

> **Known failure mode:** the auto-created gateway service role's trust policy
> can be pinned to a specific old stack. If the target fails with *"Gateway
> service is not authorized to assume the execution role"*, broaden the role's
> trust to `arn:aws:bedrock-agentcore:*:<YOUR-ACCOUNT>:gateway/*`, then
> **delete and recreate the target** (existing targets don't retry).
> Also: `NO_AUTH` is not a valid credential-provider type; `GATEWAY_IAM_ROLE`
> only works for AWS-internal targets — for external OAuth servers use the
> `OAUTH` provider route above.

The gateway appears under **Gateways / Policies** on the next crawl.

---

## Part 2 — GCP: Agent Registry account

Google's **Agent Registry** (`agentregistry.googleapis.com`) is a managed
catalog of A2A agents and MCP servers. Connecting it is the only way to fill
the console's **Agent Cards** and **MCP Servers** tabs. Use this if your agents
speak the A2A protocol or expose MCP endpoints.

### Step 1 — Enable the API

```bash
gcloud services enable agentregistry.googleapis.com --project <YOUR-PROJECT>
```

### Step 2 — Register your agents and MCP servers

Registry listings (`agents`, `mcpServers`) are read-only; you register things
as **Services**. Authentication is your normal `gcloud` user or a service
account.

**Register an A2A agent** (post its agent card):

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'content-type: application/json' \
  "https://agentregistry.googleapis.com/v1/projects/<YOUR-PROJECT>/locations/<LOCATION>/services?serviceId=<SERVICE-ID>" \
  -d '{
    "displayName": "my-agent",
    "description": "What this agent does",
    "agentSpec": {"type": "A2A_AGENT_CARD", "content": { …agent card JSON… }}
  }'
# Returns operations/…; poll it, then GET the service to confirm.
```

The card is validated strictly. Three fixes cover essentially every rejection
we have seen:

1. `securitySchemes.<name>` must be **flat OpenAPI shape** —
   `{type: "oauth2", flows: {...}}`, not the `{oauth2: {...}}` wrapper newer
   A2A cards sometimes emit.
2. `flows.authorizationCode` needs real `authorizationUrl`, `tokenUrl`
   (+ `refreshUrl`).
3. `url` must not duplicate an `additionalInterfaces[].url` — delete the
   redundant interface entry.

**Register an MCP server:**

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'content-type: application/json' \
  "https://agentregistry.googleapis.com/v1/projects/<YOUR-PROJECT>/locations/<LOCATION>/services?serviceId=<SERVICE-ID>" \
  -d '{
    "displayName": "my-mcp-server",
    "description": "What this MCP server provides",
    "mcpServerSpec": {"type": "NO_SPEC"},
    "interfaces": [{"url": "https://<YOUR-MCP-SERVER>/mcp",
                    "protocolBinding": "JSONRPC"}]
  }'
```

`interfaces` is **required** (the POST fails without it). `endpointSpec` and
`mcpServerSpec` are alternatives — set only one. `TOOL_SPEC` instead of
`NO_SPEC` takes a `tools/list` payload (≤10KB) so the registry also knows the
server's tools.

### Step 3 — Create the crawler service account (privileged: run yourself)

```bash
gcloud iam service-accounts create privilege-crawler \
  --display-name "Privilege Workload Scanner" --project <YOUR-PROJECT>
gcloud projects add-iam-policy-binding <YOUR-PROJECT> \
  --member "serviceAccount:privilege-crawler@<YOUR-PROJECT>.iam.gserviceaccount.com" \
  --role "roles/viewer"          # viewer covers registry list/get
gcloud iam service-accounts keys create /tmp/crawler-key.json \
  --iam-account privilege-crawler@<YOUR-PROJECT>.iam.gserviceaccount.com \
  --project <YOUR-PROJECT>
```

### Step 4 — Connect the account in Privilege

Console UI: **Workload Agents → Add Application → AI platform account →
GCP Agent Registry**. Paste the service-account key JSON, and enter the
project ID and location (e.g. `us-central1`) you registered services in.

### Step 5 — First crawl timing

> **Known limitation (observed 2026-11-19, local desktop console):** the
> AGENT_REGISTRY account type does not crawl on this build. Verified
> exhaustively: unlike AWS accounts (which rescan within ~1 min of re-save),
> a registry account produces no scan on re-save, on re-saving the
> credentials, or on delete + recreate — and no error is ever written (the
> crawler for this type is modeled in the product but not implemented in the
> desktop build). If your console shows the same silence, contact Ping
> support / check whether the **cloud console**
> (`console.privilege.pingone.com`) crawls the account type there, rather
> than debugging your own setup — everything on the Google side can be
> verified independently (Step 3's test script returns your registered
> agents and MCP servers).

After connecting, the first inventory may wait for the scheduled crawl (the
console shows a "nightly crawl" notice). If the account is still uncrawled
the next day, re-save the account through the console UI — the Add-flow's
verify step can trigger an immediate scan.

---

## Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Some agents missing | Crawl region filter (AWS) | Add all regions to the account, re-save |
| Account shows `Error: failed to assume role` | External-ID / trust mismatch | Fix the IAM trust policy, re-save the account |
| Gateway target FAILED: "not authorized to assume execution role" | Gateway role trust pinned to an old stack | Broaden trust to `gateway/*`, delete + recreate target |
| Registry POST: "invalid A2A Agent Card content" | Card schema drift | Apply the 3 card fixes in Part 2 |
| Registry POST: "at least one interface must be provided" | MCP service without `interfaces` | Add `interfaces: [{url, protocolBinding}]` |
| Agent Cards / MCP Servers tab empty | No GCP registry account, or first crawl pending | Connect the AGENT_REGISTRY account; wait for the crawl |
| Tabs show stale counts | Crawl hasn't re-run | Re-save the account to trigger a rescan |

## Appendix — Console REST API (automation)

Everything above can be done via the console API instead of the UI. Auth on
the local console (`https://local.procyon.ai:8643`) is just a session header:

```bash
T='<YOUR-TENANT-ID>'                    # from the console URL
BASE='https://local.procyon.ai:8643'
SID=$(uuidgen)                          # any UUID; value unvalidated

# List accounts + crawl status
curl -sk "$BASE/api/$T/v1/aiagentaccounts?ObjectMeta.Namespace=default" \
  -H "x-procyon-session-id: $SID"

# Create an AWS account
curl -sk -X POST "$BASE/api/$T/v1/aiagentaccounts" \
  -H "x-procyon-session-id: $SID" -H 'content-type: application/json' \
  -d '{
    "ObjectMeta": {"Kind": "AIAgentAccount", "Tenant": "'$T'",
                   "Namespace": "default", "Name": "my-aws-account"},
    "Spec": {"Type": "AGENTCORE",
      "AgentCoreSpec": {
        "RoleARN": "arn:aws:iam::<YOUR-ACCOUNT>:role/<ROLE>",
        "ExternalID": "<YOUR-EXTERNAL-ID>",
        "Regions": {"Elems": ["us-east-1"]}}}
  }'

# Create a GCP registry account
curl -sk -X POST "$BASE/api/$T/v1/aiagentaccounts" \
  -H "x-procyon-session-id: $SID" -H 'content-type: application/json' \
  -d '{
    "ObjectMeta": {"Kind": "AIAgentAccount", "Tenant": "'$T'",
                   "Namespace": "default", "Name": "my-gcp-registry"},
    "Spec": {"Type": "AGENT_REGISTRY",
      "AgentRegistrySpec": {
        "GcpJsonCreds": "<the SA key JSON, stringified>",
        "Projects": {"Elems": ["<YOUR-PROJECT>"]},
        "Locations": {"Elems": ["us-central1"]}}}
  }'
```

Status fields: `Status.Status.Status` (`Synced` / `Scanning` / `Error`),
`Status.AgentCount`, `Status.LastSyncedAt`. **Re-saving an account (GET →
modify → PUT the whole object) triggers an AWS re-scan within ~1 minute** —
useful after IAM changes. GCP registry accounts may wait for the scheduled
crawl (see Step 5 above).

## Where our demo stack stands (reference, Nov 2026)

- **AWS** account with 14 AgentCore runtimes across three regions, 3 gateways
  (one newly fronting the demo banking MCP door).
- **GCP** registry with one A2A agent (`langchainagent`) and one MCP service
  (`banking-mcp`) registered; first crawl pending.
- Separate mechanism: per-app A2A card discovery inside the Privilege gateway
  itself (`EnableAgentCard` on Remote-Agent apps) — 5 apps populated. That is
  card *storage*, not this crawler; see the Privilege console skill for it.
