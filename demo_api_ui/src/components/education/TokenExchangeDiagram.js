// banking_api_ui/src/components/education/TokenExchangeDiagram.js
/**
 * Visual inline diagram — Single RFC 8693 Delegation Flow (default path)
 * Designed to be embedded in TokenFlowPanel (or any education tab content).
 * Uses only inline styles + React — no external deps.
 */
import React from 'react';

// ─── Primitives ───────────────────────────────────────────────────────────────

function Actor({ icon, label, sublabel, color = '#1e3a5f', border = '#3b82f6', width = 150 }) {
  return (
    <div style={{
      width,
      minWidth: width,
      background: color,
      border: `2px solid ${border}`,
      borderRadius: 8,
      padding: '10px 8px',
      textAlign: 'center',
      flexShrink: 0,
    }}>
      <div style={{ fontSize: '1.4rem', lineHeight: 1 }}>{icon}</div>
      <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.72rem', marginTop: 4, lineHeight: 1.3 }}>{label}</div>
      {sublabel && <div style={{ color: '#374151', fontSize: '0.62rem', marginTop: 3, lineHeight: 1.3 }}>{sublabel}</div>}
    </div>
  );
}

function Arrow({ label, sublabel, color = '#64748b', dir = 'right', dashed = false }) {
  const isLeft = dir === 'left';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 80 }}>
      <div style={{
        color,
        fontSize: '0.68rem',
        fontWeight: 600,
        textAlign: 'center',
        marginBottom: 2,
        lineHeight: 1.3,
        maxWidth: 160,
      }}>{label}</div>
      <div style={{
        width: '100%',
        height: 2,
        background: dashed
          ? `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 12px)`
          : color,
        position: 'relative',
      }}>
        {/* Arrowhead */}
        <div style={{
          position: 'absolute',
          [isLeft ? 'left' : 'right']: -6,
          top: -5,
          width: 0,
          height: 0,
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          [isLeft ? 'borderRight' : 'borderLeft']: `8px solid ${color}`,
        }} />
      </div>
      {sublabel && <div style={{ color: '#475569', fontSize: '0.6rem', marginTop: 2, textAlign: 'center', maxWidth: 160 }}>{sublabel}</div>}
    </div>
  );
}

function Row({ children, mt = 8, mb = 8 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: mt, marginBottom: mb }}>
      {children}
    </div>
  );
}

function VSpacer({ label, color = '#334155', left = 75 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: 28, marginLeft: left, gap: 0 }}>
      <div style={{ width: 2, background: color, marginLeft: 0 }} />
      {label && (
        <div style={{ color: '#475569', fontSize: '0.62rem', marginLeft: 6, alignSelf: 'center' }}>{label}</div>
      )}
    </div>
  );
}

function TokenBadge({ label, claims, color = '#1e293b', border = '#475569', accent = '#94a3b8' }) {
  return (
    <div style={{
      background: color,
      border: `1px solid ${border}`,
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: '0.68rem',
      lineHeight: 1.6,
    }}>
      <div style={{ color: accent, fontWeight: 700, marginBottom: 4, fontSize: '0.72rem' }}>{label}</div>
      {claims.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 6 }}>
          <span style={{ color: '#374151', minWidth: 56, flexShrink: 0 }}>{k}:</span>
          <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children, bg = '#1e3a5f', border = '#3b82f6', color = '#93c5fd' }) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 4,
      padding: '3px 10px',
      display: 'inline-block',
      fontSize: '0.65rem',
      fontWeight: 700,
      color,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      marginBottom: 6,
    }}>{children}</div>
  );
}

// ─── Flow Variants ────────────────────────────────────────────────────────────

function PersonToMcpFlow({ Actor, Arrow, Row }) {
  return (
    <Row>
      <Actor icon="👤" label="Person" />
      <Arrow label="Subject Token" />
      <Actor icon="🔧" label="MCP Server" color="#3b82f6" border="#1d4ed8" />
      <Arrow label="MCP Token" dir="left" dashed />
    </Row>
  );
}

function AgentToA2aFlow({ Actor, Arrow, Row }) {
  return (
    <Row>
      <Actor icon="🤖" label="Agent" />
      <Arrow label="Delegation" />
      <Actor icon="🤖" label="Specialist" color="#8b5cf6" border="#6d28d9" />
      <Arrow label="Delegated Token" dir="left" dashed />
    </Row>
  );
}

function IntrospectionFlow({ Actor, Arrow, Row }) {
  return (
    <Row>
      <Actor icon="🔍" label="Validator" />
      <Arrow label="Token" />
      <Actor icon="✓" label="Valid" color="#10b981" border="#059669" />
    </Row>
  );
}

// ─── Main diagram ─────────────────────────────────────────────────────────────

export default function TokenExchangeDiagram({ exchangeType = 'person-to-agent' }) {
  // Colour palette
  const C = {
    user:    { bg: '#0f2744', border: '#3b82f6', text: '#93c5fd' },
    bff:     { bg: '#14532d', border: '#22c55e', text: '#86efac' },
    ping:    { bg: '#3b1a6e', border: '#a78bfa', text: '#c4b5fd' },
    mcp:     { bg: '#1a2e1a', border: '#4ade80', text: '#86efac' },
    tok1:    { bg: '#1c1a0d', border: '#d97706', text: '#fcd34d' },  // User AT
    tok2:    { bg: '#150d26', border: '#7c3aed', text: '#c4b5fd' },  // Intermediate
    tok3:    { bg: '#0d1a0d', border: '#16a34a', text: '#4ade80' },  // Final MCP
    cc1:     { bg: '#1a1330', border: '#6d28d9', text: '#a78bfa' },  // AI Agent CC
    cc2:     { bg: '#1a1330', border: '#6d28d9', text: '#a78bfa' },  // MCP Exchanger CC
  };

  const renderDiagram = () => {
    switch (exchangeType) {
      case 'person-to-mcp':
        return <PersonToMcpFlow Actor={Actor} Arrow={Arrow} Row={Row} />;
      case 'agent-to-a2a':
        return <AgentToA2aFlow Actor={Actor} Arrow={Arrow} Row={Row} />;
      case 'introspection':
        return <IntrospectionFlow Actor={Actor} Arrow={Arrow} Row={Row} />;
      default:
        return (
          <>
            {/* ── Security banner ── */}
            <div style={{
              background: '#14532d', border: '1px solid #16a34a', borderRadius: 6,
              padding: '8px 14px', marginBottom: 20, color: '#86efac',
              fontSize: '0.73rem', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span>🔐</span>
              <span>Raw tokens stay server-side. Only decoded claims reach the browser. <code style={{ fontWeight: 400, color: '#4ade80' }}>sub</code> is preserved end-to-end through every exchange.</span>
            </div>

            {/* ═══════════════════════════════════════════ */}
            {/* PHASE 0: LOGIN                              */}
            {/* ═══════════════════════════════════════════ */}
            <SectionLabel bg={C.user.bg} border={C.user.border} color={C.user.text}>① Login — Authorization Code + PKCE</SectionLabel>
            <Row mt={4}>
              <Actor icon="👤" label="User Browser"                                       color={C.user.bg}  border={C.user.border} />
              <Arrow label="GET /api/auth/oauth/user/login" sublabel="→ PingOne /authorize + PKCE code_challenge" color={C.user.border} />
              <Actor icon="🏦" label="BFF" sublabel="demo_api_server"                     color={C.bff.bg}   border={C.bff.border}  />
              <Arrow label="Auth Code + POST /as/token" sublabel="PingOne issues tokens" color={C.ping.border} />
              <Actor icon="🔐" label="PingOne AS" sublabel="Authorization Server"          color={C.ping.bg}  border={C.ping.border} />
            </Row>

            <VSpacer left={166} color={C.tok1.border} />

            {/* User AT card */}
            <div style={{ marginLeft: 0, marginBottom: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <TokenBadge
                label="① User Access Token  (stored in BFF session)"
                color={C.tok1.bg} border={C.tok1.border} accent={C.tok1.text}
                claims={[
                  ['sub',      '<user-id>  ← never changes'],
                  ['aud',      'agentgateway.ping.demo'],
                  ['scope',    'openid profile email offline_access read write ai:agent'],
                  ['may_act',  '{ "sub": "<ai-agent-client-id>" }  ← pre-approval for token exchange'],
                ]}
              />
            </div>

            {/* ═══════════════════════════════════════════ */}
            {/* PHASE 1: SINGLE RFC 8693 EXCHANGE           */}
            {/* ═══════════════════════════════════════════ */}
            <div style={{ marginTop: 20 }}>
              <SectionLabel bg={C.cc1.bg} border={C.cc1.border} color={C.cc1.text}>② Exchange — User AT → Exchanged MCP Token (RFC 8693 §3)</SectionLabel>
            </div>

            {/* Actor CC token */}
            <div style={{ display: 'flex', gap: 12, marginTop: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <TokenBadge
                label="AI Agent CC Token  (actor_token)"
                color={C.cc1.bg} border={C.cc1.border} accent={C.cc1.text}
                claims={[
                  ['grant',  'client_credentials'],
                  ['aud',    'agentgateway.ping.demo'],
                  ['client', 'AGENT_OAUTH_CLIENT_ID'],
                ]}
              />
            </div>

            <Row mt={4}>
              <Actor icon="🏦" label="BFF" sublabel="subject_token = User AT&#10;actor_token = AI Agent CC Token"  color={C.bff.bg}  border={C.bff.border} width={170} />
              <Arrow label="POST /as/token  RFC 8693" sublabel="grant_type=token-exchange  USE_AGENT_ACTOR_FOR_MCP=true" color={C.ping.border} />
              <Actor icon="🔐" label="PingOne AS" sublabel="validates may_act.sub matches actor_token.sub" color={C.ping.bg} border={C.ping.border} />
            </Row>

            <VSpacer left={86} color={C.tok3.border} />

            {/* Exchanged MCP token */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
              <TokenBadge
                label="② Exchanged MCP Token  (Bearer forwarded through gateway)"
                color={C.tok3.bg} border={C.tok3.border} accent={C.tok3.text}
                claims={[
                  ['sub',   '<user-id>  ← preserved end-to-end ✓'],
                  ['aud',   '<PINGONE_RESOURCE_MCP_GATEWAY_URI>'],
                  ['scope', 'read  write  (OIDC claims removed)'],
                  ['act',   '{ "sub": "<ai-agent-client-id>" }  ← single-level delegation ✓'],
                ]}
              />
            </div>

            {/* ═══════════════════════════════════════════ */}
            {/* PHASE 2: GATEWAY + MCP SERVER               */}
            {/* ═══════════════════════════════════════════ */}
            <div style={{ marginTop: 20 }}>
              <SectionLabel bg={C.mcp.bg} border={C.mcp.border} color={C.mcp.text}>③ Agent Gateway → MCP Server → Banking API</SectionLabel>
            </div>

            <Row mt={6}>
              <Actor icon="🏦" label="BFF"                                                  color={C.bff.bg}  border={C.bff.border} />
              <Arrow label="Bearer: Exchanged MCP Token" sublabel="callToolViaGateway" color={C.tok3.border} />
              <Actor icon="🛡" label="Agent Gateway" sublabel="demo_mcp_gateway :3005&#10;introspect→policy→Authorize" color={C.mcp.bg}  border={C.mcp.border} width={160} />
              <Arrow label="Forward token unchanged" sublabel="PERMIT → forward as-is" color={C.mcp.border} />
              <Actor icon="🤖" label="MCP Server" sublabel="demo_mcp_server :8080"          color={C.mcp.bg}  border={C.mcp.border} />
              <Arrow label="Banking API call" sublabel="aud ✓  scope ✓  act ✓"            color={C.mcp.border} />
              <Actor icon="💳" label="Banking API" sublabel="resource-server.pingdemo.com" color={C.mcp.bg}  border={C.mcp.border} />
            </Row>

            <VSpacer left={166} color="#475569" />

            <Row mt={0}>
              <Actor icon="🏦" label="BFF"                                                  color={C.bff.bg}  border={C.bff.border} />
              <Arrow label="decoded claims only" sublabel="no raw tokens" color="#475569" dir="left" dashed />
              <Actor icon="👤" label="User Browser" sublabel="token viewer / agent chat"   color={C.user.bg} border={C.user.border} />
            </Row>

            {/* ── legend ── */}
            <div style={{
              marginTop: 24, borderTop: '1px solid #1e293b', paddingTop: 12,
              display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: '0.65rem', color: '#374151',
            }}>
              {[
                [C.tok1.border,  'User Access Token'],
                [C.tok3.border,  'Exchanged MCP Token'],
                [C.cc1.border,   'AI Agent CC Token (actor)'],
                [C.mcp.border,   'Agent Gateway / MCP Server'],
                [C.ping.border,  'PingOne AS'],
              ].map(([color, label]) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color }} />
                  {label}
                </span>
              ))}
              <span style={{ marginLeft: 'auto', color: '#334155' }}>RFC 8693 §3 sub · §4.1 act · §4.4 may_act</span>
            </div>
          </>
        );
    }
  };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8 }}>
      <div style={{
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        background: '#0b1120',
        color: '#e2e8f0',
        borderRadius: 10,
        padding: '20px 24px',
        minWidth: 700,
        boxSizing: 'border-box',
      }}>
        {renderDiagram()}
      </div>
    </div>
  );
}
