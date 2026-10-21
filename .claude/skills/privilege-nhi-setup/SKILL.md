---
name: privilege-nhi-setup
description: Set up and troubleshoot non-human identities (NHI) in PingOne Privilege — agent access keys in the Agent Registry, scopes, custodians, grants (pacpolicys), per-key guardrails, workload-identity (NonHumanIdentity) federation, rotation, and the refusals you hit along the way. Use whenever someone is registering an AI agent / service / MCP caller in Privilege, gets 401/403/429 from the gateway with an agent key, asks "how do I give an agent its own identity", asks about key rotation or expiry, workload identity or external-issuer trust, or is stuck on any of the above. Use it even if they never say "NHI".
---

# Setting up NHI in PingOne Privilege

This is the record of what we built and what bit us (Oct 2026, Ping-hosted
gateway, mcpgw `v1.261009`-era). Each claim is tagged:

- **[verified]** — reproduced live against the gateway/console.
- **[swagger]** — read from the console's swagger spec only; not exercised. Treat as a lead.

When helping someone, work out which of the three layers they are stuck on before suggesting
anything: **(1) the identity** (key / workload identity), **(2) the grant** (what it may reach),
**(3) the guardrail** (what screens its traffic). Most "it doesn't work" reports are a
mismatch between layers 1 and 2, and the gateway's error text for that is deliberately thin.

## The mental model

In Privilege an NHI is an **agent access key**: one credential that *is* the agent's whole
identity. Everything hangs off it — scopes, allowed models, rate limits, budget, expiry,
guardrail, and which apps it may reach. There is no sign-in and no token exchange; the agent
sends `Authorization: Bearer <key>` on every call. [verified]

A key has a **custodian**: the human user the agent acts as. Policy is issued to the custodian,
the gateway log names the custodian, and if the custodian's account goes inactive the key stops
working. Pick someone who will stay and who should answer for the agent. [verified]

Release notes v1.9.0 add a second option: a key owned by a non-human identity instead of a
person, verified by a secretless workload identity (see "Workload identity" below). The live
tenant has 5 such `NonHumanIdentity` objects. [verified: read live 2026-10-21]

## Setup, in console order

Console: **Agent Privilege → Agent Registry → Add Agent**. Four steps.

1. **Identity & Access** — name, custodian, expiry, scopes.
   - **The name is permanent.** Pick one you can live with; rename = delete + recreate, and the
     key value changes.
   - Scopes: `llm` (models, `/llm/<provider>/v1/...`), `mcp` (`/<app>/mcp`), `a2a`
     (`/<app>/a2a/...`). Give only the scopes the agent uses — a three-scope key is one secret
     that reaches models, tools and agents.
2. **Gateway & Apps**
   - `llm`: one provider per key (two providers = two keys), allowed models, RPM, TPM, budget.
     Creating an `llm`-scoped key **requires the real upstream provider key** (`Spec.RealKey`);
     Privilege injects it server-side so the agent only ever holds the virtual key. [verified]
   - `mcp` / `a2a`: *select the specific apps*. Selecting them is the grant — saving the agent
     auto-creates a `pacpolicys` policy issued to the custodian, tied to this key. No separate
     policy to write. For MCP apps the grant can list individual tools (others are hidden and
     refused). [verified]
3. **Runtime Protection** — the per-key guardrail (see below).
4. **Review & Create** — shows the key and ready-made calling code. Copy it now; treat it as a
   secret.

Smoke test after creation (works for any scope; swap the path):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<gateway-host>/<app>/a2a/jsonrpc" \
  -H "Authorization: Bearer $AGENT_KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","messageId":"m1","parts":[{"kind":"text","text":"Hello"}]}}}'
```

New changes take **~4 minutes** to reach the gateway for app/policy edits; don't re-test sooner
and conclude it failed. (Brand-new keys were picked up immediately in our tests.) [verified]

## Reading refusals (the diagnostic table)

| What the caller sees | Cause | Fix |
|---|---|---|
| `401`, or `401 invalid virtual key` on `/llm/...` | Gateway doesn't know the key (typo, revoked, expired, deleted) | Check key exists, not `Revoked`, not past `NotAfter` |
| `403 key not scoped for mcp access` | Key lacks that scope — the **only** self-describing refusal | Add the scope |
| bare `403 Forbidden` | Either the app wasn't selected for this key, **or** the remote agent's Auth Mode can't be satisfied by a key | Read the gateway log: `policy denied` = missing grant; `requires token-pass` = auth mode |
| `403 model "x" not allowed for this key` | Model not on the allowlist | Add it (or use the right key) |
| `403 wrong_provider` | Key is for a different provider | Use the matching key |
| `429 tokens_rate_limit_exceeded` + `retry-after` | RPM/TPM/budget cap hit | Wait / raise cap. Caps are enforced natively (we saw 60×200 then 15×429 on a 75-burst) |
| `400 content_blocked` / JSON-RPC `-32600 request blocked by security policy` | Guardrail blocked the text | Working as designed; read the key's AI Guard events |
| `200` with an **empty body** | Not an auth problem: a gateway node with stale routing (see Gotchas) | Restart that gateway pod |

Always get the **gateway log** (`/var/log/procyon/cyonproxy.log` in the gateway pod; it rotates
every few hours, so grep the newest rotated file too). The bare `403` is only explained there.

**Auth Mode trap:** a remote agent set to *Pass Agent Token* refuses key callers — a key carries
no workload assertion to forward. Use *Static Token* for key callers. We hit this on the A2A
chain middle agent and fixed it by switching the door to Static Token. [verified]

## Guardrails (layer 3)

- AI Guard is **per key**, not per app (`agentaccesskeys` `Spec.AIGuardConfig`). It's the *only*
  screen on agent-to-agent calls; a signed-in person calling the same agent is not screened.
- **Defaults mostly alert, they don't block.** A jailbreak and an impersonation both reached the
  remote agent with only an alert in the log. Raise thresholds to sanitize/block deliberately.
- We rolled one external ML sidecar (`http://localhost:8086/inspect`, timeout 1000, Fail Closed
  off, Block Agreement **"Off — ML Blocks Alone"**) across all 10 keys. Block Agreement off is
  the only mode that's provable (built-ins have to agree otherwise). Check existing keys — one
  had `inspection` set from before. [verified]
- **Expired keys are edit-locked on step 1.** The wizard won't Continue until you bump the
  expiry — editing an expired key *is* renewing it. [verified]
- A console outage can silently eat a Save. Verify via the key's AI Guard tab ("1 / 1 Active").

## Lifecycle: rotation, revocation, expiry

This is where we lost the most time. Facts, all [verified] 2026-10-14:

- **There is no rotate endpoint.** `VirtualKey` is server-generated and **immutable**: a PUT
  with a new one returns 200 and ignores it. `RealKey` is never returned by GET (comes back
  as an empty string).
- A PUT of the object exactly as read returns 200 and **keeps** the stored real key.
- **Revoke is the only non-destructive kill:** PUT `Revoked: true`.
- Rotation = delete + recreate with the same name. For `llm`-scoped keys that needs the real
  provider key in hand. **Never delete one before you have it.**
- Keys have expiry (`NotAfter`) — put renewals on a calendar. We had one already expired
  (and unused) and two due to expire within weeks.
- Before rotating anything, **snapshot the full source Spec to a `chmod 600` file.** The list
  API returns *all* Spec fields (CustomUpstream, AIGuardConfig, LLMRules, WorkloadIdentity…) —
  our first snapshot printed only 14 and hid the rest.

**The incident to learn from:** a rotate script deleted an `llm`-scoped key, then tried to read
its Spec from the list it had just removed it from. The recreate failed and the key was gone for
~10 minutes. We rebuilt it from a sibling key with the same guardrail and limits, but the
original budget/RPM/TPM were unrecoverable. Order of operations: **snapshot → create a
temp-named key from the snapshot → verify it works → then do the real swap.** We proved the
recipe on temp keys first (new key: 200, guardrail copied with the Spec, gateway picked it up
immediately) before touching the real ones.

The real swap has a catch: grants follow the key's *name*, and we did not test whether two keys
can share a name at once. So either (a) keep the new name and recreate its grants, or (b)
delete the old key and immediately recreate under the original name from the snapshot, which
keeps the grants but leaves a short outage and issues a new VirtualKey. Either way, repoint
consumers, confirm the old value now gives 401, and revoke (`Revoked: true`) before you delete.

Consumers hold only the VirtualKey; policies and doors are not bound to key names — but grants
reference keys **by name**, so a delete+recreate with the *same* name keeps its grants. Find where
a key lives by sha256-prefix match against cluster secrets and `.env` files, never by printing it.

## Secrets hygiene

- The console key object returns `VirtualKey` **unredacted**, and the key is written in full to
  the gateway log on model calls and to the console audit feed whenever an agent is saved.
  Restrict who can read both.
- Never paste keys into a chat/transcript. We later had to audit our own transcripts for leaked
  `sk-` strings and rotate three keys because of it.
- Keep working copies in `chmod 600` files and delete them when done.

## Automating it (console REST API)

The API has full CRUD (`agentaccesskeys`, `pacpolicys`, `applications`, `tagpolicys`,
`nonhumanidentities`…). See the `privilege-console-api` skill for auth; the short version:

- **Local console** (`https://local.procyon.ai:8643`, served by the PingOne Privilege desktop
  app): accepts the "For Developers" key/secret headers — but a later 51-request probe showed it
  accepts *any* scheme, even none, because the desktop agent injects device identity. So don't
  take "it worked" as proof the creds are right.
- **Cloud console**: browser `auth_token` cookie only (60-min TTL). Call the API *from inside
  the page* with `credentials:'include'`; the browser is just the cookie carrier.
- `x-procyon-session-id` must be present but its value is unvalidated; any UUID works.
- **Agent-key PUT quirk:** only `/v1/agentaccesskeys/default/{name}` works (bare name, UUID,
  base64 id, collection PUT all 401). Apps work without the namespace.
- **Grants as policy objects:** agent-key→app is `ActionMap.HTTP|MCP.PolicyRule[]` with
  `Attributes.Map.agentaccesskey` = base64(`tenant@@@default@@@<keyname>`) and `ObjectRef` =
  base64(`tenant@@@default@@@<app>`). One app per rule — arrays are a 400.
- **Auto-mode safety classifiers block** writing a key's VirtualKey, patching k8s secrets/`.env`
  with keys, and creating grant policies, even when told to. Expect to hand those steps to the
  user or get explicit, specific approval.
- Object `ObjectMeta.ID` is required on app create; omitting it gives a misleading
  "cannot unmarshal string into map[string]json.RawMessage" 400.

## Sensor identity in Docker: crash-loop after a restart

A Docker-hosted sensor (a `NonHumanIdentity` whose credential is a signing key the sensor makes
itself) can loop forever with:

```text
open /etc/procyon/nodesensor-signing.pem: read-only file system
```

The key file *is* the identity: the sensor writes it on first start, and the identity in the console
pins that key's ID. Two separate failures hide behind the one symptom [verified 2026-10-01, OrbStack]:

1. **Key directory mounted read-only.** `docker inspect <sensor> --format '{{.HostConfig.Binds}}'`
   showed `/etc/procyon:/etc/procyon:ro`. The sensor must write there on start, so every start
   fails and `--restart always` keeps it looping (it can look alive in a quick `docker ps` unless
   you read the status column). Same flags with a writable mount created the key; with `:ro` it
   failed identically. Fix: recreate the container with `/etc/procyon` writable (only `/sys` and
   `/var/lib/docker/containers` stay `:ro`).
2. **A new key means a new identity.** Once it runs, reports fail `Unauthenticated` if the key
   file was lost, because the console still pins the old key ID. Fix: print the new key set with
   the sensor's `-mint-jwks` against the same directory and paste it into the identity (Paste
   Keys). Issuer, subject and audience do not change and no restart is needed.

**Why it comes back after a restart:** on OrbStack, `/etc/procyon` is a path inside the VM whose
writable layer sits on a tmpfs, so the key file lived in memory and was lost when the VM restarted.
Put the key on a **named Docker volume** (we used `procyon-nodesensor-key` mounted at
`/etc/procyon`, copying the existing key in first so the key ID does not change). The volume
survives on disk, but it is lost if someone runs `docker volume prune` while no sensor container
exists. We never tested a full restart after the move.

When someone reports "worked, then broke after Docker restarted or the laptop rebooted", do not
assume it is the same as ours: run the `docker inspect` line first. We only verified OrbStack;
Docker Desktop bind mounts may behave differently [unverified]. The sensor is usually not in
compose, so nothing in the repo shows its mounts.

## Workload identity / NHI federation (secretless)

Privilege can trust an **external token issuer** instead of a static key. Swagger re-read and
live objects read 2026-10-21 [verified: schema + live objects; token acceptance for each
issuer not re-exercised here].

**`NonHumanIdentity`** — CRUD at `/api/{tenant}/v1/nonhumanidentities` (GET list/get, POST,
PUT, DELETE). Spec: `Description`, `Enabled` ("the only kill switch"), `Federation`, `Scopes`
(`llm`/`mcp`/`a2a`, and the sensor identities also carry `shadowai:write`, `policy:read`),
`SubjectBinding`, `UserClaim` (dotted path naming the end user, default `sub`), `NotAfter`
(empty = no expiry).

**`Federation`** (an AgentWorkloadIdentity) is how the identity proves itself:

| Field | Meaning |
|---|---|
| `Issuer` | expected `iss`, exact match |
| `Audience` | required `aud`. **Mandatory** — an unbound token is replayable elsewhere |
| `Subject` / `AllowAnySubject` | pin one `sub`, or explicitly accept any (avoid unless the issuer is already tightly scoped) |
| `JwksURI` | gateway fetches and refreshes keys; preferred over pinned `JWKS` (public keys only) |
| `MaxTokenLifetimeSec` | rejects tokens whose `exp - iat` is longer (0 = gateway default 3600); needed because self-signing workloads pick their own `exp` |
| `RequiredClaims` | extra claims that must match exactly — use when `sub` is composite (GitHub Actions: repository, workflow, actor) |
| `Platform` | UI hint only (`kubernetes`, `docker`, `github_actions`, `spiffe`, `oidc`); never used for verification |

**What exists in our tenant (5 NHIs, all enabled):**

| NHI | Platform | Issuer → Subject |
|---|---|---|
| `k8s-sensor` | kubernetes | `https://kubernetes.default.svc.cluster.local` → `system:serviceaccount:<ns>:<sensor-sa>` (AllowAnySubject on) |
| `eks-sensor-a`, `eks-sensor-b` | kubernetes | EKS OIDC (`https://oidc.eks.<region>.amazonaws.com/id/<cluster-id>`) → the pod's service account |
| `docker-sensor` | docker | `https://privilege.local/nodesensor` → `nodesensor:<host>:<port>` |
| `pf-test` | oidc | PingFederate (`https://<pf-host>`) → a fixed test subject, aud = the door URL, scope `mcp`, short `NotAfter` |

Lessons from these:
- The **sensor** NHIs (shadow-AI sensor on Docker/k8s) are the production-shaped use: the
  platform's own token (a k8s service-account JWT) *is* the credential — no key to leak.
  Audiences are generated (`priv-nhi-<random>`); copy the one the console issues.
- The PF one proves the pattern for an agent: PF as issuer, audience bound to the specific
  door, short expiry, `mcp` scope only. Mint-time cost is a PF client / token-exchange, not a
  Privilege secret.
- An agent key can carry its own `WorkloadIdentity` in place of a VirtualKey, **or** name an NHI as its
  custodian and let the NHI supply the federation — never both (the API refuses). See "Wiring an agent
  NHI end to end" below: an NHI with no key behind it authenticates nobody.
- Per-rule `PolicyRule.RequiredClaims` in `pacpolicys` is the native claim gate on a *presented*
  token (all listed claims must match). It is **not Cedar**. Snapshot 2026-10-20: 0 of 28
  rules used it.
- Log lines: `mcpgw: workload token accepted for key <k> issuer=… subject=…` /
  `mcpgw: workload token rejected: <reason>`. A key caller still cannot satisfy *Pass Agent
  Token*; a presented workload assertion is what that mode forwards.
- Only PingFederate (not PingOne) can issue ID-JAG/DPoP or consume external issuers in the Ping
  stack. PingOne tokens are plain OIDC. The SPIFFE → PF leg is verified; SPIFFE straight to the
  gateway is still untested.

## Gotchas that cost us hours

- **Gateway probes lie.** `mcpgw` answers 200 RFC 9728 metadata, `401`-with-metadata and
  `201` on `/register` for *any* door path — including apps that never existed. A 401 proves
  nothing. Ground truth = gateway log lines (`Created backend node`, `Application … is deleted`)
  or the console.
- **Stale-routing gateway node:** after a pod restart one node kept auth registrations but never
  received frontend routes; authenticated calls returned **200 with an empty body**
  (`Domain <app>… not found` in the log). A load balancer pinning by client IP makes it look
  like "works from some networks, not others". A no-op PUT does not fix it; restart the pod.
- **Local console dies sometimes.** It's the PingOne Privilege desktop app, not a VPN. Check
  `lsof -nP -iTCP:8643`; `open -a "PingOne Privilege"`. It often self-recovers within ~30 min —
  don't kill the agent process.
- **Aggregate MCP doors hang** if a member keeps the `GET /mcp` SSE stream open forever: the
  aggregate waits on it. Front the member with a tiny nginx that returns 405 on GET and proxies
  the rest. [verified]
- **Aggregate ToolFilter** names are bare (no `<member>__` prefix), per member, and
  *intersected with the key's grant*. Empty = all tools; there is no "empty means none" — name a
  nonexistent tool for a zero-tool door.
- **No policy = DENY ALL.** An intentionally ungoverned twin needs an explicit allow-all policy.
- **Tags:** set `ObjectMeta.CTags` by PUT. They show in the UI only for http/Remote-Agent apps;
  MCP apps show "No Procyon tags" though the API state is right. Tag *policies* are declarative
  documentation only — they never auto-tag anything.
- **Native human-approval notifications (Slack/Mattermost) never fired** on our agentless
  tenant, across every wiring we tried. Approvals work fine from the console's
  *Access Request Approvals → HITL Requests* page; use that as the demo path. Self-approval by
  the agent was correctly refused.
- **Don't point a Kubernetes deployment at an image tag that doesn't exist yet.** We caused a
  backend outage by setting an image to a merge-commit sha CI never built. Check the registry
  manifest first.

## Wiring an agent NHI end to end (found 2026-10-21; gateway acceptance still NOT proven)

An NHI is the identity a key acts as. It does **not** authenticate callers by itself. The pieces,
and what each one told us [verified unless noted]:

1. **NHI** (`/v1/nonhumanidentities`): issuer, pinned subject, door-bound audience, scopes, expiry.
2. **Grant** (`pacpolicys`): put the NHI in `IssuedTo` as `{RefKind: NonHumanIdentity, RefID:
   base64("<tenant>@@@default@@@<name>")}` and give the rule the app and tool list. Existing policies
   use this shape for the sensor NHIs.
3. **An agent key whose `CustodianRef` is the NHI.** The gateway log for an NHI with no key says
   `non-human identity <n> updated, rebuilding 0 key(s)` — that "0" is the tell that nothing can
   authenticate as it. Creating the key, the API refused two mistakes with clear messages:
   - `Spec.WorkloadIdentity and a NonHumanIdentity Spec.CustodianRef are mutually exclusive` —
     leave the key's own `WorkloadIdentity` empty; the NHI supplies the federation.
   - `Spec.CustodianRef and Spec.UserRef name different principals` — clear `UserRef` if you
     cloned a key that has a human custodian. No `VirtualKey` or `RealKey` is needed for `mcp`-only.
   Success shows as `llmgw: upserted workload key <key> issuer=… subject=…` on every gateway node.
4. **The issuer must be able to mint the token.** On PingFederate, a plain client-credentials
   request failed twice before it worked:
   - `invalid_target … did not match any access token manager` — PF only accepts a `resource` value
     that is listed on a token manager. Our default manager issued opaque reference tokens
     (2-hour lifetime), which can never satisfy an NHI that needs a JWT, audience and lifetime cap.
   - Fix without touching shared managers: **add** a JWT token manager cloned from an existing JWT
     one (audience claim = the door URL, `resourceUris` = the door URL, short lifetime) and copy that
     manager's CLIENT_CREDENTIALS mapping to it. Token manager "Token Lifetime" is in minutes.
   Check the minted token's `iss`, `sub`, `aud` and `exp - iat` against the NHI before blaming Privilege.

**Open (a question for Ping):** with all of the above in place and the token claims matching, the
token was rejected on both the MCP door (`401 Bearer token required`) and the LLM route (`401
invalid virtual key`), and the gateway logged **no** `workload token accepted/rejected` line for
either — the check was never reached. We could not tell whether the deployed `privilege-aigw` image
evaluates workload tokens on these routes, whether the token must be presented differently, or
whether rejections log below info. Neither the container stdout nor `cyonproxy.log` records
per-request lines. Do not promise a customer that workload-token auth works on a door until this is
answered. `Pass Agent Token` (forwarding a caller's token to a remote agent) is a separate mode.

## When someone is stuck: triage order

1. What exactly does the caller see (status + body)? Map it with the refusal table.
2. Is the key alive? exists, not `Revoked`, not past `NotAfter`, custodian still active.
3. Right scope? Right provider? Model on the allowlist?
4. Is the target app *selected* on the key (that's the grant)? Did you wait ~4 minutes?
5. For A2A: what's the remote agent's Auth Mode? Key callers need Static Token.
6. Read the gateway log for `policy denied`, `requires token-pass`, `workload token rejected`. For an NHI caller, also look for `rebuilding 0 key(s)` (no key behind the NHI) and `upserted workload key`.
7. Empty-body 200s → stale gateway node, not auth.
8. Only then suspect the guardrail (check the key's AI Guard events for a block).

Related: `privilege-console-api` (REST + auth), `privilege-mcpgw-agent-k8s` (gateway deploy),
and in the repo `privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md`,
`privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md`, `privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md`.
