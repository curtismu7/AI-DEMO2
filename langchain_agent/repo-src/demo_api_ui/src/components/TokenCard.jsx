// demo_api_ui/src/components/TokenCard.jsx
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './TokenCard.css';
import JsonHighlight from './shared/JsonHighlight';
import { deriveTokenCategory, TokenColorDot } from './TokenColorSystem';
import { CLAIM_GLOSSARY } from '../constants/claimGlossary';
import bffAxios from '../services/bffAxios';

const IDENTITY_CLAIMS = ['sub', 'aud', 'iss', 'act', 'may_act', 'env', 'org'];

function formatTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function isExpired(exp) {
  return exp && exp * 1000 < Date.now();
}

function HeaderSection({ header }) {
  return (
    <div className="token-card__section">
      <div className="token-card__section-title">Header</div>
      <div className="token-card__header-section">
        {header.alg && <span className="token-card__alg-badge">{header.alg}</span>}
        {header.typ && <span className="token-card__typ-badge">{header.typ}</span>}
        {header.kid && (
          <div className="token-card__claim-grid" style={{ marginTop: 4 }}>
            <span className="token-card__claim-key">kid:</span>
            <span className="token-card__claim-val">{header.kid}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function IdentitySection({ payload }) {
  const present = IDENTITY_CLAIMS.filter((k) => payload[k] !== undefined && payload[k] !== null);
  if (present.length === 0) return null;
  return (
    <div className="token-card__section">
      <div className="token-card__section-title">Identity</div>
      <div className="token-card__claim-grid">
        {present.map((k) => (
          <React.Fragment key={k}>
            <span
              className={`token-card__claim-key${CLAIM_GLOSSARY[k] ? ' token-card__claim-key--tooltip' : ''}`}
              title={CLAIM_GLOSSARY[k] || undefined}
            >
              {k}:
            </span>
            <span className="token-card__claim-val">
              {typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k])}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ScopesSection({ scope }) {
  if (!scope) return null;
  const scopes = typeof scope === 'string' ? scope.split(' ') : scope;
  if (!scopes.length) return null;
  return (
    <div className="token-card__section">
      <div className="token-card__section-title">Scopes</div>
      <div className="token-card__scopes">
        {scopes.map((s) => (
          <span key={s} className="token-card__scope-badge">{s}</span>
        ))}
      </div>
    </div>
  );
}

function RawSection({ payload }) {
  return (
    <div className="token-card__section">
      <details>
        <summary className="token-card__raw-toggle">▼ Raw payload JSON</summary>
        <pre className="token-card__raw-json"><JsonHighlight value={payload} /></pre>
      </details>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="token-card__skeleton">
      <div className="token-card__skeleton-line token-card__skeleton-line--short" />
      <div className="token-card__skeleton-line token-card__skeleton-line--medium" />
      <div className="token-card__skeleton-line" />
      <div className="token-card__skeleton-line token-card__skeleton-line--medium" />
    </div>
  );
}

/**
 * TokenCard — canonical JWT token display component.
 *
 * Pass either `token` (raw JWT string) or `decoded` (pre-decoded BFF response object).
 * When `token` is passed the component POSTs to /api/token-display/raw-decode on mount.
 * When `decoded` is passed no BFF call is made.
 */
export default function TokenCard({
  token,
  decoded: decodedProp,
  title = 'Token',
  tokenType: tokenTypeProp,
  showHeader = true,
  showIdentity = true,
  showScopes = true,
  showRaw = true,
  defaultExpanded = false,
  className = '',
}) {
  const invalidProps = Boolean(token && decodedProp);

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [fetchedDecoded, setFetchedDecoded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    if (!token || decodedProp || invalidProps) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    setFetchedDecoded(null);
    bffAxios
      .post('/api/token-display/raw-decode', { token })
      .then((res) => {
        if (!cancelled) {
          if (res.data?.success) {
            setFetchedDecoded({ header: res.data.header, payload: res.data.payload, tokenType: res.data.tokenType });
          } else {
            setFetchError(res.data?.message || 'Decode failed');
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.message || 'Network error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, decodedProp, invalidProps]);

  if (invalidProps) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('TokenCard: pass either `token` or `decoded`, not both. Rendering nothing.');
    }
    return null;
  }

  const data = decodedProp || fetchedDecoded;
  const header = data?.header || {};
  const payload = data?.payload || {};

  const resolvedTokenType =
    tokenTypeProp ||
    deriveTokenCategory(title, undefined, data?.tokenType);

  const exp = payload.exp;
  const expired = isExpired(exp);

  return (
    <div className={`token-card${className ? ` ${className}` : ''}`}>
      <div
        className="token-card__header"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="token-card__header-left">
          <TokenColorDot type={resolvedTokenType} size={10} />
          <span className="token-card__title">{title} — Decoded Claims</span>
        </div>
        <span className="token-card__toggle">{expanded ? '▲ hide' : '▼ show'}</span>
      </div>

      {expanded && (payload.iat || payload.exp) && (
        <div className="token-card__timing">
          {payload.iat && <span><strong>Issued:</strong> {formatTs(payload.iat)}</span>}
          {payload.exp && (
            <span className={expired ? 'token-card__timing-expired' : ''}>
              <strong>Expires:</strong> {formatTs(payload.exp)}
            </span>
          )}
        </div>
      )}

      {expanded && loading && <SkeletonBody />}
      {expanded && fetchError && token && (
        <div className="token-card__body">
          <div className="token-card__section">
            <div className="token-card__section-title">Opaque Token (Not a JWT)</div>
            <p className="token-card__opaque-explanation">
              This is an opaque token (e.g., refresh token, session token). It cannot be decoded locally.
              Use token introspection (RFC 7662) to get details from the authorization server.
            </p>
            <details>
              <summary className="token-card__opaque-summary">
                Show raw token value
              </summary>
              <pre className="token-card__opaque-pre">
                {token}
              </pre>
            </details>
          </div>
        </div>
      )}
      {expanded && fetchError && !token && (
        <div className="token-card__error">⚠️ Could not decode token: {fetchError}</div>
      )}
      {expanded && !loading && !fetchError && data && Object.keys(payload).length === 0 && (
        <div className="token-card__error">⚠️ Token decoded but contained no claims</div>
      )}
      {expanded && !loading && !fetchError && data && Object.keys(payload).length > 0 && (
        <div className="token-card__body">
          {showHeader && <HeaderSection header={header} />}
          {showIdentity && <IdentitySection payload={payload} />}
          {showScopes && <ScopesSection scope={payload.scope} />}
          {showRaw && <RawSection payload={payload} />}
        </div>
      )}
    </div>
  );
}

TokenCard.propTypes = {
  token: PropTypes.string,
  decoded: PropTypes.shape({
    header: PropTypes.object,
    payload: PropTypes.object,
    tokenType: PropTypes.string,
  }),
  title: PropTypes.string,
  tokenType: PropTypes.oneOf(['subject', 'actor', 'mcp', null]),
  showHeader: PropTypes.bool,
  showIdentity: PropTypes.bool,
  showScopes: PropTypes.bool,
  showRaw: PropTypes.bool,
  defaultExpanded: PropTypes.bool,
  className: PropTypes.string,
};
