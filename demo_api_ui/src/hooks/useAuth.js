import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedJson } from "../services/cachedStatusService";
import { savePublicConfig } from "../services/configService";
import { SESSION_REAUTH_EVENT } from "../utils/authUi";
import { clearStatusCache } from "../services/cachedStatusService";
import { nrLog } from "../utils/nrLog";
import bffAxios from '../services/bffAxios';
import { notifyError } from '../utils/appToast';
import { navigateWithOverlay } from '../utils/navigateWithOverlay';
import { clearIdJagRunState, completeIdJagRunHandoff, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY, RUN_MODES } from '../utils/idJagRunMode';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { isNativeIdJagTrace } from '../services/tokenChainTrace/buildTraceSteps';

// Module-level flag mirrors the _didLogOut pattern — survives React
// re-renders, reset only on explicit logout.
let _didLogOut = false;
const PINGONE_SILENT_REAUTH_KEY = 'p1-silent-reauth-attempted';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionReauth, setSessionReauth] = useState(null);
  const sessionEstablishedRef = useRef(null);
  const idJagResolvedRef = useRef(false);
  const hadUserRef = useRef(false);
  const completedIdJagRunRef = useRef(null);

  const checkOAuthSession = useCallback(async ({ allowSilentReauth = false, silentReauthFailed = false, returnPath = '/dashboard' } = {}) => {
    const applyUser = (u, status = {}) => {
      setUser(u);
      try { sessionStorage.removeItem(PINGONE_SILENT_REAUTH_KEY); } catch { /* storage can be disabled */ }
      const wasIdJagResolved = idJagResolvedRef.current;
      const run = status.oauthProvider === 'pingfederate' ? status.idJagRunIntent : null;
      const validated = run?.useCaseId === ID_JAG_USE_CASE_ID && run.mode === RUN_MODES.LIVE_ID_JAG
        && typeof run.message === 'string' && !!run.message.trim();
      let detail;
      // Generic status confirms an identity but cannot carry the server's
      // PF ID-JAG intent. Defer clearing local handoff state until an OAuth
      // status (or a known local login) resolves that question.
      if (!idJagResolvedRef.current && (validated || status.oauthProvider || status.authType === 'local_session')) {
        idJagResolvedRef.current = true;
        if (!validated) clearIdJagRunState();
        else {
          detail = {
            idJagCallbackValidated: true, useCaseId: ID_JAG_USE_CASE_ID,
            mode: RUN_MODES.LIVE_ID_JAG, message: run.message,
          };
          try { sessionStorage.setItem(ID_JAG_VALIDATED_CALLBACK_KEY, JSON.stringify(detail)); }
          catch { /* event still works without storage */ }
        }
      }
      // Other auth listeners clear pending ID-JAG state on an ordinary login.
      // Generic status has no provider intent, so mark that first event as
      // provisional until a provider-specific status confirms the boundary.
      if (!idJagResolvedRef.current) detail = { authSessionProvisional: true };
      if (!sessionEstablishedRef.current) {
        sessionEstablishedRef.current = true;
        window.dispatchEvent(new CustomEvent("userAuthenticated", { detail }));
        nrLog('ui.login', { username: u?.username || u?.email || 'unknown' });
      } else if (!wasIdJagResolved && idJagResolvedRef.current) {
        window.dispatchEvent(new CustomEvent("userAuthenticated", { detail }));
      }
      setLoading(false);
    };

    try {
      const checkStatus = async (url) => {
        try {
          return (await getCachedJson(url))?.data || null;
        } catch (error) {
          console.warn(`Session status unavailable at ${url}:`, error.message);
          return null;
        }
      };
      const adminStatus = checkStatus('/api/auth/oauth/status');
      const customerStatus = checkStatus('/api/auth/oauth/user/status');
      const genericStatus = checkStatus('/api/auth/session');
      const oauthResolution = new Promise((resolve) => {
        let pending = 2;
        for (const probe of [adminStatus, customerStatus]) {
          probe.then((status) => {
            if (status?.authenticated) resolve(status);
            pending -= 1;
            if (pending === 0) resolve(null);
          });
        }
      });
      const firstAuthenticated = await Promise.race([
        oauthResolution,
        genericStatus.then((status) => status?.authenticated && status.authType === 'local_session'
          ? status : oauthResolution),
      ]);
      if (firstAuthenticated) {
        applyUser(firstAuthenticated.user, firstAuthenticated);
        return true;
      }

      const customer = await customerStatus;
      const recoverablePingOneSession = customer?.staleSession
        && customer.sessionType === 'user' && customer.loginProvider === 'pingone_sso';
      const generic = await genericStatus;
      // Concurrent status requests can overlap a BFF token refresh: the user
      // probe may read the old expiry while another probe refreshes it. A live
      // generic OAuth session is a reason to retry the user probe once.
      if (recoverablePingOneSession && generic?.authenticated && generic.authType !== 'local_session') {
        clearStatusCache();
        const refreshedCustomer = await checkStatus('/api/auth/oauth/user/status');
        if (refreshedCustomer?.authenticated) {
          applyUser(refreshedCustomer.user, refreshedCustomer);
          return true;
        }
      }
      // A generic user record cannot restore a missing OAuth credential.
      // Older BFFs may still report that stale OAuth record as authenticated.
      if (generic?.authenticated && (!recoverablePingOneSession || generic.authType === 'local_session')) {
        applyUser(generic.user, generic);
        return true;
      }

      if (allowSilentReauth && recoverablePingOneSession && !silentReauthFailed) {
        let firstAttempt = false;
        try {
          if (sessionStorage.getItem(PINGONE_SILENT_REAUTH_KEY) !== '1') {
            sessionStorage.setItem(PINGONE_SILENT_REAUTH_KEY, '1');
            firstAttempt = true;
          }
        } catch { /* no durable loop guard, so leave manual sign-in available */ }
        if (firstAttempt) {
          navigateWithOverlay(`/api/auth/oauth/user/silent-reauth?return_to=${encodeURIComponent(returnPath)}`, {
            message: 'Refreshing your session...',
          });
          return true;
        }
      }

      setLoading(false);
      return false;
    } catch (error) {
      console.error("Error checking OAuth sessions:", error.message);
      setLoading(false);
      return false;
    }
  }, []);

  // Public config → IndexedDB (skip when in logout handoff). After the IDB
  // write succeeds, dispatch a `publicConfigUpdated` window event so
  // useAppFlags can re-read — closes the race where useAppFlags' initial
  // IDB read beats this HTTP+IDB write on a cold visit and stays stuck on
  // hard-coded defaults until reload.
  useEffect(() => {
    if (localStorage.getItem("userLoggedOut") === "true") return;
    axios
      .get("/api/admin/config")
      .then(({ data }) => savePublicConfig(data.config))
      .then(() => {
        window.dispatchEvent(new CustomEvent("publicConfigUpdated"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onLiveRun = async (event) => {
      const intent = event.detail;
      if (intent?.useCaseId !== ID_JAG_USE_CASE_ID || intent.mode !== RUN_MODES.LIVE_ID_JAG) return;
      let intentPosted = false;
      try {
        const provider = (await bffAxios.get('/api/admin/config')).data?.config?.oauth_provider;
        const status = (await bffAxios.get('/api/auth/oauth/user/status').catch(() => null))?.data;
        const hasPfSession = status?.authenticated === true && status.oauthProvider === 'pingfederate';
        if (provider !== 'pingfederate') {
          // The shared provider is global; the session's provider is what the user is
          // actually signed in with. When they disagree say so rather than "PingOne is selected".
          const error = new Error(hasPfSession
            ? 'you are signed in with PingFederate but the shared login provider is PingOne; an admin must select PF with the top-bar P1/PF switch, then retry'
            : 'select PingFederate with the top-bar P1/PF switch and retry');
          error.code = hasPfSession ? 'id_jag_provider_mismatch' : 'id_jag_provider_required';
          throw error;
        }
        // An existing PingFederate session is reused: no intent, logout or second
        // sign-in. The BFF run gate accepts it (assertPfIdJagRunAllowed).
        if (hasPfSession) {
          completeIdJagRunHandoff({ restoreProvider: false });
          window.dispatchEvent(new CustomEvent('banking-agent-prefill', { detail: {
            message: intent.message, autoSend: true, useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG,
          } }));
          return;
        }
        await bffAxios.post('/api/auth/oauth/user/id-jag/intent', intent);
        intentPosted = true;
        const response = await fetch('/api/auth/logout?id_jag_handoff=1', {
          credentials: 'include', headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Logout failed');
        const body = await response.json();
        if (!body.idJagHandoff || !body.logoutUrl) throw new Error('ID-JAG logout handoff was not accepted');
        window.dispatchEvent(new CustomEvent('userLoggedOut', { detail: { idJagHandoff: true } }));
        navigateWithOverlay(body.logoutUrl, { message: 'Signing out...' });
      } catch (error) {
        if (intentPosted) await bffAxios.post('/api/auth/oauth/user/id-jag/cancel').catch(() => {});
        clearIdJagRunState();
        if (error.code === 'id_jag_provider_required' || error.code === 'id_jag_provider_mismatch') {
          window.dispatchEvent(new CustomEvent('id-jag-provider-required', { detail: { returnTo: intent.returnTo, code: error.code } }));
        }
        notifyError(`Could not start PingFederate ID-JAG login: ${error.message}`);
      }
    };
    window.addEventListener('id-jag-run-requested', onLiveRun);
    return () => window.removeEventListener('id-jag-run-requested', onLiveRun);
  }, []);

  // A launch click that hits the pending-launch guard must never be a silent
  // no-op (that read as "the button is broken" during a demo). An orphaned
  // fresh intent (the flow died mid-handoff, e.g. stuck on PF's SLO page) is
  // cancelled server-side AND locally so the NEXT click just works — the user
  // never has to open a new tab or wait out the TTL.
  const idJagCancelInFlight = useRef(false);
  useEffect(() => {
    const onBlocked = async (event) => {
      const reason = event.detail?.reason;
      if (reason === 'launch_in_progress') {
        notifyError('A PingFederate ID-JAG login is already in progress — finish or cancel it first.');
        return;
      }
      if (reason === 'provider_restore_in_progress') {
        notifyError('The previous PingFederate ID-JAG run is still restoring the login provider. Try again in a moment.');
        return;
      }
      // intent_pending: the stored intent cannot be redeemed (its handoff
      // chain died before the login claimed it). Cancel it server-side and
      // locally, then tell the user to click again.
      if (idJagCancelInFlight.current) return;
      idJagCancelInFlight.current = true;
      try {
        await bffAxios.post('/api/auth/oauth/user/id-jag/cancel');
      } catch { /* the 5-minute TTL also clears server state */ }
      clearIdJagRunState();
      idJagCancelInFlight.current = false;
      notifyError('A previous PingFederate ID-JAG launch was still pending — it has been cancelled. Click Run again.');
    };
    window.addEventListener('id-jag-launch-blocked', onBlocked);
    return () => window.removeEventListener('id-jag-launch-blocked', onBlocked);
  }, []);

  useEffect(() => tokenChainTraceStore.subscribe(({ trace }) => {
    if (!isNativeIdJagTrace(trace) || !trace.outcome || trace.runId == null
      || completedIdJagRunRef.current === trace.runId) return;
    completedIdJagRunRef.current = trace.runId;
    void bffAxios.post('/api/auth/oauth/user/id-jag/complete')
      .catch((error) => notifyError(`Could not clear the ID-JAG run: ${error.message}`))
      .finally(() => clearIdJagRunState());
  }), []);

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
      if (isPostLogoutLanding) {
        // LogoutPage owns the clear-session/pending-intent decision after IdP signoff.
        setUser(null);
        setLoading(false);
        return undefined;
      }
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

    const params = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search || "")
      : null;
    if (params?.has('error') && pathname === '/pingfederate-id-jag/demo') clearIdJagRunState();
    // Privilege MCP uses `auth=success` because it owns a separate gateway
    // OAuth handshake. Treat that callback exactly like the main app's
    // `oauth=success` so the global banner refreshes immediately too.
    const oauthSuccess = params?.get("oauth") === "success" || params?.get("auth") === "success";

    // NOTE: do NOT clear bx-dashboard-reauth on oauth=success.
    // The REAUTH_KEY guard is intentional: redirect once automatically,
    // then show the banner if still failing. Clearing the key here
    // re-enables the redirect on the very next 401, creating an infinite loop.
    // The key is cleared correctly in UserDashboard's fetchUserData try-block
    // when data actually loads successfully.

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
      const ok = await checkOAuthSession({
        allowSilentReauth: true,
        silentReauthFailed: params?.has('silent_reauth_failed') || false,
        returnPath: pathname || '/dashboard',
      });
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
      if (d.invalidateSession) {
        sessionEstablishedRef.current = false;
        idJagResolvedRef.current = false;
        clearStatusCache();
        setUser(null);
      }
      const role = d.role === "admin" ? "admin" : "customer";
      const isHITL = d.isHITL === true;
      // `detail` is raw provider text (e.g. "jwt expired") — SignInModal shows
      // it behind a disclosure, never as the leading sentence.
      const detail =
        typeof d.detail === "string" && d.detail.trim() ? d.detail.trim() : undefined;
      setSessionReauth({ message: d.message.trim(), detail, role, isHITL });
    };
    window.addEventListener(SESSION_REAUTH_EVENT, onSessionReauth);
    return () =>
      window.removeEventListener(SESSION_REAUTH_EVENT, onSessionReauth);
  }, []);

  // Dismiss reauth banner only after a fresh login (null → user), not while stale user is set
  useEffect(() => {
    if (user && !hadUserRef.current) setSessionReauth(null);
    hadUserRef.current = !!user;
  }, [user]);

  const logout = useCallback(() => {
    console.info("Starting logout — navigating to /api/auth/logout");
    clearIdJagRunState();

    // Store current path before clearing storage so LogoutPage can redirect there
    try {
      const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
      if (pathname.startsWith("/admin") || pathname.startsWith("/dashboard")) {
        sessionStorage.setItem("logoutReturnTo", pathname);
      }
    } catch (e) {
      // ignore storage errors
    }

    localStorage.setItem("userLoggedOut", "true");
    // NOTE: These removals are legacy cleanup. The BFF pattern means tokens
    // should never be stored client-side. We remove them defensively in case
    // any legacy code path wrote them.
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("authToken");
    localStorage.removeItem("refreshToken");
    // Don't clear sessionStorage yet — we need logoutReturnTo to survive until LogoutPage reads it
    try {
      Object.keys(sessionStorage).forEach(key => {
        if (key !== "logoutReturnTo") {
          sessionStorage.removeItem(key);
        }
      });
    } catch (e) {
      // ignore storage errors
    }
    window.dispatchEvent(new CustomEvent("userLoggedOut"));
    localStorage.removeItem("tokenChainHistory");
    navigateWithOverlay("/api/auth/logout", { message: "Signing out..." });
  }, []);

  return { user, loading, logout, sessionReauth, setSessionReauth };
}
