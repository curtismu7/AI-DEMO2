import React, { useEffect, useState } from 'react';

const S = {
  banner: {
    background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8,
    padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#1e3a5f',
  },
  heading: { fontWeight: 700, margin: '0 0 4px 0' },
  pill: {
    display: 'inline-block', background: '#dbeafe', color: '#1e40af',
    fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 12,
    textTransform: 'capitalize', marginRight: 6,
  },
  meta: { color: '#374151', fontSize: 12 },
};

// Shows the signed-in delegate what access they hold. Fetches once; renders
// nothing when the viewer holds no delegations, the session is signed out,
// or the endpoint is unreachable — the dashboard must not grow an error box
// for the 99% of sessions with no delegation in play.
export default function DelegatedAccessPanel() {
  const [grants, setGrants] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/delegation/granted-to-me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.ok && Array.isArray(data.delegations) && data.delegations.length > 0) {
          setGrants(data.delegations);
        }
      })
      .catch(() => {}); // silent: panel is strictly additive
    return () => { cancelled = true; };
  }, []);

  if (!grants) return null;

  return (
    <div style={S.banner} data-testid="delegated-access-panel">
      {grants.map((g) => (
        <div key={g.id} style={{ marginBottom: grants.length > 1 ? 8 : 0 }}>
          <p style={S.heading}>
            {g.delegator_email || g.delegatorEmail || 'Someone'} granted you access to their accounts
          </p>
          <p style={{ margin: 0 }}>
            {(g.scopes || []).map((s) => (
              <span key={s} style={S.pill}>{s.replace(/_/g, ' ')}</span>
            ))}
          </p>
          <p style={{ ...S.meta, margin: '4px 0 0' }}>
            Granted {g.granted_at ? new Date(g.granted_at).toLocaleDateString() : ''}
          </p>
        </div>
      ))}
    </div>
  );
}
