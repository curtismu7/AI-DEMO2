# Privilege agent attack scenarios — design

**Status:** Draft for review
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
| Tool Abuse | A controlled model response proposes a high-impact but inert fixture operation beyond the caller's allowed tools or scope. The orchestrator submits the attempted call through the configured MCP gateway. | Show proposed tool and arguments, denied decision, provider/model reached status, and `fixture backend reached: no`. Never execute the destructive text currently in the chat catalog. | Privilege MCP Gateway only when its real response denies the call. If another policy layer denies, name that layer. |
| Tool Poisoning | Return a clearly marked poisoned tool description in `tools/list` (or a poisoned fixture result in a separately named variant), inducing the model to request a disallowed fixture operation. | Preserve the poisoned metadata/result in the trace; show the model proposal and downstream call decision. Make clear whether metadata was merely relayed or itself inspected. | The normal demo claim is containment at the MCP tool-call decision. Do not claim the gateway detected or removed poisoned metadata unless a real metadata verdict is available. |
| Schema Violation | Submit a tool call with invalid arguments (negative amount, invalid enum, null required field, and/or unexpected field) against a versioned fixture schema. | Show the invalid payload and the rejecting validator. Confirm the backend was not reached. Keep any gateway response and schema-validator response separately visible. | Attribute to Privilege only if Privilege itself returns a schema-related deny. Otherwise label it `MCP adapter schema validation` (or the actual validator) rather than a Privilege block. |
| Inter-Agent Abuse | Agent A attempts a real delegated request to Agent B with an unauthorized actor, widened scope, or authority escalation. Use the existing agent/delegation path and a harmless Agent B fixture. | Show caller/delegate identity, requested versus granted authority, policy decision, and whether Agent B ran. Do not substitute a prompt asking a single model to “delegate.” | Attribute to the actual token/Authorize/agent boundary that denies it; show the underlying policy or authorization result. |
| Malicious Content | Send a safe, non-executable simulated harmful-content sample through the content inspection path. Prefer a configured policy fixture that produces an actual Privilege content verdict. | Show matched content category, actual action (block/sanitize/allow), and whether the model saw the input. If it passes, show pass/no verdict; model refusal alone is not a gateway block. | Privilege LLM Gateway only when its measured response or redaction supports the claim. Never use working malware or claim coverage based on the prompt label. |

For Tool Poisoning, tool metadata poisoning and tool-output/memory poisoning
are different attack placements. The initial selector can retain one
“Tool Poisoning” entry, but the scenario detail and trace must state which
placement ran. A later split into two menu entries is appropriate only if the
two variants have distinct, verified outcomes and are useful to presenters.

## UI and run record

The selector remains the entry point, but selection dispatches to the
appropriate scenario runner rather than always populating the plain chat box.
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

## Decisions to confirm before implementation

1. Is an accurately attributed local schema-validator rejection acceptable for
   the Schema Violation demo when Privilege itself does not return a schema
   verdict, or must all five scenarios require a Privilege verdict?
2. Should the primary Tool Poisoning variant use poisoned `tools/list`
   metadata, with tool-output poisoning retained as a separately labeled
   variant?
3. Which existing agent-to-agent authorization path and policy should be the
   Inter-Agent Abuse source of truth in this page? The implementation should
   reuse it rather than invent a parallel policy.
4. Should the audience-facing demo require a configured live Anthropic model,
   or should the deterministic fixture run be sufficient, with live mode
   optional?

These are implementation gates, not permission to weaken the truthfulness or
side-effect-safety principles above.

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
