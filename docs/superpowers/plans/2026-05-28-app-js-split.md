# App.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `demo_api_ui/src/App.js` from 1,499 lines into focused route-group components and custom hooks so merge conflicts can no longer silently drop imports or JSX panel placements.

**Architecture:** Route groups become React components (`CustomerRoutes`, `AdminRoutes`, `MonitoringRoutes`, `EducationRoutes`, `PublicRoutes`) that each own their own imports. App-level concerns (auth, config, health check, URL cleanup) become custom hooks (`useAuth`, `useAppFlags`, `useServerHealthCheck`, `useOAuthUrlCleanup`). A shared `AppShell` component replaces ~15 identical `<AdminSideNav>+<TopNav>+<main>` boilerplate blocks. App.js drops to ~250 lines.

**Tech Stack:** React 18, React Router v6, CRA (no bundler config changes needed), Jest (file-read structure tests)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `demo_api_ui/src/routes/AdminRoute.js` | Guard: admin-only wrapper |
| Create | `demo_api_ui/src/routes/AppShell.js` | Shared layout: AdminSideNav + TopNav + main |
| Create | `demo_api_ui/src/routes/PublicRoutes.js` | No-auth routes: /setup/*, /configure, /agent, etc. |
| Create | `demo_api_ui/src/routes/MonitoringRoutes.js` | Observability routes: /monitoring/*, /logs, /api-traffic, etc. |
| Create | `demo_api_ui/src/routes/EducationRoutes.js` | /architecture/*, /mcp-tools, /scope-audit, etc. |
| Create | `demo_api_ui/src/routes/AdminRoutes.js` | All admin-only routes inside AppShell |
| Create | `demo_api_ui/src/routes/CustomerRoutes.js` | Customer + shared routes inside AppShell |
| Create | `demo_api_ui/src/hooks/useAuth.js` | Auth check, session state, logout |
| Create | `demo_api_ui/src/hooks/useAppFlags.js` | Config loading, appFlags state |
| Create | `demo_api_ui/src/hooks/useServerHealthCheck.js` | Startup server health check |
| Create | `demo_api_ui/src/hooks/useOAuthUrlCleanup.js` | OAuth param cleanup side-effects |
| Modify | `demo_api_ui/src/App.js` | Shrink to ~250 lines: wire hooks, render route groups |
| Modify | `demo_api_ui/src/__tests__/App.structure.test.js` | Add per-route-file structure assertions |

---

## Task 1: Extract AdminRoute

**Files:**
- Create: `demo_api_ui/src/routes/AdminRoute.js`

- [ ] **Step 1: Create the file**

```js
// demo_api_ui/src/routes/AdminRoute.js
import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { notifyWarning } from "../utils/toastUtils";

export default function AdminRoute({ user, children }) {
  const toastedRef = useRef(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin && !toastedRef.current) {
      toastedRef.current = true;
      notifyWarning("This page is restricted to admin users.");
    }
  }, [isAdmin]);

  if (isAdmin) return children;
  return <Navigate to="/" replace />;
}
```

- [ ] **Step 2: Update App.js to import from the new location**

In `demo_api_ui/src/App.js`, find the existing `AdminRoute` function definition (lines 209–222) and replace it with an import:

```js
import AdminRoute from "./routes/AdminRoute";
```

Delete lines 209–222 (the `function AdminRoute` block).

- [ ] **Step 3: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/AdminRoute.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract AdminRoute to routes/AdminRoute.js"
```

---

## Task 2: Extract Custom Hooks

**Files:**
- Create: `demo_api_ui/src/hooks/useAuth.js`
- Create: `demo_api_ui/src/hooks/useAppFlags.js`
- Create: `demo_api_ui/src/hooks/useServerHealthCheck.js`
- Create: `demo_api_ui/src/hooks/useOAuthUrlCleanup.js`
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Create `useAppFlags.js`**

```js
// demo_api_ui/src/hooks/useAppFlags.js
import { useEffect, useState } from "react";
import { loadPublicConfig } from "../utils/configCache";

export function useAppFlags() {
  const [appFlags, setAppFlags] = useState({
    showEducationPanel: true,
    enableTokenChainDisplay: true,
    agentUiMode: "standard",
    debugShowTokenDetails: false,
    debugShowApiCalls: false,
    logFilterCategories: "",
  });

  useEffect(() => {
    loadPublicConfig()
      .then((cfg) => {
        setAppFlags({
          showEducationPanel:
            cfg.show_education_panel !== false &&
            cfg.show_education_panel !== "false",
          enableTokenChainDisplay:
            cfg.enable_token_chain_display !== false &&
            cfg.enable_token_chain_display !== "false",
          agentUiMode: cfg.agent_ui_mode || "standard",
          debugShowTokenDetails:
            cfg.debug_show_token_details === true ||
            cfg.debug_show_token_details === "true",
          debugShowApiCalls:
            cfg.debug_show_api_calls === true ||
            cfg.debug_show_api_calls === "true",
          logFilterCategories: cfg.log_filter_categories || "",
        });
      })
      .catch(() => {});
  }, []);

  return { appFlags };
}
```

- [ ] **Step 2: Create `useServerHealthCheck.js`**

```js
// demo_api_ui/src/hooks/useServerHealthCheck.js
import { useEffect, useState } from "react";

export function useServerHealthCheck() {
  const [downServers, setDownServers] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/demo-status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const down = (data.servers || []).filter((s) => !s.up);
        setDownServers(down);
      })
      .catch(() => {
        if (cancelled) return;
        setDownServers([
          {
            name: "Banking API Server",
            key: "api_server",
            up: false,
            startCmd: "cd banking_api_server && npm start",
            description: "Express BFF",
            port: 3001,
          },
          {
            name: "Banking MCP Server",
            key: "mcp_server",
            up: false,
            startCmd: "cd banking_mcp_server && npm run dev",
            description: "MCP tool server",
            port: 8080,
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { downServers };
}
```

- [ ] **Step 3: Create `useOAuthUrlCleanup.js`**

```js
// demo_api_ui/src/hooks/useOAuthUrlCleanup.js
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  showEndUserOAuthErrorToast,
  stripEndUserOAuthErrorParamsFromUrl,
} from "../utils/oauthUtils";
import { notifyInfo } from "../utils/toastUtils";

export function useOAuthUrlCleanup(user) {
  const [searchParams] = useSearchParams();

  // End-user OAuth BFF error toast
  useEffect(() => {
    if (showEndUserOAuthErrorToast(searchParams)) {
      stripEndUserOAuthErrorParamsFromUrl();
    }
  }, [searchParams]);

  // SSO silent sign-in: strip sso_silent param + show toast
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("sso_silent") !== "1") return;
    params.delete("sso_silent");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
    notifyInfo(
      "✅ Signed in automatically — you had an active PingOne session.",
      { autoClose: 6000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OAuth success landing: strip ?oauth= param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    if (!params.has("oauth")) return;
    params.delete("oauth");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 4: Create `useAuth.js`**

This is the highest-risk hook. Copy verbatim — no simplification.

```js
// demo_api_ui/src/hooks/useAuth.js
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedJson } from "../utils/apiCache";
import { savePublicConfig } from "../utils/configCache";
import { SESSION_REAUTH_EVENT } from "../utils/sessionReauthEvent";

// Module-level flag mirrors the _didLogOut pattern in App.js —
// survives React re-renders, reset only on explicit logout.
let _didLogOut = false;

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionReauth, setSessionReauth] = useState(null);
  const sessionEstablishedRef = useRef(null);

  const checkOAuthSession = useCallback(async () => {
    const applyUser = (u) => {
      setUser(u);
      if (!sessionEstablishedRef.current) {
        sessionEstablishedRef.current = true;
        window.dispatchEvent(new CustomEvent("userAuthenticated"));
      }
      setLoading(false);
    };

    try {
      const adminResponse = await getCachedJson("/api/auth/oauth/status");
      if (adminResponse.data.authenticated) {
        applyUser(adminResponse.data.user);
        return true;
      }

      const userResponse = await getCachedJson("/api/auth/oauth/user/status");
      if (userResponse.data.authenticated) {
        applyUser(userResponse.data.user);
        return true;
      }

      const sessionResponse = await getCachedJson("/api/auth/session");
      if (sessionResponse.data.authenticated) {
        applyUser(sessionResponse.data.user);
        return true;
      }

      setLoading(false);
      return false;
    } catch (error) {
      console.error("Error checking OAuth sessions:", error.message);
      setLoading(false);
      return false;
    }
  }, []);

  // Public config → IndexedDB (skip when in logout handoff)
  useEffect(() => {
    if (localStorage.getItem("userLoggedOut") === "true") return;
    axios
      .get("/api/admin/config")
      .then(({ data }) => savePublicConfig(data.config))
      .catch(() => {});
  }, []);

  // Auth check with exponential backoff retry on oauth=success
  useEffect(() => {
    const pathname =
      typeof window !== "undefined" &&
      typeof window.location?.pathname === "string"
        ? window.location.pathname
        : "";
    const isPostLogoutLanding =
      pathname === "/logout" || pathname.endsWith("/logout");
    const userLoggedOut =
      localStorage.getItem("userLoggedOut") === "true" ||
      _didLogOut ||
      isPostLogoutLanding;

    if (userLoggedOut) {
      _didLogOut = true;
      sessionEstablishedRef.current = false;
      fetch("/api/auth/clear-session", {
        method: "POST",
        credentials: "include",
      })
        .catch(() => {})
        .finally(() => {
          localStorage.removeItem("userLoggedOut");
          setUser(null);
          setLoading(false);
          if (isPostLogoutLanding && window.history?.replaceState) {
            window.history.replaceState(null, "", "/");
          }
        });
      return undefined;
    }

    const oauthSuccess =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search || "").get("oauth") ===
        "success";

    const RETRY_DELAYS_MS = [450, 950, 1900, 3000];
    let retryIndex = 0;
    let cancelled = false;
    const timeouts = [];

    const arm = (delayMs, fn) => {
      const id = setTimeout(() => {
        if (!cancelled) void fn();
      }, delayMs);
      timeouts.push(id);
    };

    const runCheck = async () => {
      if (cancelled) return;
      const ok = await checkOAuthSession();
      if (cancelled || ok) return;
      if (!oauthSuccess || retryIndex >= RETRY_DELAYS_MS.length) return;
      const delay = RETRY_DELAYS_MS[retryIndex++];
      arm(delay, runCheck);
    };

    arm(200, runCheck);

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [checkOAuthSession]);

  // userAuthenticated event listener
  useEffect(() => {
    const handler = () => void checkOAuthSession();
    window.addEventListener("userAuthenticated", handler);
    return () => window.removeEventListener("userAuthenticated", handler);
  }, [checkOAuthSession]);

  // SESSION_REAUTH_EVENT listener
  useEffect(() => {
    const onSessionReauth = (e) => {
      const d = e.detail;
      if (!d || typeof d.message !== "string" || !d.message.trim()) return;
      const role = d.role === "admin" ? "admin" : "customer";
      const isHITL = d.isHITL === true;
      setSessionReauth({ message: d.message.trim(), role, isHITL });
    };
    window.addEventListener(SESSION_REAUTH_EVENT, onSessionReauth);
    return () =>
      window.removeEventListener(SESSION_REAUTH_EVENT, onSessionReauth);
  }, []);

  // Dismiss reauth banner when user logs in
  useEffect(() => {
    if (user) setSessionReauth(null);
  }, [user]);

  const logout = useCallback(() => {
    console.info("Starting logout — navigating to /api/auth/logout");
    localStorage.setItem("userLoggedOut", "true");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("authToken");
    localStorage.removeItem("refreshToken");
    sessionStorage.clear();
    window.dispatchEvent(new CustomEvent("userLoggedOut"));
    localStorage.removeItem("tokenChainHistory");
    window.location.href = "/api/auth/logout";
  }, []);

  return { user, loading, logout, sessionReauth, setSessionReauth };
}
```

- [ ] **Step 5: Wire hooks into App.js**

In `demo_api_ui/src/App.js`:

Add imports at the top of the import block:
```js
import { useAuth } from "./hooks/useAuth";
import { useAppFlags } from "./hooks/useAppFlags";
import { useServerHealthCheck } from "./hooks/useServerHealthCheck";
import { useOAuthUrlCleanup } from "./hooks/useOAuthUrlCleanup";
```

In `AppWithAuth`, replace the state declarations and effects for auth/flags/health/url-cleanup with hook calls. The beginning of `AppWithAuth` becomes:

```js
function AppWithAuth() {
  const fullLocation = useLocation();
  const backgroundLocation = fullLocation.state?.backgroundLocation;
  const { pathname } = useLocation();
  const pathNorm = pathname.replace(/\/$/, "") || "/";
  const isApiTrafficOnlyPage =
    pathNorm === "/api-traffic" ||
    pathNorm === "/logs" ||
    pathNorm === "/agent";
  const { placement: agentPlacement, fab: agentFab, surfaceHostEl } = useAgentUiMode();

  const { user, loading, logout, sessionReauth, setSessionReauth } = useAuth();
  const { appFlags } = useAppFlags();
  const { downServers } = useServerHealthCheck();
  useOAuthUrlCleanup(user);

  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState(null);

  // Setup browser extension interference handling
  useEffect(() => {
    const cleanup = setupBrowserExtensionHandling();
    return cleanup;
  }, []);

  // Initialize server restart notification monitoring
  useEffect(() => {
    monitorApiHealth();
  }, []);

  // ... rest of AppWithAuth unchanged (layout flags, credentialsModal listener, return JSX)
```

Remove from `AppWithAuth` (now owned by hooks):
- `const [user, setUser] = useState(null)` and everything that sets it
- `const [loading, setLoading] = useState(true)`
- `const [sessionReauth, setSessionReauth] = useState(null)`
- `const [downServers, setDownServers] = useState(null)`
- `const sessionEstablishedRef = useRef(null)`
- `const [appFlags, setAppFlags] = useState({...})` and its `useEffect`
- The health check `useEffect` (fetch `/api/health/demo-status`)
- `const checkOAuthSession = useCallback(...)` and all its `useEffect`s
- The `SESSION_REAUTH_EVENT` listener `useEffect`
- `useEffect(() => { if (user) setSessionReauth(null) }, [user])`
- `const logout = () => { ... }` function
- The three OAuth URL cleanup `useEffect`s
- The `savePublicConfig` `useEffect`

- [ ] **Step 6: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 7: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/hooks/ demo_api_ui/src/App.js
git commit -m "refactor(app): extract useAuth, useAppFlags, useServerHealthCheck, useOAuthUrlCleanup hooks"
```

---

## Task 3: Create AppShell

**Files:**
- Create: `demo_api_ui/src/routes/AppShell.js`

- [ ] **Step 1: Create the file**

```js
// demo_api_ui/src/routes/AppShell.js
import AdminSideNav from "../components/AdminSideNav";
import TopNav from "../components/TopNav";

export default function AppShell({ user, logout, children }) {
  return (
    <>
      <AdminSideNav user={user} />
      <div className="app-shell-body">
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify the file exists and has no syntax errors**

```bash
node -e "require('./demo_api_ui/src/routes/AppShell.js')" 2>&1 || echo "CJS check skipped (ESM)"
cd demo_api_ui && npx react-scripts build 2>&1 | tail -3
```

No build step needed yet — AppShell isn't wired in until Task 7. This step just confirms the file is syntactically valid by triggering a build that will include it once imported.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/routes/AppShell.js
git commit -m "refactor(app): add AppShell layout wrapper component"
```

---

## Task 4: Extract PublicRoutes

**Files:**
- Create: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Create `PublicRoutes.js`**

```js
// demo_api_ui/src/routes/PublicRoutes.js
import { Navigate, Route, Routes } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";
import AuthzTestPage from "../components/AuthzTestPage";
import BankingAgent from "../components/BankingAgent";
import ComplianceModalPopout from "../components/ComplianceModalPopout";
import DemoGuidePopout from "../components/DemoGuidePopout";
import LogoutPage from "../components/LogoutPage";
import MFATestPage from "../components/MFATestPage";
import Onboarding from "../components/Onboarding";
import PingOneSetupGuidePage from "../components/PingOneSetupGuidePage";
import PingOneTestPage from "../components/PingOneTestPage";
import SelfServicePage from "../components/SelfServicePage";
import SetupPage from "../components/SetupPage";
import SetupWizard from "../components/SetupWizard";
import UnifiedConfigurationPage from "../components/Configuration/UnifiedConfigurationPage";
import TopNav from "../components/TopNav";

export default function PublicRoutes({ user, logout }) {
  return (
    <Routes>
      <Route path="/setup/pingone" element={<PingOneSetupGuidePage />} />
      <Route path="/setup/wizard" element={<SetupWizard />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/configure"
        element={
          <>
            <AdminSideNav user={user} />
            <TopNav user={user} onLogout={logout} />
            <main className="main-content">
              <UnifiedConfigurationPage user={user} onLogout={logout} />
            </main>
          </>
        }
      />
      <Route
        path="/demo-data"
        element={<Navigate to="/configure?tab=demo-management" replace />}
      />
      <Route
        path="/self-service"
        element={
          <>
            <AdminSideNav user={user} />
            <TopNav user={user} onLogout={logout} />
            <main className="main-content">
              <SelfServicePage />
            </main>
          </>
        }
      />
      <Route
        path="/pingone-test"
        element={
          <>
            <AdminSideNav user={user} />
            <TopNav user={user} onLogout={logout} />
            <main className="main-content">
              <PingOneTestPage />
            </main>
          </>
        }
      />
      <Route
        path="/mfa-test"
        element={
          <>
            <AdminSideNav user={user} />
            <TopNav user={user} onLogout={logout} />
            <main className="main-content">
              <MFATestPage />
            </main>
          </>
        }
      />
      <Route
        path="/authz-test"
        element={
          <>
            <AdminSideNav user={user} />
            <TopNav user={user} onLogout={logout} />
            <main className="main-content">
              <AuthzTestPage />
            </main>
          </>
        }
      />
      <Route
        path="/onboarding"
        element={
          user && user.role !== "admin" ? (
            <Navigate to="/" replace />
          ) : (
            <Onboarding />
          )
        }
      />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route
        path="/agent"
        element={
          <BankingAgent
            user={user}
            onLogout={logout}
            mode="inline"
            distinctFloatingChrome
          />
        }
      />
      <Route
        path="/compliance-modal-popout"
        element={<ComplianceModalPopout />}
      />
      <Route path="/demo-guide-popout" element={<DemoGuidePopout />} />
    </Routes>
  );
}
```

- [ ] **Step 2: Replace those routes in App.js with a single route**

In `demo_api_ui/src/App.js`, add the import:
```js
import PublicRoutes from "./routes/PublicRoutes";
```

In the `<Routes>` block, replace the individual routes for `/setup/pingone`, `/setup/wizard`, `/setup`, `/configure`, `/demo-data`, `/self-service`, `/pingone-test`, `/mfa-test`, `/authz-test`, `/onboarding`, `/login`, `/logout`, `/agent`, `/compliance-modal-popout`, `/demo-guide-popout` with:

```jsx
<Route path="/*" element={<PublicRoutes user={user} logout={logout} />} />
```

> **Important:** place this BEFORE the `/monitoring/*` route. React Router matches top-down; the `/*` catch here only fires for the specific paths PublicRoutes handles since the more specific `/monitoring/*` and `/architecture/*` routes above it take priority.

Actually — to keep routing unambiguous, use individual explicit paths for each public route at the App level instead of a wildcard, or keep the existing explicit routes but delegate their `element` to PublicRoutes. The cleanest approach: keep `/setup/*` as a group:

```jsx
{/* Public routes — no auth required */}
<Route path="/setup/pingone" element={<PingOneSetupGuidePage />} />
<Route path="/setup/wizard" element={<SetupWizard />} />
<Route path="/setup" element={<SetupPage />} />
<Route path="/configure" element={<PublicRoutes.Configure user={user} logout={logout} />} />
```

Wait — the cleanest approach matching the spec is to keep App.js top-level routes explicit for the ones that need special treatment, and delegate the shell-wrapping ones. Given the complexity of public route path matching, the safest implementation: keep the top-level `<Route path="/setup/..." />` entries in App.js as single-element delegations into PublicRoutes. Revise the plan:

In App.js replace the 15 public route elements with inline `<PublicRoutes user={user} logout={logout} />` component renders — each route in App.js stays but its `element` prop becomes a fragment containing the right sub-component. Actually the simplest correct approach is:

**Replace the 15 individual route declarations in App.js with their imports removed, and have PublicRoutes render its own `<Routes>` using absolute paths.** App.js gets one entry:

```jsx
<Route path="/setup/*" element={<PublicRoutes user={user} logout={logout} />} />
```

And `PublicRoutes.js` uses relative paths (drop the leading `/`). Update `PublicRoutes.js` Step 1 above to use relative paths:

```jsx
<Route path="pingone" element={<PingOneSetupGuidePage />} />
<Route path="wizard" element={<SetupWizard />} />
<Route path="" element={<SetupPage />} />
```

For `/configure`, `/demo-data`, `/self-service` etc. which are NOT under `/setup/`, keep them as separate top-level routes in App.js but replace their long JSX `element` blocks with a `<PublicShellPage>` helper defined inside PublicRoutes.js and exported:

```js
// Named export for use in App.js top-level routes
export function PublicShellPage({ user, logout, children }) {
  return (
    <>
      <AdminSideNav user={user} />
      <TopNav user={user} onLogout={logout} />
      <main className="main-content">{children}</main>
    </>
  );
}
```

Then in App.js:
```jsx
import PublicRoutes, { PublicShellPage } from "./routes/PublicRoutes";

<Route path="/setup/*" element={<PublicRoutes user={user} logout={logout} />} />
<Route path="/configure" element={
  <PublicShellPage user={user} logout={logout}>
    <UnifiedConfigurationPage user={user} onLogout={logout} />
  </PublicShellPage>
} />
<Route path="/demo-data" element={<Navigate to="/configure?tab=demo-management" replace />} />
<Route path="/self-service" element={
  <PublicShellPage user={user} logout={logout}><SelfServicePage /></PublicShellPage>
} />
<Route path="/pingone-test" element={
  <PublicShellPage user={user} logout={logout}><PingOneTestPage /></PublicShellPage>
} />
<Route path="/mfa-test" element={
  <PublicShellPage user={user} logout={logout}><MFATestPage /></PublicShellPage>
} />
<Route path="/authz-test" element={
  <PublicShellPage user={user} logout={logout}><AuthzTestPage /></PublicShellPage>
} />
<Route path="/onboarding" element={
  user && user.role !== "admin" ? <Navigate to="/" replace /> : <Onboarding />
} />
<Route path="/login" element={<Navigate to="/" replace />} />
<Route path="/logout" element={<LogoutPage />} />
<Route path="/agent" element={
  <BankingAgent user={user} onLogout={logout} mode="inline" distinctFloatingChrome />
} />
<Route path="/compliance-modal-popout" element={<ComplianceModalPopout />} />
<Route path="/demo-guide-popout" element={<DemoGuidePopout />} />
```

Update `PublicRoutes.js` to only handle `/setup/*` sub-routes:

```js
// demo_api_ui/src/routes/PublicRoutes.js
import { Route, Routes } from "react-router-dom";
import PingOneSetupGuidePage from "../components/PingOneSetupGuidePage";
import SetupPage from "../components/SetupPage";
import SetupWizard from "../components/SetupWizard";
import AdminSideNav from "../components/AdminSideNav";
import TopNav from "../components/TopNav";

export function PublicShellPage({ user, logout, children }) {
  return (
    <>
      <AdminSideNav user={user} />
      <TopNav user={user} onLogout={logout} />
      <main className="main-content">{children}</main>
    </>
  );
}

export default function PublicRoutes({ user, logout }) {
  return (
    <Routes>
      <Route path="pingone" element={<PingOneSetupGuidePage />} />
      <Route path="wizard" element={<SetupWizard />} />
      <Route path="" element={<SetupPage />} />
    </Routes>
  );
}
```

- [ ] **Step 3: Remove now-redundant imports from App.js**

After wiring, remove from App.js the imports that are now only used in PublicRoutes.js:
- `PingOneSetupGuidePage` (still needed for `PublicRoutes`)
- Keep `SetupPage`, `SetupWizard` in App.js since they're imported by App.js for the PublicShellPage pattern above — actually these move to PublicRoutes.js. Remove them from App.js if no longer used there.

Check: `grep "SetupPage\|SetupWizard\|PingOneSetupGuidePage" demo_api_ui/src/App.js` — remove any that are no longer referenced.

- [ ] **Step 4: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 5: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract PublicRoutes and PublicShellPage"
```

---

## Task 5: Extract MonitoringRoutes

**Files:**
- Create: `demo_api_ui/src/routes/MonitoringRoutes.js`
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Create `MonitoringRoutes.js`**

```js
// demo_api_ui/src/routes/MonitoringRoutes.js
import { Navigate, Route, Routes } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";
import ApiExplorerPanel from "../components/ApiExplorerPanel";
import ApiTrafficPage from "../components/ApiTrafficPage";
import DevToolsDashboard from "../components/DevToolsDashboard";
import LogViewerPage from "../components/LogViewerPage";
import McpInspector from "../components/McpInspector";
import McpTrafficPage from "../components/McpTrafficPage";
import SequenceDiagramPage from "../components/SequenceDiagramPage";
import TokenChainDisplay from "../components/TokenChainDisplay";
import TokenDiffPanel from "../components/TokenDiffPanel";
import TopNav from "../components/TopNav";
import UnifiedTokenFlowInspector from "../components/UnifiedTokenFlowInspector";
import WebMcpPanel from "../components/WebMcpPanel";

// AgentFlowPage is defined in App.js — import it from there once extracted,
// or inline it here. For now, accept it as a prop.
export default function MonitoringRoutes({ user, logout, AgentFlowPage, appFlags }) {
  const shell = (children) => (
    <>
      <AdminSideNav user={user} />
      <TopNav user={user} onLogout={logout} />
      <main className="main-content">{children}</main>
    </>
  );

  return (
    <Routes>
      {/* /monitoring/* sub-routes */}
      <Route path="monitoring/token-chain" element={shell(
        user && appFlags?.enableTokenChainDisplay
          ? <TokenChainDisplay />
          : <Navigate to="/" replace />
      )} />
      <Route path="monitoring/token-diff" element={shell(
        user ? <TokenDiffPanel /> : <Navigate to="/" replace />
      )} />
      <Route path="monitoring/flow-inspector" element={shell(
        user
          ? <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={false} />
          : <Navigate to="/" replace />
      )} />
      <Route path="monitoring/mcp-traffic" element={shell(<McpTrafficPage />)} />
      <Route path="monitoring/api-explorer" element={shell(
        user ? <ApiExplorerPanel /> : <Navigate to="/" replace />
      )} />
      <Route path="monitoring/agent-flow" element={shell(
        user && AgentFlowPage
          ? <AgentFlowPage />
          : <Navigate to="/" replace />
      )} />
      {/* Top-level monitoring pages */}
      <Route path="api-traffic" element={shell(
        user ? <ApiTrafficPage /> : <Navigate to="/" replace />
      )} />
      <Route path="mcp-traffic" element={shell(<McpTrafficPage />)} />
      <Route path="logs" element={shell(
        user ? <LogViewerPage /> : <Navigate to="/" replace />
      )} />
      <Route path="dev-tools" element={shell(
        <DevToolsDashboard
          defaultWidth={1200}
          defaultHeight={700}
          onClose={() => window.history.back()}
        />
      )} />
      <Route path="sequence-diagram" element={shell(<SequenceDiagramPage user={user} />)} />
      <Route path="mcp-inspector" element={shell(
        <McpInspector user={user} onLogout={logout} />
      )} />
      <Route path="webmcp" element={shell(
        user ? <WebMcpPanel /> : <Navigate to="/" replace />
      )} />
    </Routes>
  );
}
```

- [ ] **Step 2: Wire into App.js**

Add import:
```js
import MonitoringRoutes from "./routes/MonitoringRoutes";
```

Replace the `/monitoring/*` route block, the top-level `/api-traffic`, `/mcp-traffic`, `/dev-tools`, `/sequence-diagram` routes, and the `/webmcp`, `/mcp-inspector`, `/logs`, `/api-traffic` routes inside the wildcard catch-all with:

```jsx
<Route
  path="/monitoring/*"
  element={
    <MonitoringRoutes
      user={user}
      logout={logout}
      AgentFlowPage={AgentFlowPage}
      appFlags={appFlags}
    />
  }
/>
<Route path="/api-traffic" element={
  <MonitoringRoutes user={user} logout={logout} appFlags={appFlags} AgentFlowPage={AgentFlowPage} />
} />
```

> **Note:** Top-level `/api-traffic`, `/mcp-traffic`, `/dev-tools`, `/sequence-diagram` were duplicated (outside AND inside wildcard). Remove the ones inside the wildcard catch-all `<Routes>` block and keep only the top-level ones pointing to `MonitoringRoutes`.

- [ ] **Step 3: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/MonitoringRoutes.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract MonitoringRoutes"
```

---

## Task 6: Extract EducationRoutes

**Files:**
- Create: `demo_api_ui/src/routes/EducationRoutes.js`
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Create `EducationRoutes.js`**

```js
// demo_api_ui/src/routes/EducationRoutes.js
import { Navigate, Route, Routes } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";
import TopNav from "../components/TopNav";
import { ActorTokenEducation } from "../components/ActorTokenEducation";
import AdminTokenComplianceAudit from "../components/AdminTokenComplianceAudit";
import { AgenticTrustEducation } from "../components/AgenticTrustEducation";
import ArchitectureFlowPage from "../components/ArchitectureFlowPage";
import ArchitectureOverviewPage from "../components/ArchitectureOverviewPage";
import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel";
import ArchitectureTokenFlowPage from "../components/ArchitectureTokenFlowPage";
import ClientCredentialsResourcePage from "../components/ClientCredentialsResourcePage";
import LangChainPage from "../pages/LangChainPage";
import { MCPToolsEducation } from "../components/MCPToolsEducation";
import OAuthTokenDisplayPage from "../components/OAuthTokenDisplayPage";
import Phase266ArchitecturePage from "../components/Phase266ArchitecturePage";
import PostmanCollectionsPage from "../components/PostmanCollectionsPage";
import ResourceServerPage from "../components/ResourceServerPage";
import ScopeAuditPage from "../components/ScopeAuditPage";
import ScopeReferencePage from "../components/ScopeReferencePage";
import AdminRoute from "./AdminRoute";

export default function EducationRoutes({ user, logout }) {
  const shell = (children) => (
    <>
      <AdminSideNav user={user} />
      <TopNav user={user} onLogout={logout} />
      <main className="main-content">{children}</main>
    </>
  );

  return (
    <Routes>
      {/* /architecture/* sub-routes */}
      <Route path="system" element={shell(<ArchitectureTabsPanel user={user} />)} />
      <Route path="overview" element={shell(<ArchitectureOverviewPage user={user} />)} />
      <Route path="token-flow" element={shell(<ArchitectureTokenFlowPage user={user} />)} />
      <Route path="flow" element={shell(<ArchitectureFlowPage user={user} />)} />
      <Route path="phase-266" element={shell(<Phase266ArchitecturePage />)} />
    </Routes>
  );
}

// Named export: education routes that live outside /architecture/* (used in wildcard catch-all)
export function EducationWildcardRoutes({ user, logout }) {
  return (
    <>
      <Route path="/mcp-tools" element={
        user ? <MCPToolsEducation /> : <Navigate to="/" replace />
      } />
      <Route path="/agentic-trust" element={
        user ? <AgenticTrustEducation /> : <Navigate to="/" replace />
      } />
      <Route path="/actor-token-education" element={
        user ? <ActorTokenEducation /> : <Navigate to="/" replace />
      } />
      <Route path="/token-compliance" element={
        <AdminRoute user={user}><AdminTokenComplianceAudit /></AdminRoute>
      } />
      <Route path="/postman" element={
        <PostmanCollectionsPage user={user} onLogout={logout} />
      } />
      <Route path="/scope-audit" element={
        <AdminRoute user={user}><ScopeAuditPage /></AdminRoute>
      } />
      <Route path="/scope-reference" element={
        <AdminRoute user={user}><ScopeReferencePage /></AdminRoute>
      } />
      <Route path="/resource-server" element={
        user ? <ResourceServerPage /> : <Navigate to="/" replace />
      } />
      <Route path="/resource-server-cc" element={
        user ? <ClientCredentialsResourcePage /> : <Navigate to="/" replace />
      } />
      <Route path="/oauth/token-display" element={
        user ? <OAuthTokenDisplayPage /> : <Navigate to="/" replace />
      } />
      <Route path="/langchain" element={<LangChainPage />} />
    </>
  );
}
```

- [ ] **Step 2: Wire into App.js**

Add import:
```js
import EducationRoutes, { EducationWildcardRoutes } from "./routes/EducationRoutes";
```

Replace the `/architecture/*` route in App.js:
```jsx
<Route
  path="/architecture/*"
  element={<EducationRoutes user={user} logout={logout} />}
/>
```

Inside the wildcard catch-all `<Routes>`, replace the individual education/compliance/oauth-display route declarations with `<EducationWildcardRoutes user={user} logout={logout} />`.

- [ ] **Step 3: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/EducationRoutes.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract EducationRoutes"
```

---

## Task 7: Extract AdminRoutes

**Files:**
- Create: `demo_api_ui/src/routes/AdminRoutes.js`
- Modify: `demo_api_ui/src/App.js`

- [ ] **Step 1: Create `AdminRoutes.js`**

```js
// demo_api_ui/src/routes/AdminRoutes.js
import { Navigate, Route } from "react-router-dom";
import ActivityLogs from "../components/ActivityLogs";
import AdminErrorAuditLog from "../components/AdminErrorAuditLog";
import AdminVaultPage from "../components/AdminVaultPage";
import AuthorizeConfigPage from "../components/AuthorizeConfigPage";
import AuditPage from "../components/AuditPage";
import BankingAdminOps from "../components/BankingAdminOps";
import ClientRegistrationPage from "../components/ClientRegistrationPage";
import Dashboard from "../components/Dashboard";
import FeatureFlagsPage from "../components/FeatureFlagsPage";
import LlmConfigPage from "../components/LlmConfigPage";
import McpGatewayConfig from "../components/McpGatewayConfig";
import OAuthDebugLogViewer from "../components/OAuthDebugLogViewer";
import SecuritySettings from "../components/SecuritySettings";
import Users from "../components/Users";
import AdminRoute from "./AdminRoute";

export default function AdminRoutes({ user, logout }) {
  return (
    <>
      <Route path="/admin" element={
        <AdminRoute user={user}>
          <Dashboard user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/admin/banking" element={
        <AdminRoute user={user}>
          <BankingAdminOps user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/admin/vault" element={
        <AdminRoute user={user}><AdminVaultPage /></AdminRoute>
      } />
      <Route path="/users" element={
        <AdminRoute user={user}>
          <Users user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/activity" element={
        <AdminRoute user={user}>
          <ActivityLogs user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/audit" element={
        <AdminRoute user={user}><AuditPage user={user} /></AdminRoute>
      } />
      <Route path="/feature-flags" element={
        user ? <FeatureFlagsPage /> : <Navigate to="/" replace />
      } />
      <Route path="/llm-config" element={
        <AdminRoute user={user}>
          <LlmConfigPage user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/settings" element={
        <AdminRoute user={user}>
          <SecuritySettings user={user} onLogout={logout} />
        </AdminRoute>
      } />
      <Route path="/authorize-config" element={
        <AdminRoute user={user}><AuthorizeConfigPage /></AdminRoute>
      } />
      <Route path="/mcp-gateway" element={
        <AdminRoute user={user}><McpGatewayConfig /></AdminRoute>
      } />
      <Route path="/error-audit" element={
        <AdminRoute user={user}><AdminErrorAuditLog /></AdminRoute>
      } />
      <Route path="/oauth-debug-logs" element={
        <AdminRoute user={user}><OAuthDebugLogViewer /></AdminRoute>
      } />
      <Route path="/client-registration" element={
        <AdminRoute user={user}><ClientRegistrationPage /></AdminRoute>
      } />
      <Route path="/config" element={
        <Navigate to="/configure?tab=pingone-config" replace />
      } />
    </>
  );
}
```

- [ ] **Step 2: Wire into App.js**

Add import:
```js
import AdminRoutes from "./routes/AdminRoutes";
```

Inside the wildcard catch-all `<Routes>`, replace the individual admin route declarations with `<AdminRoutes user={user} logout={logout} />`.

- [ ] **Step 3: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/AdminRoutes.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract AdminRoutes"
```

---

## Task 8: Extract CustomerRoutes

**Files:**
- Create: `demo_api_ui/src/routes/CustomerRoutes.js`
- Modify: `demo_api_ui/src/App.js`

This is the highest-priority extraction — it isolates `WebMcpPanel` and `AuthorizeRulesPanel` into their own file so future merges can't drop them from App.js.

- [ ] **Step 1: Create `CustomerRoutes.js`**

```js
// demo_api_ui/src/routes/CustomerRoutes.js
import { Navigate, Route } from "react-router-dom";
import AccessIdTokenPathPage from "../components/AccessIdTokenPathPage";
import Accounts from "../components/Accounts";
import ApiKeyPathPage from "../components/ApiKeyPathPage";
import AuthorizeRulesPanel from "../components/AuthorizeRulesPanel";
import Dashboard from "../components/Dashboard";
import DelegatedAccessPage from "../components/DelegatedAccessPage";
import DelegationPage from "../components/DelegationPage";
import LandingPage from "../components/LandingPage";
import McpInspector from "../components/McpInspector";
import MortgagePathPage from "../components/MortgagePathPage";
import Profile from "../components/Profile";
import SecurityCenter from "../components/SecurityCenter";
import TransactionConsentPage from "../components/TransactionConsentPage";
import Transactions from "../components/Transactions";
import UnifiedTokenFlowInspector from "../components/UnifiedTokenFlowInspector";
import UserAccounts from "../components/UserAccounts";
import UserDashboard from "../components/UserDashboard";
import UserTransactions from "../components/UserTransactions";
import WebMcpPanel from "../components/WebMcpPanel";
import AdminRoute from "./AdminRoute";

export default function CustomerRoutes({ user, logout, appFlags }) {
  return (
    <>
      <Route path="/" element={
        user?.role === "admin"
          ? <Dashboard user={user} onLogout={logout} />
          : <LandingPage user={user} onLogout={logout} />
      } />
      <Route path="/dashboard" element={
        <>
          <UserDashboard user={user} onLogout={logout} />
          <WebMcpPanel />
          <AuthorizeRulesPanel />
        </>
      } />
      <Route path="/accounts" element={
        user?.role === "admin"
          ? <AdminRoute user={user}><Accounts user={user} onLogout={logout} /></AdminRoute>
          : <UserAccounts user={user} />
      } />
      <Route path="/user-accounts" element={<UserAccounts user={user} />} />
      <Route path="/transactions" element={
        user?.role === "admin"
          ? <AdminRoute user={user}><Transactions user={user} onLogout={logout} /></AdminRoute>
          : <UserTransactions user={user} />
      } />
      <Route path="/profile" element={<Profile user={user} />} />
      <Route path="/security" element={<SecurityCenter user={user} />} />
      <Route path="/delegation" element={
        user ? <DelegationPage user={user} onLogout={logout} /> : <Navigate to="/" replace />
      } />
      <Route path="/delegated-access" element={
        <DelegatedAccessPage user={user} onLogout={logout} />
      } />
      <Route path="/transaction-consent" element={
        <TransactionConsentPage user={user} />
      } />
      <Route path="/path/mortgage" element={
        user ? <MortgagePathPage /> : <Navigate to="/" replace />
      } />
      <Route path="/path/apikey-info" element={
        user ? <ApiKeyPathPage /> : <Navigate to="/" replace />
      } />
      <Route path="/path/dualtoken-info" element={
        user ? <AccessIdTokenPathPage /> : <Navigate to="/" replace />
      } />
      <Route path="/agent-flow-inspector" element={
        user
          ? <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={true} />
          : <Navigate to="/" replace />
      } />
      <Route path="/mcp-inspector" element={
        <McpInspector user={user} onLogout={logout} />
      } />
      <Route path="*" element={
        <Navigate to={user?.role === "admin" ? "/admin" : "/dashboard"} replace />
      } />
    </>
  );
}
```

- [ ] **Step 2: Wire into App.js**

Add import:
```js
import CustomerRoutes from "./routes/CustomerRoutes";
```

Inside the wildcard catch-all `<Routes>`, replace the remaining customer-facing route declarations with `<CustomerRoutes user={user} logout={logout} appFlags={appFlags} />`.

Also replace the top-level explicit `/dashboard` route in App.js:

```jsx
{/* /dashboard top-level explicit route (guests see demo data, not redirect) */}
<Route
  path="/dashboard"
  element={
    loading ? null : (
      <>
        <AdminSideNav user={user} />
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          <CustomerRoutes.Dashboard user={user} logout={logout} />
        </main>
      </>
    )
  }
/>
```

Actually the top-level `/dashboard` route needs special treatment (it shows for guests without login). Keep it in App.js but delegate its content:

```jsx
<Route
  path="/dashboard"
  element={
    loading ? null : (
      <>
        <AdminSideNav user={user} />
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          <UserDashboard user={user} onLogout={logout} />
          <WebMcpPanel />
          <AuthorizeRulesPanel />
        </main>
      </>
    )
  }
/>
```

The key insight: `App.js` still imports `WebMcpPanel` and `AuthorizeRulesPanel` for the top-level `/dashboard` route, but `CustomerRoutes.js` ALSO imports and uses them for the wildcard-matched `/dashboard`. Both files are guarded by `App.structure.test.js`.

- [ ] **Step 3: Verify build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 4: Run structure test**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -5
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/CustomerRoutes.js demo_api_ui/src/App.js
git commit -m "refactor(app): extract CustomerRoutes"
```

---

## Task 9: Update App.structure.test.js

**Files:**
- Modify: `demo_api_ui/src/__tests__/App.structure.test.js`

- [ ] **Step 1: Add route file structure assertions**

Add to the end of `demo_api_ui/src/__tests__/App.structure.test.js`:

```js
const path = require("path");
const fs = require("fs");

// ─── CustomerRoutes — highest priority (guards original regression) ───────────

describe("CustomerRoutes.js — critical imports and placements", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/CustomerRoutes.js"),
    "utf8"
  );

  test("imports WebMcpPanel", () => {
    expect(src).toContain('import WebMcpPanel from "../components/WebMcpPanel"');
  });

  test("imports AuthorizeRulesPanel", () => {
    expect(src).toContain('import AuthorizeRulesPanel from "../components/AuthorizeRulesPanel"');
  });

  test("renders AuthorizeRulesPanel after WebMcpPanel on /dashboard", () => {
    const webIdx = src.indexOf("<WebMcpPanel />");
    const authIdx = src.indexOf("<AuthorizeRulesPanel />", webIdx);
    expect(webIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(webIdx);
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── AdminRoutes ──────────────────────────────────────────────────────────────

describe("AdminRoutes.js — critical imports", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/AdminRoutes.js"),
    "utf8"
  );

  test("imports AdminRoute", () => {
    expect(src).toContain('import AdminRoute from "./AdminRoute"');
  });

  test("imports Dashboard", () => {
    expect(src).toContain('import Dashboard from "../components/Dashboard"');
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── MonitoringRoutes ─────────────────────────────────────────────────────────

describe("MonitoringRoutes.js — critical imports", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/MonitoringRoutes.js"),
    "utf8"
  );

  test("imports TokenChainDisplay", () => {
    expect(src).toContain('import TokenChainDisplay from "../components/TokenChainDisplay"');
  });

  test("imports ApiExplorerPanel", () => {
    expect(src).toContain('import ApiExplorerPanel from "../components/ApiExplorerPanel"');
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── EducationRoutes ──────────────────────────────────────────────────────────

describe("EducationRoutes.js — critical imports", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/EducationRoutes.js"),
    "utf8"
  );

  test("imports ArchitectureTabsPanel", () => {
    expect(src).toContain('import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel"');
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});
```

- [ ] **Step 2: Run the full structure test suite**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -10
```
Expected: all tests pass (13 original + new route-file tests)

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/__tests__/App.structure.test.js
git commit -m "test(app): add per-route-file structure assertions to App.structure.test.js"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: `The build folder is ready to be deployed.`

- [ ] **Step 2: Full test suite**

```bash
cd demo_api_ui && npm test -- --watchAll=false --no-coverage 2>&1 | tail -15
```
Expected: all existing suites pass, no new failures.

- [ ] **Step 3: Verify App.js line count**

```bash
wc -l demo_api_ui/src/App.js
```
Expected: under 400 lines (target ~250).

- [ ] **Step 4: Verify no remaining banking_api_ui references**

```bash
grep -r "banking_api_ui" demo_api_ui/src/ --include="*.js" --include="*.jsx"
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(app): App.js split complete — routes + hooks extracted"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ AdminRoute extracted (Task 1)
- ✅ All 4 custom hooks extracted (Task 2)
- ✅ AppShell created (Task 3)
- ✅ PublicRoutes extracted (Task 4)
- ✅ MonitoringRoutes extracted (Task 5)
- ✅ EducationRoutes extracted (Task 6)
- ✅ AdminRoutes extracted (Task 7)
- ✅ CustomerRoutes extracted — with WebMcpPanel + AuthorizeRulesPanel guarded (Task 8)
- ✅ App.structure.test.js extended with per-route-file assertions (Task 9)
- ✅ Build + test suite verification (Task 10)

**Known implementation complexity to watch for:**
- Task 2 (`useAuth`): the `_didLogOut` module-level variable must be declared in `useAuth.js`, not remain in App.js — otherwise two references to it exist
- Task 5 (`MonitoringRoutes`): `AgentFlowPage` is defined inline in App.js — pass it as a prop to MonitoringRoutes or move its definition to a shared utils location before Task 5
- Task 8 (`CustomerRoutes`): the top-level `/dashboard` route in App.js still imports `WebMcpPanel` and `AuthorizeRulesPanel` directly — this is intentional so App.structure.test.js continues to assert those imports in App.js itself
- Route path matching: `CustomerRoutes` and `AdminRoutes` render `<Route>` fragments inside the wildcard catch-all `<Routes>` — React Router v6 allows this pattern when the fragments are direct children of `<Routes>`
