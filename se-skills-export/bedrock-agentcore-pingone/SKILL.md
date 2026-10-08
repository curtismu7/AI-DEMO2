---
name: bedrock-agentcore-pingone
description: Set up, deploy, or debug an AI agent hosted in AWS Bedrock AgentCore Runtime that uses PingOne as its OAuth identity provider — covering both M2M (client_credentials) and USER_FEDERATION (3LO human login) flows. Use this whenever the user mentions Bedrock AgentCore, AgentCore Identity, AgentCore Runtime, deploying an agent to AWS, or wiring PingOne/OIDC login into an AWS-hosted agent — even if they don't use the exact term "AgentCore." Note: gotchas 22–31 cover AgentCore packaging, deploy, and runtime behavior that applies regardless of which IdP you use. This encodes hard-won, non-obvious gotchas discovered through direct debugging (not just documentation) that will otherwise cost hours to rediscover. Always consult the references/ files before writing IAM policies, agent code, or deploy scripts for this stack.
---

# Bedrock AgentCore + PingOne

**Verified against:** bedrock-agentcore SDK 1.21.0 · boto3/botocore 1.43.69 · us-east-2 · 2026-08-12
**Origin project:** Ridgeline Manufacturing agentic identity demo (internal Ping Identity)

This skill exists because a first build of exactly this integration took many
debugging rounds to get right. Almost everything below was learned from a real
failure, not from documentation alone — treat these as load-bearing constraints,
not suggestions.

**Read `references/gotchas.md` before writing any code, IAM policy, or deploy
script.** It's organized by the order you'll hit these issues. Read
`references/architecture-pattern.md` before designing the token/identity flow
for a new agent. For first-time PingOne setup, start with
`references/pingone-setup.md` — that's the ordered console checklist.

---

## The two flows this skill covers

### M2M (client_credentials)

The agent needs a PingOne-issued token scoped to a resource, using its own
client identity — no human login, no browser redirect. This is the simpler
path and a good first verification that AgentCore↔PingOne works at all.

Key points: `oauth2_flow="M2M"`, no `callback_url`, no polling, no pre-registration.
Call returns `accessToken` directly. See `references/architecture-pattern.md`
M2M section.

### USER_FEDERATION (3LO — human login)

The agent initiates a real human login through PingOne. The returned token
carries the human's `sub`. This is the harder path — more moving parts, more
gotchas, and where most debugging time is spent.

Key points: callback URL exact-match, `sessionUri` ≠ runtime session ID,
`@requires_access_token` hides `sessionUri`, pre-registration pattern required
for per-invocation user context. See `references/architecture-pattern.md`
USER_FEDERATION section.

---

## Before touching AWS: check status and permissions

1. Confirm the human setting this up has an AWS account with AgentCore access
   already provisioned — this skill can't provision AWS accounts.
2. This is a fast-moving product. Before assuming any specific API shape,
   IAM action name, or console UI element still works as documented here,
   do a live check against current AWS docs — treat everything in
   `references/gotchas.md` as "true as of when it was discovered," not an
   eternal guarantee.
3. **IAM role/user creation is always a human action**, done by the person
   with admin AWS credentials, in their own terminal/profile, never by
   pasting admin credentials into a shared session or `.env` file that an
   agent or automated process reads. Scripts can print the exact policy to
   create; the human runs it themselves.

---

## Quick-reference: the most common failures by error string

| Error / symptom | Likely cause | Gotcha |
|---|---|---|
| `authorizationCode is null` or silent auth failure after successful login | Two callback URL concepts confused | #3 |
| `401 invalid_client` on token requests | `PingOneOauth2` vendor silently using `CLIENT_SECRET_BASIC`; PingOne app requires `POST` | #4 |
| Callback returns "session not found" / lookup miss (exact wording is your own backend's — not an AgentCore message) | Pre-registration keyed on wrong value (`SESSION_ID` not `sessionUri`) | #13 |
| `AccessDeniedException: GetResourceOauth2Token` | Parent workload-identity-directory ARN missing from IAM policy | #18 |
| `ValidationException: Role validation failed` | Wrong region — shell `AWS_REGION` overriding `.env`; role only trusts correct region | #29 |
| `ValidationException: NetworkConfiguration required` on update | `networkConfiguration` must be included on every `update_agent_runtime` call | #28 |
| `PassRole` denied with otherwise-correct policy | Role name doesn't match required prefix (e.g. `AmazonBedrockAgentCore*`) | #17 |
| `list_agent_runtimes` returns 0 results / falls through to create | Wrong region (see above) or key name mismatch (`agentRuntimes` vs `agentRuntimeSummaries`) | #29, #27 |
| Session ID rejected | Session ID too short (min 33 chars) | #26 |
| `act.sub` missing or set to wrong value in downstream token | Token exchange not configured; or downstream resource's `act` attribute mapping reads the wrong source (e.g. `subjectToken.client_id` instead of `actorToken.client_id`) | not AgentCore — see downstream exchange section in `references/architecture-pattern.md` |

---

## Workflow

1. **Identity setup first.** Follow `references/pingone-setup.md` — an ordered
   checklist covering both PingOne configuration and the AgentCore credential
   provider (the two are interleaved; the checklist handles the sequencing).
2. **Decide: M2M or USER_FEDERATION?** Read the relevant section of
   `references/architecture-pattern.md`. The two flows have materially
   different mechanics; know which one you're building.
3. **Set up the AWS side**: credential provider, IAM role, S3 artifacts bucket
   if using CodeZip. Human runs privileged IAM steps; scripts handle the rest.
4. **Write agent code** per `references/architecture-pattern.md`. For
   USER_FEDERATION, use the direct `get_resource_oauth2_token()` call — not
   the `@requires_access_token` decorator — so you have access to `sessionUri`.
5. **Deploy and invoke**, then **verify by decoding real returned claims** —
   `sub`, `aud`, `scope`, and `act.sub` if applicable. This stack fails in
   ways that look like success more often than it fails loudly.

---

## When something doesn't match this skill

If live behavior contradicts something written here, that's signal the product
has changed — update the reference file with what you actually observed, citing
how you confirmed it (a decoded token, a real API response). Future-you will
hit the same wall otherwise.
