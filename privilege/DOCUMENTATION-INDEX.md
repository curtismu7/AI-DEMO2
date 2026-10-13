# PingOne Privilege documentation index

Every Privilege doc we own, in one place. The MD link is the source file in this
repo (public on GitHub). PDF exports of the SE guides ship through the shared
Google Drive folder; the two PDFs that live in the repo link directly below.

An in-app copy of this index is served at `/privilege-docs-index` in the demo UI
(Learning Hub → Ping AI Products → Privilege Docs Index).

## Customer deliverables

| Document | PDF | What it covers |
|---|---|---|
| [On users' personal agent design](../docs/personal-agent/On-Users-Personal-Agent-Design.md) | [In repo](../docs/personal-agent/On-Users-Personal-Agent-Design.pdf) | The personal-agent security architecture, built on an airline loyalty-program review: members bringing their own agent (ChatGPT, coding CLIs, anything MCP-capable) and the security between — the no-BFF/no-DPoP architecture, gateway-fronted tool calls with minutes-long single-audience bearer tokens, the as-built assistant, the gap analysis, and the recommended design. Top of page maps the design to Agent Privilege and links the demo surfaces and diagrams. Working draft, 2026-10-09, prepared for the customer's AI team |
| Request Header Size (HTTP 431) Guidance | [In repo](../docs/personal-agent/Request-Header-Size-431-Guidance.pdf) | Investigating and mitigating HTTP 431 "Request Header Fields Too Large" in a browser-based headless Ping SDK / DaVinci flow on a custom domain: cookie-scope and intermediary causes, five remediation options (BFF/proxy, cookie scope, credentialed-request limits, intermediary stripping, eTLD+1 domain), and the HAR-capture diagnostic sequence |

## Start here

| Document | PDF | What it covers |
|---|---|---|
| [Orientation & map](README.md) | — | One-screen orientation to the whole Privilege effort: the two deployment modes, where the code lives, what to read first |
| [Canonical investigation record](PRIVILEGE-MCP.md) | — | Architecture, protocol on every hop, every blocker and how it was ruled out, dated newest-last. The trap list at the end of each section is what saves the time |
| [Lessons learned](LESSONS-LEARNED.md) | — | Behaviors that cost real time and aren't in Ping's docs: policy union, entry-path pinning, DCR statelessness, hosted-vs-self-hosted auth. Read before authoring a policy or debugging a 403/404 |
| [Console steps](PRIVILEGE-MCP-CONSOLE-STEPS.md) | — | The console-side steps that cannot be automated or tested from the repo |
| [Agentless configuration](AGENTLESS-CONFIGURATION.md) | — | Operating the live Agentless (OAuth/PKCE) gateway in `ping-devops-cmuir`: current source of truth for OAuth, routing and image values |
| [Agent configuration](AGENT-CONFIGURATION.md) | — | ⚠️ Stale-bannered 2026-10-10: describes the removed `cm-mcpgw` deployment — kept for the console-side operating method. Current state in [Agent mode end to end](AGENT-MODE-END-TO-END.md) |
| [Current configuration index](CURRENT-CONFIGURATION.md) | — | Choosing between Agentless and Agent modes, and comparing their current values side by side |
| [Tag policies in depth](TAG-POLICIES.md) | — | What tag policies are and what they are not: name-regex → tag-set rules that do NOT auto-tag (measured), the CTags PUT that actually applies tags, per-resource quirks (namespaced agent-key PUT, MCP-app display bug), and the live `demo-map-*` set with its maintenance rule |
| [Official Ping config reference](PingOne-Privilege-MCP-Gateway-Configuration.md) | Drive (SE) | Ping's own configuration checklist (received 2026-08-12). First doc to call out K8s ingress 443→8623 and the 8690 mesh port; the repo's K8s setup was audited against it |
| [Technical summary v3](MCP%20Privilege%20Gateway%20Technical%20Summary%20v3.pdf) | [In repo](MCP%20Privilege%20Gateway%20Technical%20Summary%20v3.pdf) | Ping's own summary of the MCP gateway feature. PDF only; v1/v2 exports remain outside the repo |

## Gateway — setup & clients

| Document | PDF | What it covers |
|---|---|---|
| [Registering an MCP server](GATEWAY-REGISTERING-AN-MCP-SERVER.md) | Drive (SE) | App fields, entry path, Auth Mode, policy — and what was tested live on the Agent Privilege (2026-10-02) |
| [Sidecar MCP servers](GATEWAY-SIDECAR-MCP-SERVERS.md) | Drive (SE) | Running an MCP server as a sidecar in the Agent Privilege pod: ports, secrets, registering, verifying (tested live 2026-10-02) |
| [Connecting an MCP client](GATEWAY-CONNECTING-AN-MCP-CLIENT.md) | Drive (SE) | The app URL, discovery, self-registration, PKCE sign-in, tokens, client setup (tested live 2026-10-03) |
| [Setting up a calling agent](GATEWAY-SETTING-UP-A-CALLING-AGENT.md) | Drive (SE) | Registering an agent that calls the gateway with a key: scopes, model limits, granting remote agents and tool servers, the custodian, runtime protection, refusals (tested live 2026-10-03/04) |
| [Aggregate apps](GATEWAY-AGGREGATE-APPS.md) | Drive (SE) | Many MCP servers behind one address: the `<member>__<tool>` prefix, granting tools, the two layers of access, the errors an aggregate returns (tested live 2026-10-04) |
| [Load balancer & second gateway](GATEWAY-LOAD-BALANCER.md) | — | Two gateways as nodes of one mesh cluster: one app registration serves both, a shared token store, and the failover behavior after the fix |
| [Building an agent the gateway can front](GATEWAY-BUILDING-AN-AGENT-THE-GATEWAY-CAN-FRONT.md) | Drive (SE) | The agent's side of A2A: the card, the JSON-RPC endpoint, which credential each auth mode delivers, refusing other paths, error codes, the direct door (tested live 2026-10-03) |

## Gateway — agent-to-agent (A2A)

| Document | PDF | What it covers |
|---|---|---|
| [Agent-to-agent (A2A)](GATEWAY-AGENT-TO-AGENT-A2A.md) | Drive (SE) | A2A direct and through the Agent Privilege: agent card, Remote Agent setup, calling agents and their keys, auth modes, Static Token, AIGuard and NeMo (tested live 2026-10-03) |
| [A2A auth modes compared](GATEWAY-A2A-AUTH-MODES-COMPARED.md) | Drive (SE) | None, Static Token, User Token and Pass Agent Token on a Remote Agent: what each delivers, which one the gateway refuses, how to choose and verify (tested live 2026-10-03/04) |
| [Guardrails for A2A](GATEWAY-GUARDRAILS-FOR-A2A.md) | Drive (SE) | AIGuard on agent-to-agent calls: where it sits, the JSON-RPC block, which message parts are inspected, the `a2a_request_*` records, what is not covered (tested live 2026-10-03) |

## Gateway — AI protection

| Document | PDF | What it covers |
|---|---|---|
| [AIGuard (console walkthrough)](GATEWAY-AIGUARD.md) | — | The Add Agent wizard's Runtime Protection step: four detector groups and eleven detectors, Enable and Fail Closed, External Inspection and the ML Sidecar (console walkthrough with screenshots, 2026-10-08) |
| [ML sidecar rollout across Agent Registry](AGENT-REGISTRY-SIDECAR-ROLLOUT.md) | — | Wiring the demo sidecar into every registry key: the five-setting recipe, per-key state, the expired-key renewal catch, a2a-only keys get AIGuard too, Block Agreement `off` as the provable mode (tested live 2026-10-12) |
| [Guardrails & the external detector](GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md) | Drive (SE) | AIGuard on the model route: per-key detectors and thresholds, what a block looks like and its logs, the `/inspect` contract, Block Agreement, NeMo rails, what is and is not inspected (tested live 2026-10-03) |
| [LLM routing & virtual keys](GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) | Drive (SE) | The `/llm/<provider>/v1` route and virtual keys: key settings, order of checks, allowed models, rate limits, refusals, the `LLM request` log line (tested live 2026-10-03) |
| [LLM protection in the demo stack](../docs/privilege-llm-protection.md) | — | How LLM protection is wired into the AI-DEMO2 BFF: secrets into `ai-demo-secrets`, gateway route, what the demo shows |
| [Gateway release v1.261009](GATEWAY-RELEASE-v1.261009.md) | — | Release inventory for the 9 Oct 2026 gateway image: bedrock-mantle provider, the OpenAI-compat Bedrock deployments route, model catalog refresh, `llm_policy_response_denied`, and the imageID-vs-index-digest gotcha (static analysis, 2026-10-12) |
| [Gateway release v1.261009 — demo runbook](GATEWAY-RELEASE-v1.261009-DEMO.md) | — | Every release claim converted to a tested demo step: catalog dropdowns live, the response-side policy denial end to end (`llm_policy_response_denied` + the 400/UpstreamStatus:200 pairing), llama.cpp through `/llm/custom/v1`, mantle confirmed as a key provider, Bedrock block blocked-with-reason; AIGuard-sanitize vs policy-withhold demo switch (tested live 2026-10-12) |

## Gateway — observability

| Document | PDF | What it covers |
|---|---|---|
| [Logging with Elasticsearch](GATEWAY-LOGGING-WITH-ELASTICSEARCH.md) | Drive (SE) | What reaches Elasticsearch (console audit events only), where model calls and guardrail verdicts are recorded, shipping them, Kibana searches, the secrets both feeds contain (read live 2026-10-03) |
| [Reading gateway errors](GATEWAY-READING-GATEWAY-ERRORS.md) | Drive (SE) | What each status code can mean, the log lines behind it, tracing one request, backend and guardrail errors (reproduced live 2026-10-03) |
| [Elasticsearch & Kibana runbook](../docs/privilege-elasticsearch-kibana-runbook.md) | — | Sending Privilege SIEM events to Elasticsearch and viewing them in Kibana, using Kibana's port-forward as the endpoint |
| [Audit evidence & compliance mappings](AUDIT-EVIDENCE-COMPLIANCE.md) | — | What the gateway actually emits for the audit close: the three verdict/denial event types with their live-verified MITRE ATLAS / NIST AI RMF / OWASP LLM mappings (catalog aigw-compliance-v1.1.0, measured 2026-10-13), where to show each piece, and what remains unverified (the deck's slide-7 framework, the SIEM index's current state) |

## Sensor

| Document | PDF | What it covers |
|---|---|---|
| [Sensor on Docker (guide)](SENSOR-DOCKER-GUIDE.md) | Drive (SE) | The Privilege node sensor on any Docker host: setup, how it works, identity, logging, failure modes |
| [Sensor on Docker (our environment)](SENSOR-DOCKER-OUR-ENVIRONMENT.md) | Drive (SE) | Our Docker→local-gateway→Docker loop, our values, and the 2026-10-01 sensor failure and fix |
| [Sensor on Kubernetes (guide)](SENSOR-KUBERNETES-GUIDE.md) | Drive (SE) | The sensor on any Kubernetes cluster: Helm install, ServiceAccount-token identity, chart values |
| [Sensor on Kubernetes (our environment)](SENSOR-KUBERNETES-OUR-ENVIRONMENT.md) | Drive (SE) | Our values, how `k8s/deploy.sh` installs the sensor, open questions |
| [Sensor enforcement policies](SENSOR-ENFORCEMENT-POLICIES.md) | Drive (SE) | How a policy reaches the sensor, off/audit/enforce, what a rule contains, scope, what termination looks like, the tier, and a safe local test (tested live 2026-10-03) |

## Secrets Hub

| Document | PDF | What it covers |
|---|---|---|
| [Secrets Hub with Google Secret Manager](SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md) | Drive (SE) | Connecting GSM as a Privilege Secrets Hub: project setup, the API the form leaves out, what sync and view read, policies, and the service-account key landing in the audit log (tested live 2026-10-04) |

## Demos & environments

| Document | PDF | What it covers |
|---|---|---|
| [A2A demo & setup](A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md) | Drive (SE) | Runbook for both A2A demos through the Agent Privilege: the pre-demo check, both demo scripts with what to say, setup from scratch with our values, symptom-to-fix table and known limits |
| [Agent approvals — the demo that works today](AGENT-APPROVALS-DEMO.md) | — | HITL via native `agentapprovals`: the console-fallback demo script (ApprovalReq → HITL Requests → human decision → terminal auditable state), and the recorded Slack/Mattermost notification failure (dispatcher never fires on an agentless tenant — Ping support report on the Desktop) with the do-not-promise rule |
| [New demo environment](NEW-DEMO-ENVIRONMENT.md) | — | A separate demo environment from scratch (own PingOne env, gateway, apps, agents): parameter table, what is verified, enrolling with the right Host IP, token and CPU traps, order of steps |
| [Deploying & upgrading on Kubernetes](PRIVILEGE-K8S-DEPLOY-UPGRADE.md) | Drive (SE) | Helm install/upgrade/re-enroll/teardown of an Agentless gateway: first-install sequence, the Host-IP and token-whitespace traps, extraContainers and floating-tag upgrade rules, the PV-destruction teardown deadlock, and what is verified vs from notes (2026-10-09) |
| [Running the gateway locally (Docker)](GATEWAY-LOCAL-DOCKER.md) | Drive (SE) | The `profile: mcpgw` compose stack: start/stop, enrollment token + `pingone.env` + `/etc/hosts` + console app, the post-swap port map (settle by probing), nginx front door, verification incl. the smoke script, and the CA-wall status of the currently stopped local gateway (2026-10-09) |
| [Workload identity for agent callers](WORKLOAD-IDENTITY-AGENT-CALLERS.md) | Drive (SE) | What Pass Agent Token demands (`token-pass`), the SPIFFE→PingFederate actor-token path verified live 2026-09-26, and the documented gap: no caller has yet presented a workload token to the gateway, with the experiment that would close it (2026-10-09) |
| [Red team: a hostile A2A agent](RED-TEAM-HOSTILE-A2A.md) | Drive (SE) | The poisoned-Agent-Card attack end to end: `standalone/hostile-a2a-agent`, the deployed instance, what the gateway blocked vs alerted vs passed (measured 2026-10-03/06), the three properties of an A2A block, and what the demo does not claim (2026-10-09) |
| [Auth modes for MCP backends](AUTH-MODES-MCP-BACKENDS.md) | Drive (SE) | What each mode sends the backend (None, Static Token, User Token, Pass Agent Token, OAuth), the header pass-through + `X-Procyon-Mcp-Cap` behavior, the verified instances in this stack, the OAuth warning (breaks discovery on v1.260906), and a choosing guide (2026-10-09) |
| [SE1 shared demo](SE1-Privilege-Shared-Demo.md) | — | Setting up the shared Privilege demo in the SE1 environment |
| [Running our demo on the shared env](RUNNING-OUR-DEMO-ON-THE-SHARED-ENV.md) | — | Gap analysis for pointing our stack (UC45–47, LLM virtual keys, the MCP-client door) at the shared SE1 environment: what breaks and why, what we would add there, the 15-minute console probe for the open gateway question, and how to read each outcome (2026-10-11) |
| [Privilege Agent setup — Mac](SE1-Privilege-Agent-Setup-Mac.md) | — | Agent-based persona onboarding for the shared Demo Engineering environment, run on your own Mac instead of Windows 11 VMs |
| [Demo script & setup](demo/privilege-demo-script.md) | — | The customer-facing demo script and setup (auto-generated from the use-case docs — do not hand-edit) |
| [Agent features master index](../docs/privilege-agent-features.md) | — | The ten agent-facing Privilege features in demo arc order, each with a description and links to the detailed docs; names the three coverage gaps (rug-pull matrix, agentapprovals doc, compliance mapping) |
| [Privilege Agent Field Guide](../docs/privilege-agent-field-guide.html) | — | Trainer's page: the top 10 agent features in demo arc order (identity → policy → LLM → MCP → HITL → proof), each with what/show/say presenter rows, the model-allowlist verified table, and the pre-session caveats (Google lane misconfigured, Slack/Teams approvals unverified). Standalone HTML, grounded in `docs/privilege-llm-protection.md` and `docs/privilege-aiguard-training.md` |
| [CIMD client documents](../docs/2026-10-07-cimd-privilege-client-documents.md) | Drive (SE) | CIMD (client metadata documents) for PingOne Privilege — flow, boundary, and client documents, with diagrams |
| [MCP discovery-gating demo](MCP-DISCOVERY-DEMO.md) | Drive (SE) | SE demo script: an agent's `tools/list` returns only what its policy grants — permit door, deny-by-default door, grant change, agent key, aggregate; pre-demo check and troubleshooting (every claim measured 2026-10-02…04) |
| [Hostile MCP side-by-side](HOSTILE-MCP-SIDE-BY-SIDE.md) | — | Governed vs ungoverned twin hostile-MCP servers: the measured ALLOW/DENY matrix (verified live 2026-10-11, v1.261009), the permit-selection policy model, no-policy = DENY ALL, the RefID triple-@@ trap, owner reaping, the 4-min propagation, and what NOT to claim (metadata sanitizer, rug-pull detection) |
| [Ping's reference demo, explained](PINGS-REFERENCE-DEMO-EXPLAINED.md) | Drive (SE) | The two-agent demo (`aigwdemo`) from the source up: three processes, the six legs and which cross the gateway, the four ADK traps the demo solves (A2A bearer, card object, `transportOptions`, `GatewayGemini`), the seeded findings, the UI's eight detector groups, and the runbook condensed (source-verified 2026-10-09, not yet run) |
| [Policies in depth](PRIVILEGE-POLICIES-IN-DEPTH.md) | Drive (SE) | What tool policies do when there is more than one: the union model (create adds, expiry silently subtracts, delete subtracts identically, edit-down does nothing), discovery-gating and why the client never sees "denied", the four indistinguishable 403s, groups (documented, not reproduced), per-app scope, and when a "policy problem" isn't one — every step measured live 2026-10-10 |
| [Agent mode end to end](AGENT-MODE-END-TO-END.md) | Drive (SE) | The Privilege Agent on a Mac, measured: device-bound identity in the Secure Enclave, pairing and re-pairing order, the local console, the cloud frontend's 403 gate — and the reframe: the agent is an identity anchor, not an MCP transport (cm-mcpgw is gone; MCP runs through the agentless gateways). Stale-agent-doc corrections included; paired live 2026-10-10 |

## Reference & records

| Document | PDF | What it covers |
|---|---|---|
| [OpenAPI MCP on Kubernetes](OPENAPI-KUBERNETES-WORKING-PATTERN-2026-10-01.md) | [In repo](OPENAPI-KUBERNETES-WORKING-PATTERN-2026-10-01.pdf) | Working patterns for OpenAPI-based MCP on Kubernetes and the remaining gap (2026-10-01, updated 2026-10-03) |
| [Fix Privilege MCP guide — status](../docs/privilege-mcp-guide-status.md) | — | Status split from the raw punch list of the ai-demo.ping-devops.com guide fix; original numbering kept for traceability |
| [Status snapshot 2026-08-02](PRIVILEGE-MCP-STATUS-2026-08-02.md) | — | Point-in-time snapshot, superseded by the canonical record. Kept as historical evidence only |
| Ping decks & exports | Drive (SE) | Ping-provided decks and older exports: Privilege-AIGuard, Privilege-AI-Gateway, Privilege+Shared Demo, Instructional Demo Setup (Confluence export + SE1), Technical Summary v1/v2 |
| SE enablement storyboards | — | Ping's SE storyboards (HTML, ~13 MB of embedded images, not committed): architecture, flows, troubleshooting order. The older deck's EvaluateHost routing model is disproven on build v1.260726 |

## Assets in the repo

`privilege/design/` gateway + tools-table design specs ·
`privilege/diagrams/` the Agentic Trust Control Plane slide (Agent Privilege = discover & register, steps 2–5 IAM Core / AI Gateway / Agent Authorize / Agent Governance) + four rendered flows (SVG/PNG) + mermaid source ·
`privilege/postman/` Gateway, Gateway-SE, Simple, Debug, Client-Docker/K8s collections ·
`privilege/runbooks/` ping-mcpgw, renew-token, mcpgw-nginx ·
`.claude/skills/privilege-*` condensed operator skills (the docs win on disagreement).

## Planned

| Guide | What it covers | Testable now? |
|---|---|---|

Nothing queued — new guides land here first, then get tested before they move up.
