import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import './ResourceServerInterstitial.css';

const SERVERS = {
  olb: {
    id: 'olb',
    name: 'MCP Server (OLB)',
    port: 8080,
    protocol: 'WebSocket',
    auth: 'JWT + RFC 8693 Token Exchange',
    audience: 'mcpserver.ping.demo',
    color: '#2563eb',
    description: 'Core banking MCP server — accounts, transactions, transfers, admin ops',
  },
  invest: {
    id: 'invest',
    name: 'MCP Resource Server',
    port: 8081,
    protocol: 'WebSocket',
    auth: 'JWT + RFC 8693 Token Exchange',
    audience: 'mcp-resource-server.ping.demo',
    color: '#047857',
    description: 'Dedicated MCP resource server — investment portfolios, balances, holdings, transactions',
  },
  apikey: {
    id: 'apikey',
    name: 'API Resource Server',
    port: 8082,
    protocol: 'HTTP REST',
    auth: 'X-API-Key (gateway-swapped)',
    audience: '(none — API key auth)',
    color: '#d97706',
    description: 'REST API resource server — gateway swaps OAuth bearer for service API key',
  },
};

const INVEST_TOOLS = new Set([
  'get_investment_accounts', 'get_investment_balance',
  'get_investment_transactions', 'get_portfolio_summary',
]);

const APIKEY_TOOLS = new Set([
  'show_mortgage', 'show_investment', 'show_large_purchase', 'show_health_record',
  'show_gear_order', 'show_expense_report', 'show_permit', 'show_enrollment', 'show_work_order',
]);

export function resolveTargetServer(toolName) {
  if (INVEST_TOOLS.has(toolName)) return 'invest';
  if (APIKEY_TOOLS.has(toolName)) return 'apikey';
  return 'olb';
}

// Map tool → vertical query param for the API RS page
const TOOL_TO_VERTICAL = {
  show_mortgage: 'mortgage', show_health_record: 'healthRecord',
  show_investment: 'invest', show_gear_order: 'gearOrder',
  show_expense_report: 'expenseReport', show_permit: 'permit',
  show_enrollment: 'enrollment', show_work_order: 'workOrder',
  show_large_purchase: 'largePurchase',
};

export function buildRsRoute(toolName) {
  const rs = resolveTargetServer(toolName);
  if (rs === 'invest') return `/rs/invest?tool=${encodeURIComponent(toolName)}`;
  if (rs === 'apikey') {
    const v = TOOL_TO_VERTICAL[toolName] || '';
    return `/rs/api?tool=${encodeURIComponent(toolName)}${v ? `&vertical=${v}` : ''}`;
  }
  return `/rs/olb?tool=${encodeURIComponent(toolName)}`;
}

export { SERVERS };

function ServerNode({ server, isActive }) {
  const cls = isActive ? 'rsi-node rsi-node--active' : 'rsi-node rsi-node--idle';
  return (
    <div className={cls} style={isActive ? { '--rsi-accent': server.color } : undefined}>
      <div className="rsi-node-header">
        <span className="rsi-node-name">{server.name}</span>
        <span className="rsi-node-port">:{server.port}</span>
      </div>
      <div className="rsi-node-sub">{server.protocol}</div>
      {isActive && <div className="rsi-node-pulse" />}
    </div>
  );
}

/**
 * Modal overlay that shows which resource server a tool call is routed to.
 * Auto-dismisses after a countdown (default 4s) or on click.
 */
export default function ResourceServerInterstitial({ toolName, onDismiss, onNavigate }) {
  const [countdown, setCountdown] = useState(4);
  const targetId = resolveTargetServer(toolName);
  const target = SERVERS[targetId];

  useEffect(() => {
    if (countdown <= 0) {
      onNavigate?.();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onNavigate]);

  return createPortal(
    <div className="rsi-overlay" onClick={onDismiss}>
      <div className="rsi-container" style={{ '--rsi-accent': target.color }} onClick={(e) => e.stopPropagation()}>
        <header className="rsi-header">
          <span className="rsi-badge">RESOURCE SERVER</span>
          <h1 className="rsi-title">Routing to {target.name}</h1>
          <p className="rsi-subtitle">
            Tool <code>{toolName || '(unknown)'}</code> is handled by this resource server
          </p>
        </header>

        {/* 3-server architecture visual */}
        <section className="rsi-architecture">
          <div className="rsi-arch-label">Gateway routes to:</div>
          <div className="rsi-arch-nodes">
            {Object.values(SERVERS).map((s) => (
              <ServerNode key={s.id} server={s} isActive={s.id === targetId} />
            ))}
          </div>
          <div className="rsi-arch-arrows">
            {Object.values(SERVERS).map((s) => (
              <div
                key={s.id}
                className={`rsi-arrow ${s.id === targetId ? 'rsi-arrow--active' : ''}`}
              />
            ))}
          </div>
        </section>

        {/* Server detail card */}
        <section className="rsi-detail-card">
          <h2 className="rsi-detail-title">Server Details</h2>
          <dl className="rsi-detail-grid">
            <dt>Name</dt>
            <dd>{target.name}</dd>
            <dt>Port</dt>
            <dd>{target.port}</dd>
            <dt>Protocol</dt>
            <dd>{target.protocol}</dd>
            <dt>Auth Model</dt>
            <dd>{target.auth}</dd>
            <dt>Audience</dt>
            <dd><code>{target.audience}</code></dd>
            <dt>Description</dt>
            <dd>{target.description}</dd>
          </dl>
        </section>

        {/* Routing explanation */}
        <section className="rsi-explanation">
          <h2 className="rsi-explain-title">Why this server?</h2>
          {targetId === 'olb' && (
            <p>
              <code>{toolName}</code> is a core banking tool. The gateway routes all standard
              banking operations (accounts, transactions, transfers, admin) to the OLB MCP Server
              on port 8080 via WebSocket. Authentication uses RFC 8693 token exchange to narrow
              the audience to <code>mcpserver.ping.demo</code>.
            </p>
          )}
          {targetId === 'invest' && (
            <p>
              <code>{toolName}</code> is an investment tool. The gateway recognizes this tool belongs
              to the investment domain and routes it to the MCP Resource Server on port 8081. A separate token
              exchange narrows the audience to <code>mcp-resource-server.ping.demo</code>, isolating
              investment data from core banking.
            </p>
          )}
          {targetId === 'apikey' && (
            <p>
              <code>{toolName}</code> is a vertical feature tool. The gateway performs a
              credential swap: your OAuth bearer token is dropped and replaced with a service
              API key (<code>X-API-Key</code> header). This demonstrates how legacy services
              that don't understand OAuth can still be protected behind the gateway.
            </p>
          )}
        </section>

        <footer className="rsi-footer">
          <span className="rsi-countdown">Continuing in {countdown}s...</span>
          <button className="rsi-continue-btn" onClick={onNavigate}>
            View Resource Server
          </button>
          <button className="rsi-skip-btn" onClick={onDismiss}>
            Back to chat
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hook to show the resource server interstitial.
 * Returns [showInterstitial, renderInterstitial].
 */
export function useResourceServerInterstitial() {
  const [interstitialTool, setInterstitialTool] = useState(null);
  const navigate = useNavigate();

  const show = useCallback((toolName) => {
    setInterstitialTool(toolName);
  }, []);

  const dismiss = useCallback(() => {
    setInterstitialTool(null);
  }, []);

  const navigateToRs = useCallback(() => {
    if (interstitialTool) {
      const route = buildRsRoute(interstitialTool);
      setInterstitialTool(null);
      navigate(route);
    }
  }, [interstitialTool, navigate]);

  const render = interstitialTool
    ? <ResourceServerInterstitial toolName={interstitialTool} onDismiss={dismiss} onNavigate={navigateToRs} />
    : null;

  return [show, render];
}
