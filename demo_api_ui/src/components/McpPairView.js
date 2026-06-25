// banking_api_ui/src/components/McpPairView.js
import React, { useState, useMemo } from 'react';
import JsonHighlight from './shared/JsonHighlight';
import './McpPairView.css';

function PairRow({ req, resp }) {
  const [open, setOpen] = useState(false);
  const tool = req?.tool || resp?.tool || req?.method || '—';
  const ts = req?.ts ? new Date(req.ts).toLocaleTimeString([], {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  }) : '—';
  const durationMs = resp?.durationMs ?? req?.durationMs;
  const isErr = resp?.type === 'error' || resp?.ok === false || req?.ok === false;
  const isPending = !resp;

  const statusLabel = isErr ? 'ERROR' : isPending ? 'PENDING' : 'OK';
  const statusCls = isErr ? 'mpv-pair-status--err' : isPending ? 'mpv-pair-status--pending' : 'mpv-pair-status--ok';

  return (
    <div className="mpv-pair">
      <div className="mpv-pair-header" onClick={() => setOpen(o => !o)}>
        <span className={`mpv-pair-chevron${open ? ' mpv-pair-chevron--open' : ''}`}>▶</span>
        <span className="mpv-pair-tool">{tool}</span>
        <span className="mpv-pair-ts">{ts}</span>
        <span className={`mpv-pair-status ${statusCls}`}>{statusLabel}</span>
        {durationMs != null && <span className="mpv-pair-dur">{durationMs}ms</span>}
        {req?.summary && <span style={{ fontSize: '0.75rem', color: '#374151', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{req.summary}</span>}
      </div>
      {open && (
        <div className="mpv-pair-body">
          <div className="mpv-pair-side">
            <div className="mpv-side-label">Request → {req?.dir || 'BFF→MCP'}</div>
            {req ? (
              <pre className="mpv-json jh-dark"><JsonHighlight value={req.payload} deep /></pre>
            ) : (
              <pre className="mpv-json mpv-json--absent">No request captured</pre>
            )}
          </div>
          <div className="mpv-pair-side">
            <div className="mpv-side-label">Response ← {resp?.dir || 'MCP→BFF'}</div>
            {resp ? (
              <pre className="mpv-json jh-dark"><JsonHighlight value={resp.payload} deep /></pre>
            ) : (
              <pre className="mpv-json mpv-json--absent">Awaiting response…</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function McpPairView({ entries }) {
  const pairs = useMemo(() => {
    const byCorr = {};
    const order = [];

    for (const entry of entries) {
      const corrId = entry.correlationId;
      if (!corrId) continue;

      if (!byCorr[corrId]) {
        byCorr[corrId] = { req: null, resp: null };
        order.push(corrId);
      }

      const isOutbound = entry.dir === 'BFF→MCP' || entry.dir === 'BFF→PingOne' || entry.dir === 'BFF→Authorize';
      if (isOutbound) {
        byCorr[corrId].req = entry;
      } else {
        byCorr[corrId].resp = entry;
      }
    }

    return order.map(id => byCorr[id]).reverse();
  }, [entries]);

  if (pairs.length === 0) {
    return (
      <div className="mpv-root">
        <div className="mpv-empty">
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔌</div>
          No correlated pairs yet. Use the AI agent to generate MCP tool calls.
        </div>
      </div>
    );
  }

  return (
    <div className="mpv-root">
      {pairs.map((pair, i) => {
        const key = pair.req?.correlationId || pair.resp?.correlationId || String(i);
        return <PairRow key={key} req={pair.req} resp={pair.resp} />;
      })}
    </div>
  );
}
