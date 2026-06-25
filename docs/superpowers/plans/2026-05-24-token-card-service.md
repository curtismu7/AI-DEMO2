# TokenCard Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a canonical `TokenCard` React component backed by the existing BFF decode endpoint, then migrate all token display sites to use it and delete the superseded components.

**Architecture:** The BFF already exposes `POST /api/token-display/decode` returning `{ success, header, payload, tokenType, summary }`. `TokenCard` accepts either a raw JWT string (fetches BFF on mount) or a pre-decoded object (renders immediately). All five existing token display components are either migrated to use `TokenCard` or deleted.

**Tech Stack:** React 18 (CRA, `.jsx`), CommonJS BFF (Node/Express), CSS BEM (`token-card__*`), PropTypes, `bffAxios` for BFF calls.

---

## File Map

| File | Action |
|---|---|
| `demo_api_ui/src/constants/claimGlossary.js` | **Create** — shared claim description map |
| `demo_api_ui/src/components/TokenCard.jsx` | **Create** — canonical component |
| `demo_api_ui/src/components/TokenCard.css` | **Create** — scoped CSS (`token-card__*`) |
| `demo_api_server/services/tokenDisplayService.js` | **Modify** — add JSDoc response shape contract |
| `demo_api_ui/src/components/PingOneTestPage.jsx` | **Modify** — swap `DecodedTokenPanel` → `TokenCard` |
| `demo_api_ui/src/components/OAuthTokenDisplayPage.jsx` | **Modify** — replace section rendering → `TokenCard` |
| `demo_api_ui/src/components/TokenChainDisplay.js` | **Modify** — replace `TokenInspectorPanel` body → `TokenCard` |
| `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx` | **Modify** — replace right-panel claim grid → `TokenCard` |
| `demo_api_ui/src/components/DecodedTokenPanel.jsx` | **Delete** |
| `demo_api_ui/src/components/TokenDisplay.jsx` | **Delete** |
| `demo_api_ui/src/components/TokenInspector.tsx` | **Delete** |

---

## Task 1: Extract shared claimGlossary constant

**Files:**
- Create: `demo_api_ui/src/constants/claimGlossary.js`

The `CLAIM_GLOSSARY` object is duplicated in `DecodedTokenPanel.jsx`, `OAuthTokenDisplayPage.jsx`, `UnifiedTokenFlowInspector.jsx`, and `TokenDiffPanel.js`. Extract it once here; `TokenCard` imports from it.

- [ ] **Step 1: Create the file**

```javascript
// demo_api_ui/src/constants/claimGlossary.js
'use strict';

/**
 * Human-readable descriptions for common JWT/OAuth claims.
 * Used by TokenCard and other token display components.
 * Keys are claim names; values are tooltip strings with RFC references.
 */
const CLAIM_GLOSSARY = {
  sub: 'Subject (RFC 8693 §2.1) — unique identifier of the principal this token was issued for (user, client, or service)',
  iss: 'Issuer — the PingOne authorization server that issued this token (URL)',
  aud: 'Audience (RFC 8693 §2.3) — the intended recipient(s). The resource server MUST verify this matches its own identifier',
  exp: 'Expiration — Unix epoch time after which the token MUST be rejected',
  iat: 'Issued At — Unix epoch time when the token was created',
  nbf: 'Not Before — token must not be accepted before this time',
  jti: 'JWT ID — unique identifier to prevent token replay attacks',
  scope: 'Scopes — space-separated list of permissions granted to the bearer',
  client_id: 'Client ID — the OAuth 2.0 application that requested this token',
  env: 'PingOne Environment ID — the tenant/environment this token belongs to',
  org: 'PingOne Organization ID — the parent organization for this environment',
  act: 'Actor claim (RFC 8693 §2.2) — identifies the party acting on behalf of the subject in a delegated flow',
  may_act: 'May Act (RFC 8693 §4.1) — allows the named client_id to perform a Token Exchange with this token as subject_token',
  acr: 'Authentication Context Class Reference — level of authentication assurance (e.g. MFA step-up)',
  amr: 'Authentication Methods References — how the user authenticated (e.g. pwd, otp, fido)',
  at_hash: 'Access Token Hash — used to bind the id_token to the access_token',
  nonce: 'Nonce — ties the id_token to a specific authentication request to prevent replay',
  azp: 'Authorized Party — the client_id of the OAuth client that received the token',
  sid: 'Session ID — PingOne session identifier',
  auth_time: 'Authentication Time — Unix epoch time when the user last authenticated',
};

export default CLAIM_GLOSSARY;
```

- [ ] **Step 2: Verify the file parses (no syntax errors)**

```bash
cd demo_api_ui && node -e "require('@babel/register'); require('./src/constants/claimGlossary.js')" 2>&1 || echo "note: babel needed for ES module — check step 3 instead"
```

Expected: no error, or a Babel note (fine — CRA handles this at build time).

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/constants/claimGlossary.js
git commit -m "feat(token-card): add shared claimGlossary constant"
```

---

## Task 2: Create TokenCard.css

**Files:**
- Create: `demo_api_ui/src/components/TokenCard.css`

All class names use `token-card__*` BEM prefix to avoid collisions with existing `token-display-*`, `decoded-*`, `otdp-*`, and `utfi-*` classes.

- [ ] **Step 1: Create the CSS file**

```css
/* demo_api_ui/src/components/TokenCard.css */

.token-card {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
}

/* ── Header bar ─────────────────────────────────────────────────────────── */
.token-card__header {
  background: var(--token-card-header-bg, #3b5bdb);
  color: white;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.token-card__header:focus-visible {
  outline: 2px solid white;
  outline-offset: -2px;
}

.token-card__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  min-width: 0;
}

.token-card__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.token-card__toggle {
  font-size: 11px;
  opacity: 0.85;
  white-space: nowrap;
  margin-left: 12px;
}

/* ── Timing sub-bar ─────────────────────────────────────────────────────── */
.token-card__timing {
  background: #e7f0ff;
  border-bottom: 1px solid #c5d4f5;
  padding: 6px 16px;
  display: flex;
  gap: 24px;
  font-size: 11px;
  color: #1c3a8a;
  flex-wrap: wrap;
}

.token-card__timing-expired {
  color: #b91c1c;
  font-weight: 600;
}

/* ── Body ───────────────────────────────────────────────────────────────── */
.token-card__body {
  padding: 14px 16px;
  background: white;
  border: 1px solid #dee2e6;
  border-top: none;
  border-radius: 0 0 8px 8px;
}

/* ── Section ────────────────────────────────────────────────────────────── */
.token-card__section {
  padding-top: 12px;
  margin-bottom: 4px;
}

.token-card__section + .token-card__section {
  border-top: 1px solid #f1f3f5;
}

.token-card__section-title {
  font-weight: 700;
  font-size: 10px;
  color: #3b5bdb;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

/* ── Header section badges ──────────────────────────────────────────────── */
.token-card__header-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.token-card__alg-badge {
  background: #e7f5ff;
  color: #1971c2;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: monospace;
}

.token-card__typ-badge {
  background: #f3f0ff;
  color: #6741d9;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: monospace;
}

/* ── Claim grid ─────────────────────────────────────────────────────────── */
.token-card__claim-grid {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 5px 10px;
}

.token-card__claim-key {
  color: #868e96;
  font-size: 11px;
  padding-top: 1px;
  word-break: keep-all;
}

.token-card__claim-key--tooltip {
  cursor: help;
  border-bottom: 1px dotted #94a3b8;
}

.token-card__claim-val {
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
  color: #212529;
}

/* ── Scopes ─────────────────────────────────────────────────────────────── */
.token-card__scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.token-card__scope-badge {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

/* ── Raw JSON ───────────────────────────────────────────────────────────── */
.token-card__raw-toggle {
  color: #3b5bdb;
  font-size: 11px;
  cursor: pointer;
  font-weight: 500;
  list-style: none;
  padding: 0;
}

.token-card__raw-toggle::-webkit-details-marker {
  display: none;
}

.token-card__raw-json {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 10px;
  font-size: 10px;
  font-family: monospace;
  color: #495057;
  line-height: 1.6;
  margin-top: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── Loading skeleton ───────────────────────────────────────────────────── */
.token-card__skeleton {
  padding: 14px 16px;
  background: white;
  border: 1px solid #dee2e6;
  border-top: none;
  border-radius: 0 0 8px 8px;
}

.token-card__skeleton-line {
  height: 12px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: token-card-shimmer 1.4s infinite;
  border-radius: 4px;
  margin-bottom: 10px;
}

.token-card__skeleton-line--short {
  width: 40%;
}

.token-card__skeleton-line--medium {
  width: 70%;
}

@keyframes token-card-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Error state ────────────────────────────────────────────────────────── */
.token-card__error {
  padding: 12px 16px;
  background: white;
  border: 1px solid #dee2e6;
  border-top: none;
  border-radius: 0 0 8px 8px;
  color: #b91c1c;
  font-size: 12px;
}
```

- [ ] **Step 2: Commit**

```bash
git add demo_api_ui/src/components/TokenCard.css
git commit -m "feat(token-card): add TokenCard CSS"
```

---

## Task 3: Create TokenCard.jsx

**Files:**
- Create: `demo_api_ui/src/components/TokenCard.jsx`

This is the canonical component. It accepts either `token` (raw JWT string → BFF fetch) or `decoded` (pre-decoded object → render directly). Uses `bffAxios` for BFF calls.

**`decoded` prop shape** (matches BFF `formatTokenForDisplay` response):
```js
{
  header: { alg: string, kid: string, typ?: string },
  payload: { sub?, iss?, aud?, iat?, exp?, scope?, env?, org?, act?, may_act?, client_id?, ...rest },
  tokenType?: 'worker' | 'user' | 'agent' | 'mcp' | string,
}
```

- [ ] **Step 1: Create TokenCard.jsx**

```jsx
// demo_api_ui/src/components/TokenCard.jsx
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './TokenCard.css';
import { deriveTokenCategory } from './TokenColorSystem';
import CLAIM_GLOSSARY from '../constants/claimGlossary';
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

function typeDot(tokenType) {
  if (tokenType === 'subject') return '🔴';
  if (tokenType === 'actor') return '🔵';
  if (tokenType === 'mcp') return '🟢';
  return '🔍';
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
        <pre className="token-card__raw-json">{JSON.stringify(payload, null, 2)}</pre>
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
 * When `token` is passed the component POSTs to /api/token-display/decode on mount.
 * When `decoded` is passed no BFF call is made.
 */
export default function TokenCard({
  token,
  decoded: decodedProp,
  title = 'Token — Decoded Claims',
  tokenType: tokenTypeProp,
  showHeader = true,
  showIdentity = true,
  showScopes = true,
  showRaw = true,
  defaultExpanded = false,
  className = '',
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [fetchedDecoded, setFetchedDecoded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Warn about invalid prop combination in dev
  if (process.env.NODE_ENV !== 'production' && token && decodedProp) {
    // eslint-disable-next-line no-console
    console.warn('TokenCard: pass either `token` or `decoded`, not both. Rendering nothing.');
    return null;
  }

  // Fetch BFF decode when token prop provided and card is expanded
  useEffect(() => {
    if (!token || decodedProp) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    bffAxios
      .post('/api/token-display/decode', { token })
      .then((res) => {
        if (!cancelled) {
          if (res.data?.success) {
            setFetchedDecoded(res.data);
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
  }, [token, decodedProp]);

  const data = decodedProp || fetchedDecoded;
  const header = data?.header || {};
  const payload = data?.payload || {};

  const resolvedTokenType =
    tokenTypeProp ||
    deriveTokenCategory(title, undefined, data?.tokenType);

  const dot = typeDot(resolvedTokenType);
  const exp = payload.exp;
  const expired = isExpired(exp);

  return (
    <div className={`token-card${className ? ` ${className}` : ''}`}>
      {/* Blue header bar */}
      <div
        className="token-card__header"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="token-card__header-left">
          <span aria-hidden="true">{dot}</span>
          <span className="token-card__title">{title} — Decoded Claims</span>
        </div>
        <span className="token-card__toggle">{expanded ? '▲ hide' : '▼ show'}</span>
      </div>

      {/* Timing sub-bar — always shown when expanded */}
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

      {/* Body */}
      {expanded && loading && <SkeletonBody />}
      {expanded && fetchError && (
        <div className="token-card__error">⚠ Could not decode token: {fetchError}</div>
      )}
      {expanded && !loading && !fetchError && data && (
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
```

- [ ] **Step 2: Build to verify no syntax errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` (or only pre-existing warnings — zero new errors).

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/TokenCard.jsx
git commit -m "feat(token-card): add TokenCard component"
```

---

## Task 4: Document BFF response shape

**Files:**
- Modify: `demo_api_server/services/tokenDisplayService.js`

Add a JSDoc block above `formatTokenForDisplay` documenting the exact response shape.

- [ ] **Step 1: Open `demo_api_server/services/tokenDisplayService.js` and find `formatTokenForDisplay`**

Look for the line:
```js
function formatTokenForDisplay(token, options = {}) {
```

- [ ] **Step 2: Add JSDoc above that function**

Insert this block immediately before the `function formatTokenForDisplay` line:

```js
/**
 * Decode and format a JWT string for display.
 * This is the canonical decode contract — all token display consumers depend on this shape.
 *
 * @param {string} token - Raw JWT string (not verified, display only)
 * @param {{ includeFullToken?: boolean, includeClaims?: boolean }} [options]
 * @returns {{
 *   success: boolean,
 *   header: { alg: string, kid?: string, typ?: string },
 *   payload: {
 *     sub?: string, iss?: string, aud?: string|string[],
 *     iat?: number, exp?: number, scope?: string,
 *     env?: string, org?: string, client_id?: string,
 *     act?: object, may_act?: object,
 *     [key: string]: any
 *   },
 *   tokenType: string,
 *   summary: { subject?: string, issuer?: string, audience?: string, expiresAt?: string }
 * }}
 */
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/tokenDisplayService.js
git commit -m "docs(token-display-service): add JSDoc response shape contract"
```

---

## Task 5: Tier 1a — Migrate PingOneTestPage

**Files:**
- Modify: `demo_api_ui/src/components/PingOneTestPage.jsx`

Replace all `DecodedTokenPanel` usages with `TokenCard`. The existing prop is `decoded={...}` and `label="..."` — `TokenCard` uses `decoded={...}` and `title="..."`.

- [ ] **Step 1: Update the import at line 7**

Find:
```js
import DecodedTokenPanel from "./DecodedTokenPanel";
```

Replace with:
```js
import TokenCard from "./TokenCard";
```

- [ ] **Step 2: Replace all usages — find every occurrence**

Run to see all usage lines:
```bash
grep -n "DecodedTokenPanel" demo_api_ui/src/components/PingOneTestPage.jsx
```

For every occurrence of:
```jsx
<DecodedTokenPanel decoded={someVar} label="Some Label" />
```

Replace with:
```jsx
<TokenCard decoded={someVar} title="Some Label" defaultExpanded />
```

The prop rename is:
- `decoded={...}` → `decoded={...}` (same)
- `label="..."` → `title="..."` (rename only)
- Add `defaultExpanded` (the old component defaulted to collapsed, but these panels in the test page should open by default to match prior behaviour — verify visually after build)

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/PingOneTestPage.jsx
git commit -m "feat(token-card): migrate PingOneTestPage → TokenCard"
```

---

## Task 6: Tier 1b — Migrate OAuthTokenDisplayPage

**Files:**
- Modify: `demo_api_ui/src/components/OAuthTokenDisplayPage.jsx`

`OAuthTokenDisplayPage` renders four collapsible cards (Identity, Authorization, Validity, Provider) plus an optional Account card. We replace the identity/provider/validity card content with `TokenCard`, keeping the page's own data-fetching, error states, and the unique sections (`Authorization` with may_act hints, `Account Information` with enriched PingOne data) intact.

The strategy: replace the four `otdp-card` divs that duplicate `TokenCard`'s layout with a single `<TokenCard decoded={tokenClaims} title="User Access Token" defaultExpanded />`. The Authorization section (with RFC hints) and Account Information section are unique — keep them as-is below the card.

- [ ] **Step 1: Add the TokenCard import**

Find (near top of file, after existing imports):
```js
import './OAuthTokenDisplayPage.css';
```

Add after it:
```js
import TokenCard from './TokenCard';
```

- [ ] **Step 2: Replace the four otdp-card divs**

Find the block starting with:
```jsx
      <div className="otdp-grid">
        {/* Identity & Profile */}
        <div className="otdp-card">
```

And ending just before:
```jsx
      {/* PingOne Userinfo Enrichment
```

Replace that entire `<div className="otdp-grid">...</div>` block with:

```jsx
      <TokenCard
        decoded={tokenClaims}
        title="User Access Token"
        defaultExpanded
        showHeader
        showIdentity
        showScopes
        showRaw
      />
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/OAuthTokenDisplayPage.jsx
git commit -m "feat(token-card): migrate OAuthTokenDisplayPage → TokenCard"
```

---

## Task 7: Tier 2a — Migrate TokenChainDisplay TokenInspectorPanel body

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`

The `TokenInspectorPanel` function (lines ~1650–1777) renders a floating draggable panel. Its body is:
```jsx
<div className="tci-body">
  <EventDetail event={event} />
</div>
```

`EventDetail` renders the full token detail. We replace it with `TokenCard`. The panel chrome (drag handle, collapse/resize, pop-out button) is untouched.

First, understand what `event` contains by checking how `EventDetail` uses it — it uses `event.jwtFullDecode` or `event.claims`. We map that to `decoded`.

- [ ] **Step 1: Add the TokenCard import**

Find the existing imports at the top of `TokenChainDisplay.js`. Add:
```js
import TokenCard from './TokenCard';
```

- [ ] **Step 2: Build the decoded object inside TokenInspectorPanel**

Find inside `TokenInspectorPanel`:
```jsx
      {/* Body — scrollable content */}
      {!collapsed && (
        <div className="tci-body">
          <EventDetail event={event} />
        </div>
      )}
```

Replace with:
```jsx
      {/* Body — scrollable content */}
      {!collapsed && (
        <div className="tci-body">
          <TokenCard
            decoded={{
              header: event.jwtFullDecode?.header || {},
              payload: event.jwtFullDecode?.claims || event.claims || {},
              tokenType: event.tokenType,
            }}
            title={event.label || 'Token'}
            defaultExpanded
            showHeader
            showIdentity
            showScopes
            showRaw
          />
        </div>
      )}
```

- [ ] **Step 3: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.js
git commit -m "feat(token-card): migrate TokenChainDisplay inspector panel → TokenCard"
```

---

## Task 8: Tier 2b — Migrate UnifiedTokenFlowInspector right panel

**Files:**
- Modify: `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`

The right panel's `OAuthInspectorSection` component renders Identity, Authorization, Token Validity, Provider, and Raw JSON sections (lines ~641–839). The Authorization section (with RFC hints about may_act, act chains, and scope narrowing) and Account Information section are educationally unique — keep them. Replace only the identity + validity + provider + raw JSON portions with `TokenCard`.

The strategy: add `TokenCard` above the existing `renderSection` calls, showing only `showHeader`, `showIdentity`, `showRaw` (validity/timing already shown in TokenCard's sub-bar). Remove the `validity` and `provider` `renderSection` calls since `TokenCard` covers them. Keep `identity` (username/email enrichment), `authorization` (RFC hints), `tokenExchange`, `account` sections unchanged.

- [ ] **Step 1: Add the TokenCard import**

Find the import block at the top of `UnifiedTokenFlowInspector.jsx` and add:
```js
import TokenCard from './TokenCard';
```

- [ ] **Step 2: Find where `OAuthInspectorSection` renders the claim sections**

The rendered JSX starts with:
```jsx
  return (
    <div className="utfi-inspector-section">
      <div className="utfi-section-header">
```

And the sections are rendered inside `<div className="utfi-sections">`. Find the block:

```jsx
        {renderSection('identity', 'Identity & Profile', '👤', (
```

- [ ] **Step 3: Add TokenCard above the identity section**

Insert immediately before the `{renderSection('identity', ...` line:

```jsx
        {/* Canonical token card — header, key identity claims, raw JSON */}
        {tokenClaims && (
          <TokenCard
            decoded={tokenClaims}
            title="OAuth Token"
            defaultExpanded
            showHeader
            showIdentity
            showScopes={false}
            showRaw
          />
        )}
```

- [ ] **Step 4: Remove the validity and provider renderSection calls**

Find and delete these two blocks (they are now covered by TokenCard's timing sub-bar and identity section):

```jsx
        {(payload.iat || payload.exp || timeRemaining) && renderSection('validity', 'Token Validity', '⏱', (
          <>
            <ClaimRow label="Issued At" value={payload.iat ? formatTimestamp(payload.iat) : null} glossary={CLAIM_GLOSSARY.iat} />
            <ClaimRow label="Expires At" value={payload.exp ? formatTimestamp(payload.exp) : null} glossary={CLAIM_GLOSSARY.exp} />
            {timeRemaining && (
              <div className="utfi-claim-row">
                <span className="utfi-claim-key">Time Remaining</span>
                <span className={`utfi-claim-value ${isExpired ? 'utfi-expired-text' : 'utfi-active-text'}`}>
                  {timeRemaining}
                </span>
              </div>
            )}
          </>
        ))}

        {(payload.iss || header.alg || payload.env) && renderSection('provider', 'Provider', '🏛', (
          <>
            <ClaimRow label="Issuer (iss)" value={payload.iss} glossary={CLAIM_GLOSSARY.iss} />
            <ClaimRow label="Algorithm" value={header.alg} />
            <ClaimRow label="Environment" value={payload.env} glossary={CLAIM_GLOSSARY.env} />
          </>
        ))}
```

Also remove the Raw Claims section since `TokenCard` provides it:
```jsx
        {Object.keys(payload).length > 0 && renderSection('rawJson', 'Raw Claims (JSON)', '{ }', (
          <pre className="utfi-raw-json">{JSON.stringify(payload, null, 2)}</pre>
        ))}
```

- [ ] **Step 5: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx
git commit -m "feat(token-card): migrate UnifiedTokenFlowInspector right panel → TokenCard"
```

---

## Task 9: Tier 3 — Delete unused components

**Files:**
- Delete: `demo_api_ui/src/components/DecodedTokenPanel.jsx`
- Delete: `demo_api_ui/src/components/TokenDisplay.jsx`
- Delete: `demo_api_ui/src/components/TokenInspector.tsx`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "DecodedTokenPanel\|TokenDisplay\|TokenInspector" demo_api_ui/src --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
```

Expected: zero results (all usages were migrated in Tasks 5–8). If any appear, fix them before continuing.

- [ ] **Step 2: Delete the files**

```bash
rm demo_api_ui/src/components/DecodedTokenPanel.jsx
rm demo_api_ui/src/components/TokenDisplay.jsx
rm demo_api_ui/src/components/TokenInspector.tsx
```

- [ ] **Step 3: Build to confirm no broken imports**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add -A demo_api_ui/src/components/DecodedTokenPanel.jsx \
           demo_api_ui/src/components/TokenDisplay.jsx \
           demo_api_ui/src/components/TokenInspector.tsx
git commit -m "feat(token-card): delete superseded token display components"
```

---

## Task 10: Final verification

- [ ] **Step 1: Clean build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 2: No remaining references to deleted components**

```bash
grep -rn "DecodedTokenPanel\|TokenDisplay\b\|TokenInspector\b" demo_api_ui/src --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
```

Expected: zero results.

- [ ] **Step 3: Run existing test suite**

```bash
cd /path/to/repo && npm run test:ui 2>&1 | tail -20
```

Expected: all tests pass (no new failures).

- [ ] **Step 4: Confirm TokenCard used at all sites**

```bash
grep -rn "TokenCard" demo_api_ui/src --include="*.jsx" --include="*.js"
```

Expected results include: `PingOneTestPage.jsx`, `OAuthTokenDisplayPage.jsx`, `TokenChainDisplay.js`, `UnifiedTokenFlowInspector.jsx`.

- [ ] **Step 5: Final commit if any cleanup needed, then summarise**

```bash
git log --oneline -10
```

All 10 tasks should produce a clean commit history.
