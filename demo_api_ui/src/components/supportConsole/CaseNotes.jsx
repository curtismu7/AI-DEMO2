import React, { useCallback, useEffect, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifyError } from '../../utils/appToast';
import './CaseNotes.css';

// What the operator wrote down during the call. Not gated on verification: a
// note records what happened, it does not change the customer's data.
export default function CaseNotes({ vertical, customerId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const path = `/api/admin/${vertical}/cases/${customerId}/notes`;

  useEffect(() => {
    let live = true;
    bffAxios
      .get(path)
      .then(({ data }) => { if (live) setNotes(data?.data?.notes || []); })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [path]);

  const save = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const { data } = await bffAxios.post(path, { body });
      setNotes((prev) => [...prev, data.note]);
      setDraft('');
    } catch (err) {
      notifyError(err?.response?.data?.error || 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }, [draft, path]);

  return (
    <section className="cnotes" aria-labelledby="cnotes-heading" data-testid="case-notes">
      <h3 id="cnotes-heading" className="cnotes__title">Case notes</h3>
      <ul className="cnotes__list">
        {notes.map((n) => (
          <li key={n.id} className="cnotes__item">
            <div className="cnotes__meta">
              {new Date(n.at).toLocaleString()} · {n.operator}
            </div>
            <div className="cnotes__body">{n.body}</div>
          </li>
        ))}
        {notes.length === 0 && <li className="cnotes__empty">No notes yet.</li>}
      </ul>
      <div className="cnotes__compose">
        <input
          aria-label="Add a note"
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" onClick={save} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </section>
  );
}
