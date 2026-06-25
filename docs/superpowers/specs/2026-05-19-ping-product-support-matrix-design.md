# Ping Product Support Matrix — Education Panel

**Date:** 2026-05-19
**Status:** Approved for implementation planning

---

## Problem

The demo has 45 education panels covering OAuth and IETF identity standards. Product coverage is completely inconsistent:
- Some panels have a "PingOne setup" tab, some have "PingOne / FAPI 2.0", some have nothing
- AIC (Advanced Identity Cloud) and PingFederate are never mentioned anywhere in the education directory
- There is no single place to answer "which Ping product supports this standard?"
- A customer doing product evaluation must read every panel individually to understand coverage differences

---

## Solution

Three deliverables that work together:

1. **`pingProductSupport.js`** — shared data module (single source of truth)
2. **`PingProductSupportMatrix.js`** — new standalone panel with filterable matrix + clickable cells
3. **`Ping Products` tab** — added to 9 existing panels using a shared `ProductSupportRow` component

---

## Data Module — `pingProductSupport.js`

**Location:** `banking_api_ui/src/components/education/pingProductSupport.js`

Single source of truth. No logic — pure data. Exports one constant `MATRIX`: an array of 13 row objects.

**Row shape:**
```js
{
  id: 'rfc8693',
  standard: 'RFC 8693 Token Exchange',
  shortLabel: 'RFC 8693',
  panelId: 'rfc8693',   // educationId key — used to link to the panel
  products: {
    pingone: { level: 'full',    note: '...one sentence...', docsUrl: 'https://...' },
    aic:     { level: 'full',    note: '...one sentence...', docsUrl: 'https://...' },
    pf:      { level: 'full',    note: '...one sentence...', docsUrl: 'https://...' },
  }
}
```

**Support levels:** `'full'` | `'partial'` | `'not-supported'` | `'planned'`

**The 13 rows (standard → [pingone, aic, pf]):**

| Standard | PingOne SSO | AIC | PingFederate |
|---|---|---|---|
| RFC 8693 Token Exchange | full | full | full |
| ID-JAG / XAA | not-supported | partial | not-supported |
| Identity Chaining | not-supported | not-supported | not-supported |
| RFC 8707 Resource Indicators | partial | partial | full |
| PAR (RFC 9126) | full | full | full |
| RAR (RFC 9396) | partial | full | partial |
| JWT Client Auth (RFC 7523) | full | full | full |
| Step-Up Auth (RFC 9470) | full | not-supported | partial |
| CIBA | full | partial | full |
| WIMSE | not-supported | not-supported | not-supported |
| SD-JWT VC | partial | planned | not-supported |
| MCP | full | full | partial |
| OIDC 2.1 | partial | not-supported | not-supported |

**Evidence notes (per cell, used in expanded detail card):**

- RFC 8693 / PingOne: Dedicated use-case guide; delegation and impersonation grant types natively configured. https://docs.pingidentity.com/pingone/use_cases/p1_oauth_2_token_exchange.html
- RFC 8693 / AIC: Explicitly listed in AIC supported-standards; audience-scoped exchanges, subject/actor token types fully implemented. https://docs.pingidentity.com/pingoneaic/am-oauth2/token-exchange.html
- RFC 8693 / PF: Dedicated docs in PF 12.3; token exchange grant type, processor policies, delegation and impersonation all natively configured. https://docs.pingidentity.com/pingfederate/12.3/administrators_reference_guide/pf_oauth_exchange.html
- ID-JAG / PingOne: No product docs found; Ping Identity co-authors the IETF draft but no GA or preview is announced. No URL.
- ID-JAG / AIC: Tech preview only — `IdentityAssertionHandlerTechPreview` component and Identity Assertion auth node exist; no GA support. https://backstage.forgerock.com/docs/ig/2023.11/reference/IdentityAssertionHandlerTechPreview.html
- ID-JAG / PF: Underlying primitives (RFC 8693 + RFC 7523) exist but the XAA profile is not shipped. No URL.
- Identity Chaining / all: Draft reached -12 in early 2026 (near Proposed Standard); no vendor GA announced for any Ping product. No URL.
- RFC 8707 / PingOne: Supported via PingGateway MCP security gateway; native PingOne SaaS support is workaround-based. https://docs.pingidentity.com/pinggateway/2026/mcp/index.html
- RFC 8707 / AIC: Requires an OAuth2 Access Token Modification script to set the aud claim; not a native toggle. No URL.
- RFC 8707 / PF: Added in PF 12.1 (June 2024); resource parameter accepted on authorize/token endpoints. https://docs.pingidentity.com/pingfederate/latest/release_notes/pf_release_notes_121.html
- PAR / PingOne: Dedicated PAR documentation; /par endpoint is a supported back-channel mechanism. https://docs.pingidentity.com/pingone/applications/p1_pushed_authorization_request.html
- PAR / AIC: Dedicated AIC doc page; PAR endpoint is a first-class feature of AIC/PingAM 7.x+. https://backstage.forgerock.com/docs/idcloud/latest/am-oauth2/oauth2-authz-grant-par.html
- PAR / PF: /as/par.oauth2 endpoint documented in PF 12.2+; supports signed requests and all standard authorization parameters. https://docs.pingidentity.com/pingfederate/12.2/developers_reference_guide/pf_pushed_authoriz_request_endpoint.html
- RAR / PingOne: PingFederate 11.2+ has full RAR support; standalone PingOne SaaS docs do not yet show this feature. https://docs.pingidentity.com/pingfederate/12.3/administrators_reference_guide/pf_config_oauth_rar.html
- RAR / AIC: /authorize and /par endpoints accept authorization_details per RFC 9396; explicitly in AIC release notes. No URL.
- RAR / PF: authorization_details parameter supported; authorization detail processors require custom plugin development — no built-in processors ship out of the box. https://docs.pingidentity.com/pingfederate/12.2/administrators_reference_guide/pf_oauth_rich_authorization_requests.html
- JWT Client Auth / PingOne: private_key_jwt natively supported; developer portal has step-by-step guide. https://developer.pingidentity.com/pingone-api/auth/auth-config-options/create-a-private-key-jwt.html
- JWT Client Auth / AIC: private_key_jwt is configurable in every client profile; covered in PingAM 7.x and AIC docs. https://backstage.forgerock.com/docs/idcloud/latest/am-oauth2/client-auth-jwt.html
- JWT Client Auth / PF: private_key_jwt is a documented client authentication scheme in PF 12.3. https://docs.pingidentity.com/pingfederate/12.3/introduction_to_pingfederate/pf_client_auth_scheme.html
- Step-Up / PingOne: Dedicated step-up authentication for APIs feature using acr_values/max_age; aligns directly with RFC 9470. https://docs.pingidentity.com/pingone/authentication/p1_stepup_authentication_for_apis.html
- Step-Up / AIC: RFC 9470 not listed in supported-standards; step-up achievable via authentication trees but not labeled as RFC 9470 compliant. No URL.
- Step-Up / PF: Supports acr_values, Requested AuthN Context selector, and acr/auth_time claims; RFC 9470 cited in support docs but no explicit conformance claim. https://docs.pingidentity.com/pingfederate/12.3/administrators_reference_guide/pf_config_request_authn_context_auth_selector.html
- CIBA / PingOne: Supported as an OIDC grant type with PingOne MFA Integration Kit. https://docs.pingidentity.com/pingoneaic/latest/am-oidc1/openid-connect-backchannel-request-flow.html
- CIBA / AIC: Poll mode only; push and ping delivery modes are not supported. https://backstage.forgerock.com/docs/am/7/oidc1-guide/openid-connect-backchannel-request-flow.html
- CIBA / PF: Full implementation with both Poll and Ping callback modes; dedicated endpoint, request policies, and CIBA authenticator plugin. https://docs.pingidentity.com/pingfederate/12.3/administrators_reference_guide/pf_ciba.html
- WIMSE / all: Active IETF WG drafts; no product documentation or roadmap announcement found for any Ping product. No URL.
- SD-JWT VC / PingOne: PingOne Credentials service supports JWT VC and selective disclosure; full SD-JWT VC format not yet confirmed in product docs. https://docs.pingidentity.com/pingone/digital_credentials_using_pingone_credentials/p1_credentials_introduction.html
- SD-JWT VC / AIC: NOWallet VC wallet integration announced H2 2024; production-grade SD-JWT VC in AIC not yet documented as GA. No URL.
- SD-JWT VC / PF: No mention across PF 12.x release notes; VC support targets PingOne/AIC. No URL.
- MCP / PingOne: PingGateway 2026 MCP Security Gateway module enforces OAuth 2.0 token validation for MCP servers. https://docs.pingidentity.com/pinggateway/2026/mcp/index.html
- MCP / AIC: AIC MCP Server GA for sandbox/dev tenants; AIC acts as OAuth AS for MCP token issuance. https://developer.pingidentity.com/blog/introducing-the-aic-mcp-server/
- MCP / PF: PingFederate is a valid OAuth AS for MCP resource servers via Dynamic Client Registration + token exchange; integration pattern, not a packaged feature. https://developer.pingidentity.com/identity-for-ai/agents/idai-securing-cloudflare-pingfed.html
- OIDC 2.1 / PingOne: Implements all OIDC 2.1 behaviors (PKCE required, no implicit) but does not advertise formal OIDC 2.1 conformance. No URL.
- OIDC 2.1 / AIC: Implements OIDC Core 1.0 only; OIDC 2.1 changes partially met in practice but not formally claimed. No URL.
- OIDC 2.1 / PF: Implements OIDC Core 1.0 only; OIDC 2.1 changes partially met in practice but not formally claimed. No URL.

---

## Standalone Panel — `PingProductSupportMatrix.js`

**Location:** `banking_api_ui/src/components/education/PingProductSupportMatrix.js`

**Single tab** — no tab bar, just a titled panel body.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Ping Product Support — AI & Agentic Identity Standards          │
│─────────────────────────────────────────────────────────────────│
│ Show:  [✅ Full] [⚡ Partial] [— Not Supported] [Planned]       │
│        (toggle buttons, all active by default)                  │
│─────────────────────────────────────────────────────────────────│
│ Standard          │ PingOne SSO  │ AIC          │ PingFederate  │
│───────────────────┼──────────────┼──────────────┼───────────────│
│ RFC 8693          │ ✅ Full      │ ✅ Full      │ ✅ Full       │
│ ID-JAG / XAA      │ — None       │ ⚡ Partial   │ — None        │
│ ...               │ ...          │ ...          │ ...           │
│───────────────────┴──────────────┴──────────────┴───────────────│
│ ↕ expanded cell detail card (appears inline below the row)      │
│ ✅ Full Support — PingOne SSO                                    │
│ Dedicated use-case guide; delegation and impersonation grant    │
│ types natively configured.                                       │
│ → docs.pingidentity.com/pingone/use_cases/... ↗                 │
└─────────────────────────────────────────────────────────────────┘
```

**Filter behavior:** Toggle buttons at top. Each button toggles its level on/off. Filtering shows rows where *at least one product* matches any active level. All levels active by default (unfiltered). Buttons are independent toggles — multiple can be active simultaneously.

**Cell click behavior:** Clicking a support badge cell sets `activeCell: { rowId, productKey }` in local state. The detail card renders inline, spanning all columns, directly below the clicked row. Clicking the same cell again collapses it. Clicking a different cell moves the expansion.

**Badge rendering:**
- `full` → green background, `✅ Full` text
- `partial` → amber background, `⚡ Partial` text  
- `planned` → blue background, `◷ Planned` text
- `not-supported` → gray background, `— Not Supported` text

---

## Per-Panel `Ping Products` Tab

**Shared component:** `ProductSupportRow` — defined inline in `PingProductSupportMatrix.js`, exported for reuse. Accepts a single `rowId` prop, looks up the matching row from `MATRIX`, renders the three-column badge row with the same click-to-expand card behavior as the matrix.

**Added to these 9 panels (tab added alongside existing tabs, nothing removed):**

| Panel file | Tab label added | Existing product tab preserved |
|---|---|---|
| `IdJagPanel.js` | `Ping Products` | `PingOne SSO` kept |
| `RFC8693Panel.js` | `Ping Products` | none |
| `RARPanel.js` | `Ping Products` | `PingOne / FAPI 2.0` kept |
| `PARPanel.js` | `Ping Products` | `PingOne setup` kept |
| `StepUpPanel.js` | `Ping Products` | `ACR in PingOne` kept |
| `JwtClientAuthPanel.js` | `Ping Products` | `PingOne setup` kept |
| `IETFStandardsPanel.js` | `Ping Products` | existing tabs kept |
| `MayActPanel.js` | `Ping Products` | none |
| `IntrospectionPanel.js` | `Ping Products` | none |

The `ProductSupportRow` in each per-panel tab also includes a "View full matrix" link that opens `PingProductSupportMatrix` via the education command system.

---

## Registration and Entry Points

**`educationIds.js`** — add:
```js
PING_PRODUCT_MATRIX: 'ping-product-matrix'
```

**`educationCommands.js`** — add entry:
```js
{ id: EDUCATION_IDS.PING_PRODUCT_MATRIX, label: 'Ping Product Support Matrix', keywords: ['pingone', 'aic', 'pingfederate', 'support', 'matrix', 'products'] }
```

**`EducationPanelsHost.js`** — register `PingProductSupportMatrix` component.

**`IETFStandardsPanel.js` overview tab** — add a "View Ping product support matrix" button below the IDC guardrail table.

**`RFCIndexPanel.js`** — add a row/link for the matrix panel.

---

## File Structure

```
banking_api_ui/src/components/education/
  pingProductSupport.js          ← NEW: data module (SSOT)
  PingProductSupportMatrix.js    ← NEW: standalone panel + ProductSupportRow export
  IdJagPanel.js                  ← MODIFIED: add Ping Products tab
  RFC8693Panel.js                ← MODIFIED: add Ping Products tab
  RARPanel.js                    ← MODIFIED: add Ping Products tab
  PARPanel.js                    ← MODIFIED: add Ping Products tab
  StepUpPanel.js                 ← MODIFIED: add Ping Products tab
  JwtClientAuthPanel.js          ← MODIFIED: add Ping Products tab
  IETFStandardsPanel.js          ← MODIFIED: add Ping Products tab + overview button
  MayActPanel.js                 ← MODIFIED: add Ping Products tab
  IntrospectionPanel.js          ← MODIFIED: add Ping Products tab
  educationIds.js                ← MODIFIED: add PING_PRODUCT_MATRIX
  educationCommands.js           ← MODIFIED: add matrix entry
  EducationPanelsHost.js         ← MODIFIED: register panel
  RFCIndexPanel.js               ← MODIFIED: add matrix link
```

2 new files, 12 modified files. No backend changes.

---

## Success Criteria

- `cd banking_api_ui && npm run build` exits 0
- Matrix panel opens from education command palette with all 13 rows and 3 columns
- Filter toggles correctly show/hide rows
- Clicking a cell expands detail card; clicking again collapses it
- Each of the 9 modified panels has a `Ping Products` tab showing the correct row
- `ProductSupportRow` "View full matrix" link opens the matrix panel
- No existing PingOne setup/config tabs are removed or modified
- No emojis beyond ✅ ⚠️ ❌ in any UI text (REGRESSION_PLAN §0)
