import React from 'react';
import { useMermaidRender } from '../hooks/useMermaidRender';
import './A2AArchitectureDiagram.css';

export const A2A_ARCHITECTURE_DIAGRAM = `
flowchart LR
    USER["User / Browser"]

    subgraph APP["Super Sports Assistant"]
        CHAT["Generalist agent"]
        CLIENT["A2A client<br/>message/send"]
        CHAT --> CLIENT
    end

    subgraph DISCOVERY["A2A discovery"]
        CARD["Signed Agent Card<br/>/.well-known/agent-card.json"]
    end

    subgraph IDENTITY["PingOne identity and policy"]
        EX1["RFC 8693 Exchange #1<br/>user + generalist actor"]
        EX2["RFC 8693 Exchange #2<br/>specialist audience + scope"]
        AUTHZ["PingOne Authorize<br/>PERMIT / DENY"]
        EX1 --> EX2 --> AUTHZ
    end

    subgraph SPECIALIST["A2A specialist"]
        GATE["Bearer gate<br/>issuer · audience · scope · act"]
        AGENT["Specialist agent"]
        GATE --> AGENT
    end

    subgraph TOOLS["MCP execution"]
        GATEWAY["MCP Gateway"]
        TOOL["Specialist MCP tool"]
        GATEWAY --> TOOL
    end

    NOTE["No token crosses the A2A response"]

    USER --> CHAT
    CLIENT -. "1. discover" .-> CARD
    CARD -. "capabilities + auth scheme" .-> CLIENT
    CLIENT -- "2. delegated A2A bearer" --> GATE
    CLIENT -- "3. request identity" --> EX1
    AGENT -- "4. own downstream token" --> EX2
    AUTHZ -- "5. authorized call" --> GATEWAY
    AGENT -- "6. result / toolError" --> CLIENT
    AGENT -.-> NOTE

    classDef app fill:#eff6ff,stroke:#2563eb,color:#1e3a8a;
    classDef discovery fill:#f0fdf4,stroke:#047857,color:#14532d;
    classDef identity fill:#fef2f2,stroke:#b91c1c,color:#7f1d1d;
    classDef specialist fill:#fefce8,stroke:#a16207,color:#713f12;
    classDef tools fill:#eef2ff,stroke:#4338ca,color:#312e81;
    class APP app;
    class DISCOVERY discovery;
    class IDENTITY identity;
    class SPECIALIST specialist;
    class TOOLS tools;
`.trim();

export default function A2AArchitectureDiagram({ onClose }) {
  const { containerRef, error } = useMermaidRender(A2A_ARCHITECTURE_DIAGRAM, {
    flowchart: { curve: 'basis', htmlLabels: true },
  });

  return (
    <div className="a2a-arch-backdrop" role="presentation" onClick={onClose}>
      <section
        className="a2a-arch-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="a2a-arch-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="a2a-arch-head">
          <div>
            <h2 id="a2a-arch-title">A2A implementation architecture</h2>
            <p>How identity delegation, A2A protocol traffic, and MCP authorization fit together in this demo.</p>
          </div>
          <button type="button" className="a2a-arch-close" onClick={onClose} aria-label="Close architecture diagram">✕</button>
        </div>

        <div className="a2a-arch-legend">
          <span><b>Identity plane:</b> RFC 8693 exchanges create scoped, nested <code>act</code> claims.</span>
          <span><b>Protocol plane:</b> Agent Card discovery and <code>message/send</code> connect the agents.</span>
          <span><b>Trust boundary:</b> the response carries a result or <code>toolError</code>, never a token.</span>
        </div>

        {error ? (
          <p className="a2a-arch-error">Diagram failed to render: {error}</p>
        ) : (
          <div ref={containerRef} className="a2a-arch-diagram" role="img" aria-label="A2A implementation flow diagram" />
        )}
      </section>
    </div>
  );
}
