import { useEffect, useState } from 'react';
import bffAxios from '../services/bffAxios';
import './LookupUserChips.css';

// Hint list of demo usernames an operator can type into a vertical ops
// lookup box. Clicking a chip fills the search input via onPick.
export default function LookupUserChips({ vertical, noun, onPick }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    bffAxios.get(`/api/admin/${vertical}/users`)
      .then(({ data }) => {
        if (!cancelled) setUsers(Array.isArray(data.users) ? data.users : []);
      })
      .catch(() => { /* hint list only — the lookup box still works without it */ });
    return () => { cancelled = true; };
  }, [vertical]);

  if (!users.length) return null;

  return (
    <div className="lookup-user-chips">
      <span className="lookup-user-chips__label">Demo {noun} you can look up:</span>
      {users.map(u => (
        <button
          key={u.username}
          type="button"
          className="lookup-user-chip"
          title={[u.name, u.email].filter(Boolean).join(' · ')}
          onClick={() => onPick(u.username)}
        >
          {u.username}
        </button>
      ))}
    </div>
  );
}
