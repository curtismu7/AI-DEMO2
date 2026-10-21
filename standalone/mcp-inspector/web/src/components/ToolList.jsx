import React, { useState } from 'react';

/**
 * Searchable list of the tools (or protocol methods) a server offers. Each row
 * shows the name, a two-line description and any scopes the tool declares, so
 * you can pick without opening every tool. Picking a row opens its form.
 */
export default function ToolList({ items, selectedName, loading, noun, emptyMessage, onPick }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = q
    ? items.filter((t) => `${t.name} ${t.description || ''} ${(t.requiredScopes || []).join(' ')}`.toLowerCase().includes(q))
    : items;

  if (loading && !items.length) return <div className="tool-tree__empty">{`Loading ${noun}s…`}</div>;
  if (!items.length) return <div className="tool-tree__empty">{emptyMessage}</div>;

  return (
    <div className="tool-list">
      <div className="tool-list__bar">
        <input
          type="search"
          className="tool-list__search"
          placeholder={`Search ${items.length} ${noun}s…`}
          aria-label={`Search ${noun}s`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="tool-list__count" aria-live="polite">
          {rows.length === items.length ? `${items.length}` : `${rows.length} of ${items.length}`}
        </span>
      </div>
      <ul className="tool-list__rows">
        {rows.map((t) => {
          const on = t.name === selectedName;
          const scopes = t.requiredScopes || [];
          return (
            <li key={t.name}>
              <button type="button" className={on ? 'tool-list__row tool-list__row--active' : 'tool-list__row'} aria-pressed={on} onClick={() => onPick(t)}>
                <span className="tool-list__name">{t.name}</span>
                {t.description && <span className="tool-list__desc">{t.description}</span>}
                {scopes.length > 0 && (
                  <span className="tool-list__scopes">
                    {scopes.map((s) => <span key={s} className="tool-list__chip">{s}</span>)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="tool-tree__empty">{`No ${noun}s match "${query}".`}</li>}
      </ul>
    </div>
  );
}
