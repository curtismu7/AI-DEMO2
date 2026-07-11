import { useCallback, useState } from 'react';

export function deriveVerdict(results) {
  const list = Object.values(results);
  if (!list.length) return null;
  if (list.some((r) => r.status === 'fail')) return 'not_ready';
  if (list.some((r) => r.status === 'warn')) return 'ready_with_warnings';
  return 'ready';
}

// Parse a fetch ReadableStream of SSE frames, invoking onEvent(eventName, data).
async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const ev = /event: (.*)/.exec(frame)?.[1];
      const dataLine = /data: (.*)/.exec(frame)?.[1];
      if (ev && dataLine) onEvent(ev, JSON.parse(dataLine));
    }
  }
}

export function useCheckRun() {
  const [catalog, setCatalog] = useState(null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);

  const loadCatalog = useCallback(async () => {
    const res = await fetch('/api/check/catalog', { credentials: 'include' });
    setCatalog(await res.json());
  }, []);

  const setResult = useCallback((r) => setResults((prev) => ({ ...prev, [r.id]: r })), []);

  const runAll = useCallback(async ({ includeHeavy = false } = {}) => {
    setRunning(true);
    try {
      const res = await fetch('/api/check/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeHeavy }),
      });
      await readSse(res, (ev, data) => { if (ev === 'result') setResult(data); });
    } finally { setRunning(false); }
  }, [setResult]);

  return { catalog, results, verdict: deriveVerdict(results), running, loadCatalog, runAll, setResult };
}
