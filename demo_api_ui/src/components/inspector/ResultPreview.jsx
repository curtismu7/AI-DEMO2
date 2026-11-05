import React, { useEffect, useMemo, useRef, useState } from 'react';
import JsonFormView from '../shared/JsonFormView.jsx';
import { Chip } from './CallDetail.jsx';
import { ok, err, idle } from './inspectorCalls.js';
import { readableResult, failureMessage } from './readableResult.js';
import { isProtocolMethod, listOf } from './protocolMethod.js';

/** Calls whose response is an MCP tool result worth reading as an answer. */
export const RESULT_KINDS = ['mcp', 'tools/call'];

const WORDS = {
  tool: { ret: 'What the tool returned', no: 'Why the tool did not run', error: 'Tool reported an error', noChip: 'Tool did not run' },
  server: { ret: 'What the server returned', no: 'Why the server did not answer', error: 'Server reported an error', noChip: 'No answer' },
};

const textOf = (blocks) => blocks.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b.value, null, 2))).join('\n\n');

/**
 * The call, classified for the card:
 *  - 'tool'    the tool ran and answered (its words, or its data)
 *  - 'tool-error'  the tool ran and reported isError
 *  - 'not-run' a denial, auth failure, rate limit, hold or protocol error: the tool never spoke
 */
function classify(call, result) {
  if (result.isError && result.ranTool) return 'tool-error';
  const tone = call.status?.tone;
  if (result.isError || tone === 'err' || tone === 'warn') return 'not-run';
  return 'tool';
}

/** A *list result (resources, prompts, templates, tools) as names with a one-line description each. */
function ProtocolList({ list }) {
  const { noun, items } = list;
  return (
    <div className="insp-result-data" tabIndex={0} role="region" aria-label={`Server output: ${noun} list`}>
      <p className="insp-result-count">{items.length === 1 ? `1 ${noun}` : `${items.length} ${noun}s`}</p>
      {items.length === 0 ? <p className="insp-empty">{`The server lists no ${noun}s.`}</p> : (
        <ul className="insp-list">
          {items.map((it, i) => (
            <li key={`${it.title}-${i}`}>
              <strong className="mono">{it.title}</strong>
              {it.subtitle && <span className="insp-list-sub mono">{it.subtitle}</span>}
              {it.description && <span className="insp-list-desc">{it.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "What the tool returned" — the answer itself, not the JSON-RPC envelope around it.
 * Prose stays prose (line breaks kept); structured results use the same readable
 * Key Values view as the Form toggle. The raw frames remain in Request & response.
 * When the tool never ran (denied, held, rate limited) it says why instead of
 * presenting the refusal as an answer.
 */
export default function ResultPreview({ call }) {
  const result = useMemo(() => readableResult(call?.response?.body), [call]);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => { setCopied(false); }, [call?.id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Log records (input.partial) carry an audit decision, not a tool result; a call that has
  // not finished and has no body yet (waiting on you, in flight) has nothing to show.
  if (!call || !RESULT_KINDS.includes(call.kind) || call.input?.partial) return null;
  if (call.ms == null && (call.response?.body === null || call.response?.body === undefined)) return null;

  const protocol = isProtocolMethod(call.title);
  const w = protocol ? WORDS.server : WORDS.tool;
  const mode = classify(call, result);
  const notRun = mode === 'not-run';
  const blocks = result.blocks.length || !notRun || !call.banner?.text ? result.blocks : [{ type: 'text', text: call.banner.text }];
  const chip = mode === 'tool-error'
    ? err(w.error)
    : notRun
      ? { tone: call.status?.tone === 'warn' ? 'warn' : 'err', label: w.noChip }
      : blocks.length === 0 ? idle('Nothing returned') : ok('Returned');
  const failed = mode === 'tool-error' || (notRun && result.isError);
  const copyText = textOf(blocks) || failureMessage(result);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — the text is selectable */
    }
  };

  return (
    <section className="insp-card insp-result" aria-label={notRun ? w.no : w.ret}>
      <div className="insp-result-head">
        <h2 className="insp-label">{notRun ? w.no : w.ret}</h2>
        <Chip chip={chip} />
      </div>
      {blocks.length === 0 && (
        <p className="insp-empty">The tool sent back no content. The full response is in Request &amp; response.</p>
      )}
      {blocks.map((b, i) => (b.type === 'text'
        ? (
          <p key={i} className={failed ? 'insp-prose insp-prose--err' : 'insp-prose'} tabIndex={0} role="region" aria-label="Tool output text">{b.text}</p>
        )
        : (protocol && listOf(b.value))
          ? <ProtocolList key={i} list={listOf(b.value)} />
          : (
            <div key={i} className="insp-result-data" tabIndex={0} role="region" aria-label="Tool output data"><JsonFormView value={b.value} /></div>
          )))}
      {blocks.length > 0 && (
        <button type="button" className="insp-btn ghost insp-result-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      )}
      <span className="insp-sr" aria-live="polite">{copied ? 'Copied to the clipboard' : ''}</span>
    </section>
  );
}
