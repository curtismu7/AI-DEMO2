import { useNavigate, useLocation } from 'react-router-dom';
import { useVertical } from '../vertical/useVertical';
import './VerticalFeaturePage.css';

function fmtMoney(amt, currency = 'USD') {
  if (typeof amt !== 'number') return String(amt ?? '');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amt);
}

function fmtPct(rate) {
  if (typeof rate !== 'number') return String(rate ?? '');
  return `${rate.toFixed(3)}%`;
}

function formatValue(value, fmt, currency) {
  if (fmt === 'money') return fmtMoney(value, currency);
  if (fmt === 'percent') return fmtPct(value);
  return String(value ?? '');
}

export default function VerticalFeaturePage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { pageManifest: manifest } = useVertical();

  const fp  = manifest?.featurePage || null;
  const raw = location.state?.featurePayload || null;

  // accentColor is the only accent field in the v3 schema; the surrounding
  // shades are derived from it with CSS color-mix() so the feature page is
  // accent-aware per vertical without a color library or extra manifest fields.
  // (bg/light/code = pale tints toward white; text/dd = dark shades toward black.)
  const accentColor = fp?.accentColor || '#ca8a04';
  const mix = (pct, other) => `color-mix(in srgb, ${accentColor} ${pct}%, ${other})`;

  const styles = {
    '--vfp-accent':      accentColor,
    '--vfp-accent-bg':   mix(6, 'white'),
    '--vfp-accent-lt':   mix(20, 'white'),
    '--vfp-accent-code': mix(12, 'white'),
    '--vfp-accent-text': mix(45, 'black'),
    '--vfp-accent-dd':   mix(60, 'black'),
  };

  if (!raw) {
    return (
      <div className="vfp-container" style={styles}>
        <header className="vfp-header">
          <span className="vfp-badge">{fp?.badgeLabel || 'API-KEY PATH'}</span>
          <h1 className="vfp-title">{fp?.pageTitle || 'Feature data not loaded'}</h1>
          <p className="vfp-subtitle">
            This page renders data returned by the MCP gateway's api_key disposition.
            To see the data, ask the agent: <code>{fp?.emptyPrompt || 'show feature data'}</code>.
            The agent will call the gateway, which swaps your OAuth bearer for a
            service API key, calls the backend service, and routes you here with the result.
          </p>
        </header>
        <div className="vfp-actions">
          <button className="vfp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const dataKey  = fp?.dataKey || Object.keys(raw).find((k) => k !== 'source' && k !== 'authMechanism' && k !== 'note' && k !== 'apiKeyMaskedLast4' && k !== 'message' && k !== 'backend') || '';
  const record   = raw[dataKey] || {};
  const currency = record.currency;
  const fields   = fp?.fields || [];

  return (
    <div className="vfp-container" style={styles}>
      <header className="vfp-header">
        <span className="vfp-badge">{fp?.badgeLabel || 'API-KEY PATH'}</span>
        <h1 className="vfp-title">{fp?.pageTitle || 'Feature data'}</h1>
        <p className="vfp-subtitle">{raw.message}</p>
      </header>

      <section className="vfp-card vfp-card--data">
        <h2 className="vfp-card-title">{fp?.sectionTitle || 'Details'}</h2>
        <dl className="vfp-fields">
          {fields.map((field) => {
            const val = record[field.path];
            const display = formatValue(val, field.format, currency);
            return (
              <div key={field.path} className={`vfp-field-row${field.accent ? ' vfp-field-row--accent' : ''}`}>
                <dt>{field.label}</dt>
                <dd>{display}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="vfp-card vfp-card--swap">
        <h2 className="vfp-card-title">Credential swap</h2>
        <p className="vfp-swap-line">
          <strong>Gateway swapped your OAuth bearer</strong> for a service API key before
          calling the backend. The user's bearer never reached the downstream service.
        </p>
        <div className="vfp-swap-row">
          <span className="vfp-swap-label">Service API key (last 4 chars only):</span>
          <code className="vfp-swap-value">****{raw.apiKeyMaskedLast4 || 'XXXX'}</code>
        </div>
        <ul className="vfp-swap-details">
          <li><strong>Source:</strong> {raw.backend?.source || raw.source}</li>
          <li><strong>Auth mechanism:</strong> {raw.backend?.authMechanism || raw.authMechanism}</li>
          <li><strong>Note:</strong> {raw.backend?.note || raw.note}</li>
        </ul>
      </section>

      <div className="vfp-actions">
        <button className="vfp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  );
}
