/**
 * TokenChainArchitecturePage.js — /architecture/token-chain
 *
 * Interactive token chain diagram showing all servers, authentication,
 * authorization, token exchange, and MCP gateway flow.
 */
import React from 'react';
import ArchitectureDiagramPage from './ArchitectureDiagramPage';

const MERMAID_DIAGRAM = `
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#2E5090', 'primaryTextColor': '#fff', 'primaryBorderColor': '#1a3a5c', 'lineColor': '#4a7bb8', 'secondaryColor': '#28a745', 'tertiaryColor': '#f57c00', 'fontFamily': 'sans-serif'}, 'flowchart': {'useMaxWidth': true}}}%%
graph LR
    subgraph Client["🖥️ CLIENT"]
      User["👤 User"]
      OLB["OLB Application<br/>chatbot"]
    end

    subgraph Auth["🔐 AUTHENTICATION"]
      PingOne["PingOne/PF/AIC"]
      HumanToken["Human Token<br/>━━━━━━<br/>sub: user1<br/>may_act: agent1"]
    end

    subgraph Agent["AGENT"]
      AgentSvc["Agent Service"]
      LLM["LLM<br/>tool selector"]
      AgentToken["Agent Token<br/>━━━━━━<br/>client_id: agent1<br/>SPIFFE SVID"]
    end

    subgraph Exchange["TOKEN EXCHANGE"]
      TxService["Exchange Service"]
      TxToken["TX Token<br/>━━━━━━<br/>sub: user1<br/>act: agent1<br/>scope: mcp"]
    end

    subgraph Gateway["🚪 GATEWAY"]
      GWService["Agent Gateway<br/>route & introspect"]
      AuthCall["authorize()<br/>check token"]
    end

    subgraph Authz["✅ AUTHORIZATION"]
      PingAuthz["PingAuthorize<br/>Policy Engine<br/>Read metadata"]
    end

    subgraph MCPs["🔌 MCP SERVERS"]
      MCP_OLB["MCP OLB<br/>mcp-olb.bxf.com"]
      MCP_Invest["MCP Resource Server<br/>mcp-resource-server.bxf.com"]
    end

    subgraph Resources["📊 RESOURCES"]
      RS_OLB["olb-resource<br/>/balance /transfer"]
      RS_Invest["invest-resource<br/>API key vault"]
    end

    subgraph Safety["🛡️ SAFETY"]
      HITL["HITL/CIBA<br/>step-up"]
      Metadata["Agent metadata<br/>capabilities"]
    end

    User -->|login| OLB
    OLB -->|auth| PingOne
    PingOne -->|token| HumanToken
    HumanToken -->|present| AgentSvc

    AgentSvc -->|own creds| AgentToken
    AgentSvc -->|tool list| GWService
    GWService -->|agent token| AuthCall
    AuthCall -->|verify| PingAuthz

    AgentSvc -->|route tool| LLM
    LLM -->|select: balance| AgentSvc
    AgentSvc -->|call| GWService

    GWService -->|DENY<br/>no subject| AuthCall
    AuthCall -->|unauthorized| AgentSvc

    AgentSvc -->|human+agent| TxService
    TxService -->|issue| TxToken

    TxToken -->|authorize| GWService
    GWService -->|introspect| PingAuthz
    PingAuthz -->|PERMIT| GWService

    GWService -->|balance<br/>PERMIT| MCP_OLB
    MCP_OLB -->|get API key| RS_OLB
    RS_OLB -->|data| MCP_OLB
    MCP_OLB -->|response| GWService

    GWService -->|transfer| AuthCall
    AuthCall -->|DENY<br/>HITL required| GWService
    GWService -->|step-up| AgentSvc
    AgentSvc -->|CIBA| HITL
    HITL -->|MFA approve| AgentSvc
    AgentSvc -->|MFA token| TxService

    TxService -->|new TX| TxToken
    TxToken -->|retry| GWService
    GWService -->|PERMIT| MCP_Invest
    MCP_Invest -->|execute| RS_Invest
    RS_Invest -->|confirm| MCP_Invest
    MCP_Invest -->|result| GWService

    AgentSvc -->|check| Metadata
    PingAuthz -->|query| Metadata

    style Client fill:#1e3a5f,stroke:#0f2438,stroke-width:2px,color:#fff
    style Auth fill:#2e5090,stroke:#1a3a5c,stroke-width:2px,color:#fff
    style Agent fill:#3b5998,stroke:#2a3f6c,stroke-width:2px,color:#fff
    style Exchange fill:#28a745,stroke:#1e7e34,stroke-width:2px,color:#fff
    style Gateway fill:#f57c00,stroke:#d66b00,stroke-width:2px,color:#fff
    style Authz fill:#dc3545,stroke:#a02830,stroke-width:2px,color:#fff
    style MCPs fill:#6f42c1,stroke:#4a276a,stroke-width:2px,color:#fff
    style Resources fill:#17a2b8,stroke:#0e5968,stroke-width:2px,color:#fff
    style Safety fill:#ffc107,stroke:#d9a308,stroke-width:2px,color:#000

    style User fill:#0f2438,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style OLB fill:#0f2438,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style PingOne fill:#2a3f6c,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style HumanToken fill:#4a7bb8,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style AgentSvc fill:#2a3f6c,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style LLM fill:#2a3f6c,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style AgentToken fill:#4a7bb8,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style TxService fill:#1e7e34,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style TxToken fill:#45c754,stroke:#e0e0e0,stroke-width:1px,color:#000
    style GWService fill:#d66b00,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style AuthCall fill:#d66b00,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style PingAuthz fill:#a02830,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style MCP_OLB fill:#4a276a,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style MCP_Invest fill:#4a276a,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style RS_OLB fill:#0e5968,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style RS_Invest fill:#0e5968,stroke:#e0e0e0,stroke-width:1px,color:#fff
    style HITL fill:#d9a308,stroke:#e0e0e0,stroke-width:2px,color:#000
    style Metadata fill:#d9a308,stroke:#e0e0e0,stroke-width:1px,color:#000
`;

export default function TokenChainArchitecturePage({ user }) {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h1>Token Chain Architecture</h1>
        <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem' }}>
          Complete flow: PingOne auth → Agent → Token Exchange → Agent Gateway → Authorization → Resource Servers
        </p>
      </div>

      <div style={{
        background: '#fafafa',
        padding: '2rem',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        overflowX: 'auto'
      }}>
        <pre className="mermaid">
          {MERMAID_DIAGRAM}
        </pre>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #2E5090' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#2E5090' }}>🔐 Authentication</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            PingOne issues human token with <code>may_act: agent1</code> delegation claim
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #3b5998' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#3b5998' }}>Agent</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Gets own token (client creds), routes to LLM for tool selection
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #28a745' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#28a745' }}>Token Exchange</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Combines human + agent tokens into single TX token for MCP calls
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #f57c00' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#f57c00' }}>🚪 Gateway</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Routes tool calls, enforces authorization checks, handles introspection
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #dc3545' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#dc3545' }}>✅ Authorization</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            PingAuthorize evaluates policies based on scopes, audience, ACR, transaction details
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #6f42c1' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#6f42c1' }}>🔌 MCP Servers</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Tool providers, validate tokens, forward to resources with optional exchange
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #17a2b8' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#17a2b8' }}>📊 Resources</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Backend APIs behind MCP servers, may do token exchange for API keys
          </div>
        </div>

        <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '6px', borderLeft: '4px solid #ffc107' }}>
          <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#000' }}>🛡️ HITL/CIBA</div>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Step-up flow for high-risk actions (transfers), requires Multi-Factor ACR
          </div>
        </div>
      </div>
    </div>
  );
}
