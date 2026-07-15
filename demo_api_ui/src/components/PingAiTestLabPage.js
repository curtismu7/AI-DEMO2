import { useState, useEffect, useRef } from 'react';
import JsonHighlight from './shared/JsonHighlight';
import './PingAiTestLabPage.css';

// Status glyphs restricted to the REGRESSION_PLAN §0 emoji allowlist.
const STATUS_META = {
  pass:           { glyph: '✅', label: 'Pass',           cls: 'patl-pass' },
  fail:           { glyph: '❌', label: 'Fail',           cls: 'patl-fail' },
  not_run:        { glyph: '⚠️', label: 'Not run',        cls: 'patl-notrun' },
  not_configured: { glyph: '⚠️', label: 'Not configured', cls: 'patl-notconf' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { glyph: '⚠️', label: status || 'unknown', cls: 'patl-notrun' };
  return (
    <span className={`patl-status ${meta.cls}`}>
      <span aria-hidden="true">{meta.glyph}</span> {meta.label}
    </span>
  );
}

function ResultRow({ test, result, running, onRun }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`patl-row ${result ? '' : 'patl-row-idle'}`}>
      <div className="patl-row-main">
        <button
          type="button"
          className="patl-row-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={!result}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="patl-row-label">{test.label}</span>
        {test.runnableCount != null && (
          <span className="patl-row-hint">{test.runnableCount}/{test.checkCount} checks runnable</span>
        )}
        <span className="patl-row-spacer" />
        {result?.latencyMs != null && <span className="patl-latency">{result.latencyMs} ms</span>}
        {result ? <StatusBadge status={result.status} /> : null}
        <button type="button" className="patl-btn patl-btn-small" disabled={!!running} onClick={() => onRun(test.key)}>
          Run
        </button>
      </div>
      {open && result && (
        <div className="patl-row-detail">
          <pre className="patl-json"><JsonHighlight value={result.detail ?? result} deep /></pre>
        </div>
      )}
    </div>
  );
}

export default function PingAiTestLabPage() {
  const [suites, setSuites] = useState([]);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null); // null | 'all' | suiteKey | testKey
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    fetch('/api/admin/ping-ai-test-lab/suites', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setSuites(data.suites || []))
      .catch((err) => setError(`Failed to load test catalog: ${err.message}`));
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  const runOne = async (testKey) => {
    if (running) return;
    setRunning(testKey);
    setError(null);
    try {
      const res = await fetch('/api/admin/ping-ai-test-lab/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ testKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResults((prev) => ({ ...prev, [testKey]: body }));
    } catch (err) {
      setError(`${testKey}: ${err.message}`);
    } finally {
      setRunning(null);
    }
  };

  const runStream = async (suiteKeys, runKey) => {
    if (running) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(runKey);
    setSummary(null);
    setError(null);
    setProgress({ done: 0 });
    try {
      const qs = suiteKeys ? `?suites=${encodeURIComponent(suiteKeys.join(','))}` : '';
      const res = await fetch(`/api/admin/ping-ai-test-lab/run-all${qs}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let done = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop();
        for (const frame of frames) {
          const eventMatch = frame.match(/^event: (\w+)/m);
          const dataMatch = frame.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;
          const payload = JSON.parse(dataMatch[1]);
          if (eventMatch[1] === 'result') {
            done += 1;
            setProgress({ done });
            setResults((prev) => ({ ...prev, [payload.key]: payload }));
          } else if (eventMatch[1] === 'done') {
            setSummary(payload.summary);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(`Run failed: ${err.message}`);
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  const copyResults = () => {
    navigator.clipboard.writeText(JSON.stringify({ summary, results }, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const evalsSuite = suites.find((s) => s.key === 'evals');
  const evalStages = evalsSuite
    ? [...new Set(evalsSuite.tests.map((t) => t.stage))]
    : [];

  return (
    <div className="patl-page">
      <header className="patl-header">
        <h1>Ping AI Test Lab</h1>
        <p className="patl-sub">
          Exercises Ping&apos;s AI-first headless identity surface — Agent Skills + connectivity,
          live MCP calls, demo launcher use cases (UC1 PERMIT and attack-sim DENYs), and
          ping-bench CIAM eval checks. PingOne is reached only through CLI, skills, and MCP
          servers; never direct Management API calls.
        </p>
        <div className="patl-actions">
          <button type="button" className="patl-btn patl-btn-primary" disabled={!!running} onClick={() => runStream(null, 'all')}>
            {running === 'all' ? `Running… ${progress?.done ?? 0}` : 'Run everything'}
          </button>
          <button type="button" className="patl-btn" disabled={!Object.keys(results).length} onClick={copyResults}>
            {copied ? '✓ Copied' : 'Copy results JSON'}
          </button>
          {summary && (
            <span className="patl-summary">
              {Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}
            </span>
          )}
        </div>
        {error && <div className="patl-error">❌ {error}</div>}
      </header>

      {suites.filter((s) => s.key !== 'evals').map((suite) => (
        <section key={suite.key} className="patl-suite">
          <div className="patl-suite-head">
            <h2>{suite.label}</h2>
            <p>{suite.description}</p>
            <button
              type="button"
              className="patl-btn patl-btn-small"
              disabled={!!running}
              onClick={() => runStream([suite.key], suite.key)}
            >
              {running === suite.key ? `Running… ${progress?.done ?? 0}` : 'Run suite'}
            </button>
          </div>
          {suite.tests.map((test) => (
            <ResultRow key={test.key} test={test} result={results[test.key]} running={running} onRun={runOne} />
          ))}
        </section>
      ))}

      {evalsSuite && (
        <section className="patl-suite">
          <div className="patl-suite-head">
            <h2>{evalsSuite.label}</h2>
            <p>{evalsSuite.description}</p>
            <button
              type="button"
              className="patl-btn patl-btn-small"
              disabled={!!running}
              onClick={() => runStream(['evals'], 'evals')}
            >
              {running === 'evals' ? `Running… ${progress?.done ?? 0}` : 'Run all eval rows'}
            </button>
          </div>
          {evalStages.map((stage) => (
            <div key={stage} className="patl-stage">
              <h3 className="patl-stage-title">{stage}</h3>
              {evalsSuite.tests.filter((t) => t.stage === stage).map((test) => (
                <ResultRow key={test.key} test={test} result={results[test.key]} running={running} onRun={runOne} />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
