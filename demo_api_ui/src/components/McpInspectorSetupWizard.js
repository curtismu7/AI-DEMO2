// demo_api_ui/src/components/McpInspectorSetupWizard.js
// Questionnaire that generates env snippets and commands for MCP Inspector (browser + official npm).

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'mcpInspectorWizard.v1';
const INSPECTOR_NPM = '@modelcontextprotocol/inspector';
const INSPECTOR_REPO = 'https://github.com/modelcontextprotocol/inspector';

/**
 * Loads and saves wizard answers to localStorage so the user can resume later.
 */
function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export default function McpInspectorSetupWizard({ appBaseUrl, mcpAgentUrl, storageType }) {
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState(1);
  const [deploy, setDeploy] = useState('local');
  const [baseUrl, setBaseUrl] = useState('');
  const [mcpWsUrl, setMcpWsUrl] = useState('ws://localhost:8080');
  const [inspectorChoice, setInspectorChoice] = useState('builtin');

  useEffect(() => {
    const p = loadPersisted();
    if (p) {
      if (p.deploy) setDeploy(p.deploy);
      if (p.baseUrl) setBaseUrl(p.baseUrl);
      if (p.mcpWsUrl) setMcpWsUrl(p.mcpWsUrl);
      if (p.inspectorChoice) setInspectorChoice(p.inspectorChoice);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setBaseUrl((u) => u || appBaseUrl || window.location.origin);
  }, [appBaseUrl]);

  useEffect(() => {
    persist({ deploy, baseUrl, mcpWsUrl, inspectorChoice });
  }, [deploy, baseUrl, mcpWsUrl, inspectorChoice]);

  const handleReset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setStep(1);
    setDeploy('local');
    setBaseUrl(typeof window !== 'undefined' ? (appBaseUrl || window.location.origin) : '');
    setMcpWsUrl('ws://localhost:8080');
    setInspectorChoice('builtin');
  }, [appBaseUrl]);

  const builtinUrl = `${(baseUrl || '').replace(/\/$/, '')}/mcp-inspector`;
  const isHostedCloud = storageType === 'vercel-kv' || deploy === 'vercel' || deploy === 'replit';

  const envSnippet = `# Paste into .env for local full stack (adjust names to match your repo).
# Banking UI + API origin (same host as the React app in this demo)
DEMO_API_BASE_URL=${baseUrl || 'https://demo-api-server:3001'}

# MCP server WebSocket (demo_mcp_server — default listen)
MCP_SERVER_URL=${mcpWsUrl}

# LangChain agent WebSocket (optional; only if you use the chat widget)
${mcpAgentUrl ? `MCP_AGENT_URL=${mcpAgentUrl}` : '# MCP_AGENT_URL=http://localhost:8000'}
`;

  const startMcpServer = `cd oauth-mcp
npm install
npm run build
npm start
# Server listens for WebSocket MCP clients (default port 8080 unless overridden).`;

  const officialNpm = `# Official open-source MCP Inspector (${INSPECTOR_NPM})
npx ${INSPECTOR_NPM}@latest

# Upstream docs and transport options:
# ${INSPECTOR_REPO}

# This repo’s demo_mcp_server speaks WebSocket MCP, not stdio. The in-app
# inspector at /mcp-inspector proxies through the Backend-for-Frontend (BFF) with your session cookie.
# For the npm package, follow the inspector README for connecting to your transport.`;

  return (
    <div className="card" style={{ borderColor: '#c7d2fe', background: '#f8fafc' }}>
      <div className="card-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
        <h2 className="card-title" style={{ margin: 0 }}>MCP Inspector setup</h2>
        <span style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
          Answer a few questions — we generate env snippets, start commands, and links. You can use the{' '}
          <strong>built-in</strong> inspector in this app (session-based) or install the official{' '}
          <a href={INSPECTOR_REPO} target="_blank" rel="noopener noreferrer">
            {INSPECTOR_NPM}
          </a>{' '}
          package locally.
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? '▼ Hide wizard' : '▶ Open wizard'}
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 1rem 1rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#374151' }}>
            <span>Step {step} of 4</span>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={handleReset}>
              Reset answers
            </button>
          </div>

          {step === 1 && (
            <div>
              <p className="form-label">Where are you running?</p>
              <select className="form-input" value={deploy} onChange={(e) => setDeploy(e.target.value)}>
                <option value="local">Local dev (API + UI + optional MCP on this machine)</option>
                <option value="vercel">Hosted on Vercel (browser only — MCP agent runs locally)</option>
                <option value="replit">Hosted on Replit (browser only — MCP agent runs locally)</option>
              </select>
              <p style={{ fontSize: '0.75rem', color: '#374151', marginTop: '0.5rem' }}>
                Cloud deployments often use deployment-managed OAuth; LangChain/MCP agent URLs are still local-only.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Next</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <label className="form-label">Banking app base URL (UI + API origin)</label>
              <input
                className="form-input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://demo-api-server:3001"
              />
              <p style={{ fontSize: '0.75rem', color: '#374151', marginTop: '0.35rem' }}>
                Same origin as <code>GET /api/auth/oauth/*</code> — used for the built-in inspector link below.
              </p>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <label className="form-label">MCP server WebSocket URL</label>
              <input
                className="form-input"
                value={mcpWsUrl}
                onChange={(e) => setMcpWsUrl(e.target.value)}
                placeholder="ws://localhost:8080"
              />
              <p style={{ fontSize: '0.75rem', color: '#374151', marginTop: '0.35rem' }}>
                Default for <code>demo_mcp_server</code>. LangChain uses this MCP server; not the same as the agent chat WebSocket URL.
              </p>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => setStep(4)}>Next</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <p className="form-label">Preferred inspector</p>
              <select className="form-input" value={inspectorChoice} onChange={(e) => setInspectorChoice(e.target.value)}>
                <option value="builtin">Built-in /mcp-inspector (recommended for this demo — uses your login session)</option>
                <option value="official">Official npm package @modelcontextprotocol/inspector (local dev tool)</option>
                <option value="both">Show both</option>
              </select>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(3)}>Back</button>
              </div>

              <h3 style={{ fontSize: '1rem', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Generated output</h3>

              {(inspectorChoice === 'builtin' || inspectorChoice === 'both') && (
                <>
                  <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '0.35rem' }}>
                    <strong>1. Built-in inspector</strong> — sign in first, then open:
                  </p>
                  <pre style={{
                    background: '#f1f5f9',
                    padding: '0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.8rem',
                    overflow: 'auto',
                  }}
                  >
                    {builtinUrl}
                  </pre>
                  {isHostedCloud && (
                    <p style={{ fontSize: '0.75rem', color: '#92400e', marginBottom: '0.75rem' }}>
                      On a hosted deployment you must be signed in on the same domain; the Backend-for-Frontend (BFF) forwards MCP calls with token exchange.
                    </p>
                  )}
                  <p style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                    <Link to="/mcp-inspector">Open MCP Inspector in this app →</Link>
                  </p>
                </>
              )}

              {(inspectorChoice === 'official' || inspectorChoice === 'both') && (
                <>
                  <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: '1rem', marginBottom: '0.35rem' }}>
                    <strong>2. Official npm inspector</strong> — run locally:
                  </p>
                  <pre style={{
                    background: '#f1f5f9',
                    padding: '0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.8rem',
                    overflow: 'auto',
                  }}
                  >
                    {officialNpm}
                  </pre>
                </>
              )}

              <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: '1rem', marginBottom: '0.35rem' }}>
                <strong>Start MCP server</strong> (from repo root):
              </p>
              <pre style={{
                background: '#f1f5f9',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
              >
                {startMcpServer}
              </pre>

              <p style={{ fontSize: '0.85rem', color: '#475569', marginTop: '1rem', marginBottom: '0.35rem' }}>
                <strong>Env snippet</strong> (copy into your local <code>.env</code>):
              </p>
              <pre style={{
                background: '#f1f5f9',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
              >
                {envSnippet}
              </pre>

              <p style={{ fontSize: '0.75rem', color: '#374151', marginTop: '0.75rem' }}>
                <strong>Education:</strong> open the floating <strong>CIBA guide</strong> → <strong>Token exchange</strong> tab for RFC 8693 /token flow, HTTP status, and responses.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
