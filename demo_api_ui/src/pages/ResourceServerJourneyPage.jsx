import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import bffAxios from '../services/bffAxios';
import SignInPrompt from '../components/SignInPrompt';
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

const fmt$ = (n) => typeof n === 'number' ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : String(n ?? '—');
const fmtPct = (n) => typeof n === 'number' ? `${n}%` : String(n ?? '—');

function VerticalCards({ vertical, data }) {
  if (!data) return null;
  // Flatten: the BFF returns { vertical, noun, <key>: { ...fields } }
  // Find the nested record object (first non-scalar, non-metadata key)
  const rec = Object.entries(data).reduce((found, [k, v]) => {
    if (found) return found;
    if (k === 'vertical' || k === 'noun' || k === 'tool' || k === 'note') return null;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
  }, null) || data;

  switch (vertical) {
    case 'mortgage': return <MortgageCard r={rec} />;
    case 'healthRecord': return <HealthCard r={rec} />;
    case 'gearOrder': return <ItemOrderCard r={rec} noun="Gear Order" />;
    case 'largePurchase': return <ItemOrderCard r={rec} noun="Purchase" />;
    case 'expenseReport': return <ExpenseCard r={rec} />;
    case 'enrollment': return <EnrollmentCard r={rec} />;
    case 'permit': return <PermitCard r={rec} />;
    case 'workOrder': return <WorkOrderCard r={rec} />;
    case 'invest': return <PortfolioCard r={rec} />;
    default: return <GenericVerticalRows data={data} />;
  }
}

function MortgageCard({ r }) {
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">{r.propertyAddress}</div>
      <div className="rsj-vcard-sub">{r.propertyType} — {r.loanId}</div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Loan Amount</span><span className="rsj-vcard-stat-value">{fmt$(r.loanAmount)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Balance</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.currentBalance)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Rate</span><span className="rsj-vcard-stat-value">{r.interestRate}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Monthly</span><span className="rsj-vcard-stat-value">{fmt$(r.monthlyPayment)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Escrow</span><span className="rsj-vcard-stat-value">{fmt$(r.escrowBalance)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Next Payment</span><span className="rsj-vcard-stat-value">{r.nextPaymentDate}</span></div>
      </div>
      <div className="rsj-vcard-status">{r.status}</div>
    </div>
  );
}

function HealthCard({ r }) {
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">{r.name}</div>
      <div className="rsj-vcard-sub">Patient {r.patientId} — DOB {r.dateOfBirth}</div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Provider</span><span className="rsj-vcard-stat-value">{r.primaryProvider}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">BP</span><span className="rsj-vcard-stat-value">{r.bloodPressure}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Cholesterol</span><span className="rsj-vcard-stat-value">{r.cholesterolTotal}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Next Appt</span><span className="rsj-vcard-stat-value">{r.nextAppointment}</span></div>
      </div>
      {r.allergies?.length > 0 && <div className="rsj-vcard-tags">{r.allergies.map(a => <span key={a} className="rsj-vcard-tag rsj-vcard-tag--warn">{a}</span>)}</div>}
      {r.activeMedications?.length > 0 && <div className="rsj-vcard-tags">{r.activeMedications.map(m => <span key={m} className="rsj-vcard-tag">{m}</span>)}</div>}
      <div className="rsj-vcard-status">{r.status}</div>
    </div>
  );
}

function ItemOrderCard({ r, noun }) {
  const items = r.items || [];
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">{noun} {r.orderId || r.purchaseId}</div>
      <div className="rsj-vcard-sub">{r.customer}{r.purchaseDate ? ` — ${r.purchaseDate}` : ''}</div>
      {items.length > 0 && (
        <div className="rsj-vcard-table">
          {items.map((it, i) => (
            <div key={i} className="rsj-vcard-table-row">
              <span className="rsj-vcard-table-name">{it.name || it.description}{it.size ? ` (${it.size})` : ''}</span>
              <span className="rsj-vcard-table-val">{fmt$(it.price || it.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {r.item && !items.length && <div className="rsj-vcard-sub">{r.item}</div>}
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Total</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.total)}</span></div>
        {r.shippingMethod && <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Shipping</span><span className="rsj-vcard-stat-value">{r.shippingMethod}</span></div>}
        {r.estimatedDelivery && <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Delivery</span><span className="rsj-vcard-stat-value">{r.estimatedDelivery}</span></div>}
        {r.warrantyExpires && <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Warranty</span><span className="rsj-vcard-stat-value">{r.warrantyExpires}</span></div>}
        {r.paymentMethod && <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Payment</span><span className="rsj-vcard-stat-value">{r.paymentMethod}</span></div>}
      </div>
      <div className="rsj-vcard-status">{r.status || r.deliveryStatus}</div>
    </div>
  );
}

function ExpenseCard({ r }) {
  const items = r.lineItems || [];
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">Expense Report {r.reportId}</div>
      <div className="rsj-vcard-sub">{r.employee} — {r.department} — {r.period}</div>
      {items.length > 0 && (
        <div className="rsj-vcard-table">
          {items.map((it, i) => (
            <div key={i} className="rsj-vcard-table-row">
              <span className="rsj-vcard-table-name">{it.category}: {it.description}</span>
              <span className="rsj-vcard-table-val">{fmt$(it.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Total</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.totalAmount)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Approver</span><span className="rsj-vcard-stat-value">{r.approver}</span></div>
      </div>
      <div className="rsj-vcard-status">{r.status}</div>
    </div>
  );
}

function EnrollmentCard({ r }) {
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">{r.program}</div>
      <div className="rsj-vcard-sub">Student {r.studentId} — {r.term}</div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">GPA</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{r.gpa}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Credits</span><span className="rsj-vcard-stat-value">{r.creditsEarned} earned / {r.enrolledCredits} enrolled</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Tuition</span><span className="rsj-vcard-stat-value">{fmt$(r.tuitionBalance)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Standing</span><span className="rsj-vcard-stat-value">{r.standing}</span></div>
      </div>
      <div className="rsj-vcard-status">Holds: {r.holds || 'None'}</div>
    </div>
  );
}

function PermitCard({ r }) {
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">{r.permitType} Permit {r.permitId}</div>
      <div className="rsj-vcard-sub">{r.subject} — {r.jurisdiction}</div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Issued</span><span className="rsj-vcard-stat-value">{r.issuedDate}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Expires</span><span className="rsj-vcard-stat-value">{r.expiresDate}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Fees Owed</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.feesOwed)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Inspector</span><span className="rsj-vcard-stat-value">{r.inspector}</span></div>
      </div>
      <div className="rsj-vcard-status">{r.status}</div>
    </div>
  );
}

function WorkOrderCard({ r }) {
  const pct = r.quantity > 0 ? Math.round((r.completedQty / r.quantity) * 100) : 0;
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">Work Order {r.orderId}</div>
      <div className="rsj-vcard-sub">{r.product} — {r.type} — {r.line}</div>
      <div className="rsj-vcard-progress"><div className="rsj-vcard-progress-bar" style={{ width: `${pct}%` }} /><span className="rsj-vcard-progress-label">{r.completedQty}/{r.quantity} ({pct}%)</span></div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Value</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.value)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Due</span><span className="rsj-vcard-stat-value">{r.dueDate}</span></div>
      </div>
      <div className="rsj-vcard-status">{r.status}</div>
    </div>
  );
}

function PortfolioCard({ r }) {
  const holdings = r.holdings || [];
  return (
    <div className="rsj-vcard">
      <div className="rsj-vcard-header">Portfolio {r.portfolioId}</div>
      <div className="rsj-vcard-sub">{r.holder} — {r.riskProfile}</div>
      <div className="rsj-vcard-grid">
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Total Value</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--accent">{fmt$(r.totalValue)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">Cash Sweep</span><span className="rsj-vcard-stat-value">{fmt$(r.cashSweep)}</span></div>
        <div className="rsj-vcard-stat"><span className="rsj-vcard-stat-label">YTD Return</span><span className="rsj-vcard-stat-value rsj-vcard-stat-value--green">{fmtPct(r.ytdReturnPct)}</span></div>
      </div>
      {holdings.length > 0 && (
        <div className="rsj-vcard-table">
          {holdings.map((h, i) => (
            <div key={i} className="rsj-vcard-table-row">
              <span className="rsj-vcard-table-name"><strong>{h.symbol}</strong> {h.name}</span>
              <span className="rsj-vcard-table-val">{fmt$(h.marketValue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GenericVerticalRows({ data }) {
  return (
    <div className="rsj-vertical-data">
      {Object.entries(data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
        <div key={k} className="rsj-vertical-row">
          <span className="rsj-vertical-key">{k}</span>
          <span className="rsj-vertical-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
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
  const [needsSignIn, setNeedsSignIn] = useState(false);
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
    const on401 = (e) => {
      if (e.response?.status === 401) setNeedsSignIn(true);
      return null;
    };
    const fetches = [bffAxios.get('/api/resource-server/summary-inflow').catch(on401)];
    if (rsType === 'apikey' && toolName) {
      fetches.push(bffAxios.get(`/api/resource-server/vertical-record?tool=${encodeURIComponent(toolName)}`).catch(on401));
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
        {needsSignIn && (
          <SignInPrompt message="Sign in to see the live token and data proof for this resource server." />
        )}

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
              <VerticalCards vertical={vertical} data={verticalData} />
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
