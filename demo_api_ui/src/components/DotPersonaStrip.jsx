/**
 * DotPersonaStrip — who Dot is, above its chat. Static copy only: it states the
 * trust model (Dot acts for the signed-in user, Ping checks each tool call, Dot's
 * memory stays with Dot) and shows the page's mode. It carries no identity or
 * scope data, so it can never disagree with what the agent was actually granted.
 */
export default function DotPersonaStrip({ theme = 'dark', mode = 'llm' }) {
  const dark = theme === 'dark';
  return (
    <div
      data-testid="dot-persona-strip"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', flexWrap: 'wrap',
        background: dark ? '#1b1e20' : '#f6f9f9', borderBottom: `1px solid ${dark ? '#2c3234' : '#d9e3e3'}`,
        color: dark ? '#ecefef' : '#1c2123',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, boxShadow: '0 0 0 3px rgba(43,179,163,0.18)', background: 'radial-gradient(circle at 35% 30%, #8ee6da, #2bb3a3 60%, #12766b)' }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Dot <span style={{ fontWeight: 400, opacity: 0.7 }}>· your always-on persona agent</span></div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Acts for you. Ping checks every tool call; what Dot remembers stays with Dot.</div>
      </div>
      <span style={{ marginLeft: 'auto', fontSize: 11.5, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(43,179,163,0.5)' }}>
        {mode === 'heuristics' ? 'Heuristics · no model call' : 'llama.cpp · model routes'}
      </span>
    </div>
  );
}
