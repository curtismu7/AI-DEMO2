// ToolsTable — the MCP tool catalogue as a wide table, the centrepiece of the
// Privilege MCP Client page. Columns: Tool / Description / Resources / Run.
// Click a row to expand an inline args box + Execute + result. In presentMode
// it is display-only (no Run, no expand) for projecting during a demo.
import { useEffect, useMemo, useRef, useState } from 'react';
import JsonHighlight from '../shared/JsonHighlight';
import './ToolsTable.css';

function paramsOf(tool) {
  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required ?? []);
  return Object.entries(props).map(([name, schema]) => ({
    name,
    type: (schema && schema.type) || 'any',
    required: required.has(name),
  }));
}

// Prefill an args object with one empty entry per property, so the box shows the
// shape the tool expects instead of a bare {}.
function seedArgs(tool) {
  const props = tool.inputSchema?.properties || {};
  const keys = Object.keys(props);
  if (keys.length === 0) return '{}';
  const obj = {};
  for (const k of keys) obj[k] = props[k]?.type === 'boolean' ? false : '';
  return JSON.stringify(obj, null, 2);
}

export default function ToolsTable({ tools, presentMode = false, onExecute, onClose, onPresent, selectedTool = null, selectNonce = 0 }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState('');
  const [argsByTool, setArgsByTool] = useState({});
  const [resultByTool, setResultByTool] = useState({});
  // Per-tool, not a single shared name: starting tool B while A is still in
  // flight used to clear A's busy flag, re-enabling its Run button mid-call.
  const [busyTools, setBusyTools] = useState({});
  const scrollRef = useRef(null);

  // A tool picked in the left rail reveals it here: clear any filter that would
  // hide it, expand its detail (seeding args), and scroll it into view. Keyed on
  // selectNonce so re-picking the same tool re-triggers the reveal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on selectNonce only — the current selectedTool/tools are read at fire time, and adding them would re-scroll on unrelated renders.
  useEffect(() => {
    if (!selectedTool || presentMode) return;
    setFilter('');
    setExpanded(selectedTool);
    const tool = tools.find((t) => t.name === selectedTool);
    if (tool) setArgsByTool((m) => (m[selectedTool] === undefined ? { ...m, [selectedTool]: seedArgs(tool) } : m));
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-tool-row="${selectedTool}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectNonce]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q),
    );
  }, [tools, filter]);

  const toggle = (name, tool) => {
    if (presentMode) return;
    setExpanded((cur) => {
      const next = cur === name ? '' : name;
      if (next && argsByTool[name] === undefined) {
        setArgsByTool((m) => ({ ...m, [name]: seedArgs(tool) }));
      }
      return next;
    });
  };

  const run = async (name, tool) => {
    setBusyTools((m) => ({ ...m, [name]: true }));
    try {
      const result = await onExecute(name, argsByTool[name] ?? seedArgs(tool));
      setResultByTool((m) => ({ ...m, [name]: result }));
    } catch (err) {
      // A rejected execute must still surface in the row and clear busy —
      // otherwise the tool sits on "Executing..." forever with no explanation.
      setResultByTool((m) => ({ ...m, [name]: { error: err?.message || String(err) } }));
    } finally {
      setBusyTools((m) => {
        const { [name]: _done, ...rest } = m;
        return rest;
      });
    }
  };

  return (
    <div className={`ptt${presentMode ? ' ptt--present' : ''}`}>
      <div className="ptt-header">
        <span className="ptt-title">
          MCP Tools <span className="ptt-count">{tools.length}</span>
        </span>
        {presentMode ? (
          <button type="button" className="ptt-close" onClick={onClose} title="Close (Esc)">
            &#x2715;
          </button>
        ) : (
          <div className="ptt-header-actions">
            <input
              className="ptt-filter"
              placeholder="Filter tools..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {onPresent && tools.length > 0 && (
              <button type="button" className="ptt-present-btn" onClick={onPresent} title="Full-screen present mode">
                Present
              </button>
            )}
          </div>
        )}
      </div>

      <div className="ptt-scroll" ref={scrollRef}>
        <table className="ptt-table">
          <thead>
            <tr>
              <th className="ptt-col-tool">Tool</th>
              <th className="ptt-col-desc">Description</th>
              <th className="ptt-col-res">Resources</th>
              {!presentMode && <th className="ptt-col-run">Run</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={presentMode ? 3 : 4} className="ptt-empty">
                  {tools.length === 0 ? 'No tools discovered yet' : `No tools match "${filter}"`}
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const params = paramsOf(t);
              const isOpen = expanded === t.name;
              return (
                <FragmentRow
                  key={t.name}
                  tool={t}
                  params={params}
                  isOpen={isOpen}
                  selected={t.name === selectedTool}
                  presentMode={presentMode}
                  onToggle={() => toggle(t.name, t)}
                  args={argsByTool[t.name] ?? '{}'}
                  onArgs={(v) => setArgsByTool((m) => ({ ...m, [t.name]: v }))}
                  result={resultByTool[t.name]}
                  busy={Boolean(busyTools[t.name])}
                  onRun={() => run(t.name, t)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ tool, params, isOpen, selected = false, presentMode, onToggle, args, onArgs, result, busy, onRun }) {
  return (
    <>
      <tr data-tool-row={tool.name} className={`ptt-row${isOpen ? ' ptt-row--open' : ''}${selected ? ' ptt-row--selected' : ''}${presentMode ? '' : ' ptt-row--click'}`} onClick={onToggle}>
        <td className="ptt-col-tool"><span className="ptt-name">{tool.name}</span></td>
        <td className="ptt-col-desc">{tool.description || ''}</td>
        <td className="ptt-col-res">
          {params.length === 0 ? (
            <span className="ptt-none">(none)</span>
          ) : (
            <div className="ptt-params">
              {params.map((p) => (
                <span key={p.name} className={`ptt-param${p.required ? ' ptt-param--req' : ''}`} title={`${p.type}${p.required ? ' · required' : ''}`}>
                  {p.name}{p.required ? '*' : ''}
                </span>
              ))}
            </div>
          )}
        </td>
        {!presentMode && (
          <td className="ptt-col-run">
            <button
              type="button"
              className="ptt-run"
              onClick={(e) => { e.stopPropagation(); if (!isOpen) onToggle(); onRun(); }}
              disabled={busy}
            >
              {busy ? '...' : 'Run'}
            </button>
          </td>
        )}
      </tr>
      {isOpen && !presentMode && (
        <tr className="ptt-detail-row">
          <td colSpan={4}>
            <div className="ptt-detail">
              {params.length > 0 && (
                <div className="ptt-detail-res">
                  {params.map((p) => (
                    <span key={p.name} className="ptt-detail-param">
                      <code>{p.name}</code> · {p.type}{p.required ? ' · required' : ''}
                    </span>
                  ))}
                </div>
              )}
              <span className="ptt-args-label">Arguments (JSON)</span>
              <textarea
                className="ptt-args"
                aria-label="Arguments (JSON)"
                rows={Math.min(8, Math.max(2, args.split('\n').length))}
                value={args}
                onChange={(e) => onArgs(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <button type="button" className="ptt-execute" onClick={(e) => { e.stopPropagation(); onRun(); }} disabled={busy}>
                {busy ? 'Executing...' : 'Execute'}
              </button>
              {result !== undefined && (
                <>
                  <div className="ptt-result-label">Result</div>
                  <pre className="ptt-result jh-dark"><JsonHighlight value={result} deep /></pre>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
