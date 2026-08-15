import React, { useState, useCallback, useRef } from 'react';
import AgentClientSkin from '../components/AgentClientSkin';
import SecurityRail from '../components/SecurityRail';
import { useTokenChainOptional } from '../context/TokenChainContext';

const SKINS = ['privilege', 'claude', 'claude-terminal', 'gpt', 'gemini'];
const SKIN_LABELS = { privilege: 'Privilege', claude: 'Claude', 'claude-terminal': 'Terminal', gpt: 'ChatGPT', gemini: 'Gemini' };
const SKIN_DOT_COLORS = { privilege: '#0073e6', claude: '#d97941', 'claude-terminal': '#ffb454', gpt: '#10a37f', gemini: '#4285f4' };

const INITIAL_MESSAGES = [
  { role: 'agent', text: "Hello! I'm your personal agent. I can access your MileagePlus account and help manage your upcoming flights. What would you like to do today?" },
];

const DEFAULT_GATES = [
  { id: 'mfa',   name: 'AuthN: MFA Required',       desc: 'BFF checks acr claim · /multi_factor/ regex', icon: '🔐', status: 'waiting' },
  { id: 'gw',    name: 'Gateway: Token Validation',  desc: 'Audience · act claim · RFC 7662 introspection', icon: '🪟', status: 'waiting' },
  { id: 'authz', name: 'PingOne Authorize',           desc: 'Policy: agent identity · loyalty tier · action scope', icon: '✅', status: 'waiting' },
];

function deriveGates(events) {
  const gates = DEFAULT_GATES.map((g) => ({ ...g }));
  const ids = new Set(events.map((e) => e.id));
  const statuses = Object.fromEntries(events.map((e) => [e.id, e.status]));

  // Gate 0 — MFA
  if (events.some((e) => (e.id === 'personal-agent-lookup' || e.id === 'mfa') && (e.status === 'success' || e.status === 'valid'))) {
    gates[0].status = 'permit';
  }
  // Gate 1 — Gateway
  if (ids.has('mcp-tool-invoked')) gates[1].status = 'checking';
  if (ids.has('gw-introspection') || ids.has('gw-authorize')) {
    const azStatus = statuses['gw-authorize'];
    const intrStatus = statuses['gw-introspection'];
    if (azStatus === 'deny') {
      gates[1].status = 'deny';
    } else if (azStatus === 'permit' || azStatus === 'active' || intrStatus === 'permit' || intrStatus === 'active') {
      gates[1].status = 'permit';
    }
  }
  // Gate 2 — Authz / result
  if (ids.has('resource-server-reply') || ids.has('mcp-tool-result')) {
    gates[2].status = 'permit';
  }
  return gates;
}

function extractActClaim(events) {
  const exchEvent = events.find((e) => e.id === 'mcp-exchange' || e.id === 'personal-agent-lookup');
  if (!exchEvent || !exchEvent.token) return null;
  const claims = exchEvent.token?.claims;
  if (!claims?.act) return null;
  return { sub: claims.sub || '…', act: claims.act, scope: claims.scope || '', acr: claims.acr || '' };
}

// Layout state → CSS
const LAYOUT_STYLES = {
  full:   { agentFlex: '1',    railWidth: '0',     railVisible: false, placeholderVisible: false },
  split:  { agentFlex: '0 0 55%', railWidth: '45%', railVisible: true,  placeholderVisible: false },
  popped: { agentFlex: '0 0 280px', railWidth: 'auto', railVisible: true, placeholderVisible: true },
};

export default function PersonalAgentStudioPage() {
  const [layoutState, setLayoutState] = useState('full');
  const [activeSkin, setActiveSkin] = useState('privilege');
  const [theme, setTheme] = useState('dark');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [replayGates, setReplayGates] = useState(null);
  const replayTimer = useRef(null);

  const tokenChain = useTokenChainOptional();
  const events = tokenChain?.events || [];
  const gates = deriveGates(events);
  const actClaim = extractActClaim(events);

  const handleSend = useCallback((text) => {
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev.filter((m) => !m.typing),
        { role: 'agent', text: "Processing through the delegation chain…" },
      ]);
    }, 1500);
  }, []);

  function handlePopOut() {
    const url = `/personal-agent/client?skin=${activeSkin}&theme=${theme}`;
    window.open(url, '_blank', 'width=480,height=700,left=200,top=100,resizable=yes');
    setLayoutState('popped');
  }

  function handleReplay() {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    const base = DEFAULT_GATES.map((g) => ({ ...g, status: 'waiting' }));
    setReplayGates(base);
    [0, 1, 2].forEach((idx) => {
      replayTimer.current = setTimeout(() => {
        setReplayGates((prev) => {
          if (!prev) return null;
          const next = prev.map((g, i) => i === idx ? { ...g, status: 'permit' } : g);
          if (idx === 2) {
            setTimeout(() => setReplayGates(null), 1200);
          }
          return next;
        });
      }, 400 + idx * 400);
    });
  }

  const layout = LAYOUT_STYLES[layoutState] || LAYOUT_STYLES.full;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg, #0f1117)' }}>
      {/* Page header */}
      <div style={{ background: 'var(--surface, #1a1d27)', borderBottom: '1px solid var(--border, #2e3347)', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text, #e2e8f0)', marginRight: 8 }}>Personal Agent</span>

        {/* Skin tabs */}
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {SKINS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSkin(s)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${activeSkin === s ? 'var(--border, #2e3347)' : 'transparent'}`, background: activeSkin === s ? 'var(--surface2, #242838)' : 'transparent', fontSize: 12, fontWeight: 500, color: activeSkin === s ? 'var(--text, #e2e8f0)' : 'var(--muted, #8892a4)' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SKIN_DOT_COLORS[s], display: 'inline-block' }} />
              {SKIN_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button
            onClick={() => setLayoutState((s) => s === 'split' ? 'full' : 'split')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: `1px solid ${layoutState === 'split' ? 'var(--accent, #4f8ef7)' : 'var(--border, #2e3347)'}`, background: layoutState === 'split' ? 'rgba(79,142,247,0.15)' : 'transparent', color: layoutState === 'split' ? 'var(--accent, #4f8ef7)' : 'var(--muted, #8892a4)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            Split
          </button>
          <button
            onClick={handlePopOut}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: `1px solid ${layoutState === 'popped' ? 'var(--accent, #4f8ef7)' : 'var(--border, #2e3347)'}`, background: layoutState === 'popped' ? 'rgba(79,142,247,0.15)' : 'transparent', color: layoutState === 'popped' ? 'var(--accent, #4f8ef7)' : 'var(--muted, #8892a4)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            Pop Out
          </button>
          <button
            onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: '1px solid var(--border, #2e3347)', background: 'transparent', color: 'var(--muted, #8892a4)', fontSize: 12, cursor: 'pointer' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Agent panel */}
        <div style={{ flex: layout.agentFlex, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {layout.placeholderVisible ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, borderRight: '1px dashed var(--border, #2e3347)' }}>
              <div style={{ fontSize: 40 }}>👤</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e2e8f0)', textAlign: 'center' }}>Agent active in external window</div>
              <div style={{ fontSize: 12, color: 'var(--muted, #8892a4)', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
                The agent is running independently — just like a real user's AI client. Security gates on the right fire for every message it sends.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22c55e' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'blink 1.5s infinite' }} />
                Live — receiving token events
                <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
              </div>
            </div>
          ) : (
            <AgentClientSkin
              skin={activeSkin}
              theme={theme}
              messages={messages}
              onSend={handleSend}
              showPopOutButton={false}
              onPopOut={handlePopOut}
            />
          )}
        </div>

        {/* Security rail */}
        {layout.railVisible && (
          <SecurityRail
            gates={replayGates || gates}
            actClaim={actClaim}
            tokenEvents={events}
            onReplay={handleReplay}
          />
        )}
      </div>
    </div>
  );
}
