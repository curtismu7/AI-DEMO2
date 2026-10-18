// The inspectors' Vertical select: ?vertical= wins, then the app's active
// vertical, then banking. Options are the catalog's verticals, named and
// limited by the app's own list (GET /api/verticals/list, as VerticalSwitcher).
import React, { useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VerticalContext } from '../../vertical/VerticalProvider';
import { INSPECTOR_VERTICALS, DEFAULT_VERTICAL } from '../../config/inspectorVerticals';

/** onChange(vertical, id) runs whenever the vertical changes after mount. */
export function useInspectorVertical(onChange) {
  const [params, setParams] = useSearchParams();
  // Same value as useVertical().activeId, read directly: it needs no router location.
  const activeId = useContext(VerticalContext)?.activeId;
  const requested = params.get('vertical');
  const id = INSPECTOR_VERTICALS[requested] ? requested : INSPECTOR_VERTICALS[activeId] ? activeId : DEFAULT_VERTICAL;
  const vertical = INSPECTOR_VERTICALS[id];

  const [names, setNames] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetch('/api/verticals/list', { credentials: 'include' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => { if (live && Array.isArray(list)) setNames(Object.fromEntries(list.map((v) => [v.id, v.displayName]))); })
      .catch(() => { /* ids stand in for names */ });
    return () => { live = false; };
  }, []);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const shown = useRef(id);
  useEffect(() => {
    if (shown.current === id) return;
    shown.current = id;
    onChangeRef.current?.(vertical, id);
  }, [id, vertical]);

  const pick = (v) => setParams((p) => { const n = new URLSearchParams(p); n.set('vertical', v); return n; });
  const options = Object.keys(INSPECTOR_VERTICALS).filter((v) => v === id || !names || names[v]);
  const field = (
    <label className="insp-field">
      <span>Vertical</span>
      <select value={id} onChange={(e) => pick(e.target.value)}>
        {options.map((v) => <option key={v} value={v}>{names?.[v] ?? v}</option>)}
      </select>
    </label>
  );
  return { id, vertical, field };
}
