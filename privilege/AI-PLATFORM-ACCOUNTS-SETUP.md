# Privilege AI Platform Accounts: setup guide

*How to get your AI agents and MCP servers inventoried in the Privilege console's
Workload Scanner — and why you would.*

Verified live 2026-11-19 against the local console (`local.procyon.ai:8643`,
tenant `0428ba4f-169c-436b-aff9-b230496e0e3b`). Console API auth: just
`x-procyon-session-id` with any UUID (see
`.claude/skills/privilege-console-api/SKILL.md`).

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
- **What changed?** Nightly re-crawl keeps the inventory current — new agents
  appear on their own.

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

---

## Part 1 — AWS: Bedrock AgentCore account

### What you need

- An AWS account with AgentCore runtimes/gateways deployed (this demo: account
  `265988230536`, "cmuir-P1-privilege")
- An IAM role the crawler assumes, trusting Ping's crawler principal with an
  external ID
- The AWS CLI signed in (`aws login --profile <name>`)

### Step 1 — Create the crawler role (human-run, privileged)

```bash
# Trust policy: Ping's Privilege crawler role, pinned by external ID.
# The ExternalId value comes from the Privilege console when you add the
# account through the UI (Settings → AI platform accounts → AWS AgentCore);
# reuse the one already configured for this tenant:
cat > /tmp/procyon-crawler-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::208980577242:role/prod-privilege"},
    "Action": "sts:AssumeRole",
    "Condition": {"StringEquals": {"sts:ExternalId": "<EXTERNAL-ID>"}}
  }]
}
EOF
aws iam create-role --role-name ProcyonAgentCoreFullOps \
  --assume-role-policy-document file:///tmp/procyon-crawler-trust.json
```

Attach a policy with `bedrock-agentcore:List*`/`Get*` on runtimes and gateways
(the live role is `ProcyonAgentCoreFullOpsPolicy`; write actions are only
needed if the console will manage gateways).

**Failure mode we hit:** the crawl silently stops when `AssumeRole` fails
(e.g. external-ID mismatch after a re-enroll). The account shows
`Status: Error — failed to assume role`. Fix the trust policy, then re-PUT the
account (below) — the next scan recovers and new agents flow in.

### Step 2 — Connect the account

Console UI: **Workload Agents → Overview → Connect platform → AWS AgentCore**;
paste the role ARN and select regions. Via API instead:

```bash
T='0428ba4f-169c-436b-aff9-b230496e0e3b'
BASE='https://local.procyon.ai:8643'
SID=$(uuidgen)
curl -sk -X POST "$BASE/api/$T/v1/aiagentaccounts" \
  -H "x-procyon-session-id: $SID" -H 'content-type: application/json' \
  -d '{
    "ObjectMeta": {"Kind": "AIAgentAccount", "Tenant": "'$T'",
                   "Namespace": "default", "Name": "cmuir-P1-privilege"},
    "Spec": {"Type": "AGENTCORE",
      "AgentCoreSpec": {
        "RoleARN": "arn:aws:iam::265988230536:role/ProcyonAgentCoreFullOps",
        "ExternalID": "<EXTERNAL-ID>",
        "Regions": {"Elems": ["us-east-1"]}}}
  }'
```

### Step 3 — Regions: the silent filter

The crawler **only scans the regions listed** in `AgentCoreSpec.Regions`. Ours
had `us-east-1` and silently ignored 10 runtimes in us-east-2/us-west-2. To add
regions: GET the account, append to `Spec.AgentCoreSpec.Regions.Elems`, PUT the
whole object back. A PUT also triggers a rescan within ~1 minute (verified —
the UI tab count updates, `Status.LastSyncedAt` refreshes).

```bash
curl -sk "$BASE/api/$T/v1/aiagentaccounts/default/cmuir-P1-privilege" \
  -H "x-procyon-session-id: $SID" -o /tmp/acct.json
python3 - <<'EOF'
import json
a = json.load(open('/tmp/acct.json'))
for r in ['us-east-2', 'us-west-2']:
    if r not in a['Spec']['AgentCoreSpec']['Regions']['Elems']:
        a['Spec']['AgentCoreSpec']['Regions']['Elems'].append(r)
json.dump(a, open('/tmp/acct-new.json', 'w'))
EOF
curl -sk -X PUT "$BASE/api/$T/v1/aiagentaccounts/default/cmuir-P1-privilege" \
  -H "x-procyon-session-id: $SID" -H 'content-type: application/json' \
  --data-binary @/tmp/acct-new.json
```

Check progress: `GET …/aiagentaccounts/default/<name>` →
`Status.Status.Status` (`Synced`/`Scanning`/`Error`), `Status.AgentCount`,
`Status.LastSyncedAt`.

### Step 4 — Add an MCP gateway (optional)

An **AgentCore Gateway** fronts your existing MCP servers with AWS-managed auth
and becomes one crawlable unit. We added one in us-east-1 fronting the demo
banking gateway:

```bash
# Gateway (needs a role trusting bedrock-agentcore.amazonaws.com with
# SourceArn arn:aws:bedrock-agentcore:*:<account>:gateway/*):
aws bedrock-agentcore-control create-gateway \
  --name 'cjm-p1-demo-mcp-gw' \
  --role-arn "arn:aws:iam::<account>:role/AmazonBedrockAgentCoreGatewayDefaultServiceRole<id>" \
  --protocol-type MCP --authorizer-type AWS_IAM

# Target pointing at an existing MCP server. For an OAuth-protected backend,
# use an existing token-vault provider (listing: list-oauth2-credential-providers):
aws bedrock-agentcore-control create-gateway-target \
  --gateway-identifier <gateway-id> \
  --name 'banking-mcp-target' \
  --target-configuration '{"mcp":{"mcpServer":{"endpoint":"https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp","listingMode":"DYNAMIC"}}}' \
  --credential-provider-configurations '[{"credentialProviderType":"OAUTH","credentialProvider":{"oauthCredentialProvider":{"providerArn":"<provider-arn>","scopes":["banking-mcp"]}}}]'
```

**Gotchas we hit:** the default gateway service role's trust was pinned to an
old quick-start stack (`eu-north-1`, specific gateway ARN) — broaden it to
`arn:aws:bedrock-agentcore:*:<account>:gateway/*` or the target fails with
"Gateway service is not authorized to assume the execution role". `NO_AUTH` is
not a valid credential provider type; `GATEWAY_IAM_ROLE` needs
`{service, region}` and still failed for us — the OAUTH route with an existing
provider worked first try. Delete + recreate the target after fixing a trust
policy (existing targets don't retry).

The gateway appears under **Gateways / Policies** on the next crawl with its
12-check scorecard (ours scored 3/12, "4 risks · Medium" — fine for a demo).

---

## Part 2 — GCP: Agent Registry account

Google's **Agent Registry** (`agentregistry.googleapis.com`) is a managed
catalog of A2A agents and MCP servers. Connecting it is the only way to fill
the console's **Agent Cards** and **MCP Servers** tabs.

### Step 1 — Enable the API

```bash
gcloud services enable agentregistry.googleapis.com --project <project>
```

### Step 2 — Register your agents and MCP servers

Registry listings (`agents`, `mcpServers`) are read-only; you register things
as **Services**:

```bash
# An A2A agent: post its agent card. The card is validated strictly —
# see gotchas below before your first POST.
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'content-type: application/json' \
  "https://agentregistry.googleapis.com/v1/projects/<project>/locations/us-central1/services?serviceId=<name>" \
  -d '{
    "displayName": "my-agent",
    "description": "…",
    "agentSpec": {"type": "A2A_AGENT_CARD", "content": { …agent card JSON… }}
  }'
# Returns operations/...; poll it, then GET the service to confirm.
```

**Card-validation gotchas (each cost us a round):**

1. `securitySchemes.<name>` must be **flat OpenAPI shape** —
   `{type: "oauth2", flows: {...}}`, not the `{oauth2: {...}}` wrapper newer A2A
   cards emit.
2. `flows.authorizationCode` needs `authorizationUrl`, `tokenUrl`
   (+ `refreshUrl`) with real URLs.
3. `url` must not duplicate an `additionalInterfaces[].url` — delete the
   redundant interface entry.

**An MCP server:**

```bash
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'content-type: application/json' \
  "https://agentregistry.googleapis.com/v1/projects/<project>/locations/us-central1/services?serviceId=<name>" \
  -d '{
    "displayName": "banking-mcp",
    "description": "…",
    "mcpServerSpec": {"type": "NO_SPEC"},
    "interfaces": [{"url": "https://mcpgw.example.com/banking-mcp/mcp",
                    "protocolBinding": "JSONRPC"}]
  }'
```

`interfaces` is **required** (omit it and the POST fails with "at least one
interface must be provided"). `endpointSpec` and `mcpServerSpec` are a oneof —
set only one. `TOOL_SPEC` instead of `NO_SPEC` takes a `tools/list` payload
(≤10KB).

### Step 3 — Crawler service account (human-run, privileged)

```bash
gcloud iam service-accounts create privilege-crawler \
  --display-name "Privilege Workload Scanner" --project <project>
gcloud projects add-iam-policy-binding <project> \
  --member "serviceAccount:privilege-crawler@<project>.iam.gserviceaccount.com" \
  --role "roles/viewer"          # viewer covers registry list/get
gcloud iam service-accounts keys create /tmp/crawler-key.json \
  --iam-account privilege-crawler@<project>.iam.gserviceaccount.com \
  --project <project>
```

Test the key before wiring it in (python + `google-auth`):

```python
from google.oauth2 import service_account
import google.auth.transport.requests, json, urllib.request
creds = service_account.Credentials.from_service_account_file(
    '/tmp/crawler-key.json', scopes=['https://www.googleapis.com/auth/cloud-platform'])
creds.refresh(google.auth.transport.requests.Request())
r = urllib.request.Request(
    'https://agentregistry.googleapis.com/v1/projects/<project>/locations/us-central1/services',
    headers={'Authorization': f'Bearer {creds.token}'})
print([s['displayName'] for s in json.load(urllib.request.urlopen(r))['services']])
```

### Step 4 — Connect the account to Privilege

Console UI: **Workload Agents → Add Application / AI platform accounts →
GCP Agent Registry**; paste the key JSON, set projects + locations. Via API:

```bash
curl -sk -X POST "$BASE/api/$T/v1/aiagentaccounts" \
  -H "x-procyon-session-id: $SID" -H 'content-type: application/json' \
  -d '{
    "ObjectMeta": {"Kind": "AIAgentAccount", "Tenant": "'$T'",
                   "Namespace": "default", "Name": "gcp-agent-registry"},
    "Spec": {"Type": "AGENT_REGISTRY",
      "AgentRegistrySpec": {
        "GcpJsonCreds": "<the SA key JSON, stringified>",
        "Projects": {"Elems": ["<project>"]},
        "Locations": {"Elems": ["us-central1"]}}}
  }'
```

### Step 5 — Wait for the crawl (current caveat)

Unlike the AWS account (PUT triggers a rescan in ~1 min), the AGENT_REGISTRY
account did **not** rescan on PUT — as of 2026-11-19 its status stayed blank
for 10+ minutes after creation and we await the nightly crawl. Check
`Status.LastSyncedAt`; when it fills, `langchainagent` lands in **Agents**
(and its card in **Agent Cards**) and `banking-mcp` in **MCP Servers**.

If the account is still uncrawled the next day, recreate it through the console
UI Add-flow instead of the API — the UI's verify step may trigger the immediate
first scan that the API POST skips.

---

## Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Tabs show stale counts | Crawl region filter | Add missing regions, re-PUT |
| `Status: Error, failed to assume role` | External-ID / trust mismatch | Fix IAM trust, re-PUT account |
| Agents tab frozen, AWS account fine | Key/secret auth outage or cloud-controller issue | Check `Status.Error` first; rescan = touch + PUT |
| Gateway target FAILED "not authorized to assume execution role" | Gateway role trust pinned to old stack | Broaden trust to `gateway/*`, delete + recreate target |
| Registry POST: "invalid A2A Agent Card content" | Card schema drift | Apply the 3 card fixes above |
| Registry POST: "at least one interface must be provided" | MCP service without `interfaces` | Add `interfaces: [{url, protocolBinding}]` |
| Agent Cards / MCP Servers tab empty | No GCP registry account, or crawl pending | Connect AGENT_REGISTRY account; wait for nightly |

## What exists in this demo (reference)

- **AWS** `265988230536` "cmuir-P1-privilege": 14 AgentCore runtimes
  (us-east-1/2/west-2), 3 gateways incl. new `cjm-p1-demo-mcp-gw`
  (us-east-1) targeting the banking MCP door.
- **GCP** `privilege-workspace` "gcp-agent-registry": `langchainagent` A2A
  card + `banking-mcp` MCP service registered; crawl pending nightly.
- In-gateway A2A cards (separate mechanism, `EnableAgentCard` per Remote-Agent
  app): 5 apps populated — see `.claude/skills/privilege-console-api/SKILL.md`.
