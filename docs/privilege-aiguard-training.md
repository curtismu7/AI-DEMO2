# Privilege AIGuard training guide

Use the AIGuard deck as the product overview, then use the Attack Lab at
`/llm-gateway?tab=attacks` to show what the current demo actually observes.
The deck is a technical briefing; the lab is the evidence for the run in front
of you.

## Suggested presenter flow

1. **Frame the gateway story — slide 1, “AIGuard.”** Explain that the Privilege
   path places inspection at the gateway for model and MCP traffic. For the LLM
   call path, the app presents a virtual key and Privilege holds the provider
   credential. Keep this scoped to the configured Privilege path; other agent
   modes may call providers directly.
2. **Explain the available actions — slide 5, “Actions and policy controls.”**
   Define allow, alert, sanitize, and block, then point out that policy is
   configured per credential/application. Alert-only behavior is useful when
   discussing observation before enforcement.
3. **Show the two traffic surfaces — slide 6, “Coverage by protocol.”**
   Distinguish model request/response inspection from MCP tool-call and tool
   result inspection. In the lab, use the Path and Enforcement fields to show
   which surface a scenario actually exercised.
4. **Run the Attack Lab and narrate its observed evidence.** Read the
   enforcement component and provider/backend reachability fields aloud. A
   model refusal, local validator rejection, or authorization denial is not an
   AIGuard decision unless the result identifies Privilege as the enforcement
   component.
5. **Close on audit evidence — slide 7, “Audit record and compliance
   mapping.”** Show the actual Privilege event for the run, if the configured
   environment produced one. Avoid promising fields or payload handling based
   solely on the slide; confirm them against the current product configuration.

## Attack Lab: what each run demonstrates

| Scenario | Path to describe | Presenter guardrail |
|---|---|---|
| Tool Abuse | BFF → token exchange → Authorize/resource-owner check → balance read | This is an authorization/resource-owner result, not an LLM or AIGuard verdict. The simulator does not run a transfer. |
| Tool Poisoning | Hostile MCP metadata → model proposal → MCP tool-call boundary | Poisoned metadata may be relayed. Claim detection or removal only if a real gateway verdict says so. A live denial also requires the `hostile-mcp` policy and a synced demo identity. |
| Schema Violation | Invalid tool arguments → MCP input-schema boundary | Call it local schema rejection unless the response separately reports a Privilege decision. The invalid request must not reach transfer logic. |
| Inter-Agent Abuse | A2A discovery and message probes → specialist wire gate | Show the observed HTTP response. These probes do not by themselves prove a downstream scope or Authorize decision. |
| Malicious Content | Safe awareness sample → Privilege LLM Gateway → Anthropic | Run only on explicit action. Show a deny or redaction only when the response reports it; provider refusal or a normal answer is not a gateway block. |

Treat “no gateway decision reported” and “unknown reachability” as valid
outcomes. Do not turn them into a pass or deny for the sake of the story.

## Optional technical slides

- **Slide 2, “Detection categories and default thresholds”:** use for a policy
  configuration deep dive; explain that scores and thresholds drive the action.
- **Slide 3, “Inspection pipeline”:** use for parsing, normalization, detection,
  validation, scoring, and action details.
- **Slide 4, “Optional model-based detection”:** use when discussing the optional
  evaluator/model layer and its calibration tradeoffs.
- **Slide 8, “Defaults, limits and measured behaviour”:** use for operational
  limits and benchmark methodology, not as a performance guarantee.
- **Slide 9, “Agent traffic and roadmap”:** use when the audience asks about
  agent-to-agent calls, indirect injection or what is coming. Only calls made
  with an agent key are inspected on the A2A path, and the Q4 items are targets,
  not commitments.
- **Slide 10, “Cedar policy and approvals”:** use when the audience asks what
  decides on top of AIGuard findings: Cedar AI policies, human-in-the-loop
  approvals and scope-based access. In the verified demo the approver decides
  in the console; the notification channels on the slide are stated from
  Ping's update, not demonstrated.

## Before presenting

The deck was revised on 19 October 2026 (first issued 22 September 2026) from
the 22 September overview, the 28 September Platform Update and the 7 October
gateway update. Recheck these
items with the current Privilege tenant or product owner before quoting them:

- Detector availability, thresholds, default policy, failure posture, and which
  credentials have inspection enabled.
- The current provider virtual keys and model allowlists. In particular, verify
  the selected provider can answer before presenting a policy demonstration.
- The MCP policy for the hostile-mcp app and synchronization of the demo user
  before attempting its live tool-call denial.
- Benchmark figures, supported provider/protocol behavior, event fields, and
  payload logging claims. Slides 2–4 and 8 describe specific implementation and
  measurement details that may change between releases or configurations.

If a live result differs from the deck, narrate the observed result and update
the presenter notes before the next session.
