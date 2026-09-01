/**
 * ClaimDetailsModal Component
 * Displays JWT claims for a specific token type (user, agent, mcp)
 * Renders claims dynamically based on tokenType prop
 */
import React, { useState } from 'react';
import DraggableModal from './DraggableModal';
import { TOKEN_CLAIMS } from '../constants/tokenClaims';
import InspectorTabs from './shared/InspectorTabs';
import JsonView, { JSON_VIEW_TABS } from './shared/JsonView';
import '../styles/TokenChainRedesign.css';

/**
 * Builds the claim rows to render. With no live claims (or an empty object),
 * returns the static educational example set unchanged — same as before this
 * function existed. With live claims, shows only the fields actually present
 * on this run's token (real values), pairing each with the static RFC
 * description when we have one for that key, so the teaching content survives
 * without ever putting a canned example value next to a real token.
 */
function buildClaimRows(tokenType, liveClaims) {
  const staticClaims = TOKEN_CLAIMS[tokenType] || [];
  if (!liveClaims || typeof liveClaims !== "object" || Object.keys(liveClaims).length === 0) {
    return { claims: staticClaims, isLive: false };
  }
  const descriptionByKey = new Map(staticClaims.map((c) => [c.key, c.description]));
  const claims = Object.entries(liveClaims).map(([key, value]) => ({
    key,
    value: value && typeof value === "object" ? value : String(value),
    isObject: Boolean(value && typeof value === "object"),
    description: descriptionByKey.get(key) || "Live value from this run.",
  }));
  return { claims, isLive: true };
}

/**
 * ClaimDetailsModal
 * @param {boolean} isOpen - Whether the modal is visible
 * @param {string} tokenType - Token type: 'user', 'agent', or 'mcp'
 * @param {Object} [liveClaims] - This run's real claims for tokenType, e.g.
 *   { sub, aud, scope, act, ... }. When omitted/empty, falls back to the
 *   static educational example set for tokenType.
 * @param {function} onClose - Callback when modal should close
 */
function ClaimDetailsModal({ isOpen, tokenType, liveClaims, onClose }) {
  const [jsonMode, setJsonMode] = useState('json');
  if (!isOpen) return null;

  const { claims, isLive } = buildClaimRows(tokenType, liveClaims);
  const hasObjectClaim = claims.some((c) => c.isObject);
  const titleMap = {
    user: 'User Token Claims',
    agent: 'Agent Token Claims',
    mcp: 'MCP Token Claims',
  };
  const title = titleMap[tokenType] || 'Token Claims';

  return (
    <DraggableModal isOpen={isOpen} onClose={onClose} title={title} storageKey="claim-details-modal">
      {/* dm-scroll: `dm-body` is bare by contract — no padding, and no scroll,
          so a long claim list clipped instead of scrolling. */}
      <div className="dm-scroll">
      {isLive && <span className="utfi-modal-live-badge">Live — this run</span>}
      {hasObjectClaim && (
        <InspectorTabs tabs={JSON_VIEW_TABS} activeKey={jsonMode} onChange={setJsonMode} />
      )}
      <div className="utfi-claims-list">
        {claims.map((claim) => (
          <div key={claim.key} className="utfi-claim-item">
            <div className="utfi-claim-key">{claim.key}</div>
            <div className="utfi-claim-value">
              {claim.isObject ? <JsonView mode={jsonMode} value={claim.value} crackHeight={240} /> : claim.value}
            </div>
            <div className="utfi-claim-description">{claim.description}</div>
          </div>
        ))}
      </div>
      </div>
    </DraggableModal>
  );
}

export default ClaimDetailsModal;
