// PrivilegeFirstGatewayPage.jsx — target architecture from
// docs/superpowers/plans/2026-09-08-privilege-first-gateway.md: the PingOne
// Agent Privilege as the first hop for LLM and MCP traffic, the Agent
// Gateway behind it, and the identity fork the plan stops at. Both figures are
// React Flow graphs (StaticFlowDiagram) so they pan, zoom and step.
import React from "react";
import DiagramStepBar from "./DiagramStepBar";
import StaticFlowDiagram from "./StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import {
  GROUPS,
  GATEWAY_NODES,
  GATEWAY_EDGES,
  GATEWAY_STEPS,
  FORK_NODES,
  FORK_EDGES,
  FORK_STEPS,
} from "../config/privilegeFirstGatewayDiagram";
import "./PrivilegeFirstGatewayPage.css";
import PageHeader from './common/PageHeader';

const GATEWAY_CAPTIONS = edgeCaptions(GATEWAY_EDGES, Object.fromEntries(GATEWAY_NODES.map((n) => [n.id, n.label])));
const FORK_CAPTIONS = edgeCaptions(FORK_EDGES, Object.fromEntries(FORK_NODES.map((n) => [n.id, n.label])));

const FLAGS = [
  {
    code: ["ff_privilege_llm_first"],
    text: "BFF chat: google → privilege_llm, anthropic → privilege_claude. Default off. Works locally and on SE.",
  },
  {
    code: ["AGENT_LLM_BASE_URL", "AGENT_LLM_API_KEY"],
    text: "Sidecar agents and LibreChat enter the Privilege OpenAI lane by env alone. No agent code changes.",
  },
  {
    code: ["ff_mcp_gateway_privilege_first"],
    text: "BFF MCP chokepoint routes to /agent-gateway/mcp on Privilege, checked before the PingOne Agent Gateway flag so the two compose. Default off. SE only.",
  },
];

export default function PrivilegeFirstGatewayPage() {
  const stepper = useDiagramStepper(GATEWAY_EDGES.length);
  const forkStepper = useDiagramStepper(FORK_EDGES.length);
  return (
    <main className="pfg-page">
      <PageHeader className="pfg-hero" eyebrow="AI-DEMO2 · plan 2026-09-08" title="Privilege first, Agent Gateway for the rest" summary={<>Every LLM call and every MCP tool call enters the PingOne Agent Privilege before anything else.
          Privilege owns the credentials and the human-governed policy. The Agent Gateway behind it keeps doing the
          delegated, per-tool authorization it does today. Agent-to-agent calls take the same front door: each agent
          is a Remote Agent app on the gateway and is called with the caller&apos;s own agent key (see the
          Agent-to-agent tab on <a href="/privilege-gateway-topologies">Privilege Gateway Topologies</a>).</>} />

      <DiagramStepBar stepper={stepper} caption={GATEWAY_CAPTIONS[stepper.step]} />

      <figure className="pfg-figure">
        <StaticFlowDiagram
          NODES={GATEWAY_NODES}
          EDGES={GATEWAY_EDGES}
          GROUPS={GROUPS}
          stepper={stepper}
          pingStyle
          steps={GATEWAY_STEPS}
          testId="pfg-gateway-diagram"
          height={600}
          ariaLabel="Target architecture: callers on the left enter the Agent Privilege, whose LLM lane goes to cloud providers with a virtual key and whose MCP lane goes to the Agent Gateway, which then reaches the MCP servers. Local models on port 8090 stay outside Privilege."
        />
        <div className="pfg-legend">
          <span><i className="pfg-sw" style={{ borderTopColor: GROUPS.priv.bg }} />Ping product: Privilege and the Agent Gateway</span>
          <span><i className="pfg-sw" style={{ borderTopColor: GROUPS.caller.bg }} />callers, agents and servers</span>
          <span><i className="pfg-sw" style={{ borderTopColor: GROUPS.ghost.bg }} />unchanged today, stays outside Privilege</span>
          <span><i className="pfg-sw pfg-sw--dashed" />dashed blue: the hop the Phase 0 spike must measure, and the local-model path</span>
        </div>
        <figcaption>
          <strong>What moves.</strong> Today the BFF's chat goes vendor-direct and its tool calls go straight to the
          Agent Gateway; Privilege only serves the browser doors and two opt-in picker modes. In the target, the
          Privilege LLM lane becomes the default cloud path and the Agent Gateway becomes Privilege's registered
          backend, so the two gates compose instead of sitting side by side. SE cluster only for the MCP lane: the
          Privilege gateway pod must reach ping-gateway.ping-devops-cmuir.svc.cluster.local. The LLM lane already
          works from local Docker.
        </figcaption>
      </figure>

      <figure className="pfg-figure">
        <DiagramStepBar stepper={forkStepper} caption={FORK_CAPTIONS[forkStepper.step]} testId="pfg-fork-step-bar" />
        <StaticFlowDiagram
          NODES={FORK_NODES}
          EDGES={FORK_EDGES}
          GROUPS={GROUPS}
          stepper={forkStepper}
          pingStyle
          steps={FORK_STEPS}
          testId="pfg-fork-diagram"
          height={260}
          ariaLabel="The identity fork on the Privilege to Agent Gateway hop. Outcome A: Privilege forwards a static bridge secret as the bearer plus the caller's token in the tx-token header, so the Agent Gateway swaps the user token in and runs introspection, exchange and authorization on the real user. Outcome B: only the bridge secret arrives, so there is no user and the Agent Gateway refuses tool calls."
        />
        <figcaption>
          <strong>The fork the plan stops at — settled 2026-09-10 as Outcome A.</strong> A live probe (throwaway
          Agentic App on Auth Mode None, pointed at a disposable header-logging backend) confirmed it: custom
          request headers reach the backend unchanged, so a header carrying the caller's exchanged token — such
          as tx-token — survives this hop too, letting delegated user identity reach the Agent Gateway
          instead of collapsing to a machine subject. Auth Mode None itself forwards no Authorization header at
          all; a backend that needs a bearer on this hop requires Auth Mode Static Token instead. (x-forwarded-for
          preserves the real caller address; x-forwarded-host arrives empty — don't key logic on it.) What's left
          is wiring up the bridge secret in the console: Phase 2, Tasks 5–9.
        </figcaption>
      </figure>

      <section className="pfg-flags" aria-label="Switches introduced by the plan">
        {FLAGS.map((f) => (
          <div key={f.code[0]} className="pfg-flag">
            <div>
              {f.code.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <small>{f.text}</small>
          </div>
        ))}
      </section>
    </main>
  );
}
