import { useState } from 'react';
import { HOSTILE_MCP_SCENARIOS } from '../../config/hostileMcpScenarios';

function sourceText(source, payload) {
  if (source.kind === 'tool') return payload?.description || 'Tool metadata was not discovered yet.';
  if (source.kind === 'resource') return (payload?.contents || []).map((content) => content.text || '').join('\n') || 'Resource returned no text content.';
  return (payload?.messages || []).map((message) => message.content?.text || '').join('\n') || 'Prompt returned no text content.';
}

function resultText(result) {
  return result ? JSON.stringify(result, null, 2) : '';
}

export default function HostileMcpDenialPanel({ tools = [], onRequest, onCall }) {
  const [scenarioId, setScenarioId] = useState(HOSTILE_MCP_SCENARIOS[0].id);
  const [sourcePayload, setSourcePayload] = useState(null);
  const [scannerFinding, setScannerFinding] = useState(null);
  const [inducedCall, setInducedCall] = useState(null);
  const [privilegeResult, setPrivilegeResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scenario = HOSTILE_MCP_SCENARIOS.find((entry) => entry.id === scenarioId) || HOSTILE_MCP_SCENARIOS[0];

  const runScenario = async () => {
    setBusy(true);
    setError('');
    setSourcePayload(null);
    setPrivilegeResult(null);
    setInducedCall(null);
    setScannerFinding(scenario.scanner);
    try {
      let payload = null;
      if (scenario.source.kind === 'tool') {
        payload = tools.find((tool) => tool.name === scenario.source.label) || null;
      } else if (onRequest) {
        const response = await onRequest({ method: scenario.source.method, params: scenario.source.params });
        payload = response?.result || response;
      }
      setSourcePayload(payload);
      setInducedCall(scenario.inducedCall);
      try {
        const response = await onCall(scenario.inducedCall);
        setPrivilegeResult({ ok: true, response });
      } catch (callError) {
        setPrivilegeResult({
          ok: false,
          status: callError.status,
          code: callError.code,
          reason: callError.reason || callError.message,
          provider: callError.provider,
          route: callError.route,
        });
      }
    } catch (runError) {
      setError(runError.message || 'Scenario could not run.');
    } finally {
      setBusy(false);
    }
  };

  const denied = privilegeResult && !privilegeResult.ok;
  return (
    <section className="cur-hostile-panel" aria-labelledby="hostile-panel-title">
      <div className="cur-hostile-panel__header">
        <div>
          <p className="cur-hostile-panel__eyebrow">Hostile MCP · Privilege backstop</p>
          <h2 id="hostile-panel-title">Content reaches the agent. Privilege stops the action.</h2>
          <p>Select poisoned tool, resource, or prompt content, then send the induced call through the current MCP path.</p>
        </div>
        <label className="cur-field cur-hostile-panel__selector">
          <span className="cur-field-label">Scenario</span>
          <select aria-label="Hostile MCP scenario" className="cur-input" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            {HOSTILE_MCP_SCENARIOS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
      </div>
      <p className="cur-hostile-panel__summary">{scenario.summary}</p>
      <button type="button" className="cur-btn cur-btn--primary" onClick={runScenario} disabled={busy || !onCall}>
        {busy ? 'Running scenario…' : 'Run denial scenario'}
      </button>
      {error && <p className="cur-hostile-panel__error" role="alert">{error}</p>}
      <div className="cur-hostile-panel__evidence">
        <article>
          <h3>Hostile content</h3>
          <span className="cur-hostile-panel__meta">{scenario.source.kind} · {scenario.source.label}</span>
          <pre>{sourcePayload ? sourceText(scenario.source, sourcePayload) : 'Run the scenario to fetch the hostile content.'}</pre>
        </article>
        <article>
          <h3>Scanner finding</h3>
          {scannerFinding ? <><strong>{scannerFinding.kind}</strong><p>{scannerFinding.detail}</p></> : <p>Not scanned yet.</p>}
        </article>
        <article>
          <h3>Induced action</h3>
          <pre>{inducedCall ? resultText(inducedCall) : 'No tool call attempted yet.'}</pre>
        </article>
        <article className={denied ? 'cur-hostile-panel__decision cur-hostile-panel__decision--denied' : 'cur-hostile-panel__decision'}>
          <h3>Privilege decision</h3>
          {denied ? (
            <>
              <strong>Privilege denied the resulting action</strong>
              <p>{[privilegeResult.status, privilegeResult.code, privilegeResult.reason, privilegeResult.provider, privilegeResult.route].filter(Boolean).join(' · ')}</p>
            </>
          ) : privilegeResult?.ok ? (
            <><strong>Privilege allowed the resulting action</strong><pre>{resultText(privilegeResult.response)}</pre></>
          ) : <p>No gateway decision yet.</p>}
        </article>
      </div>
    </section>
  );
}
