import React, { useCallback, useEffect, useRef, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import './SupportQueueRail.css';
import InlineSpinner from '../shared/InlineSpinner';

// Open work for this vertical, derived on the server from the same records the
// console shows. Selecting a row hands its customer query back to the console,
// which runs the ordinary lookup — the rail never becomes a second way to read
// customer data.
//
// autoOpen: fire onSelect for the lead row once it loads, so the console opens
// on a customer instead of a blank slate. The server leads the queue with the
// demo persona (demoUser), the one customer with a real PingOne link — without
// this the operator's first click tends to land on john.doe, who cannot verify.
export default function SupportQueueRail({ vertical, onSelect, autoOpen = false }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    let live = true;
    setState('loading');
    bffAxios
      .get(`/api/admin/${vertical}/queue`)
      .then(({ data }) => {
        if (!live) return;
        setRows(Array.isArray(data?.data?.rows) ? data.data.rows : []);
        setState('ready');
      })
      .catch(() => {
        if (!live) return;
        setRows([]);
        setState('error');
      });
    return () => { live = false; };
  }, [vertical]);

  // One-shot per mount: the lead row opens itself; later rows don't steal focus.
  useEffect(() => {
    if (!autoOpen || state !== 'ready' || autoOpenedRef.current) return;
    if (!rows.length || !onSelect) return;
    autoOpenedRef.current = true;
    onSelect(rows[0]);
  }, [autoOpen, state, rows, onSelect]);

  const select = useCallback((row) => {
    if (onSelect) onSelect(row);
  }, [onSelect]);

  return (
    <aside className="squeue" data-testid="support-queue" aria-label="Support queue">
      <div className="squeue__head">
        <b>Open work</b>
        {state === 'ready' && <span className="squeue__count">{rows.length}</span>}
      </div>

      {state === 'loading' && <div className="squeue__note"><InlineSpinner label="Loading…" /></div>}

      {state === 'error' && (
        <div className="squeue__note">
          ⚠️ Could not load the queue. The records themselves are unaffected.
        </div>
      )}

      {state === 'ready' && rows.length === 0 && (
        <div className="squeue__note">Nothing open for this vertical.</div>
      )}

      {state === 'ready' && rows.map((row) => (
        <button
          type="button"
          className="squeue__row"
          key={`${row.customerId}:${row.category}:${row.id}`}
          onClick={() => select(row)}
        >
          <span className="squeue__title">{row.title}</span>
          <span className="squeue__meta">
            {row.customerName} · {row.categoryLabel}
          </span>
          <span className="squeue__status">{row.status}</span>
        </button>
      ))}
    </aside>
  );
}
