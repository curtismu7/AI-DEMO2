import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PrivilegeA2aTab from '../features/privilegeA2aClient/PrivilegeA2aTab';
import { usePrivilegeA2aProfile } from '../features/privilegeA2aClient/usePrivilegeA2aProfile';
// The workbench shell (title bar + status strip) lives in the MCP client's sheet.
import './PrivilegeMcpClientPage.css';

/**
 * Privilege A2A access review as its own page. It was a tab on the MCP client;
 * it keeps that page's shell — title bar, a status strip of who is asking and
 * which agents answer, then the workspace — so the two read as one family.
 * The conversation, trace and gateway record are PrivilegeA2aTab, unchanged.
 */
export default function PrivilegeA2aPage({ user }) {
  const profile = usePrivilegeA2aProfile();
  // Shares the MCP client's page-local light/dark key, so flipping it on one page holds on the other.
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cur_priv_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cur_priv_theme', theme); } catch { /* storage disabled */ }
  }, [theme]);

  const identity = user?.email || user?.username || user?.name || '';
  const row = (n, key, value, testId) => (
    <li className="cur-rail__row" data-testid={testId}>
      <span className="cur-rail__n">{n}</span>
      <span className="cur-rail__k">{key}</span>
      <span className="cur-rail__v">{value}</span>
    </li>
  );

  return (
    <div className="cur-ide" data-cur-theme={theme} data-testid="privilege-a2a-page">
      <header className="cur-titlebar">
        <div className="cur-titlebar-left">
          <span className="cur-titlebar-title">Agent Privilege — A2A access review</span>
        </div>
        <div className="cur-titlebar-center">
          <div className={`cur-status ${identity ? 'cur-status--ok' : ''}`}>
            <span className="cur-status-dot" />
            {identity ? 'Signed in' : 'Not signed in'}
          </div>
        </div>
        <div className="cur-titlebar-right">
          <button
            type="button"
            className="cur-flow-trigger"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <Link className="cur-flow-trigger" to="/privilege-mcp-client">MCP client</Link>
        </div>
      </header>

      <ol className="cur-rail cur-rail--4" aria-label="Who is asking and which agents answer">
        {row(1, 'Identity', identity || '—', 'a2a-identity')}
        {row(2, 'Vertical', profile?.vertical || '—', 'a2a-vertical')}
        {row(3, 'Main agent', profile?.agentName || 'Main agent', 'a2a-main-agent')}
        {row(4, 'Worker agent', profile?.specialistName || 'Analyst', 'a2a-worker-agent')}
      </ol>

      <main className="cur-a2a-main">
        <PrivilegeA2aTab />
      </main>
    </div>
  );
}
