# Privilege agent attack scenarios — design

**Status:** Approved design; implementation decisions resolved
**Date:** 2026-09-23

## Problem

The LLM Gateway page offers Tool Abuse, Tool Poisoning, Schema Violation,
Inter-Agent Abuse, and Malicious Content in one attack selector. Four of those
are currently marked `effect: 'none'` because a plain user prompt is not a tool
call, tool definition, or agent message. Malicious Content is also marked
`effect: 'none'`: a ransomware-writing prompt was measured to produce no
Privilege verdict at the configured threshold. All five therefore advertise
attack classes that the current chat request cannot demonstrate as gateway
decisions.

The goal is to make all five selectable scenarios produce a truthful,
inspectable result, while preserving the distinction between model behavior,
Privilege decisions, and local validation. A scenario must never display a
synthetic Privilege verdict.

## Design principles

1. Each attack runs through the request path that carries the signal its
   detector or policy is meant to evaluate. Do not emulate tool or agent
   traffic by placing attack text in a chat prompt.
2. Show the actual enforcement point and outcome: policy/validator, allow or
   deny, whether the provider/model was reached, and whether the simulated
   tool backend was reached.
3. Keep side effects harmless and repeatable. Tools use fixtures or a
   non-mutating sandbox; no shell execution, real transfers, credential
   delegation, external exfiltration, or destructive state mutation.
4. If a configured Privilege policy does not produce a verdict, report that
   accurately. A local schema rejection or model refusal must not be presented
   as a Privilege block.
5. Keep a deterministic test mode separate from an optional live-model run.
   Live model output can vary; the run record must say which mode produced it.

## Request paths

```text
Prompt/content scenario:
  Demo UI → BFF → Privilege LLM API Gateway (virtual key) → Anthropic

Tool scenario:
  Demo UI → BFF/orchestrator → model proposes tool use
                             → Privilege MCP Gateway → fixture MCP server
                             ← decision/tool result ←
                         BFF/orchestrator → Privilege LLM Gateway → model

Inter-agent scenario:
  Demo UI → BFF → Agent A → delegated request / propagated identity
                        → configured agent/MCP authorization boundary → Agent B
```

The model-call route and MCP-call route are distinct gateway surfaces. A model
tool-use proposal does not itself prove that a downstream MCP call was
authorized, denied, or even attempted.

## Scenario behavior

| Attack | Exercise | Expected visible outcome | Enforcement attribution |
|---|---|---|---|
| Tool Abuse | Run the existing `cross-owner-account` attack simulation, which performs a non-mutating balance-read attempt through the BFF token-exchange/Authorize/resource-owner pipeline. | Show the actual authorization/resource-owner result and pipeline events; the model is not involved and no write/transfer runs. | Name the authorization/resource-owner boundary reported by the simulator; do not attribute it to Privilege unless that is the reported engine. |
| Tool Poisoning | Return a clearly marked poisoned tool description in `tools/list` (or a poisoned fixture result in a separately named variant), inducing the model to request a disallowed fixture operation. | Preserve the poisoned metadata/result in the trace; show the model proposal and downstream call decision. Make clear whether metadata was merely relayed or itself inspected. | The normal demo claim is containment at the MCP tool-call decision. Do not claim the gateway detected or removed poisoned metadata unless a real metadata verdict is available. |
| Schema Violation | Submit a tool call with invalid arguments (negative amount, invalid enum, null required field, and/or unexpected field) against a versioned fixture schema. | Show the invalid payload and the rejecting validator. Confirm the backend was not reached. Keep any gateway response and schema-validator response separately visible. | Attribute to Privilege only if Privilege itself returns a schema-related deny. Otherwise label it `MCP adapter schema validation` (or the actual validator) rather than a Privilege block. |
| Inter-Agent Abuse | Use the existing A2A wire-hop tester to probe public Agent Card discovery, then send message calls with no bearer and a forged bearer. | Show the actual HTTP results; discovery is public by design and the unauthenticated/forged requests should stop at the wire gate before the specialist runs. | Attribute only the observed status/message to the A2A wire gate; these probes do not establish downstream scope/Authorize behavior. |
| Malicious Content | On explicit user action, send a safe, non-executable phishing-awareness sample through the existing Privilege LLM call path using Anthropic. | Show a policy denial or redaction only when the response reports one, separately show whether the provider was reached, and otherwise show that no gateway decision was reported. A model refusal is not a gateway block. | Privilege LLM Gateway only when its measured response or redaction supports the claim. Never use working malware or claim coverage based on the prompt label. |

For Tool Poisoning, tool metadata poisoning and tool-output/memory poisoning
are different attack placements. The initial selector can retain one
“Tool Poisoning” entry, but the scenario detail and trace must state which
placement ran. A later split into two menu entries is appropriate only if the
two variants have distinct, verified outcomes and are useful to presenters.

## UI and run record

Keep the existing LLM Gateway chat console and transaction dashboard unchanged.
Add a distinct Attack Lab tab in the `/llm-gateway` workspace, with one entry for
each of the five requested attacks. Choosing an attack runs its appropriate
existing or purpose-built scenario runner in that tab; it must not silently
populate the ordinary chat prompt as a substitute for a tool or agent request.
The existing five prompt catalog entries can remain available as prompt-only
examples, clearly identified as prompts rather than enforcement tests.

The scenario panel and movie-reel/sequence trace should include:

- attack name and variant;
- topology/path actually exercised;
- payload or tool/agent request, with poison origin identified;
- enforcement component and the raw/normalized decision;
- model/provider reached: yes/no;
- MCP/Agent B/backend reached: yes/no;
- mode: deterministic fixture or live model;
- a concise explanation distinguishing gateway decision, local validation,
  model refusal, and no verdict.

“Not evaluated” and “allowed/no verdict” are first-class outcomes, not errors
to be cosmetically converted into blocks. Presenter copy must be generated
from the observed result, not only from the scenario's expected result.

## Acceptance criteria

1. Each of the five selector entries dispatches to the correct request path;
   none is treated as a plain prompt-only test when the attack requires tool or
   agent context.
2. Tests cover an allow and deny (where supported), exact enforcement
   attribution, provider/backend reachability, malformed/absent gateway
   verdicts, and deterministic fixture behavior.
3. A gateway pass, local validator rejection, and model refusal render as
   distinct outcomes. No UI text asserts a Privilege block without a real
   Privilege decision.
4. Fixture MCP/agent backends are side-effect-free and tests verify they are
   not invoked on denied or invalid requests.
5. Live-model variability, if supported, is disclosed and cannot make the
   deterministic test suite flaky.
6. Existing chat-only attack scenarios and their measured behavior remain
   unchanged unless explicitly migrated with equivalent regression coverage.

## Out of scope

- Faking Privilege detector events or changing tenant policy silently.
- Claiming that Privilege scans/removes tool metadata when only tool invocation
  is currently mediated.
- Live destructive tool execution, real transaction mutation, real malware,
  or real credential/identity escalation.
- Redesigning the whole LLM Gateway page or changing authentication/session
  behavior.

## Implementation decisions

1. A schema rejection by the MCP adapter is a valid demo result when labeled
   exactly as local schema validation; it must not be called a Privilege policy
   deny. If the configured Privilege gateway also returns a decision, show it
   separately.
2. Tool Poisoning's primary path uses the existing hostile MCP server's
   poisoned `tools/list` metadata and downstream tool-call mediation. Do not
   claim the gateway inspects or removes the metadata. Existing tool-output
   poisoning remains available only if it can be clearly distinguished as a
   separate variant.
3. Inter-Agent Abuse reuses the existing A2A specialist/delegation path and its
   current authorization policy; no parallel policy or synthetic agent verdict
   is introduced. The run must disclose when the required agent path is not
   configured or available.
4. A deterministic, side-effect-free run is the default and must not depend on
   a live Anthropic model. A live-model variant may be offered only where the
   existing configured runner supports it, and its output must be labeled as
   variable.

These choices preserve the truthfulness and side-effect-safety principles
above. The banking transaction dashboard is explicitly outside this change.

## Hostile MCP live-test prerequisite

The live Tool Poisoning denial depends on a manually configured Privilege
policy: the `hostile-mcp` Agentic App must deny `create_transfer` for the demo
user. The UI must not create or change this tenant policy. The signed-in browser
run is a manual acceptance check because it uses the user's PKCE session.
Before the run, the presenter must switch to the hostile door, sign in with
Privilege, and load tools. The result is conclusive only if the model actually
proposes `create_transfer` and the tool call receives a policy response.

Render these outcomes distinctly:

- Privilege denial: policy worked for the observed call.
- Allowed stub: policy did not deny the call; the hostile server's stub moves no
  money, but this is not a successful enforcement result.
- `user not found in system`: the demo identity is not synced into Privilege;
  resolve that external prerequisite before treating the policy as tested.
- No `create_transfer` proposal, no gateway log, or auth/model/service failure:
  inconclusive; do not label it a pass or deny.

Automated tests cover these UI states with fixtures. Only the user's live
browser run validates the tenant policy and identity synchronization.

## Current repository anchors

- `demo_api_ui/src/config/guardrailAttackCatalog.js` documents the prompt-only
  lane limitation and current measured outcomes.
- `demo_api_ui/src/pages/LlmGatewayPage.jsx` is the current Privilege LLM
  gateway experience.
- `demo_api_ui/src/pages/HostileMcpTab.jsx` and
  `demo_api_server/routes/privilegeMcpClient.js` contain the existing poisoned
  MCP/model loop and its trace.
- `demo_api_server/services/attackSimulatorService.js`,
  `demo_api_server/routes/demoAttackSeeds.js`, and the Agent Gateway Tester
  hold existing tool-path attack demonstrations that should be reused where
  their enforcement and fixture behavior meet this design.
