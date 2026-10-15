import { useEffect, useState } from 'react';

const EMPTY = { agentName: null, agentId: null, scopes: [], loaded: false };

/** The signed-in user's registered personal agent, from /api/agent-builder/state. Signed out or unregistered: stays empty. */
export function useDotPersona() {
  const [persona, setPersona] = useState(EMPTY);
  useEffect(() => {
    let live = true;
    fetch('/api/agent-builder/state', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!live) return;
        const scopes = [...new Set((s?.resources || []).flatMap((r) => r.granted || []))];
        setPersona({ agentName: s?.agent?.name || null, agentId: s?.agent?.id || null, scopes, loaded: true });
      })
      .catch(() => { if (live) setPersona({ ...EMPTY, loaded: true }); });
    return () => { live = false; };
  }, []);
  return persona;
}
