import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import bffAxios from '../services/bffAxios';
import { SERVERS } from '../components/ResourceServerInterstitial';
import './ResourceServerJourneyPage.css';

const RS_META = {
  olb: { badge: 'MCP SERVER (OLB)', badgeClass: 'rsj-badge--olb', subtitle: ':8080 • WebSocket • RFC 8693' },
  invest: { badge: 'MCP RESOURCE SERVER', badgeClass: 'rsj-badge--mcp', subtitle: ':8081 • WebSocket • RFC 8693' },
  apikey: { badge: 'API RESOURCE SERVER', badgeClass: 'rsj-badge--api', subtitle: ':8082 • HTTP REST • X-API-Key' },
};

// Resolve RS type from route path
function rsTypeFromPath(pathname) {
  if (pathname.includes('/rs/invest')) return 'invest';
  if (pathname.includes('/rs/api')) return 'apikey';
  return 'olb';
}

function ClaimRow({ k, v }) {
  return (
    <div className="rsj-claim"><span className="rsj-ck">{k}</span><span className="rsj-cv">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>
  );
}

export default function ResourceServerJourneyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const rsType = rsTypeFromPath(location.pathname);
  const toolName = params.get('tool') || '';
  const vertical = params.get('vertical') || '';

  const meta = RS_META[rsType];

  const [inflowData, setInflowData] = useState(null);
  const [verticalData, setVerticalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('rsj-theme') || 'dark');

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('rsj-theme', next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetches = [bffAxios.get('/api/resource-server/summary-inflow').catch(() => null)];
    if (rsType === 'apikey' && toolName) {
      fetches.push(bffAxios.get(`/api/resource-server/vertical-record?tool=${encodeURIComponent(toolName)}`).catch(() => null));
    }
    Promise.all(fetches).then(([inflowRes, vertRes]) => {
      if (cancelled) return;
      if (inflowRes?.data) setInflowData(inflowRes.data);
      if (vertRes?.data) setVerticalData(vertRes.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [rsType, toolName]);

  const claims = inflowData?.accessTokenClaims || {};

  const handleBack = useCallback(() => navigate(-1), [navigate]);

  return (
    <div className={`rsj-page rsj-page--${theme}`}>
      <header className="rsj-header">
        <span className={`rsj-badge ${meta.badgeClass}`}>{meta.badge}</span>
        <span className="rsj-header-sub">{meta.subtitle}</span>
        <button className="rsj-theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? '\u2600' : '\u263E'}
        </button>
        <button className="rsj-back-btn" onClick={handleBack}>Back to Agent</button>
      </header>

      <div className="rsj-body">
        {/* Split view: token left / data right */}
        <div className="rsj-split">
          {/* Left: credential/token */}
          <div className="rsj-panel rsj-panel--token">
            <h3 className="rsj-panel-title">
              {rsType === 'apikey' ? 'Credential Swap' : 'Token Presented'}
            </h3>
            {loading ? (
              <div className="rsj-loading">Loading...</div>
            ) : rsType === 'apikey' ? (
              <div className="rsj-claims">
                <ClaimRow k="in" v="Bearer eyJhbG..." />
                <ClaimRow k="out" v="X-API-Key: [gateway-injected]" />
                <ClaimRow k="X-User-Sub" v={claims.sub || '—'} />
                <div className="rsj-proof">
                  <div className="rsj-proof-label">Gateway Proof</div>
                  <div className="rsj-proof-desc">OAuth bearer dropped. API key injected. Service never sees the user token.</div>
                </div>
              </div>
            ) : (
              <div className="rsj-claims">
                {claims.sub && <ClaimRow k="sub" v={claims.sub} />}
                {claims.aud && <ClaimRow k="aud" v={Array.isArray(claims.aud) ? claims.aud.join(', ') : claims.aud} />}
                {claims.scope && <ClaimRow k="scope" v={claims.scope} />}
                {claims.act && <ClaimRow k="act" v={claims.act} />}
                {claims.exp && <ClaimRow k="exp" v={claims.exp} />}
                {claims.client_id && <ClaimRow k="client_id" v={claims.client_id} />}
              </div>
            )}
          </div>

          {/* Right: data returned */}
          <div className="rsj-panel rsj-panel--data">
            <h3 className="rsj-panel-title">
              {vertical ? `${vertical.charAt(0).toUpperCase() + vertical.slice(1)} — Data Returned` : 'Data Returned'}
            </h3>
            {loading ? (
              <div className="rsj-loading">Loading...</div>
            ) : rsType === 'apikey' && verticalData ? (
              <div className="rsj-vertical-data">
                {Object.entries(verticalData).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                  <div key={k} className="rsj-vertical-row">
                    <span className="rsj-vertical-key">{k}</span>
                    <span className="rsj-vertical-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            ) : rsType === 'invest' ? (
              <div className="rsj-data-cards">
                <div className="rsj-data-card"><div className="rsj-data-label">Portfolio</div><div className="rsj-data-value rsj-data-value--green">View returned</div></div>
                <div className="rsj-data-card"><div className="rsj-data-label">Tool</div><div className="rsj-data-value">{toolName || 'get_portfolio_summary'}</div></div>
                <div className="rsj-data-card"><div className="rsj-data-label">Audience</div><div className="rsj-data-value">mcp-invest.ping.demo</div></div>
              </div>
            ) : (
              <div className="rsj-data-cards">
                {inflowData?.accounts?.slice(0, 3).map(acct => (
                  <div key={acct.id || acct.accountNumber} className="rsj-data-card">
                    <div className="rsj-data-label">{acct.accountType} {acct.accountNumber}</div>
                    <div className="rsj-data-value rsj-data-value--accent">${(acct.balance || 0).toLocaleString()}</div>
                  </div>
                )) || <div className="rsj-data-card"><div className="rsj-data-label">Tool</div><div className="rsj-data-value">{toolName}</div></div>}
              </div>
            )}
          </div>
        </div>

        {/* Footer nav */}
        <div className="rsj-footer-nav">
          <button className="rsj-nav-btn rsj-nav-btn--primary" onClick={handleBack}>Back to Agent</button>
          <button className="rsj-nav-btn" onClick={() => navigate('/resource-server')}>Full Token Details</button>
        </div>
      </div>
    </div>
  );
}
