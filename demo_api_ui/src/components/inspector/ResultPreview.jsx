import React, { useMemo, useState } from 'react';
import JsonFormView from '../shared/JsonFormView.jsx';
import { Chip } from './CallDetail.jsx';
import { ok, err, idle } from './inspectorCalls.js';
import { readableResult } from './readableResult.js';

/** Calls whose response is an MCP tool result worth reading as an answer. */
export const RESULT_KINDS = ['mcp', 'tools/call'];

const textOf = (blocks) => blocks.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b.value, null, 2))).join('\n\n');

/**
 * "What the tool returned" — the answer itself, not the JSON-RPC envelope around it.
 * Prose stays prose (line breaks kept); structured results use the same readable
 * Key Values view as the Form toggle. The raw frames remain in Request & response.
 */
export default function ResultPreview({ call }) {
  const result = useMemo(() => readableResult(call?.response?.body), [call]);
  const [copied, setCopied] = useState(false);
  if (!call || !RESULT_KINDS.includes(call.kind)) return null;

  const chip = result.isError ? err('Tool reported an error') : result.kind === 'empty' ? idle('Nothing returned') : ok('Returned');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textOf(result.blocks));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — the text is selectable */
    }
  };

  return (
    <section className="insp-card insp-result" aria-label="What the tool returned">
      <div className="insp-result-head">
        <h2 className="insp-label">What the tool returned</h2>
        <Chip chip={chip} />
      </div>
      {result.blocks.length === 0 && (
        <p className="insp-empty">The tool sent back no content. The full response is in Request &amp; response.</p>
      )}
      {result.blocks.map((b, i) => (b.type === 'text'
        ? <p key={i} className={result.isError ? 'insp-prose insp-prose--err' : 'insp-prose'}>{b.text}</p>
        : <div key={i} className="insp-result-data"><JsonFormView value={b.value} /></div>))}
      {result.blocks.length > 0 && (
        <button type="button" className="insp-btn ghost insp-result-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      )}
    </section>
  );
}
