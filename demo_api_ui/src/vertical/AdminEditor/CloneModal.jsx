import React, { useState } from 'react';

const ID_REGEX = /^[a-z][a-z0-9-]*$/;

/**
 * Modal for cloning a vertical. Validates the new id matches /^[a-z][a-z0-9-]*$/
 * and that it isn't already in use. Submit calls onSubmit({ newId, displayName }).
 *
 * Props:
 *   sourceId: string — the id being cloned from (shown in heading)
 *   existingIds: string[] — to reject collisions client-side
 *   onClose: () => void
 *   onSubmit: ({ newId, displayName }) => void
 */
export function CloneModal({ sourceId, existingIds, onClose, onSubmit }) {
  const [newId, setNewId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!ID_REGEX.test(newId)) {
      setError('id must be lowercase letters/numbers/hyphens, starting with a letter');
      return;
    }
    if (existingIds.includes(newId)) {
      setError('id already exists');
      return;
    }
    if (!displayName.trim()) {
      setError('display name required');
      return;
    }
    onSubmit({ newId, displayName: displayName.trim() });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Clone vertical from {sourceId}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            New id (lowercase, hyphens):
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Display name:
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          {error && <div className="modal__error">{error}</div>}
          <div className="modal__actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!newId || !displayName}>Clone</button>
          </div>
        </form>
      </div>
    </div>
  );
}
