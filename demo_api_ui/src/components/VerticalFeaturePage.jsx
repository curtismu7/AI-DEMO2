import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useVertical } from '../vertical/useVertical';
import { formatValue } from '../utils/formatters';
import TokenChainTraceRail from './TokenChainTraceRail';
import './VerticalFeaturePage.css';

export default function VerticalFeaturePage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { pageManifest: manifest } = useVertical();

  const fp  = location.state?.featurePageOverride || manifest?.featurePage || null;
  const raw = location.state?.featurePayload || null;
  const chipContext = location.state?.chipContext || null;

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

  const dataKey = useMemo(
    () => {
      if (!raw) return '';
      return fp?.dataKey || Object.keys(raw).find((k) => k !== 'source' && k !== 'authMechanism' && k !== 'note' && k !== 'apiKeyMaskedLast4' && k !== 'message' && k !== 'backend') || '';
    },
    [fp?.dataKey, raw]
  );

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

      <section className="vfp-card vfp-card--flow">
        <h2 className="vfp-card-title">What happened</h2>
        <p className="vfp-flow-text">
          You clicked a <strong>feature demonstration chip</strong> in the {chipContext?.verticalName || 'active vertical'}.
          The agent routed your request through the OAuth gateway, which performed a <strong>credential swap</strong>:
          your user's OAuth bearer token was exchanged for a service-specific API key before calling the backend.
          This page displays the result of that API call.
        </p>
        {chipContext && (
          <dl className="vfp-flow-details">
            <div className="vfp-flow-detail">
              <dt>Vertical:</dt>
              <dd>{chipContext.verticalName}</dd>
            </div>
            <div className="vfp-flow-detail">
              <dt>Tool called:</dt>
              <dd><code>{chipContext.featureTool}</code></dd>
            </div>
          </dl>
        )}
      </section>

      {chipContext?.tokenEvents && chipContext.tokenEvents.length > 0 && (
        <section className="vfp-card vfp-card--chain">
          <h2 className="vfp-card-title">Token chain</h2>
          <div className="vfp-chain-list">
            {chipContext.tokenEvents.map((event, idx) => (
              <div key={idx} className="vfp-chain-event">
                <div className="vfp-chain-step">Step {idx + 1}</div>
                <div className="vfp-chain-detail">
                  {event.step && <div className="vfp-chain-label">{event.step}</div>}
                  {event.detail && <div className="vfp-chain-text">{event.detail}</div>}
                  {event.aud && <div className="vfp-chain-aud">aud: <code>{event.aud}</code></div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
        <div className="vfp-swap-row">
          <span className="vfp-swap-label">API call:</span>
          <code className="vfp-swap-value">{raw.apiCall || '—'}</code>
        </div>
        <ul className="vfp-swap-details">
          <li><strong>Source:</strong> {raw.backend?.source || raw.source}</li>
          <li><strong>Auth mechanism:</strong> {raw.backend?.authMechanism || raw.authMechanism}</li>
          <li><strong>Note:</strong> {raw.backend?.note || raw.note}</li>
        </ul>
      </section>

      <section className="vfp-card vfp-card--learning">
        <h2 className="vfp-card-title">Token chain — Learning path</h2>
        <p className="vfp-learning-intro">
          Below is the full RFC 8693 token exchange flow that just completed. Each step shows
          how credentials were transformed and verified as the request passed through the system.
        </p>
        <div className="vfp-token-rail">
          <TokenChainTraceRail />
        </div>
      </section>

      <div className="vfp-actions">
        <button className="vfp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  );
}
