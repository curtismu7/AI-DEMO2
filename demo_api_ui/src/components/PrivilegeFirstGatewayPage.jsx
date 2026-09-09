// PrivilegeFirstGatewayPage.jsx — target architecture from
// docs/superpowers/plans/2026-09-08-privilege-first-gateway.md: the PingOne
// Privilege AI Gateway as the first hop for LLM and MCP traffic, the Agent
// Gateway behind it, and the identity fork the plan stops at. Hand-drawn
// inline SVG (no Mermaid) so both themes resolve through --th-* tokens.
import React from "react";
import "./PrivilegeFirstGatewayPage.css";

const ARROW_DEFS = (
  <defs>
    <marker id="pfg-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" className="pfg-arrow" />
    </marker>
    <marker id="pfg-ah-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" className="pfg-arrow-m" />
    </marker>
    <marker id="pfg-ah-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" className="pfg-arrow-s" />
    </marker>
  </defs>
);

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
    text: "BFF MCP chokepoint routes to /agent-gateway/mcp on Privilege, checked before the PingGateway flag so the two compose. Default off. SE only.",
  },
];

export default function PrivilegeFirstGatewayPage() {
  return (
    <main className="pfg-page">
      <header className="pfg-hero">
        <div className="pfg-eyebrow">AI-DEMO2 · plan 2026-09-08</div>
        <h1>Privilege first, Agent Gateway for the rest</h1>
        <p>
          Every LLM call and every MCP tool call enters the PingOne Privilege AI Gateway before anything else.
          Privilege owns the credentials and the human-governed policy. The Agent Gateway behind it keeps doing the
          delegated, per-tool authorization it does today.
        </p>
      </header>

      <figure className="pfg-figure">
        <div className="pfg-frame">
          <svg
            viewBox="0 0 1200 600"
            role="img"
            aria-label="Target architecture: callers on the left enter the Privilege AI Gateway, whose LLM lane goes to cloud providers with a virtual key and whose MCP lane goes to the Agent Gateway, which then reaches the MCP servers. Local models on port 8090 stay outside Privilege."
          >
            {ARROW_DEFS}

            <text x="20" y="28" className="pfg-t-m">CALLERS</text>
            <text x="300" y="28" className="pfg-t-priv">1 · FIRST GATE</text>
            <text x="790" y="28" className="pfg-t-ag">2 · THE REST</text>

            <rect x="20" y="50" width="200" height="72" rx="4" className="pfg-box" />
            <text x="32" y="74" className="pfg-t-b">BFF chat</text>
            <text x="32" y="92" className="pfg-t-mono-m">demo-api-server :3001</text>
            <text x="32" y="108" className="pfg-t-m">LangGraph agent, tool pipeline</text>

            <rect x="20" y="160" width="200" height="72" rx="4" className="pfg-box" />
            <text x="32" y="184" className="pfg-t-b">Sidecar agents</text>
            <text x="32" y="202" className="pfg-t-m">openai · pydantic · mastra</text>
            <text x="32" y="218" className="pfg-t-m">LibreChat, agent-service :3006</text>

            <rect x="20" y="270" width="200" height="72" rx="4" className="pfg-box" />
            <text x="32" y="294" className="pfg-t-b">External MCP clients</text>
            <text x="32" y="312" className="pfg-t-m">LM Studio, LibreChat MCP</text>
            <text x="32" y="328" className="pfg-t-m">OAuth (DCR+PKCE) via façade doors</text>

            <rect x="300" y="50" width="360" height="360" rx="6" className="pfg-box-priv" />
            <text x="318" y="76" className="pfg-t-h">PingOne Privilege AI Gateway</text>
            <text x="318" y="94" className="pfg-t-mono-m">mcpgw.ai-demo.ping-devops.com · SE cluster</text>
            <text x="318" y="112" className="pfg-t-m">identity: Privilege tenant 0428ba4f… (human sign-in)</text>

            <rect x="318" y="128" width="324" height="104" rx="4" className="pfg-lane" />
            <text x="330" y="150" className="pfg-t-b">LLM lane · virtual keys</text>
            <text x="330" y="168" className="pfg-t-mono">{"/llm/{openai|anthropic|google}/v1/…"}</text>
            <text x="330" y="188" className="pfg-t-m">provider API key is injected here and never</text>
            <text x="330" y="204" className="pfg-t-m">leaves Privilege · policy deny → llm_policy_denied</text>
            <text x="330" y="222" className="pfg-t-m">model allow-list · usage caps</text>

            <rect x="318" y="252" width="324" height="140" rx="4" className="pfg-lane" />
            <text x="330" y="274" className="pfg-t-b">MCP lane · Agentic App “agent-gateway”</text>
            <text x="330" y="292" className="pfg-t-mono">/agent-gateway/mcp</text>
            <text x="330" y="312" className="pfg-t-m">who may connect · which tools are visible</text>
            <text x="330" y="328" className="pfg-t-m">time-boxed policy · approval on risky tools</text>
            <text x="330" y="344" className="pfg-t-m">session recording · gateway-managed OAuth</text>
            <text x="330" y="364" className="pfg-t-m">backend registered on /mcp, never /sse</text>
            <text x="330" y="380" className="pfg-t-m">(NEW — today Privilege is beside, not in front)</text>

            <path d="M220 72 H252 V160 H316" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="256" y="150" className="pfg-t-m">chat</text>
            <path d="M220 104 H284 V300 H316" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="228" y="252" className="pfg-t-m" transform="rotate(-90 228 252)">tools/call</text>
            <path d="M220 190 H268 V182 H316" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <path d="M220 306 H270 V330 H316" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <path d="M220 222 H240 V498 H298" className="pfg-e-ghost" markerEnd="url(#pfg-ah-m)" />

            <rect x="790" y="128" width="390" height="104" rx="4" className="pfg-box" />
            <text x="802" y="150" className="pfg-t-b">Cloud LLM providers</text>
            <text x="802" y="172" className="pfg-t-mono">OpenAI      /llm/openai/v1/chat/completions</text>
            <text x="802" y="190" className="pfg-t-mono">Anthropic   /llm/anthropic/v1/messages</text>
            <text x="802" y="208" className="pfg-t-mono">Google      /llm/google/v1/chat/completions</text>
            <text x="802" y="226" className="pfg-t-m">Privilege holds the real key; the app holds a virtual one</text>

            <path d="M642 180 H788" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="715" y="172" textAnchor="middle" className="pfg-t-m">real provider key</text>

            <rect x="790" y="252" width="390" height="158" rx="6" className="pfg-box-ag" />
            <text x="802" y="276" className="pfg-t-h">Agent Gateway</text>
            <text x="802" y="294" className="pfg-t-mono-m">ping-gateway :8080 /mcp (PingGateway) — default lane</text>
            <text x="802" y="310" className="pfg-t-mono-m">mcp-gateway :3005 /mcp (Node) when that flag is off</text>
            <text x="802" y="330" className="pfg-t-m">identity: demo env 01d89b06… (user + act chain)</text>
            <text x="802" y="352" className="pfg-t">introspection · RFC 8693 exchange · aud on every hop</text>
            <text x="802" y="370" className="pfg-t">P1AZ per tool: PERMIT / DENY / HITL · D-05 · RAR</text>
            <text x="802" y="392" className="pfg-t-m">unchanged: nothing relaxed, one input added (below)</text>

            <path d="M642 322 H788" className="pfg-e-spike" markerEnd="url(#pfg-ah-s)" />
            <text x="715" y="296" textAnchor="middle" className="pfg-t-spike">backend hop</text>
            <text x="715" y="310" textAnchor="middle" className="pfg-t-spike">Phase 0 decides</text>
            <text x="715" y="342" textAnchor="middle" className="pfg-t-mono-m">bridge token</text>
            <text x="715" y="356" textAnchor="middle" className="pfg-t-mono-m">+ X-Subject-Token</text>

            <rect x="790" y="480" width="90" height="60" rx="4" className="pfg-box" />
            <text x="835" y="504" textAnchor="middle" className="pfg-t-b">mcp-server</text>
            <text x="835" y="522" textAnchor="middle" className="pfg-t-mono-m">:8080 banking</text>
            <rect x="890" y="480" width="90" height="60" rx="4" className="pfg-box" />
            <text x="935" y="504" textAnchor="middle" className="pfg-t-b">resource-srv</text>
            <text x="935" y="522" textAnchor="middle" className="pfg-t-mono-m">:8081 invest</text>
            <rect x="990" y="480" width="90" height="60" rx="4" className="pfg-box" />
            <text x="1035" y="504" textAnchor="middle" className="pfg-t-b">mcp-weather</text>
            <text x="1035" y="522" textAnchor="middle" className="pfg-t-mono-m">:8896</text>
            <rect x="1090" y="480" width="90" height="60" rx="4" className="pfg-box" />
            <text x="1135" y="504" textAnchor="middle" className="pfg-t-b">mcp-brave</text>
            <text x="1135" y="522" textAnchor="middle" className="pfg-t-mono-m">:8897</text>

            <path d="M835 410 V478" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <path d="M935 410 V478" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <path d="M1035 410 V478" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <path d="M1135 410 V478" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="780" y="448" textAnchor="end" className="pfg-t-m">exchanged token,</text>
            <text x="780" y="462" textAnchor="end" className="pfg-t-m">aud per server</text>

            <rect x="300" y="470" width="360" height="70" rx="4" className="pfg-box-ghost" />
            <text x="318" y="494" className="pfg-t-b">llm-proxy :8090 · local models</text>
            <text x="318" y="512" className="pfg-t-m">llama.cpp / MLX tiers, unchanged, no auth today</text>
            <text x="318" y="528" className="pfg-t-m">outside Privilege — no lane exists for it (D2)</text>

            <text x="20" y="580" className="pfg-t-m">
              SE cluster only for the MCP lane: the Privilege gateway pod must reach ping-gateway.ping-devops-cmuir.svc.cluster.local. The LLM lane already works from local Docker.
            </text>
          </svg>
        </div>
        <div className="pfg-legend">
          <span><i className="pfg-sw" />request path, as planned</span>
          <span><i className="pfg-sw pfg-sw--spike" />the one hop the Phase 0 spike must measure</span>
          <span><i className="pfg-sw pfg-sw--ghost" />unchanged today, stays outside Privilege</span>
        </div>
        <figcaption>
          <strong>What moves.</strong> Today the BFF's chat goes vendor-direct and its tool calls go straight to the
          Agent Gateway; Privilege only serves the browser doors and two opt-in picker modes. In the target, the
          Privilege LLM lane becomes the default cloud path and the Agent Gateway becomes Privilege's registered
          backend, so the two gates compose instead of sitting side by side.
        </figcaption>
      </figure>

      <figure className="pfg-figure">
        <div className="pfg-frame">
          <svg
            viewBox="0 0 1200 250"
            role="img"
            aria-label="The identity fork on the Privilege to Agent Gateway hop. Outcome A: Privilege forwards a subject token header, so the Agent Gateway sees the user with Privilege as an actor and banking tools can be permitted. Outcome B: only a machine token arrives, so the Agent Gateway sees the bridge client with no user and banking tools are denied while weather and brave are permitted."
          >
            {ARROW_DEFS}

            <text x="20" y="26" className="pfg-t-spike">OUTCOME A · Privilege forwards custom headers</text>
            <rect x="20" y="44" width="150" height="80" rx="4" className="pfg-box-priv" />
            <text x="32" y="70" className="pfg-t-b">Privilege</text>
            <text x="32" y="88" className="pfg-t-m">bearer in: session token</text>
            <text x="32" y="104" className="pfg-t-m">user token in: header</text>

            <path d="M170 84 H318" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="244" y="64" textAnchor="middle" className="pfg-t-mono-m">Bearer: bridge token</text>
            <text x="244" y="78" textAnchor="middle" className="pfg-t-mono-m">X-Subject-Token: user</text>

            <rect x="320" y="44" width="260" height="80" rx="4" className="pfg-box-ag" />
            <text x="332" y="70" className="pfg-t-b">Agent Gateway sees</text>
            <text x="332" y="88" className="pfg-t-mono">sub = user   act = [privilege-bridge]</text>
            <text x="332" y="106" className="pfg-t-m">header validated exactly like a bearer</text>

            <text x="320" y="152" className="pfg-t-permit">banking:read → P1AZ decides, PERMIT possible</text>
            <text x="320" y="172" className="pfg-t-m">Privilege shows in the act chain and audit rail.</text>
            <text x="320" y="190" className="pfg-t-m">Full Phase 2: Tasks 5–9.</text>

            <text x="620" y="26" className="pfg-t-spike">OUTCOME B · machine token only</text>
            <rect x="620" y="44" width="150" height="80" rx="4" className="pfg-box-priv" />
            <text x="632" y="70" className="pfg-t-b">Privilege</text>
            <text x="632" y="88" className="pfg-t-m">bearer in: session token</text>
            <text x="632" y="104" className="pfg-t-m">headers dropped</text>

            <path d="M770 84 H918" className="pfg-e" markerEnd="url(#pfg-ah)" />
            <text x="844" y="64" textAnchor="middle" className="pfg-t-mono-m">Bearer: bridge token</text>
            <text x="844" y="78" textAnchor="middle" className="pfg-t-mono-m">(client_credentials)</text>

            <rect x="920" y="44" width="260" height="80" rx="4" className="pfg-box-ag" />
            <text x="932" y="70" className="pfg-t-b">Agent Gateway sees</text>
            <text x="932" y="88" className="pfg-t-mono">sub = privilege-bridge   no user</text>
            <text x="932" y="106" className="pfg-t-m">no exchange can mint banking:read</text>

            <text x="920" y="152" className="pfg-t-deny">banking tools → DENY: no delegated user</text>
            <text x="920" y="172" className="pfg-t-permit">weather · brave · opensearch → PERMIT</text>
            <text x="920" y="190" className="pfg-t-m">The DENY is the demo beat; header gap raised with Ping.</text>

            <line x1="600" y1="40" x2="600" y2="200" className="pfg-e-ghost" />
          </svg>
        </div>
        <figcaption>
          <strong>The fork the plan stops at.</strong> Privilege rejects tokens from the demo environment, and the
          Agent Gateway needs the user's exchanged token for banking scopes. Whether the user's identity can cross
          this hop is measured in Phase 0 with a throwaway Agentic App and the Node gateway's logs, then decided by
          the operator.
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
