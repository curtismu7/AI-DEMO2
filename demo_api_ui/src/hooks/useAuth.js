import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedJson } from "../services/cachedStatusService";
import { savePublicConfig } from "../services/configService";
import { SESSION_REAUTH_EVENT } from "../utils/authUi";
import { clearStatusCache } from "../services/cachedStatusService";
import { nrLog } from "../utils/nrLog";
import bffAxios from '../services/bffAxios';
import { notifyError } from '../utils/appToast';
import { clearIdJagRunState, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY, RUN_MODES } from '../utils/idJagRunMode';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { isNativeIdJagTrace } from '../services/tokenChainTrace/buildTraceSteps';

// Module-level flag mirrors the _didLogOut pattern — survives React
// re-renders, reset only on explicit logout.
let _didLogOut = false;

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionReauth, setSessionReauth] = useState(null);
  const sessionEstablishedRef = useRef(null);
  const hadUserRef = useRef(false);
  const completedIdJagRunRef = useRef(null);

  const checkOAuthSession = useCallback(async () => {
    const applyUser = (u, status = {}) => {
      setUser(u);
      if (!sessionEstablishedRef.current) {
        sessionEstablishedRef.current = true;
        const run = status.oauthProvider === 'pingfederate' ? status.idJagRunIntent : null;
        const validated = run?.useCaseId === ID_JAG_USE_CASE_ID && run.mode === RUN_MODES.LIVE_ID_JAG
          && typeof run.message === 'string' && !!run.message.trim();
        if (!validated) clearIdJagRunState();
        const detail = validated ? {
          idJagCallbackValidated: true, useCaseId: ID_JAG_USE_CASE_ID,
          mode: RUN_MODES.LIVE_ID_JAG, message: run.message,
        } : undefined;
        if (detail) {
          try { sessionStorage.setItem(ID_JAG_VALIDATED_CALLBACK_KEY, JSON.stringify(detail)); }
          catch { /* event still works without storage */ }
        }
        window.dispatchEvent(new CustomEvent("userAuthenticated", { detail }));
        nrLog('ui.login', { username: u?.username || u?.email || 'unknown' });
      }
      setLoading(false);
    };

    try {
      const adminResponse = await getCachedJson("/api/auth/oauth/status");
      if (adminResponse.data.authenticated) {
        applyUser(adminResponse.data.user, adminResponse.data);
        return true;
      }

      const userResponse = await getCachedJson("/api/auth/oauth/user/status");
      if (userResponse.data.authenticated) {
        applyUser(userResponse.data.user, userResponse.data);
        return true;
      }

      const sessionResponse = await getCachedJson("/api/auth/session");
      if (sessionResponse.data.authenticated) {
        applyUser(sessionResponse.data.user, sessionResponse.data);
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
        if (provider !== 'pingfederate') {
          const error = new Error('select PingFederate with the top-bar P1/PF switch and retry');
          error.code = 'id_jag_provider_required';
          throw error;
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
        window.location.href = body.logoutUrl;
      } catch (error) {
        if (intentPosted) await bffAxios.post('/api/auth/oauth/user/id-jag/cancel').catch(() => {});
        clearIdJagRunState();
        if (error.code === 'id_jag_provider_required') {
          window.dispatchEvent(new Event('id-jag-provider-required'));
        }
        notifyError(`Could not start PingFederate ID-JAG login: ${error.message}`);
      }
    };
    window.addEventListener('id-jag-run-requested', onLiveRun);
    return () => window.removeEventListener('id-jag-run-requested', onLiveRun);
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
      if (d.invalidateSession) {
        sessionEstablishedRef.current = false;
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
    window.location.href = "/api/auth/logout";
  }, []);

  return { user, loading, logout, sessionReauth, setSessionReauth };
}
