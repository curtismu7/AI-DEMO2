# App.js Split — Design Spec

**Date:** 2026-05-28  
**Status:** Approved  
**Motivation:** `App.js` is 1,499 lines with 133 imports and ~70 routes inside a single `AppWithAuth` function. Merge conflict resolutions that pick one side silently drop imports and JSX panel placements (regression: `AuthorizeRulesPanel` dropped in merge `3d2cf092`). Splitting by role/access level and extracting custom hooks reduces App.js to ~250 lines and puts each route group's imports in its own focused file.

---

## Approach

Option A — Route components + custom hooks. Route groups become React components; app-level concerns become custom hooks. No route config objects, no new renderers. Follows existing CRA/JSX patterns.

---

## File Structure

### New files

```
demo_api_ui/src/
├── hooks/
│   ├── useAuth.js
│   ├── useAppFlags.js
│   ├── useServerHealthCheck.js
│   └── useOAuthUrlCleanup.js
└── routes/
    ├── AppShell.js
    ├── AdminRoute.js
    ├── PublicRoutes.js
    ├── CustomerRoutes.js
    ├── AdminRoutes.js
    ├── MonitoringRoutes.js
    └── EducationRoutes.js
```

### Modified files

- `demo_api_ui/src/App.js` — reduced from 1,499 to ~250 lines
- `demo_api_ui/src/__tests__/App.structure.test.js` — extended with per-route-file assertions

### Deleted files

- None during the refactor. `App.js` is trimmed in place as logic moves out.

---

## Custom Hooks

### `useAuth()`

**Returns:** `{ user, loading, logout, sessionReauth, setSessionReauth }`

**Owns (moved verbatim from AppWithAuth, zero behaviour change):**
- `checkOAuthSession()` with exponential backoff retry loop (450ms → 950ms → 1900ms → 3000ms)
- `sessionEstablishedRef` guard preventing dispatch loops
- `userAuthenticated` custom event listener
- `SESSION_REAUTH_EVENT` listener → `sessionReauth` state
- `user` and `loading` state
- `logout` function (memoised with `useCallback`)

**Constraint:** All retry timings, localStorage flag names, and backoff values copied exactly. This is the highest-risk hook — no simplification during extraction.

---

### `useAppFlags()`

**Returns:** `{ appFlags }`

**Owns:**
- `loadPublicConfig()` fetch on mount
- `appFlags` state (`showEducationPanel`, `enableTokenChainDisplay`, `agentUiMode`, `debugShowTokenDetails`, `debugShowApiCalls`, `logFilterCategories`)

---

### `useServerHealthCheck()`

**Returns:** `{ downServers }`

**Owns:**
- `monitorApiHealth()` fetch on mount
- `downServers` state (null = not checked, [] = all ok, array = down list)

Runs independently of auth — no dependency on `user`.

---

### `useOAuthUrlCleanup()`

**Returns:** nothing (side-effects only)

**Owns:**
- `oauth=success` URL param strip effect
- `sso_silent` param strip + toast notification effect
- End-user OAuth error toast effect (`showEndUserOAuthErrorToast`, `stripEndUserOAuthErrorParamsFromUrl`)

**Deps:** `searchParams`, `user` (for the error toast guard only).

---

## Route Components

### `AdminRoute.js`

Extracted from App.js into `demo_api_ui/src/routes/AdminRoute.js`. Renders children for admin users; redirects non-admin to `/` with a warning toast. Imported by `AdminRoutes.js` and `App.js`.

---

### `AppShell.js`

Replaces the ~15 repeated layout boilerplate blocks in the current App.js.

```jsx
export default function AppShell({ user, logout, children }) {
  return (
    <div className="app-shell">
      <AdminSideNav user={user} />
      <div className="app-shell-body">
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
```

Routes that don't use the shell (public pages, popouts, inline agent) render without it.

---

### `PublicRoutes.js`

No auth required. Imports only public-facing components.

| Path | Component |
|------|-----------|
| `/setup` | `SetupPage` |
| `/setup/pingone` | `PingOneSetupGuidePage` |
| `/setup/wizard` | `SetupWizard` |
| `/configure` | `UnifiedConfigurationPage` |
| `/demo-data` | Redirect → `/configure?tab=demo-management` |
| `/self-service` | `SelfServicePage` |
| `/pingone-test` | `PingOneTestPage` |
| `/mfa-test` | `MFATestPage` |
| `/authz-test` | `AuthzTestPage` |
| `/onboarding` | `Onboarding` |
| `/login` | Redirect → `/` |
| `/logout` | `LogoutPage` |
| `/compliance-modal-popout` | `ComplianceModalPopout` |
| `/demo-guide-popout` | `DemoGuidePopout` |
| `/agent` | `BankingAgent mode="inline"` |

---

### `MonitoringRoutes.js`

Requires login (redirects to `/` if no user). Owns all observability and traffic routes.

| Path | Component |
|------|-----------|
| `/monitoring/token-chain` | `TokenChainDisplay` |
| `/monitoring/token-diff` | `TokenDiffPanel` |
| `/monitoring/flow-inspector` | `UnifiedTokenFlowInspector` |
| `/monitoring/mcp-traffic` | `McpTrafficPage` |
| `/monitoring/api-explorer` | `ApiExplorerPanel` |
| `/monitoring/agent-flow` | `AgentFlowPage` |
| `/api-traffic` | `ApiTrafficPage` |
| `/mcp-traffic` | `McpTrafficPage` |
| `/logs` | `LogViewerPage` |
| `/dev-tools` | `DevToolsDashboard` |
| `/sequence-diagram` | `SequenceDiagramPage` |
| `/mcp-inspector` | `McpInspector` |
| `/webmcp` | `WebMcpPanel` |

---

### `EducationRoutes.js`

Mix of login-required and admin-only. Owns architecture diagrams and education panels.

| Path | Access | Component |
|------|--------|-----------|
| `/architecture/system` | Login | `ArchitectureTabsPanel` |
| `/architecture/overview` | Login | `ArchitectureOverviewPage` |
| `/architecture/token-flow` | Login | `ArchitectureTokenFlowPage` |
| `/architecture/flow` | Login | `ArchitectureFlowPage` |
| `/architecture/phase-266` | Login | `Phase266ArchitecturePage` |
| `/mcp-tools` | Login | `MCPToolsEducation` |
| `/agentic-trust` | Login | `AgenticTrustEducation` |
| `/actor-token-education` | Login | `ActorTokenEducation` |
| `/token-compliance` | Admin | `AdminTokenComplianceAudit` |
| `/postman` | Public | `PostmanCollectionsPage` |
| `/scope-audit` | Admin | `ScopeAuditPage` |
| `/scope-reference` | Admin | `ScopeReferencePage` |
| `/resource-server` | Login | `ResourceServerPage` |
| `/resource-server-cc` | Login | `ClientCredentialsResourcePage` |
| `/oauth/token-display` | Login | `OAuthTokenDisplayPage` |
| `/langchain` | Public | `LangChainPage` |

---

### `AdminRoutes.js`

All routes wrapped in `AdminRoute`. Owns all admin-only tooling.

| Path | Component |
|------|-----------|
| `/admin` | `Dashboard` |
| `/admin/banking` | `BankingAdminOps` |
| `/admin/vault` | `AdminVaultPage` |
| `/users` | `Users` |
| `/activity` | `ActivityLogs` |
| `/audit` | `AuditPage` |
| `/feature-flags` | `FeatureFlagsPage` |
| `/llm-config` | `LlmConfigPage` |
| `/settings` | `SecuritySettings` |
| `/authorize-config` | `AuthorizeConfigPage` |
| `/mcp-gateway` | `McpGatewayConfig` |
| `/error-audit` | `AdminErrorAuditLog` |
| `/client-registration` | `ClientRegistrationPage` |
| `/oauth-debug-logs` | `OAuthDebugLogViewer` |
| `/config` | Redirect → `/configure?tab=pingone-config` |

---

### `CustomerRoutes.js`

Customer-facing and shared routes. **This is the file guarded most carefully** — it owns `WebMcpPanel` and `AuthorizeRulesPanel` on the dashboard route, which caused the original merge regression.

| Path | Access | Component(s) |
|------|--------|-------------|
| `/` | Public | `Dashboard` (admin) or `LandingPage` |
| `/dashboard` | Public | `UserDashboard` + `WebMcpPanel` + `AuthorizeRulesPanel` |
| `/accounts` | Login | `Accounts` (admin) or `UserAccounts` |
| `/user-accounts` | Login | `UserAccounts` |
| `/transactions` | Login | `Transactions` (admin) or `UserTransactions` |
| `/profile` | Login | `Profile` |
| `/security` | Login | `SecurityCenter` |
| `/delegation` | Login | `DelegationPage` |
| `/delegated-access` | Login | `DelegatedAccessPage` |
| `/transaction-consent` | Login | `TransactionConsentPage` |
| `/path/mortgage` | Login | `MortgagePathPage` |
| `/path/apikey-info` | Login | `ApiKeyPathPage` |
| `/path/dualtoken-info` | Login | `AccessIdTokenPathPage` |
| `/agent-flow-inspector` | Login | `UnifiedTokenFlowInspector` |
| `*` | — | Redirect → `/admin` or `/dashboard` |

---

## `App.js` After

```jsx
// ~25 imports: providers, hooks, route groups, app-level portal components

function AppWithAuth() {
  const { user, loading, logout, sessionReauth, setSessionReauth } = useAuth();
  const { appFlags } = useAppFlags();
  const { downServers } = useServerHealthCheck();
  useOAuthUrlCleanup();

  // AgentUiModeContext (stays — layout flags depend on it)
  const { placement: agentPlacement, fab: agentFab, surfaceHostEl } = useAgentUiMode();

  // Layout flag computations (stays — depends on pathname + agentPlacement + appFlags)
  // showFloatingAgent, hasEmbeddedDockLayout, shouldMountSingleAgent, singleAgentSurfaceProps, etc.

  // credentialsModal + logViewerOpen state + their event listeners (stays)

  if (loading) return <SpinnerHost />;

  return (
    <div className={`App ...`}>
      <ToastContainer ... />
      {sessionReauth && <SessionReauthBanner ... />}

      <Routes>
        <Route path="/setup/*"        element={<PublicRoutes user={user} logout={logout} />} />
        <Route path="/monitoring/*"   element={<MonitoringRoutes user={user} logout={logout} />} />
        <Route path="/architecture/*" element={<EducationRoutes user={user} />} />
        <Route path="*" element={
          <AppShell user={user} logout={logout}>
            <Routes>
              <AdminRoutes user={user} logout={logout} />
              <CustomerRoutes user={user} logout={logout} appFlags={appFlags} />
            </Routes>
          </AppShell>
        } />
      </Routes>

      {/* App-level portals and modals — stay here */}
      {shouldMountSingleAgent && <BankingAgent surfaceHostEl={surfaceHostEl} ... />}
      <EmbeddedAgentDock ... />
      {downServers && <ServerRestartModal ... />}
      {credentialsModal && <MissingCredentialsModal ... />}
      {logViewerOpen && <LogViewer ... />}
      <DemoServerCheckModal ... />
      <DemoTourModal ... />
    </div>
  );
}

export default function App() {
  // Context providers — unchanged
}
```

---

## Testing

### `App.structure.test.js` — extended

Existing 13 assertions stay. New assertions added per route file:

**`CustomerRoutes.structure` block (highest priority — guards original regression):**
- `import WebMcpPanel` present
- `import AuthorizeRulesPanel` present
- `<AuthorizeRulesPanel />` appears after `<WebMcpPanel />` (both occurrences)

**Per route file:**
- Critical import present (spot-check 2–3 key components per file)
- No `banking_api_ui` path strings (stale path guard)

### Build verification

`cd demo_api_ui && npm run build` must exit 0 after each phase of the implementation. The implementation plan will gate each phase on a passing build before proceeding to the next.

### Existing tests

No existing tests target App.js internals. The React component tests (`BankingAgent.test.js`, `AgentUiModeContext` tests, etc.) test components in isolation and are unaffected by this refactor.

---

## Constraints / Do-Not-Break

- `useAuth` hook: all retry timings, localStorage flag names, and `sessionEstablishedRef` guard copied verbatim — no simplification during extraction
- `AgentFlowPage` mini-component stays in App.js (20 lines, route-specific)
- App-level portal renders (`BankingAgent`, `EmbeddedAgentDock`) stay in `AppWithAuth` — they depend on `surfaceHostEl` from context and `shouldMountSingleAgent` from layout flags
- All context providers in `App()` stay in place and in the same order
- `App.structure.test.js` must pass after every implementation phase

---

## Implementation Phases (high-level)

1. Extract `AdminRoute` to `routes/AdminRoute.js`
2. Extract four custom hooks; wire into `AppWithAuth`; build passes
3. Create `AppShell.js`
4. Extract `PublicRoutes.js`; remove those routes from App.js; build passes
5. Extract `MonitoringRoutes.js`; build passes
6. Extract `EducationRoutes.js`; build passes
7. Extract `AdminRoutes.js`; build passes
8. Extract `CustomerRoutes.js`; build passes
9. Update `App.structure.test.js` with per-route-file assertions
10. Final build + full test suite
