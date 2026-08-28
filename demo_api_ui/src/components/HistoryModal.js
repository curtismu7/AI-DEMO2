/**
 * HistoryModal.js
 *
 * Floating, draggable, 8-direction-resizable history panel.
 * Renders token cards for each history entry.
 * "Pop out" button opens a standalone browser window — true cross-monitor support.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const MIN_W = 380;
const MIN_H = 180;
const HS    = 8; // handle size px

const ACCENT = {
  oauth: 'var(--brand-blue)', exchange: '#7c3aed', permit: '#16a34a',
  hitl: '#d97706', idtoken: '#0891b2', mcp: '#475569', error: '#dc2626',
};
const URN_SHORT = {
  'urn:ietf:params:oauth:grant-type:token-exchange': 'token-exchange',
  'urn:ietf:params:oauth:token-type:access_token':   'access_token',
  'urn:ietf:params:oauth:token-type:id_token':        'id_token',
  'urn:ietf:params:oauth:token-type:refresh_token':   'refresh_token',
};
function fmtVal(v) { return URN_SHORT[v] !== undefined ? URN_SHORT[v] : String(v); }

function ClaimRow({ k, v }) {
  const isAud    = k === 'aud' || k === 'audience' || k === 'TokenAudience' || k === 'requested_aud';
  const isAct    = k === 'act' || k === 'may_act' || k === 'ActClientId';
  const isDecide = k === 'decision' || k === 'DecisionContext';
  if (k === 'note' || k === '_type' || k === '_rfcs' || k === '_title') return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 3, alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.71rem', color: '#374151', minWidth: 90, flexShrink: 0, fontFamily: 'inherit', lineHeight: 1.5 }}>{k}</span>
      <span style={{
        fontSize: '0.77rem', fontFamily: 'inherit', lineHeight: 1.5, wordBreak: 'break-word',
        color: isAud ? 'var(--sidebar-bg-active)' : isAct ? '#15803d' : isDecide ? '#15803d' : '#0f172a',
        fontWeight: (isAud || isAct || isDecide) ? 700 : 500,
      }}>{fmtVal(v)}</span>
    </div>
  );
}

function MiniCard({ token, isHitl }) {
  if (!token) return null;
  const accentType = token._type || (isHitl ? 'hitl' : 'oauth');
  const accent = ACCENT[accentType] || ACCENT.oauth;
  const rfcs   = token._rfcs || [];
  const note   = token.note;
  const claims = Object.entries(token).filter(([k]) =>
    k !== 'type' && k !== '_type' && k !== '_title' && k !== '_rfcs' && k !== 'note'
  );
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: '8px 10px', marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', flex: '1 1 auto' }}>{token.type || 'Token'}</span>
        {rfcs.map((r) => (
          <span key={r} style={{
            fontSize: '0.6rem', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8',
            border: '1px solid #bfdbfe', borderRadius: 4, padding: '1px 4px', whiteSpace: 'nowrap',
          }}>{r}</span>
        ))}
      </div>
      {claims.map(([k, v]) => <ClaimRow key={k} k={k} v={String(v)} />)}
      {note && (
        <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid #f1f5f9', fontSize: '0.68rem', color: '#374151', fontStyle: 'italic', lineHeight: 1.4 }}>
          ℹ {note}
        </div>
      )}
    </div>
  );
}

function HistoryEntry({ entry }) {
  const [collapsed, setCollapsed] = useState(false);
  const isLive = entry.isLive;
  return (
    <div style={{
      borderBottom: '1px solid #f1f5f9', paddingBottom: 10, marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: collapsed ? 0 : 6, cursor: 'pointer' }}
        onClick={() => setCollapsed(c => !c)}>
        <span style={{
          background: isLive ? '#059669' : '#004687', color: '#fff',
          fontSize: '0.6rem', fontWeight: 700, borderRadius: 20, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {isLive ? '🔴 LIVE' : `Step ${entry.stepNum}`}
        </span>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', flex: 1, lineHeight: 1.3 }}>{entry.label}</span>
        <span style={{ color: '#374151', fontSize: '0.75rem' }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <>
          <MiniCard token={entry.token}  isHitl={entry.isHitl} />
          {entry.token2    && <MiniCard token={entry.token2} />}
          {entry.isTokenExchange && entry.tokenOut && <MiniCard token={entry.tokenOut} />}
        </>
      )}
    </div>
  );
}

const HANDLE_CURSORS = { n:'n-resize', ne:'ne-resize', e:'e-resize', se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize', nw:'nw-resize' };

function handleStyle(dir) {
  const base = { position: 'absolute', zIndex: 2 };
  if (dir === 'n')  return { ...base, top: 0,      left: HS,   right: HS,  height: HS,  cursor: 'n-resize' };
  if (dir === 'ne') return { ...base, top: 0,      right: 0,   width: HS*2, height: HS*2, cursor: 'ne-resize' };
  if (dir === 'e')  return { ...base, top: HS,     right: 0,   width: HS,  bottom: HS,  cursor: 'e-resize' };
  if (dir === 'se') return { ...base, bottom: 0,   right: 0,   width: HS*2, height: HS*2, cursor: 'se-resize' };
  if (dir === 's')  return { ...base, bottom: 0,   left: HS,   right: HS,  height: HS,  cursor: 's-resize' };
  if (dir === 'sw') return { ...base, bottom: 0,   left: 0,    width: HS*2, height: HS*2, cursor: 'sw-resize' };
  if (dir === 'w')  return { ...base, top: HS,     left: 0,    width: HS,  bottom: HS,  cursor: 'w-resize' };
  if (dir === 'nw') return { ...base, top: 0,      left: 0,    width: HS*2, height: HS*2, cursor: 'nw-resize' };
  return base;
}

export default function HistoryModal({ history, onClear }) {
  const [pos,     setPos]     = useState({ x: 24, y: 120 });
  const [size,    setSize]    = useState({ w: 340, h: 460 });
  const [open,    setOpen]    = useState(true);
  const [visible, setVisible] = useState(true);
  // eslint-disable-next-line no-unused-vars
  const dragRef   = useRef(null);
  // eslint-disable-next-line no-unused-vars
  const resizeRef = useRef(null);
  const prevLenRef = useRef(0);

  // Auto-reopen when new history arrives after being dismissed
  useEffect(() => {
    const len = history ? history.length : 0;
    if (len > prevLenRef.current && len > 0) setVisible(true);
    prevLenRef.current = len;
  }, [history]);

  // Listen for clear signal posted by the popout window
  useEffect(() => {
    const handler = (e) => {
      if (e.data === 'token-history-clear') onClear?.();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onClear]);

  const onDragDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const orig = { x: pos.x, y: pos.y };
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (mv) => setPos({ x: orig.x + mv.clientX - start.x, y: orig.y + mv.clientY - start.y });
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [pos]);

  const onResizeDown = useCallback((e, dir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const orig = { pos: { ...pos }, size: { ...size } };
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (mv) => {
      const dx = mv.clientX - start.x;
      const dy = mv.clientY - start.y;
      let { x: nx, y: ny } = orig.pos;
      let { w: nw, h: nh } = orig.size;
      if (dir.includes('e')) nw = Math.max(MIN_W, orig.size.w + dx);
      if (dir.includes('s')) nh = Math.max(MIN_H, orig.size.h + dy);
      if (dir.includes('w')) { nw = Math.max(MIN_W, orig.size.w - dx); nx = orig.pos.x + orig.size.w - nw; }
      if (dir.includes('n')) { nh = Math.max(MIN_H, orig.size.h - dy); ny = orig.pos.y + orig.size.h - nh; }
      setPos({ x: nx, y: ny });
      setSize({ w: nw, h: nh });
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [pos, size]);

  const popOut = useCallback(() => {
    const w = window.open('', '_blank', `width=${size.w + 40},height=${size.h + 40},left=${pos.x},top=${pos.y}`);
    if (!w) return;
    // Escape every interpolated value: token claim keys/values are rendered into
    // an innerHTML string, so an unescaped `<` in any claim would inject markup.
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // postMessage to a specific origin (this app), never the '*' wildcard.
    const targetOrigin = window.location.origin;
    const html = document.createElement('html');
    html.innerHTML = `
      <head><title>Token History</title>
      <style>
        body { font-family: system-ui,sans-serif; background:#f8fafc; margin:0; padding:0; }
        .toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; position:sticky; top:0; z-index:10; }
        .toolbar h3 { flex:1; margin:0; font-size:0.95rem; color:#1e293b; }
        .toolbar button { padding:3px 10px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer; font-size:0.75rem; color:#475569; }
        .toolbar button:hover { background:#f8fafc; }
        .body { padding:12px; }
        .entry { border-bottom:1px solid #e2e8f0; margin-bottom:10px; padding-bottom:10px; }
        .chip  { background:#004687; color:#fff; font-size:0.6rem; font-weight:700; border-radius:20px; padding:2px 7px; }
        .label { font-size:0.72rem; font-weight:600; color:#475569; margin-left:6px; }
        .card  { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; margin-top:4px; }
        .claim { display:flex; gap:8px; margin-bottom:3px; font-size:0.73rem; font-family:inherit; }
        .k     { color:#64748b; min-width:90px; }
      </style></head>
      <body>
        <div class="toolbar">
          <h3>Token History — ${esc(history.length)} entries</h3>
          <button onclick="window.opener&&window.opener.postMessage('token-history-clear','${esc(targetOrigin)}')">✕ Clear</button>
          <button onclick="window.close()">✕ Close</button>
        </div>
        <div class="body">
      ${history.map(e => `
        <div class="entry">
          <span class="chip">${e.isLive ? '🔴 LIVE' : 'Step ' + esc(e.stepNum)}</span>
          <span class="label">${esc(e.label || '')}</span>
          ${[e.token, e.token2, e.isTokenExchange ? e.tokenOut : null].filter(Boolean).map(t => `
            <div class="card"><strong style="font-size:0.78rem">${esc(t.type || 'Token')}</strong>
            ${Object.entries(t).filter(([k]) => !['type','_type','_title','_rfcs','note'].includes(k)).map(([k,v]) =>
              `<div class="claim"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>`
            ).join('')}
            ${t.note ? `<div style="font-size:0.68rem;color:#64748b;font-style:italic;margin-top:4px">ℹ ${esc(t.note)}</div>` : ''}
            </div>`).join('')}
        </div>`).join('')}
        </div>
      </body>`;
    w.document.replaceChild(html, w.document.documentElement);
    // Hide the in-browser panel while popout is open
    setVisible(false);
  }, [history, size, pos]);

  if (!visible || !history || history.length === 0) return null;

  return createPortal(
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: size.w, zIndex: 9999,
      background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1',
      boxShadow: '0 8px 40px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', userSelect: 'none', height: open ? size.h : 'auto',
    }}>
      {/* 8 resize handles */}
      {Object.keys(HANDLE_CURSORS).map(dir => (
        <div key={dir} style={handleStyle(dir)} onMouseDown={(e) => onResizeDown(e, dir)} />
      ))}

      {/* Header — drag zone */}
      <div
        onMouseDown={onDragDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
          background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
          cursor: 'grab', flexShrink: 0,
        }}
      >
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.95rem', color: '#475569', padding: 0, lineHeight: 1 }}>
          {open ? '▾' : '▸'}
        </button>
        <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
          Token History ({history.length})
        </span>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={popOut}
          title="Pop out to new window"
          style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer', fontSize: '0.68rem', color: '#374151', padding: '2px 6px' }}
        >🪟 Pop out</button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClear}
          style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer', fontSize: '0.68rem', color: '#374151', padding: '2px 6px' }}
        >✕ Clear</button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setVisible(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#374151', padding: 0, lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Log — vertical scroll, newest at bottom */}
      {open && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {history.map((entry, idx) => (
              <HistoryEntry key={idx} entry={entry} />
            ))}
          </div>
          {/* Footer close button */}
          <div style={{ flexShrink: 0, padding: '6px 10px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setVisible(false)}
              style={{ padding: '3px 10px', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', color: '#374151', background: '#fff' }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
