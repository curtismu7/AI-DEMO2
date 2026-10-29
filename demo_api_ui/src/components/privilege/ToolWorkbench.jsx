// ToolWorkbench — the Tools tab as "request and response": pick a tool (chips; a ✋ HITL badge marks the ones a policy
// holds for a human), edit the request on the left with the exact JSON-RPC it sends, read the response on the right.
// The response is supplied by the page (it owns the result, the HITL hold and the approver popup).
import { useEffect, useMemo, useState } from 'react';
import { EnumParamFields, missingRequiredParams, normalizeTools, paramsOf, seedArgs, tryParseArgs } from './ToolsTable';
import './ToolWorkbench.css';

// Starting arguments for tools whose blank form can never run, so the demo works on the first click.
const DEFAULT_ARGS = {
  SearchIndexTool: { index: '_all', query_dsl: { query: { match_all: {} } } },
};
const startingArgs = (tool) => {
  const seeded = JSON.parse(seedArgs(tool));
  return JSON.stringify(DEFAULT_ARGS[tool.name] ? { ...seeded, ...DEFAULT_ARGS[tool.name] } : seeded, null, 2);
};

export default function ToolWorkbench({ tools: rawTools, onExecute, hitlTools = {}, response, onPresent, selectedTool = null, selectNonce = 0 }) {
  const tools = useMemo(() => normalizeTools(rawTools), [rawTools]);
  const [current, setCurrent] = useState('');
  const [argsByTool, setArgsByTool] = useState({});
  const [busy, setBusy] = useState(false);

  // A tool picked in the left rail wins; otherwise the first tool, so Run is never a dead button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on selectNonce so re-picking the same tool re-selects it.
  useEffect(() => {
    if (selectedTool && tools.some((t) => t.name === selectedTool)) setCurrent(selectedTool);
  }, [selectNonce]);
  const tool = tools.find((t) => t.name === current) || tools[0] || null;
  const params = useMemo(() => (tool ? paramsOf(tool) : []), [tool]);
  const args = tool ? (argsByTool[tool.name] ?? startingArgs(tool)) : '{}';
  const setArgs = (v) => setArgsByTool((m) => ({ ...m, [tool.name]: v }));
  const missing = missingRequiredParams(params, args);
  const policy = tool ? hitlTools[tool.name] : null;

  if (!tool) return <div className="ptw ptw--empty">No tools discovered yet</div>;

  // The wire format the Run button sends, rebuilt from the box as it is edited.
  const request = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: tool.name, arguments: tryParseArgs(args) } }, null, 2);
  const run = async () => {
    setBusy(true);
    try { await onExecute(tool.name, args); } finally { setBusy(false); }
  };

  return (
    <div className="ptw">
      <div className="ptw-bar">
        <div className="ptw-chips" role="tablist" aria-label="MCP tools">
          {tools.map((t) => (
            <button
              key={t.name}
              type="button"
              role="tab"
              aria-selected={t.name === tool.name}
              className={`ptw-chip${t.name === tool.name ? ' ptw-chip--on' : ''}`}
              onClick={() => setCurrent(t.name)}
              title={t.description || t.name}
            >
              {t.name}
              {hitlTools[t.name] && <span className="ptw-hitl" title={`Held for human approval by ${hitlTools[t.name]}`}>✋ HITL</span>}
            </button>
          ))}
        </div>
        {onPresent && <button type="button" className="ptw-present" onClick={onPresent}>Present</button>}
      </div>
      <div className="ptw-cols">
        <section className="ptw-col" aria-label="Request">
          <div className="ptw-head">
            <h3 className="ptw-h">Request <span className="ptw-sub">tools/call · {tool.name}</span></h3>
            {/* Up here, not under the JSON: in the short Tools area the old position sat below the fold. */}
            <button type="button" className="ptw-run" onClick={run} disabled={busy || missing.length > 0} title={missing.length ? `Fill in: ${missing.map((p) => p.name).join(', ')}` : undefined}>{busy ? 'Running…' : 'Run'}</button>
          </div>
          {tool.description && <p className="ptw-desc">{tool.description}</p>}
          {policy && (
            <p className="ptw-policy" data-testid="hitl-tool-note">
              ✋ Held for human approval by <code>{policy}</code>. Run will pause until someone approves it in Privilege.
            </p>
          )}
          <EnumParamFields params={params} args={args} onArgs={setArgs} />
          <label className="ptw-label" htmlFor="ptw-args">Arguments (JSON)</label>
          <textarea id="ptw-args" className="ptw-args" rows={Math.min(8, Math.max(3, args.split('\n').length))} value={args} onChange={(e) => setArgs(e.target.value)} />
          {missing.length > 0 && <div className="ptt-missing-required">Missing required: {missing.map((p) => p.name).join(', ')} — this call will not run until filled in.</div>}
          <div className="ptw-label">Sends</div>
          <pre className="ptw-wire">{request}</pre>
        </section>
        <section className="ptw-col" aria-label="Response">
          <h3 className="ptw-h">Response</h3>
          {response || <p className="ptw-desc">Run <code>{tool.name}</code> to see what comes back.</p>}
        </section>
      </div>
    </div>
  );
}
