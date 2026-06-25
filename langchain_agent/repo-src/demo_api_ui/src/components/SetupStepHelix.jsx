import React, { useState } from 'react';
import apiClient from '../services/apiClient';

const SUB_STEPS = [
  { n: 1, label: 'Go to console' },
  { n: 2, label: 'Publish agent' },
  { n: 3, label: 'Get API key' },
  { n: 4, label: 'Fill fields' },
  { n: 5, label: 'Verify' },
];

function SubStepBar({ current }) {
  return (
    <div className="helix-substep-bar">
      {SUB_STEPS.map((s, i) => {
        const state = s.n < current ? 'done' : s.n === current ? 'active' : 'pending';
        return (
          <React.Fragment key={s.n}>
            <div className="helix-substep-node">
              <div className={`badge ${state}`}>{state === 'done' ? '✓' : s.n}</div>
              <div className="label">{s.label}</div>
            </div>
            {i < SUB_STEPS.length - 1 && (
              <div className={`helix-substep-connector ${s.n < current ? 'done' : s.n === current ? 'active' : 'pending'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function SetupStepHelix({ onComplete }) {
  const [subStep, setSubStep] = useState(1);
  const [helixConfig, setHelixConfig] = useState({
    base_url: '', api_key: '', environment_id: '', agent_id: '', prompt_field_id: '',
  });
  const [keyImportError, setKeyImportError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const setField = (k, v) => setHelixConfig(prev => ({ ...prev, [k]: v }));

  const handleImportKey = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.keyValue) {
          setKeyImportError('JSON file has no keyValue field.');
          return;
        }
        if (!data.target || data.scope !== 'agent') {
          setKeyImportError(
            'Wrong key type — this appears to be an env-admin key (target is empty or scope is not "agent"). ' +
            'Create a new key from the agent\'s ⋮ menu in the Helix console.'
          );
          return;
        }
        setKeyImportError(null);
        setField('api_key', data.keyValue);
        if (data.keyName) setField('agent_id', data.keyName);
      } catch {
        setKeyImportError('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const validateFields = () => {
    const errs = {};
    if (!helixConfig.base_url) errs.base_url = 'Required';
    if (!helixConfig.environment_id) errs.environment_id = 'Required';
    if (!helixConfig.prompt_field_id) errs.prompt_field_id = 'Required';
    if (!helixConfig.api_key) errs.api_key = 'Import a key JSON first';
    if (!helixConfig.agent_id) errs.agent_id = 'Required — auto-filled from key JSON';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data } = await apiClient.post('/api/langchain/helix/verify', {
        helix_base_url: helixConfig.base_url,
        helix_api_key: helixConfig.api_key,
        helix_environment_id: helixConfig.environment_id,
        helix_agent_id: helixConfig.agent_id,
        helix_prompt_field_id: helixConfig.prompt_field_id,
      });
      setVerifyResult(data);
      if (data.ok) {
        await apiClient.post('/api/langchain/config', {
          provider: 'helix',
          helix_base_url: helixConfig.base_url,
          helix_api_key: helixConfig.api_key,
          helix_environment_id: helixConfig.environment_id,
          helix_agent_id: helixConfig.agent_id,
          helix_prompt_field_id: helixConfig.prompt_field_id,
        });
        onComplete();
      }
    } catch (err) {
      setVerifyResult({ ok: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <SubStepBar current={subStep} />

      {subStep === 1 && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Open the <a href="https://openam-helix.forgeblocks.com" target="_blank" rel="noreferrer">Helix console</a> in another tab.
            You'll need to be logged in to your Helix tenant.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>Click Next when you're in the console.</p>
          <div className="setup-nav">
            <button className="setup-btn primary" onClick={() => setSubStep(2)}>Next →</button>
          </div>
        </div>
      )}

      {subStep === 2 && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Make sure your agent is <strong>published</strong> — saving is not the same as publishing.
          </p>
          <ol style={{ fontSize: '0.82rem', lineHeight: '1.8', paddingLeft: '1.25rem' }}>
            <li>Go to <strong>Agents</strong> in the Helix console</li>
            <li>Find your agent and open it</li>
            <li>Click <strong>Publish</strong> (or <em>Deploy to Published</em>) in the toolbar</li>
            <li>Wait for the status badge to show <strong>Published</strong> or <strong>Live</strong></li>
          </ol>
          <div className="setup-banner-warn" style={{ marginTop: '0.75rem' }}>
            ⚠️ Changes saved in the designer are not live until published. If API behaviour doesn't change after editing, look for a separate Publish button.
          </div>
          <div className="setup-nav">
            <button className="setup-btn" onClick={() => setSubStep(1)}>← Back</button>
            <button className="setup-btn primary" onClick={() => setSubStep(3)}>Next →</button>
          </div>
        </div>
      )}

      {subStep === 3 && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Create an <strong>agent-scoped</strong> API key for your published agent:
          </p>
          <ol style={{ fontSize: '0.82rem', lineHeight: '1.8', paddingLeft: '1.25rem', marginBottom: '0.75rem' }}>
            <li>In the Helix console, go to <strong>Agents</strong></li>
            <li>Click the <strong>⋮</strong> menu on your published agent card</li>
            <li>Select <strong>Create API Key</strong></li>
            <li>Download the JSON file, then import it here</li>
          </ol>
          <div className="setup-banner-warn">
            ⚠️ Don't use <code>LLM2.json</code> — it's an env-admin key and won't work for agent invocation.
            The correct key JSON has <code>"scope": "agent"</code> and a non-empty <code>target</code>.
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label className="setup-btn" style={{ cursor: 'pointer' }}>
              Import Key JSON
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportKey} />
            </label>
            {helixConfig.api_key && !keyImportError && (
              <span style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>✅ Key imported</span>
            )}
          </div>
          {keyImportError && (
            <div className="setup-banner-error" style={{ marginTop: '0.75rem' }}>{keyImportError}</div>
          )}
          <div className="setup-nav">
            <button className="setup-btn" onClick={() => setSubStep(2)}>← Back</button>
            <button
              className="setup-btn primary"
              disabled={!helixConfig.api_key || !!keyImportError}
              onClick={() => setSubStep(4)}
            >Next →</button>
          </div>
        </div>
      )}

      {subStep === 4 && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Key imported ✅ — API key and agent name auto-filled. Complete the remaining fields:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="setup-field">
              <label>Base URL</label>
              <input value={helixConfig.base_url} onChange={e => setField('base_url', e.target.value)} placeholder="https://openam-helix.forgeblocks.com" />
              <div className="hint">Tenant origin only — no trailing path</div>
              {fieldErrors.base_url && <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>{fieldErrors.base_url}</div>}
            </div>
            <div className="setup-field">
              <label>Environment ID</label>
              <input value={helixConfig.environment_id} onChange={e => setField('environment_id', e.target.value)} placeholder="fe213c3c-9c1d-…" />
              <div className="hint">Console → Settings → UUID</div>
              {fieldErrors.environment_id && <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>{fieldErrors.environment_id}</div>}
            </div>
            <div className="setup-field">
              <label>Agent Name {helixConfig.agent_id && <span style={{ color: '#15803d', fontWeight: 400, fontSize: '0.7rem' }}>✅ auto-filled</span>}</label>
              <input value={helixConfig.agent_id} onChange={e => setField('agent_id', e.target.value)} placeholder="LLM2" />
              <div className="hint">Exact agent name from console (case-sensitive)</div>
              {fieldErrors.agent_id && <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>{fieldErrors.agent_id}</div>}
            </div>
            <div className="setup-field">
              <label>Prompt Field ID</label>
              <input value={helixConfig.prompt_field_id} onChange={e => setField('prompt_field_id', e.target.value)} placeholder="textInput502c5045a61c" />
              <div className="hint">AI Task node → input field ID</div>
              {fieldErrors.prompt_field_id && <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>{fieldErrors.prompt_field_id}</div>}
            </div>
            <div className="setup-field" style={{ gridColumn: '1 / -1' }}>
              <label>API Key {helixConfig.api_key && <span style={{ color: '#15803d', fontWeight: 400, fontSize: '0.7rem' }}>✅ auto-filled</span>}</label>
              <input type="password" value={helixConfig.api_key} readOnly />
            </div>
          </div>
          <div className="setup-nav">
            <button className="setup-btn" onClick={() => setSubStep(3)}>← Back</button>
            <button className="setup-btn primary" onClick={() => { if (validateFields()) setSubStep(5); }}>Next → Verify</button>
          </div>
        </div>
      )}

      {subStep === 5 && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Testing connection to Helix agent <strong>{helixConfig.agent_id}</strong>…
          </p>
          {!verifyResult && !verifying && (
            <button className="setup-btn primary" onClick={handleVerify}>Run connection test</button>
          )}
          {verifying && <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>Connecting…</p>}
          {verifyResult && verifyResult.ok && (
            <div className="setup-banner-success">
              ✅ Helix connected — conversation created and test message replied successfully.
            </div>
          )}
          {verifyResult && !verifyResult.ok && (
            <>
              <div className="setup-banner-error">❌ {verifyResult.error}</div>
              <button className="setup-btn" onClick={handleVerify} style={{ marginTop: '0.5rem' }}>Retry</button>
            </>
          )}
          <div className="setup-nav">
            <button className="setup-btn" onClick={() => setSubStep(4)}>← Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
