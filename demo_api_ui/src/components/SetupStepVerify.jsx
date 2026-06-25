import React, { useState, useCallback } from 'react';
import apiClient from '../services/apiClient';

function CheckRow({ label, status }) {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '…';
  return (
    <div className="verify-check-row">
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

export default function SetupStepVerify({ onEnvDownload }) {
  const [checks, setChecks] = useState({});
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);

  const runChecks = useCallback(async () => {
    setRunning(true);
    setRan(false);
    const results = {};

    try {
      await apiClient.get('/api/healthz');
      results.bff = 'pass';
    } catch { results.bff = 'fail'; }

    try {
      await apiClient.get('/api/health/mcp-server');
      results.mcp = 'pass';
    } catch { results.mcp = 'fail'; }

    try {
      await apiClient.get('/api/health/mcp-gateway');
      results.gateway = 'pass';
    } catch { results.gateway = 'fail'; }

    try {
      const { data } = await apiClient.get('/api/admin/setup/management-probe');
      results.pingone = data?.ok ? 'pass' : 'fail';
    } catch { results.pingone = 'fail'; }

    try {
      const { data } = await apiClient.get('/api/langchain/provider/helix/status');
      results.helix = data?.status === 'configured' ? 'pass' : 'fail';
    } catch { results.helix = 'fail'; }

    results.bootstrap = results.pingone === 'pass' ? 'pass' : 'fail';

    setChecks(results);
    setRunning(false);
    setRan(true);
  }, []);

  const allPass = ran && Object.values(checks).every(v => v === 'pass');
  const anyFail = ran && Object.values(checks).some(v => v === 'fail');

  return (
    <div>
      {!ran && (
        <div className="setup-card">
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Run health checks to confirm all services are up and configuration is complete before your demo.
          </p>
          <button className="setup-btn primary" onClick={runChecks} disabled={running}>
            {running ? 'Checking…' : 'Run checks'}
          </button>
        </div>
      )}

      {ran && (
        <>
          <div className="verify-grid">
            <div className="verify-panel">
              <div className="verify-panel-title">Services</div>
              <CheckRow label="BFF :3001" status={checks.bff} />
              <CheckRow label="MCP Server :8080" status={checks.mcp} />
              <CheckRow label="MCP Gateway :3005" status={checks.gateway} />
            </div>
            <div className="verify-panel">
              <div className="verify-panel-title">Configuration</div>
              <CheckRow label="PingOne credentials" status={checks.pingone} />
              <CheckRow label="Helix / LLM connected" status={checks.helix} />
              <CheckRow label="PingOne apps bootstrapped" status={checks.bootstrap} />
            </div>
          </div>

          {allPass && (
            <div className="setup-banner-success">
              ✅ Demo ready — all services healthy and configuration complete.
            </div>
          )}

          {anyFail && (
            <div className="setup-banner-error">
              ❌ One or more checks failed. Run <code>./run.sh status</code> to diagnose service issues.
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`setup-btn${allPass ? ' success' : ''}`} onClick={onEnvDownload}>
              Download .env
            </button>
            <button className="setup-btn" onClick={runChecks} disabled={running}>
              Re-run checks
            </button>
            {allPass && (
              <a href="/dashboard" style={{ fontSize: '0.85rem', color: '#2563eb', marginLeft: 'auto' }}>
                Open demo dashboard →
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
