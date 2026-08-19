import axios from "axios";
import { format } from "date-fns";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useCurrentUserTokenEvent } from "../hooks/useCurrentUserTokenEvent";
import apiClient from "../services/apiClient";
import { getCachedJson } from "../services/cachedStatusService";
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
  toast,
} from "../utils/appToast";
import { navigateToCustomerOAuthLogin, SESSION_REAUTH_EVENT } from "../utils/authUi";
import { normalizePhoneE164 } from "../utils/mfaEnrollment";
import {
  getDashboardLayout,
  setDashboardLayout,
  splitGridClass,
} from "../utils/dashboardLayout";
import { toastCustomerError } from "../utils/dashboardToast";
import {
  AGENT_COL_MAX_WIDTH,
  AGENT_COL_MIN_WIDTH,
  persistAgentColWidth,
  readStoredAgentColWidth,
} from "../utils/agentColumnLayout";
import { extractRfc9470Challenge } from "../utils/wwwAuthenticate";
import DashboardTokenRail from "./DashboardTokenRail";
import TokenChainFilmstrip from "./TokenChainFilmstrip";
import SimpleStepperBar from "./SimpleStepperBar";
import AgentResponseMirror from "./AgentResponseMirror";
import ExchangeModeToggle from "./ExchangeModeToggle";
import Fido2Challenge from "./Fido2Challenge";
import TokenChainTraceRail from "./TokenChainTraceRail";
import { useSessionToken } from '../context/SessionTokenContext';
import ConfirmModal from "./ConfirmModal";
import TransactionConsentModal from "./TransactionConsentModal";
import EmbeddedAgentDock from "./EmbeddedAgentDock";
import WebMcpPanel from "./WebMcpPanel";
import FloatingPanel from "./FloatingPanel";
import "./UserDashboard.css";
import "./customerSkinPing2026.css";
import OAuthTokenDisplayPage from "./OAuthTokenDisplayPage";
import { useVertical } from "../vertical/useVertical";
import RetailDashboard from "./RetailDashboard";
import AgentClinicalHost from "./agent-clinical/AgentClinicalHost";
import AgentIdentityCard from "./AgentIdentityCard";

/** Format a number as USD currency — $1,234.56 */
const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "$0.00";

/** Account types whose balances represent money owed (liabilities), not assets. */
const DEBT_TYPES = new Set(["loan", "car_loan", "mortgage", "credit"]);
/** Only these account types count toward the "Total Accounts" balance. */
const ASSET_TYPES = new Set(["checking", "savings"]);

const DEMO_ACCOUNTS = [
  {
    id: "demo-chk",
    name: "Checking Account",
    accountType: "checking",
    accountNumber: "CHK-DEMO-0001",
    balance: 3000.0,
    _demo: true,
  },
  {
    id: "demo-sav",
    name: "Savings Account",
    accountType: "savings",
    accountNumber: "SAV-DEMO-0001",
    balance: 2000.0,
    _demo: true,
  },
];
const DEMO_TRANSACTIONS = [
  {
    id: "d1",
    type: "deposit",
    amount: 2500.0,
    description: "Payroll deposit",
    accountInfo: "Checking - CHK-DEMO-0001",
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    clientType: "enduser",
    performedBy: "Demo User",
    _demo: true,
  },
  {
    id: "d2",
    type: "withdrawal",
    amount: 150.0,
    description: "ATM withdrawal",
    accountInfo: "Checking - CHK-DEMO-0001",
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    clientType: "enduser",
    performedBy: "Demo User",
    _demo: true,
  },
  {
    id: "d3",
    type: "transfer",
    amount: 500.0,
    description: "Transfer to savings",
    accountInfo: "Savings - SAV-DEMO-0001",
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    clientType: "ai_agent",
    performedBy: "Demo User",
    _demo: true,
  },
  {
    id: "d4",
    type: "deposit",
    amount: 75.0,
    description: "Refund — online purchase",
    accountInfo: "Checking - CHK-DEMO-0001",
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    clientType: "enduser",
    performedBy: "Demo User",
    _demo: true,
  },
];

const MIDDLE_HEIGHT_KEY = "middle_agent_height_px";
const MIDDLE_DEFAULT_HEIGHT = 720;
const MIDDLE_MIN_HEIGHT = 420;

function readStoredMiddleHeight() {
  try {
    const n = parseInt(localStorage.getItem(MIDDLE_HEIGHT_KEY) || "", 10);
    if (Number.isFinite(n) && n >= MIDDLE_MIN_HEIGHT) {
      return Math.min(n, Math.round(window.innerHeight * 0.9));
    }
  } catch {
    /* ignore */
  }
  return MIDDLE_DEFAULT_HEIGHT;
}

const UserDashboardPing2026 = ({ user: propUser, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { placement: agentPlacement, setSurfaceHostEl, setToolbarHostEl } = useAgentUiMode();
  const [toolbarHostEl, setToolbarHostElNode] = useState(null);
  const toolbarHostRef = useCallback((node) => setToolbarHostElNode(node), []);
  const { pageManifest, pageMockData } = useVertical();
  const themeDashboard = pageManifest?.dashboard;
  const isRetailDashboard = themeDashboard && themeDashboard.kind === "retail";
  useCurrentUserTokenEvent(); // Seed the token chain with current user's session token on mount
  /** Middle layout: auto-opens when placement is 'middle'; collapses via FAB click. */
  const [middleAgentOpen, setMiddleAgentOpen] = useState(
    () => agentPlacement === "middle",
  );

  // Default ON — only an explicit More › Movie reel toggle-off ("0") hides it.
  const [showFilmstrip, setShowFilmstrip] = useState(() => {
    try { return localStorage.getItem("ba_show_filmstrip") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    const handler = (e) => setShowFilmstrip(!!e.detail?.on);
    window.addEventListener("agent-filmstrip-toggle", handler);
    return () => window.removeEventListener("agent-filmstrip-toggle", handler);
  }, []);

  // ff_show_agent_in_middle — when false (default) the banking column
  // is hidden in the middle-agent layout (banking info comes from the agent /
  // pop-out). Floating mode is unaffected. Mirrors the cookie-
  // credentialed read BankingAgent.js uses for ff_heuristic_enabled.
  const [showBankingInMiddle, setShowBankingInMiddle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCachedJson("/api/admin/feature-flags")
      .then(({ data }) => {
        if (cancelled) return;
        const flag = data?.flags?.find(
          (f) => f.id === "ff_show_agent_in_middle",
        );
        if (flag != null) setShowBankingInMiddle(Boolean(flag.value));
      })
      .catch(() => {
        /* fail to the clean default (column hidden) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [middleHeight, setMiddleHeight] = useState(() =>
    typeof window !== "undefined"
      ? readStoredMiddleHeight()
      : MIDDLE_DEFAULT_HEIGHT,
  );
  const [agentColWidth, setAgentColWidth] = useState(() =>
    typeof window !== "undefined"
      ? readStoredAgentColWidth()
      : AGENT_COL_MIN_WIDTH,
  );
  const [dashboardLayout, setDashboardLayoutState] = useState(() =>
    getDashboardLayout(),
  );

  /**
   * ff_agent_clinical_split — when on, the dashboard renders the 2B-refined
   * clinical-split layout instead of the legacy split3 / token-display chrome.
   * Default off; flipped on via /api/admin/feature-flags or
   * `?ff_agent_clinical_split=on` (URL override for ad-hoc testing).
   */
  const [clinicalSplitEnabled, setClinicalSplitEnabled] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const v = sp.get('ff_agent_clinical_split');
      return v === 'on' || v === 'true' || v === '1';
    } catch (_) {
      return false;
    }
  });
  useEffect(() => {
    let cancelled = false;
    getCachedJson('/api/admin/feature-flags')
      .then(({ data }) => {
        if (cancelled) return;
        const f = data?.flags?.find((x) => x.id === 'ff_agent_clinical_split');
        if (f != null) setClinicalSplitEnabled((cur) => cur || Boolean(f.value));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [user, setUser] = useState(propUser);
  const [accounts, setAccounts] = useState([]);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Reset Demo button lives in TopNav (see TopNav.js). It dispatches this
  // event so the confirmation modal can stay co-located with `onLogout`.
  useEffect(() => {
    const open = () => setShowResetModal(true);
    window.addEventListener('dashboard:open-reset-modal', open);
    return () => window.removeEventListener('dashboard:open-reset-modal', open);
  }, []);
  const { registerTokenModalOpener } = useSessionToken();

  // SessionTokenProvider owns the pill countdown; this dashboard only owns the
  // token-detail modal, so register an opener for the pill's "View Token" button.
  useEffect(
    () => registerTokenModalOpener(() => setShowTokenModal(true)),
    [registerTokenModalOpener],
  );
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [transferForm, setTransferForm] = useState({
    toAccountId: "",
    amount: "",
    description: "",
  });
  const [depositForm, setDepositForm] = useState({
    amount: "",
    description: "",
  });
  const [depositAccount, setDepositAccount] = useState(null);
  const [withdrawForm, setWithdrawForm] = useState({
    amount: "",
    description: "",
  });
  const [withdrawAccount, setWithdrawAccount] = useState(null);
  /** Server-issued id for high-value HITL — opens TransactionConsentModal on the dashboard. */
  const [consentChallengeId, setConsentChallengeId] = useState(null);
  /** Track which account cards have expanded profile details */
  const [expandedAccounts, setExpandedAccounts] = useState(new Set());
  /** True when the HITL was triggered via AgentConsentModal — skip consent step, go straight to OTP. */
  const [agentHitlAutoConfirm, setAgentHitlAutoConfirm] = useState(false);
  const [stepUpRequired, setStepUpRequired] = useState(false);
  // 'ciba' | 'email' — set from the 428 response step_up_method field
  const [stepUpMethod, setStepUpMethod] = useState("email");
  // Raw RFC 9470 WWW-Authenticate value (set when the challenge arrived as
  // 401 + header rather than legacy 428 + body) — shown on the step-up toast.
  const [stepUpChallengeRaw, setStepUpChallengeRaw] = useState("");
  // CIBA step-up state
  const [cibaAuthReqId, setCibaAuthReqId] = useState(null);
  const [cibaStatus, setCibaStatus] = useState("idle"); // 'idle' | 'pending' | 'completed' | 'error'
  // ACR captured from the 428 step_up_acr — forwarded to CIBA so PingOne triggers the right step-up policy
  const [cibaAcr, setCibaAcr] = useState("");
  const [agentTriggeredStepUp, setAgentTriggeredStepUp] = useState(false);
  const [agentCountdown, setAgentCountdown] = useState(0);
  // Email OTP step-up modal state
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpDaId, setOtpDaId] = useState(null);
  const [otpDeviceId, setOtpDeviceId] = useState(null);
  // TOTP step-up modal state
  const [totpModalOpen, setTotpModalOpen] = useState(false);
  const [totpDaId, setTotpDaId] = useState(null);
  const [totpDeviceId, setTotpDeviceId] = useState(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState(null);
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  // Push notification step-up state
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushDaId, setPushDaId] = useState(null);
  const [pushPolling, setPushPolling] = useState(false);
  // Device picker state (shown when multiple MFA devices enrolled)
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [devicePickerDevices, setDevicePickerDevices] = useState([]);
  const [devicePickerDaId, setDevicePickerDaId] = useState(null);
  // FIDO2 passkey step-up state
  const [fido2ModalOpen, setFido2ModalOpen] = useState(false);
  const [fido2DaId, setFido2DaId] = useState(null);
  const [fido2DeviceId, setFido2DeviceId] = useState(null);
  // MFA error states
  const [mfaChallengeExpired, setMfaChallengeExpired] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState("");
  // SMS enrollment sub-flow inside the enroll modal: 'choose' | 'phone' | 'otp'
  const [smsEnrollStep, setSmsEnrollStep] = useState("choose");
  const [smsEnrollPhone, setSmsEnrollPhone] = useState("");
  const [smsEnrollOtp, setSmsEnrollOtp] = useState("");
  const [smsEnrollDeviceId, setSmsEnrollDeviceId] = useState(null);
  const autoInitiateTimerRef = useRef(null); // [t1, t2, t3] setTimeout IDs
  const handleCibaStepUpRef = useRef(null); // stays current — avoids stale closure
  const handleInitiateOtpRef = useRef(null); // stays current — avoids stale closure
  const stepUpVerifyHrefRef = useRef(null); // stays current — avoids stale closure
  const fetchingRef = React.useRef(false);
  const inFlightRef = React.useRef(null);
  const agentPlacementInitRef = React.useRef(true);

  const loadDemoFallback = useCallback(
    (reason) => {
      // Guard: do not overwrite real account data if the user is already authenticated.
      // This prevents a race condition where a momentary session blip on layout-switch
      // reload causes DEMO_ACCOUNTS to replace real accounts (todo #11).
      if (!user) {
        setAccounts(DEMO_ACCOUNTS);
        setTransactions(DEMO_TRANSACTIONS);
      }
    },
    [user, setAccounts, setTransactions],
  );

  const fetchUserData = useCallback(
    async (silent = false) => {
      if (fetchingRef.current) {
        // Silent callers don't touch `loading` either way (see both `!silent`
        // guards below), so no-op is fine for them. A non-silent caller does
        // care, though — if it silently no-ops here because a silent fetch
        // (e.g. the agentPlacement-change effect) won the race for
        // fetchingRef first, nothing would ever clear the spinner it owns.
        // Wait for the in-flight fetch to settle instead of leaving
        // `loading` stuck true forever.
        if (!silent) {
          await inFlightRef.current?.catch(() => {});
          setLoading(false);
        }
        return;
      }
      fetchingRef.current = true;
      const runPromise = (async () => {
      try {
        if (!silent) setLoading(true);

        // ── 1. Resolve session ────────────────────────────────────────────────
        let sessionUser = null;
        try {
          const userRes = await getCachedJson("/api/auth/oauth/user/status");
          if (userRes.data.authenticated) {
            sessionUser = userRes.data.user;
          } else {
            const adminRes = await getCachedJson("/api/auth/oauth/status");
            if (adminRes.data.authenticated) {
              sessionUser = adminRes.data.user;
            }
          }
        } catch (sessionErr) {
          console.warn("Session check failed:", sessionErr.message);
        }

        if (!sessionUser) {
          // Not logged in — show demo data, no error banner
          if (!silent) loadDemoFallback("no active session");
          return;
        }

        setUser(sessionUser);

        // ── 2. Fetch real account + transaction data ──────────────────────────
        const REAUTH_KEY = "bx-dashboard-reauth";
        try {
          const [acctRes, txRes] = await Promise.all([
            apiClient.get("/api/accounts/my"),
            apiClient.get("/api/transactions/my"),
          ]);
          // Successful fetch — clear any pending reauth guard
          sessionStorage.removeItem(REAUTH_KEY);
          setAccounts(acctRes.data.accounts || []);
          setTransactions(txRes.data.transactions || []);
        } catch (dataErr) {
          if (dataErr.response?.status === 401) {
            // Log the server-side reason for easier diagnosis — visible in browser console
            const serverReason =
              dataErr.response?.data?.error_description ||
              dataErr.response?.data?.message ||
              dataErr.response?.data?.error ||
              "(no body)";
            console.warn(
              "Data fetch 401 — server reason:",
              serverReason,
              "| REAUTH_KEY:",
              sessionStorage.getItem(REAUTH_KEY),
            );
            if (!silent) {
              // Only redirect when App.js has confirmed a session (propUser non-null).
              // If we mounted as a guest (propUser=null, lazy-auth), a 401 on accounts
              // means the user hasn't logged in yet — show demo data, don't redirect.
              if (!propUser) {
                loadDemoFallback("guest 401 — not yet authenticated");
                return;
              }
              // Token expired or cold-start stub. Redirect to re-auth.
              // PingOne's SSO session usually makes this seamless (no credentials needed).
              // Guard: only auto-redirect once — if a redirect already happened and we still
              // get 401, clear the guard and fall back to the banner so the user can act.
              if (!sessionStorage.getItem(REAUTH_KEY)) {
                sessionStorage.setItem(REAUTH_KEY, "1");
                navigateToCustomerOAuthLogin();
                return;
              }
              sessionStorage.removeItem(REAUTH_KEY);
              toastCustomerError(
                "Session could not be restored after sign-in. Please try signing in again.",
                navigateToCustomerOAuthLogin,
              );
            }
            // silent refresh 401 — ignore; next explicit load will handle it
          } else if (dataErr.response?.status === 403) {
            // admin_token_forbidden: an admin is viewing the customer dashboard.
            // requireNotAdmin refuses admin tokens on customer data by design, so
            // there is nothing to re-authenticate *for* — show the same demo data a
            // guest sees rather than an error the admin cannot act on. Signing in as
            // a customer stays available from the header.
            if (dataErr.response?.data?.error === "admin_token_forbidden") {
              if (!silent) loadDemoFallback("admin token — customer data not available");
            } else {
              notifyError(
                "You do not have permission to access this information.",
              );
            }
          } else if (!silent) {
            // API unreachable or 5xx — fall back to demo without blocking the user
            loadDemoFallback("could not reach banking API");
          }
        }
      } finally {
        if (!silent) setLoading(false);
        fetchingRef.current = false;
      }
      })();
      inFlightRef.current = runPromise;
      return runPromise;
    },
    [loadDemoFallback],
  );

  /** Holds the agent HITL detail (actionId, form) while the consent modal is open so we can fire the confirmed event. */
  const agentHitlDetailRef = React.useRef(null);

  useEffect(() => {
    const onLayout = () => setDashboardLayoutState(getDashboardLayout());
    window.addEventListener("banking-dashboard-layout", onLayout);
    return () =>
      window.removeEventListener("banking-dashboard-layout", onLayout);
  }, []);

  /** HITL: open the TransactionConsentModal when the floating agent requests consent. */
  useEffect(() => {
    const onAgentHitl = async (e) => {
      const { intentPayload, autoConfirm } = e.detail || {};
      if (!intentPayload) return;
      try {
        const { data } = await apiClient.post(
          "/api/transactions/consent-challenge",
          intentPayload,
        );
        const cid = data?.challengeId;
        if (!cid) {
          notifyError("Could not start consent — no challenge id from server.");
          return;
        }
        setConsentChallengeId({ id: cid, snapshot: data.snapshot || null });
        setAgentHitlAutoConfirm(!!autoConfirm);
        // Store the original agent intent so we can pass it back on confirmation
        agentHitlDetailRef.current = e.detail;
      } catch (ex) {
        const msg =
          ex.response?.data?.message ||
          ex.response?.data?.error ||
          ex.message ||
          "Could not start consent flow.";
        notifyError(msg);
      }
    };
    window.addEventListener("banking-agent-hitl-consent", onAgentHitl);
    return () =>
      window.removeEventListener("banking-agent-hitl-consent", onAgentHitl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refresh balances silently after any agent write action (deposit/withdraw/transfer). */
  useEffect(() => {
    const onAgentResult = ({ detail }) => {
      const { type } = detail;
      // 'confirm' = write (deposit/withdraw/transfer) → full refresh
      // 'accounts' / 'balance' = reads → silent refresh to keep dashboard cards in sync
      if (type === "confirm" || type === "accounts" || type === "balance") {
        fetchUserData(true);
      }
    };
    window.addEventListener("banking-agent-result", onAgentResult);
    return () =>
      window.removeEventListener("banking-agent-result", onAgentResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchUserData identity is stable; adding it would re-register on every render
  }, []);

  /** Keep localStorage layout aligned with Agent UI (Middle → split3). */
  useEffect(() => {
    if (agentPlacement === "middle") {
      setMiddleAgentOpen(true);
      setDashboardLayoutState("split3");
      setDashboardLayout("split3");
    }

    // Refresh account data on layout change to prevent account loss (todo #11).
    // Skip the very first mount — the dedicated mount-only useEffect owns the initial
    // non-silent fetch. Calling fetchUserData(true) here on mount steals fetchingRef
    // before the mount effect runs (effects fire in declaration order), leaving
    // loading=true forever because the non-silent call hits the guard and returns early.
    if (agentPlacementInitRef.current) {
      agentPlacementInitRef.current = false;
    } else if (user) {
      fetchUserData(true);
    }
  }, [agentPlacement, user, fetchUserData]);

  /** Persist middle agent height to localStorage */
  useEffect(() => {
    if (agentPlacement !== "middle") return;
    try {
      localStorage.setItem(MIDDLE_HEIGHT_KEY, String(Math.round(middleHeight)));
    } catch {
      /* ignore */
    }
  }, [middleHeight, agentPlacement]);

  /** Persist middle agent column width */
  useEffect(() => {
    if (agentPlacement !== "middle") return;
    persistAgentColWidth(agentColWidth);
  }, [agentColWidth, agentPlacement]);

  /** Cap middle height when viewport shrinks */
  useEffect(() => {
    if (agentPlacement !== "middle") return;
    const onResize = () => {
      const maxH = Math.round(window.innerHeight * 0.9);
      setMiddleHeight((h) => Math.min(h, maxH));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [agentPlacement]);

  const onMiddleResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = middleHeight;
      const maxH = Math.round(window.innerHeight * 0.9);
      const onMove = (ev) => {
        const delta = ev.clientY - startY;
        setMiddleHeight(
          Math.min(maxH, Math.max(MIDDLE_MIN_HEIGHT, startH + delta)),
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = onUp;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [middleHeight],
  );

  /** Drag right edge of agent column: move right = wider. */
  const onAgentWidthResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = agentColWidth;
      const onMove = (ev) => {
        setAgentColWidth(
          Math.min(
            AGENT_COL_MAX_WIDTH,
            Math.max(AGENT_COL_MIN_WIDTH, startW + (ev.clientX - startX)),
          ),
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = onUp;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [agentColWidth],
  );

  // Unmounting mid-drag (role switch, route change with the button held) must
  // not leak the document listeners or leave body cursor/userSelect overridden
  // — same fix EmbeddedAgentDock carries via its dragCleanupRef.
  const dragCleanupRef = useRef(null);
  useEffect(() => () => {
    if (dragCleanupRef.current) dragCleanupRef.current();
  }, []);

  /** Toggle expanded state for account profile details */
  const toggleAccountProfile = useCallback((accountId) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  // Function to decode JWT token
  // eslint-disable-next-line no-unused-vars
  const decodeToken = (token) => {
    try {
      if (!token) return null;

      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const header = JSON.parse(atob(parts[0]));
      const payload = JSON.parse(atob(parts[1]));

      return {
        header,
        payload,
        raw: token,
      };
    } catch (error) {
      console.error("Error decoding token:", error);
      return null;
    }
  };

  useEffect(() => {
    // Initial data fetch
    fetchUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only load
  }, []);

  // Refresh accounts whenever the Demo config page saves (new/edited accounts, balances).
  // UserDashboard stays mounted while the user navigates to /demo-data and back, so we
  // can't rely on remount — we listen for the event instead.
  useEffect(() => {
    const onDemoSaved = () => fetchUserData(true);
    window.addEventListener("demoScenarioUpdated", onDemoSaved);
    return () => window.removeEventListener("demoScenarioUpdated", onDemoSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Toast when returning from transaction consent route (success or decline). */
  useEffect(() => {
    const st = location.state;
    if (!st || typeof st !== "object") return;
    if (
      typeof st.transactionSuccess === "string" &&
      st.transactionSuccess.trim()
    ) {
      notifySuccess(st.transactionSuccess.trim());
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: {} },
      );
      return;
    }
    if (st.consentDeclined) {
      notifyInfo(
        "You declined high-value consent. The AI banking assistant is paused — dismiss the decline notice to keep using it.",
      );
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: {} },
      );
      return;
    }
    if (st.resetDemo) {
      notifySuccess("Demo reset. All agent history and audit logs cleared.");
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: {} },
      );
    }
  }, [location.state, location.pathname, location.search, navigate]);

  // ── CIBA step-up: initiate back-channel authentication ──
  const handleCibaStepUp = useCallback(async () => {
    if (!user?.email) {
      notifyError("Cannot initiate CIBA: no email on session.");
      return;
    }
    try {
      const { data } = await axios.post("/api/auth/ciba/initiate", {
        login_hint: user.email,
        binding_message: "Approve your banking transaction",
        scope: "openid profile",
        acr_values: cibaAcr,
      });
      setCibaAuthReqId(data.auth_req_id);
      setCibaStatus("pending");
    } catch (err) {
      notifyError(
        "CIBA initiation failed: " +
          (err.response?.data?.message || err.message),
      );
    }
  }, [user?.email, cibaAcr]);

  const stepUpVerifyHref = useMemo(
    () =>
      `/api/auth/oauth/user/stepup?return_to=${encodeURIComponent(
        (process.env.REACT_APP_CLIENT_URL || window.location.origin) +
          "/dashboard",
      )}`,
    [],
  );

  /** Initiate PingOne MFA challenge and route to correct modal by device type. */
  const handleInitiateOtp = useCallback(async () => {
    setMfaChallengeExpired(false);
    try {
      const { data } = await apiClient.post("/api/auth/mfa/challenge");
      const devices = data.devices || [];
      if (!devices.length) {
        setEnrollModalOpen(true);
        return;
      }
      setStepUpRequired(false);
      toast.dismiss("customer-step-up");
      // Route by device type — single device: auto-route; multiple: show picker
      if (devices.length > 1) {
        setDevicePickerDevices(devices);
        setDevicePickerDaId(data.daId);
        setDevicePickerOpen(true);
        return;
      }
      const device = devices[0];
      if (device.type === "EMAIL" || device.type === "SMS") {
        await apiClient.put(`/api/auth/mfa/challenge/${data.daId}`, {
          deviceId: device.id,
        });
        setOtpDaId(data.daId);
        setOtpDeviceId(device.id);
        setOtpEmail(user?.email || device.nickname || "");
        setOtpCode("");
        setOtpError("");
        setOtpModalOpen(true);
      } else if (device.type === "TOTP") {
        await handleTotpChallengeRef.current(data.daId, device);
      } else if (device.type === "MOBILE") {
        await handlePushChallengeRef.current(data.daId, device);
      } else if (device.type === "FIDO2") {
        handleFido2Challenge(data.daId, device);
      } else {
        // Unknown device type: show picker
        setDevicePickerDevices(devices);
        setDevicePickerDaId(data.daId);
        setDevicePickerOpen(true);
      }
    } catch (err) {
      if (
        err.response?.status === 422 &&
        err.response?.data?.error === "no_devices_enrolled"
      ) {
        setEnrollModalOpen(true);
        return;
      }
      if (
        err.response?.status === 401 &&
        err.response?.data?.error === "session_expired"
      ) {
        notifyError("Session expired — please sign in again.");
        setTimeout(() => {
          window.location.replace("/");
        }, 2000);
        return;
      }
      if (
        err.response?.status === 410 ||
        err.response?.data?.error === "challenge_expired"
      ) {
        setMfaChallengeExpired(true);
        return;
      }
      notifyError(
        "Could not initiate MFA: " +
          (err.response?.data?.message || err.message),
      );
    }
  }, [user]);

  /** Select a device from the picker and route to the correct challenge modal. */
  const handleDevicePick = useCallback(
    async (device) => {
      try {
        const daId = devicePickerDaId;
        setDevicePickerOpen(false);
        if (device.type === "EMAIL" || device.type === "SMS") {
          await apiClient.put(`/api/auth/mfa/challenge/${daId}`, {
            deviceId: device.id,
          });
          setOtpDaId(daId);
          setOtpDeviceId(device.id);
          setOtpEmail(user?.email || device.nickname || "");
          setOtpCode("");
          setOtpError("");
          setOtpModalOpen(true);
        } else if (device.type === "TOTP") {
          await handleTotpChallengeRef.current(daId, device);
        } else if (device.type === "MOBILE") {
          await handlePushChallengeRef.current(daId, device);
        } else if (device.type === "FIDO2") {
          handleFido2Challenge(daId, device);
        }
      } catch (err) {
        notifyError(
          "Could not select device: " +
            (err.response?.data?.message || err.message),
        );
      }
    },
    [devicePickerDaId, user],
  );

  /** Select FIDO2 device, set ASSERTION_REQUIRED, then open Fido2Challenge overlay. */
  const handleFido2Challenge = (daId, device) => {
    axios
      .put(`/api/auth/mfa/challenge/${daId}`, { deviceId: device.id })
      .then(() => {
        setFido2DaId(daId);
        setFido2DeviceId(device.id);
        setFido2ModalOpen(true);
        setDevicePickerOpen(false);
      })
      .catch((err) => {
        if (
          err.response?.status === 401 &&
          err.response?.data?.error === "session_expired"
        ) {
          notifyError("Session expired — please sign in again.");
          setTimeout(() => {
            window.location.replace("/");
          }, 2000);
          return;
        }
        if (
          err.response?.status === 410 ||
          err.response?.data?.error === "challenge_expired"
        ) {
          setMfaChallengeExpired(true);
          return;
        }
        notifyError(
          err.response?.data?.message ||
            "Failed to initiate passkey challenge.",
        );
      });
  };

  /** Enroll an email OTP device, then auto-initiate MFA challenge. */
  const handleEnrollEmail = useCallback(async () => {
    setEnrolling(true);
    setEnrollError("");
    try {
      await apiClient.post("/api/auth/mfa/enroll/email");
      setEnrollModalOpen(false);
      setEnrolling(false);
      notifySuccess("Email OTP device enrolled — starting MFA challenge…");
      handleInitiateOtpRef.current && handleInitiateOtpRef.current();
    } catch (err) {
      setEnrollError(
        err.response?.data?.message || "Enrollment failed. Please try again.",
      );
      setEnrolling(false);
    }
  }, []);

  /** Close the enroll modal and reset the SMS sub-flow so it reopens clean. */
  const closeEnrollModal = useCallback(() => {
    setEnrollModalOpen(false);
    setSmsEnrollStep("choose");
    setSmsEnrollOtp("");
    setSmsEnrollDeviceId(null);
    setEnrollError("");
  }, []);

  /** POST /enroll/sms-init — PingOne texts an activation code to the phone. */
  const handleEnrollSmsInit = useCallback(async () => {
    const phone = normalizePhoneE164(smsEnrollPhone);
    if (!phone || phone.length < 10) {
      setEnrollError("Enter a phone number in E.164 format, e.g. +15551234567");
      return;
    }
    setEnrolling(true);
    setEnrollError("");
    try {
      const { data } = await apiClient.post("/api/auth/mfa/enroll/sms-init", {
        phone,
      });
      const status = String(data.status || "").toUpperCase();
      // Worker-token enroll can return ACTIVE immediately — no activation code.
      if (status === "ACTIVE" || status === "ENABLED") {
        setEnrollModalOpen(false);
        notifySuccess("SMS device enrolled — starting MFA challenge…");
        handleInitiateOtpRef.current?.();
        return;
      }
      if (!data.deviceId) throw new Error("SMS enroll did not return a deviceId");
      setSmsEnrollDeviceId(data.deviceId);
      setSmsEnrollOtp("");
      setSmsEnrollStep("otp");
    } catch (err) {
      setEnrollError(
        err.response?.data?.message ||
          err.message ||
          "SMS enrollment failed. Please try again.",
      );
    } finally {
      setEnrolling(false);
    }
  }, [smsEnrollPhone]);

  /** POST /enroll/sms-complete — activate the device, then challenge it. */
  const handleEnrollSmsComplete = useCallback(async () => {
    if (!/^\d{6}$/.test(smsEnrollOtp)) {
      setEnrollError("Enter the 6-digit code from your SMS");
      return;
    }
    setEnrolling(true);
    setEnrollError("");
    try {
      await apiClient.post("/api/auth/mfa/enroll/sms-complete", {
        deviceId: smsEnrollDeviceId,
        otp: smsEnrollOtp,
      });
      setEnrollModalOpen(false);
      setSmsEnrollOtp("");
      setSmsEnrollDeviceId(null);
      notifySuccess("SMS device enrolled — starting MFA challenge…");
      handleInitiateOtpRef.current?.();
    } catch (err) {
      setEnrollError(
        err.response?.data?.message ||
          err.message ||
          "Could not activate the SMS device. Please try again.",
      );
    } finally {
      setEnrolling(false);
    }
  }, [smsEnrollOtp, smsEnrollDeviceId]);

  /** Enroll a FIDO2 passkey, then auto-initiate MFA challenge. */
  const handleEnrollFido2 = useCallback(async () => {
    setEnrolling(true);
    setEnrollError("");
    try {
      const { data: initData } = await apiClient.post(
        "/api/auth/mfa/enroll/fido2-init",
      );
      const credential = await navigator.credentials.create({
        publicKey: initData.publicKeyCredentialCreationOptions,
      });
      if (!credential) throw new Error("Passkey creation was cancelled.");
      const attestation = {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        type: credential.type,
        response: {
          attestationObject: btoa(
            String.fromCharCode(
              ...new Uint8Array(credential.response.attestationObject),
            ),
          ),
          clientDataJSON: btoa(
            String.fromCharCode(
              ...new Uint8Array(credential.response.clientDataJSON),
            ),
          ),
        },
      };
      await apiClient.post("/api/auth/mfa/enroll/fido2-complete", {
        deviceId: initData.deviceId,
        attestation,
        origin: window.location.origin,
      });
      setEnrollModalOpen(false);
      setEnrolling(false);
      notifySuccess("Passkey registered — starting MFA challenge…");
      handleInitiateOtpRef.current && handleInitiateOtpRef.current();
    } catch (err) {
      setEnrollError(
        err.response?.data?.message ||
          err.message ||
          "Passkey enrollment failed. Please try again.",
      );
      setEnrolling(false);
    }
  }, []);

  const handleTotpChallengeRef = useRef(null);
  const handlePushChallengeRef = useRef(null);

  /** Select a TOTP device and open the TOTP code entry modal. */
  const handleTotpChallenge = useCallback(async (daId, device) => {
    try {
      await apiClient.put(`/api/auth/mfa/challenge/${daId}`, {
        deviceId: device.id,
      });
      setTotpDaId(daId);
      setTotpDeviceId(device.id);
      setTotpCode("");
      setTotpError(null);
      setTotpModalOpen(true);
    } catch (err) {
      notifyError(
        "Could not initiate TOTP challenge: " +
          (err.response?.data?.message || err.message),
      );
    }
  }, []);

  /** Verify a TOTP code. */
  const handleTotpSubmit = useCallback(async () => {
    setTotpSubmitting(true);
    setTotpError(null);
    try {
      const { data } = await apiClient.put(
        `/api/auth/mfa/challenge/${totpDaId}`,
        {
          deviceId: totpDeviceId,
          otp: totpCode,
        },
      );
      if (!data.completed) {
        setTotpError(
          "Incorrect code. Please check your authenticator app and try again.",
        );
        return;
      }
      setTotpModalOpen(false);
      setTotpCode("");
      setStepUpRequired(false);
      notifySuccess(
        agentTriggeredStepUp
          ? "Identity verified \u2014 resuming agent request\u2026"
          : "Identity verified \u2014 please retry your transaction.",
      );
      if (agentTriggeredStepUp) {
        setAgentTriggeredStepUp(false);
        window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
      }
    } catch (err) {
      if (
        err.response?.status === 401 &&
        err.response?.data?.error === "session_expired"
      ) {
        notifyError("Session expired — please sign in again.");
        setTimeout(() => {
          window.location.replace("/");
        }, 2000);
        return;
      }
      if (
        err.response?.status === 410 ||
        err.response?.data?.error === "challenge_expired"
      ) {
        setTotpModalOpen(false);
        setMfaChallengeExpired(true);
        setAgentTriggeredStepUp(false);
        return;
      }
      setTotpError(
        err.response?.data?.message || "Incorrect code. Please try again.",
      );
    } finally {
      setTotpSubmitting(false);
    }
  }, [totpDaId, totpDeviceId, totpCode, agentTriggeredStepUp]);

  /** Select a push (MOBILE) device and open the push waiting panel. */
  const handlePushChallenge = useCallback(async (daId, device) => {
    try {
      await apiClient.put(`/api/auth/mfa/challenge/${daId}`, {
        deviceId: device.id,
      });
      setPushDaId(daId);
      setPushPolling(true);
      setPushModalOpen(true);
    } catch (err) {
      notifyError(
        "Could not send push notification: " +
          (err.response?.data?.message || err.message),
      );
    }
  }, []);

  /** Verify the OTP code via PingOne MFA; on success resume the pending agent action. */
  const handleVerifyOtp = useCallback(async () => {
    setOtpSubmitting(true);
    setOtpError("");
    try {
      const { data } = await apiClient.put(
        `/api/auth/mfa/challenge/${otpDaId}`,
        {
          deviceId: otpDeviceId,
          otp: otpCode,
        },
      );
      if (!data.completed) {
        setOtpError("Incorrect code. Please try again.");
        return;
      }
      setOtpModalOpen(false);
      setOtpCode("");
      notifySuccess(
        agentTriggeredStepUp
          ? "Identity verified — resuming agent request…"
          : "Identity verified — please retry your transaction.",
      );
      if (agentTriggeredStepUp) {
        setAgentTriggeredStepUp(false);
        window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
      }
    } catch (err) {
      if (
        err.response?.status === 401 &&
        err.response?.data?.error === "session_expired"
      ) {
        notifyError("Session expired — please sign in again.");
        setTimeout(() => {
          window.location.replace("/");
        }, 2000);
        return;
      }
      if (
        err.response?.status === 410 ||
        err.response?.data?.error === "challenge_expired"
      ) {
        setOtpModalOpen(false);
        setMfaChallengeExpired(true);
        setAgentTriggeredStepUp(false);
        return;
      }
      setOtpError(
        err.response?.data?.message || "Incorrect code. Please try again.",
      );
    } finally {
      setOtpSubmitting(false);
    }
  }, [otpCode, otpDaId, otpDeviceId, agentTriggeredStepUp]);

  // Keep refs current so stale closures (timers, event listeners) can call latest functions
  useEffect(() => {
    handleCibaStepUpRef.current = handleCibaStepUp;
  }, [handleCibaStepUp]);
  useEffect(() => {
    handleInitiateOtpRef.current = handleInitiateOtp;
  }, [handleInitiateOtp]);
  useEffect(() => {
    handleTotpChallengeRef.current = handleTotpChallenge;
  }, [handleTotpChallenge]);
  useEffect(() => {
    handlePushChallengeRef.current = handlePushChallenge;
  }, [handlePushChallenge]);

  // Push polling: poll /api/auth/mfa/challenge/:daId/status every 3s while waiting
  useEffect(() => {
    if (!pushDaId || !pushPolling) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await apiClient.get(
          `/api/auth/mfa/challenge/${pushDaId}/status`,
        );
        if (data.completed || data.status === "COMPLETED") {
          setPushPolling(false);
          setPushModalOpen(false);
          setStepUpRequired(false);
          notifySuccess(
            agentTriggeredStepUp
              ? "Identity verified \u2014 resuming agent request\u2026"
              : "Identity verified \u2014 please retry your transaction.",
          );
          if (agentTriggeredStepUp) {
            setAgentTriggeredStepUp(false);
            window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
          }
        } else if (
          data.status === "PUSH_CONFIRMATION_TIMED_OUT" ||
          data.status === "FAILED"
        ) {
          setPushPolling(false);
          setPushModalOpen(false);
          setAgentTriggeredStepUp(false);
          notifyError(
            "Push notification timed out or was denied. Please try again.",
          );
        }
      } catch (_) {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pushDaId, pushPolling]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    stepUpVerifyHrefRef.current = stepUpVerifyHref;
  }, [stepUpVerifyHref]);

  /** Cancel the auto-initiate countdown (agent-triggered flows). */
  const cancelAutoInitiate = useCallback(() => {
    if (autoInitiateTimerRef.current) {
      autoInitiateTimerRef.current.forEach(clearTimeout);
      autoInitiateTimerRef.current = null;
    }
    setAgentCountdown(0);
  }, []);

  /** Clears step-up gate state and dismisses the persistent step-up toast. */
  const dismissStepUp = useCallback(() => {
    cancelAutoInitiate();
    setStepUpRequired(false);
    setCibaAuthReqId(null);
    setCibaStatus("idle");
    setCibaAcr("");
    toast.dismiss("customer-step-up");
  }, [cancelAutoInitiate]);

  /** Enter the step-up gate from a 428 body or an RFC 9470 401 challenge (method + ACR for CIBA). Inverse of dismissStepUp. */
  const beginStepUp = useCallback((d) => {
    setStepUpMethod(d?.step_up_method || "email");
    setCibaAcr(d?.step_up_acr || "");
    setStepUpChallengeRaw(d?.rfc9470?.raw || "");
    setCibaStatus("idle");
    setStepUpRequired(true);
  }, []);

  // Poll CIBA status when a request is in flight
  useEffect(() => {
    if (!cibaAuthReqId || cibaStatus !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(
          `/api/auth/ciba/poll/${cibaAuthReqId}`,
        );
        if (data.status === "completed" || data.status === "approved") {
          setCibaStatus("completed");
          setCibaAuthReqId(null);
          setStepUpRequired(false);
          setCibaAcr("");
          await fetchUserData(true);
          notifySuccess(
            agentTriggeredStepUp
              ? "Identity verified — resuming agent request…"
              : "Identity verified — please retry your transaction.",
          );
          if (agentTriggeredStepUp) {
            setAgentTriggeredStepUp(false);
            window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
          }
        }
        // (the route signals pending via a 200 body; terminal failures arrive
        //  as HTTP errors and are handled in catch below.)
      } catch (err) {
        // Terminal failures arrive as HTTP errors, not a 200 body:
        //   403 → user denied at PingOne
        //   404 → request no longer in this session (reset or cancelled elsewhere)
        //   410 → request expired locally
        // Anything else (network blip / 5xx) is transient — keep polling.
        const status = err.response?.status;
        if (status === 403 || status === 404 || status === 410) {
          const denied =
            err.response?.data?.status === "denied" ||
            err.response?.data?.error === "access_denied";
          setCibaStatus("error");
          setCibaAuthReqId(null);
          setCibaAcr("");
          notifyError(
            denied
              ? "Authentication was denied. Please try again."
              : "The verification request is no longer valid. Please try again.",
          );
        }
        /* otherwise keep polling */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [cibaAuthReqId, cibaStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Agent-triggered step-up: listen for agentStepUpRequested and activate CIBA flow
  useEffect(() => {
    const onAgentStepUp = (e) => {
      const method = (e && e.detail && e.detail.step_up_method) || "email";
      const isHITL = (e && e.detail && e.detail.isHITL) === true;
      if (method === "ciba") {
        setAgentTriggeredStepUp(true);
        setStepUpRequired(true);
        setStepUpMethod("ciba");
        setCibaAcr((e && e.detail && e.detail.step_up_acr) || "");
        // Dispatch SESSION_REAUTH_EVENT with isHITL flag for SessionReauthBanner
        window.dispatchEvent(
          new CustomEvent(SESSION_REAUTH_EVENT, {
            detail: {
              message:
                "Additional authentication required for this transaction.",
              role: "customer",
              isHITL,
            },
          }),
        );
        // 3-second countdown then auto-initiate CIBA
        setAgentCountdown(3);
        const t1 = setTimeout(() => setAgentCountdown(2), 1000);
        const t2 = setTimeout(() => setAgentCountdown(1), 2000);
        const t3 = setTimeout(() => {
          setAgentCountdown(0);
          autoInitiateTimerRef.current = null;
          handleCibaStepUpRef.current && handleCibaStepUpRef.current();
        }, 3000);
        autoInitiateTimerRef.current = [t1, t2, t3];
      } else {
        // Email OTP: generate code server-side and show inline modal (no PingOne redirect)
        setAgentTriggeredStepUp(true);
        // Dispatch SESSION_REAUTH_EVENT with isHITL flag for SessionReauthBanner
        window.dispatchEvent(
          new CustomEvent(SESSION_REAUTH_EVENT, {
            detail: {
              message:
                "Additional authentication required for this transaction.",
              role: "customer",
              isHITL,
            },
          }),
        );
        handleInitiateOtpRef.current && handleInitiateOtpRef.current();
      }
    };
    window.addEventListener("agentStepUpRequested", onAgentStepUp);
    return () => {
      window.removeEventListener("agentStepUpRequested", onAgentStepUp);
      cancelAutoInitiate();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Step-up MFA (428): persistent warning toast with verify actions (replaces inline banner). */
  useEffect(() => {
    if (!stepUpRequired) {
      toast.dismiss("customer-step-up");
      return;
    }

    const onToastClosed = () => {
      cancelAutoInitiate();
      setStepUpRequired(false);
      setCibaAuthReqId(null);
      setCibaStatus("idle");
      setCibaAcr("");
      setStepUpChallengeRaw("");
    };

    const body = (
      <div
        className="dashboard-toast-error"
        style={{ flexDirection: "column", alignItems: "stretch" }}
      >
        <p className="dashboard-toast-error__text" style={{ marginBottom: 8 }}>
          <strong>Additional verification required.</strong> Transfers and
          withdrawals of $250 or more require MFA. Verify your identity to
          continue.
        </p>
        {stepUpChallengeRaw && (
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              background: "rgba(0,0,0,0.25)",
              padding: 6,
              borderRadius: 4,
              wordBreak: "break-all",
              marginBottom: 8,
            }}
          >
            <strong>RFC 9470 challenge:</strong> WWW-Authenticate:{" "}
            {stepUpChallengeRaw}
          </p>
        )}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {stepUpMethod === "ciba" ? (
            <>
              {cibaStatus === "idle" &&
                agentTriggeredStepUp &&
                agentCountdown > 0 && (
                  <>
                    <span style={{ fontStyle: "italic" }}>
                      Starting in {agentCountdown}s…
                    </span>
                    <button
                      type="button"
                      className="dashboard-toast-error__btn"
                      onClick={cancelAutoInitiate}
                    >
                      Cancel
                    </button>
                  </>
                )}
              {cibaStatus === "idle" &&
                (!agentTriggeredStepUp || agentCountdown === 0) && (
                  <button
                    type="button"
                    className="dashboard-toast-error__btn"
                    onClick={handleCibaStepUp}
                  >
                    Verify via CIBA
                  </button>
                )}
              {cibaStatus === "pending" && (
                <span style={{ fontStyle: "italic" }}>
                  Waiting for approval on your device…
                </span>
              )}
              {cibaStatus === "error" && (
                <button
                  type="button"
                  className="dashboard-toast-error__btn"
                  onClick={() => {
                    setCibaStatus("idle");
                    setCibaAuthReqId(null);
                  }}
                >
                  Retry
                </button>
              )}
            </>
          ) : (
            <>
              {agentTriggeredStepUp && agentCountdown > 0 && (
                <>
                  <span style={{ fontStyle: "italic" }}>
                    Redirecting in {agentCountdown}s…
                  </span>
                  <button
                    type="button"
                    className="dashboard-toast-error__btn"
                    onClick={cancelAutoInitiate}
                  >
                    Cancel
                  </button>
                </>
              )}
              {(!agentTriggeredStepUp || agentCountdown === 0) && (
                <button
                  type="button"
                  className="dashboard-toast-error__btn"
                  onClick={handleInitiateOtpRef.current || handleInitiateOtp}
                >
                  Verify via Email
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="dashboard-toast-error__btn"
            onClick={dismissStepUp}
          >
            Dismiss
          </button>
        </div>
      </div>
    );

    const opts = {
      toastId: "customer-step-up",
      autoClose: false,
      closeOnClick: false,
      onClose: onToastClosed,
    };

    if (toast.isActive("customer-step-up")) {
      toast.update("customer-step-up", { render: body, ...opts });
    } else {
      toast.warning(body, opts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleInitiateOtp excluded: ref keeps it current without re-triggering the toast
  }, [
    stepUpRequired,
    stepUpMethod,
    stepUpChallengeRaw,
    cibaStatus,
    handleCibaStepUp,
    dismissStepUp,
    stepUpVerifyHref,
    agentTriggeredStepUp,
    agentCountdown,
    cancelAutoInitiate,
  ]);

  // Demo mode: true when accounts haven't been replaced by real API data
  const isDemoMode = accounts.length > 0 && accounts.every((a) => a._demo);

  const totalBalance = useMemo(
    () =>
      accounts
        // Only checking and savings count toward the displayed total.
        .filter((a) => ASSET_TYPES.has(a.accountType || a.type))
        .reduce((sum, a) => sum + (Number(a.balance) || 0), 0),
    [accounts],
  );

  const totalDebt = useMemo(
    () =>
      accounts
        .filter((a) => DEBT_TYPES.has(a.accountType || a.type))
        .reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0),
    [accounts],
  );

  const accountsAnchorRef = useRef(null);
  const agentColumnRef = useRef(null);

  // Middle column = portal host for the single App-level banking agent.
  // Mirrors EmbeddedAgentDock's bottom-dock pattern (4b): a stable ref
  // callback publishes the host element into AgentUiModeContext; the App
  // single instance portals its floatShell into it. Guarded cleanup avoids a
  // middle/bottom host race (only clears if still pointing at our element).
  const [middleHostEl, setMiddleHostEl] = useState(null);
  const middleHostRefCb = useCallback((el) => setMiddleHostEl(el), []);
  useEffect(() => {
    // In clinical-split mode the TalkPane owns the agent surface host (.ac-chat-host).
    // The middle-host div is not rendered then, so middleHostEl is null and the
    // unconditional setSurfaceHostEl(middleHostEl) below would set surfaceHostEl=null
    // AFTER TalkPane registered — clobbering it and leaving the agent unportaled/hidden.
    // Skip the middle-host registration entirely when clinical split is active.
    if (clinicalSplitEnabled) return undefined;
    setSurfaceHostEl(middleHostEl);
    return () => {
      setSurfaceHostEl((cur) => (cur === middleHostEl ? null : cur));
    };
  }, [middleHostEl, setSurfaceHostEl, clinicalSplitEnabled]);

  useEffect(() => {
    setToolbarHostEl(toolbarHostEl);
    return () => setToolbarHostEl((cur) => (cur === toolbarHostEl ? null : cur));
  }, [toolbarHostEl, setToolbarHostEl]);

  const handleScrollToAccounts = useCallback(() => {
    accountsAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleScrollToAssistant = useCallback(() => {
    if (dashboardLayout === "split3" && agentColumnRef.current) {
      agentColumnRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    // When the embedded agent isn't in the layout, open the floating FAB panel instead of scrolling.
    if (agentPlacement === "none") {
      window.dispatchEvent(new CustomEvent("banking-agent-open"));
      return;
    }
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  }, [dashboardLayout, agentPlacement]);

  /**
   * High-value HITL: POST /transactions without consent returns 400; create a session challenge and open the consent popup.
   */
  const openConsentFlowForPayload = async (intentBody) => {
    try {
      const { data } = await apiClient.post(
        "/api/transactions/consent-challenge",
        intentBody,
      );
      const cid = data?.challengeId;
      if (!cid) {
        notifyError("Could not start consent — no challenge id from server.");
        return;
      }
      setConsentChallengeId({
        id: cid,
        snapshot: data.snapshot || null,
        payload: intentBody,
      });
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        e.response?.data?.error ||
        e.message ||
        "Could not start consent flow.";
      notifyError(msg);
    }
  };


  const handleTransfer = async (e) => {
    e.preventDefault();

    if (!selectedAccount || !transferForm.toAccountId || !transferForm.amount) {
      notifyWarning("Please fill in all transfer details");
      return;
    }

    // Phase 122: Session check before banking action
    if (!user) {
      notifyWarning(
        "You need to sign in first to perform banking operations. Tap Customer Sign In to get started.",
      );
      return;
    }


    try {
      await apiClient.post("/api/transactions", {
        fromAccountId: selectedAccount.id,
        toAccountId: transferForm.toAccountId,
        amount: parseFloat(transferForm.amount),
        type: "transfer",
        description: transferForm.description || "Transfer between accounts",
        userId: user.id,
      });

      // Reset form and refresh data
      setTransferForm({ toAccountId: "", amount: "", description: "" });
      setSelectedAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "transfer" },
        }),
      );

      notifySuccess("Transfer completed successfully!");
    } catch (error) {
      const d = error.response?.data;
      // RFC 9470 mode (ff_rfc9470_challenge): 401 + WWW-Authenticate challenge.
      // Ordinary 401s yield null here and keep their existing handling.
      const rfc9470StepUp = extractRfc9470Challenge(error.response);
      console.error("Transfer error:", error);
      if (error.response?.data?.error === "amount_exceeds_hard_limit") {
        notifyError(
          `Transaction exceeds the $${error.response.data.limit} limit. Your amount ($${error.response.data.amount}) is too high. Please reduce the amount and try again.`,
          5000,
        );
        return;
      }
      if (error.response?.status === 428) {
        if (d?.error === "hitl_required" && d?.hitl?.type === "consent") {
          await openConsentFlowForPayload({
            fromAccountId: selectedAccount.id,
            toAccountId: transferForm.toAccountId,
            amount: parseFloat(transferForm.amount),
            type: "transfer",
            description:
              transferForm.description || "Transfer between accounts",
          });
          return;
        }
        beginStepUp(error.response.data);
      } else if (rfc9470StepUp) {
        beginStepUp(rfc9470StepUp);
      } else if (d?.error === "policy_not_found") {
        // Policy drift, NOT a permission problem: the action has no matching
        // authorization policy. Independent of HTTP status — the real PingOne
        // Authorize engine returns 503 for this, while insufficient_scope and
        // other permission denials stay 403. Say so, so nobody chases scopes
        // or user perms.
        notifyError(
          d?.error_description ||
            "Policy not found — this action has no matching authorization policy. Please contact your administrator.",
          5000,
        );
      } else if (error.response?.status === 403) {
        const scopeError = d?.error === "insufficient_scope";
        if (scopeError) {
          const requiredScope = d?.required_scope || "write";
          const userScopes = d?.user_scopes || [];
          const userScopesStr =
            userScopes.length > 0 ? userScopes.join(", ") : "(none)";
          notifyError(
            `Insufficient scope: This action requires '${requiredScope}' scope.\nYour token has: ${userScopesStr}\nRe-authenticate to request additional scopes.`,
            5000,
          );
        } else {
          notifyError(
            "You do not have permission to perform transfers. Please contact your administrator.",
          );
        }
      } else {
        notifyError(error.response?.data?.error || "Transfer failed");
      }
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();

    if (!depositAccount || !depositForm.amount) {
      notifyWarning("Please fill in all deposit details");
      return;
    }

    // Phase 122: Session check before banking action
    if (!user) {
      notifyWarning(
        "You need to sign in first to perform banking operations. Tap Customer Sign In to get started.",
      );
      return;
    }


    try {
      await apiClient.post("/api/transactions", {
        fromAccountId: null,
        toAccountId: depositAccount.id,
        amount: parseFloat(depositForm.amount),
        type: "deposit",
        description: depositForm.description || "Deposit to account",
        userId: user.id,
      });

      // Reset form and refresh data
      setDepositForm({ amount: "", description: "" });
      setDepositAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "deposit" },
        }),
      );

      notifySuccess("Deposit completed successfully!");
    } catch (error) {
      const d = error.response?.data;
      // RFC 9470 mode (ff_rfc9470_challenge): 401 + WWW-Authenticate challenge.
      // Ordinary 401s yield null here and keep their existing handling.
      const rfc9470StepUp = extractRfc9470Challenge(error.response);
      console.error("Deposit error:", error);
      if (error.response?.data?.error === "amount_exceeds_hard_limit") {
        notifyError(
          `Transaction exceeds the $${error.response.data.limit} limit. Your amount ($${error.response.data.amount}) is too high. Please reduce the amount and try again.`,
          5000,
        );
        return;
      }
      if (error.response?.status === 428) {
        if (d?.error === "hitl_required" && d?.hitl?.type === "consent") {
          await openConsentFlowForPayload({
            fromAccountId: null,
            toAccountId: depositAccount.id,
            amount: parseFloat(depositForm.amount),
            type: "deposit",
            description: depositForm.description || "Deposit to account",
          });
          return;
        }
        beginStepUp(error.response.data);
      } else if (rfc9470StepUp) {
        beginStepUp(rfc9470StepUp);
      } else if (d?.error === "policy_not_found") {
        // Policy drift, NOT a permission problem: the action has no matching
        // authorization policy. Independent of HTTP status — the real PingOne
        // Authorize engine returns 503 for this, while insufficient_scope and
        // other permission denials stay 403. Say so, so nobody chases scopes
        // or user perms.
        notifyError(
          d?.error_description ||
            "Policy not found — this action has no matching authorization policy. Please contact your administrator.",
          5000,
        );
      } else if (error.response?.status === 403) {
        const scopeError = d?.error === "insufficient_scope";
        if (scopeError) {
          const requiredScope = d?.required_scope || "write";
          const userScopes = d?.user_scopes || [];
          const userScopesStr =
            userScopes.length > 0 ? userScopes.join(", ") : "(none)";
          notifyError(
            `Insufficient scope: This action requires '${requiredScope}' scope.\nYour token has: ${userScopesStr}\nRe-authenticate to request additional scopes.`,
            5000,
          );
        } else {
          notifyError(
            "You do not have permission to make deposits. Please contact your administrator.",
          );
        }
      } else {
        notifyError(error.response?.data?.error || "Deposit failed");
      }
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();

    if (!withdrawAccount || !withdrawForm.amount) {
      notifyWarning("Please fill in all withdrawal details");
      return;
    }

    // Phase 122: Session check before banking action
    if (!user) {
      notifyWarning(
        "You need to sign in first to perform banking operations. Tap Customer Sign In to get started.",
      );
      return;
    }


    try {
      await apiClient.post("/api/transactions", {
        fromAccountId: withdrawAccount.id,
        toAccountId: null,
        amount: parseFloat(withdrawForm.amount),
        type: "withdrawal",
        description: withdrawForm.description || "Withdrawal from account",
        userId: user.id,
      });

      // Reset form and refresh data
      setWithdrawForm({ amount: "", description: "" });
      setWithdrawAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "withdrawal" },
        }),
      );

      notifySuccess("Withdrawal completed successfully!");
    } catch (error) {
      const d = error.response?.data;
      // RFC 9470 mode (ff_rfc9470_challenge): 401 + WWW-Authenticate challenge.
      // Ordinary 401s yield null here and keep their existing handling.
      const rfc9470StepUp = extractRfc9470Challenge(error.response);
      console.error("Withdrawal error:", error);
      if (error.response?.data?.error === "amount_exceeds_hard_limit") {
        notifyError(
          `Transaction exceeds the $${error.response.data.limit} limit. Your amount ($${error.response.data.amount}) is too high. Please reduce the amount and try again.`,
          5000,
        );
        return;
      }
      if (error.response?.status === 428) {
        if (d?.error === "hitl_required" && d?.hitl?.type === "consent") {
          await openConsentFlowForPayload({
            fromAccountId: withdrawAccount.id,
            toAccountId: null,
            amount: parseFloat(withdrawForm.amount),
            type: "withdrawal",
            description: withdrawForm.description || "Withdrawal from account",
          });
          return;
        }
        beginStepUp(error.response.data);
      } else if (rfc9470StepUp) {
        beginStepUp(rfc9470StepUp);
      } else if (d?.error === "policy_not_found") {
        // Policy drift, NOT a permission problem: the action has no matching
        // authorization policy. Independent of HTTP status — the real PingOne
        // Authorize engine returns 503 for this, while insufficient_scope and
        // other permission denials stay 403. Say so, so nobody chases scopes
        // or user perms.
        notifyError(
          d?.error_description ||
            "Policy not found — this action has no matching authorization policy. Please contact your administrator.",
          5000,
        );
      } else if (error.response?.status === 403) {
        const scopeError = d?.error === "insufficient_scope";
        if (scopeError) {
          const requiredScope = d?.required_scope || "write";
          const userScopes = d?.user_scopes || [];
          const userScopesStr =
            userScopes.length > 0 ? userScopes.join(", ") : "(none)";
          notifyError(
            `Insufficient scope: This action requires '${requiredScope}' scope.\nYour token has: ${userScopesStr}\nRe-authenticate to request additional scopes.`,
            5000,
          );
        } else {
          notifyError(
            "You do not have permission to make withdrawals. Please contact your administrator.",
          );
        }
      } else {
        notifyError(error.response?.data?.error || "Withdrawal failed");
      }
    }
  };

  // Function to determine if a transaction represents money going out (negative) or coming in (positive)
  const isTransactionNegative = (transaction) => {
    // For withdrawals, money is going out (negative)
    if (transaction.type === "withdrawal") {
      return true;
    }

    // For deposits, money is coming in (positive)
    if (transaction.type === "deposit") {
      return false;
    }

    // For other transaction types, determine based on which account is involved
    // If this transaction has a fromAccountId, it means money is going out from that account
    if (transaction.fromAccountId) {
      return true;
    }
    // If this transaction has a toAccountId but no fromAccountId, it means money is coming in
    if (transaction.toAccountId && !transaction.fromAccountId) {
      return false;
    }

    // Default to positive for unknown transaction types
    return false;
  };

  const renderBankingMain = () => (
    <>
      {/* Hero: balance, AI insight, lightweight viz (2026 “financial butler” pattern) */}
      <div className="section ud-hero" aria-labelledby="ud-hero-heading">
        <div className="ud-hero__top">
          <p className="ud-hero__eyebrow" id="ud-hero-heading">
            {format(new Date(), "EEEE, MMM d")}
          </p>
          <p className="ud-hero__greet">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, <em>{user?.firstName || "there"}</em>
          </p>
          <p className="ud-hero__insight" role="status">
            {isDemoMode
              ? "Demo snapshot — connect real accounts to unlock personalized cash-flow and savings nudges from the assistant."
              : dashboardLayout === "split3"
                ? "Your balances update automatically. Ask the assistant in the center column for transfers, explanations, or spending patterns."
                : "Your balances update automatically. Ask the assistant below for transfers, explanations, or spending patterns."}
          </p>
        </div>

        <div className="ud-hero__balance-band">
          <div className="ud-balance-main">
            <p className="ud-hero__balance-label">Total Balance</p>
            <p className="ud-hero__balance" aria-live="polite">
              {fmt(totalBalance)}
            </p>
          </div>
          <div
            className="ud-hero__spark"
            aria-hidden="true"
            title="Illustrative activity trend"
          >
            <span style={{ height: "40%" }} />
            <span style={{ height: "65%" }} />
            <span style={{ height: "55%" }} />
            <span style={{ height: "78%" }} />
            <span style={{ height: "62%" }} />
            <span style={{ height: "88%" }} />
            <span style={{ height: "72%" }} />
          </div>
        </div>

        {/* Stats row: quick metrics */}
        <div className="ud-hero__stats">
          <div className="ud-stat">
            <div className="ud-stat__label">Accounts</div>
            <div className="ud-stat__value">{accounts.length}</div>
          </div>
          <div className="ud-stat">
            <div className="ud-stat__label">Available</div>
            <div className="ud-stat__value">{fmt(totalBalance)}</div>
          </div>
          {totalDebt > 0 && (
            <div className="ud-stat">
              <div className="ud-stat__label">Loans</div>
              <div className="ud-stat__value">{fmt(totalDebt)}</div>
            </div>
          )}
          <div className="ud-stat">
            <div className="ud-stat__label">Active</div>
            <div className="ud-stat__value">{accounts.filter((a) => !a.closed).length}</div>
          </div>
        </div>
      </div>

      {/* Proactive actions — reduce menu depth (mobile-first tap targets) */}
      <div className="section ud-quick-actions" aria-label="Quick actions">
        <h2 className="ud-quick-actions__title">Quick actions</h2>
        <div className="ud-quick-actions__row">
          <button
            type="button"
            className="ud-qa-btn"
            onClick={() =>
              user ? handleScrollToAccounts() : navigateToCustomerOAuthLogin()
            }
          >
            Move money
          </button>
          <button
            type="button"
            className="ud-qa-btn"
            onClick={() =>
              user ? handleScrollToAccounts() : navigateToCustomerOAuthLogin()
            }
          >
            Add funds
          </button>
          <button
            type="button"
            className="ud-qa-btn ud-qa-btn--accent"
            onClick={() =>
              user ? handleScrollToAssistant() : navigateToCustomerOAuthLogin()
            }
          >
            Ask assistant
          </button>
          <button
            type="button"
            className="ud-qa-btn ud-qa-btn--delegate"
            onClick={() =>
              window.open(
                "/delegated-access",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Manage Delegates
          </button>
        </div>

        {/* Trust + omnichannel / super-app cues (copy only in this demo) */}
        <div className="ud-trust-strip" aria-live="polite">
          <span className="ud-trust-strip__item">Session secured (OAuth)</span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <span className="ud-trust-strip__item">
            Step-up when risk warrants
          </span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <span className="ud-trust-strip__item">
            Biometrics on supported devices
          </span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <a
            href="/api/auth/debug?deep=1"
            target="_blank"
            rel="noopener noreferrer"
            className="ud-trust-strip__item ud-trust-strip__item--debug"
            title="Inspect session and Upstash store health"
          >
            Session debug
          </a>
        </div>
        <nav className="ud-super-pills" aria-label="Quick links">
          <Link
            to="/security"
            className="ud-super-pill"
            aria-label="Security and Insights"
          >
            Insights
          </Link>
          <Link
            to="/transactions"
            className="ud-super-pill"
            aria-label="Payments and Transfers"
          >
            Payments hub
          </Link>
          <Link
            to="/pingone-test"
            className="ud-super-pill"
            aria-label="PingOne integration test page"
          >
            PingOne Test
          </Link>
          <Link
            to="/mfa-test"
            className="ud-super-pill"
            aria-label="MFA test page"
          >
            MFA Test
          </Link>
          <Link
            to="/learning"
            className="ud-super-pill"
            aria-label="Learning Hub"
          >
            Learning Hub
          </Link>
          <Link
            to="/code-search"
            className="ud-super-pill"
            aria-label="RAG code search"
          >
            Code Search
          </Link>
        </nav>
      </div>

      {/* Customer Profile */}
      <div className="section ud-profile-card">
        <div className="ud-profile-header">
          <h2>Account Holder</h2>
          {isDemoMode && <span className="account-demo-badge">Demo mode</span>}
        </div>
        <div className="ud-profile-meta">
          <div className="account-detail-row">
            <span className="detail-label">Name</span>
            <span className="detail-value">
              {user?.firstName || user?.lastName
                ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                : user?.name || user?.username || "—"}
            </span>
          </div>
          <div className="account-detail-row">
            <span className="detail-label">Email</span>
            <span className="detail-value">
              {user?.email || user?.username || "—"}
            </span>
          </div>
          <div className="account-detail-row">
            <span className="detail-label">Role</span>
            <span
              className="detail-value"
              style={{ textTransform: "capitalize" }}
            >
              {user?.role || (isDemoMode ? "demo" : "customer")}
            </span>
          </div>
        </div>
      </div>

      {/* Account Summary */}
      <div ref={accountsAnchorRef} className="section">
        <h2 className="ud-accounts-heading">Your Accounts</h2>
        {isDemoMode && (
          <p
            className="demo-notice"
            style={{
              color: "#6b7280",
              fontSize: "0.85rem",
              marginBottom: "0.75rem",
            }}
          >
            Demo mode —{" "}
            <button
              type="button"
              onClick={navigateToCustomerOAuthLogin}
              style={{
                background: "none",
                border: "none",
                color: "var(--brand-navy)",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                textDecoration: "underline",
              }}
            >
              sign in
            </button>{" "}
            to use your real accounts
          </p>
        )}
        <div className="accounts-grid">
          {accounts.map((account) => {
            const isExpanded = expandedAccounts.has(account.id);
            const acctType = (
              account.accountType ||
              account.type ||
              "unknown"
            ).toLowerCase();
            const isNegative = (account.balance ?? 0) < 0;
            const maskedNum = account.accountNumber
              ? `${acctType.toUpperCase().slice(0, 3)} •••• ${String(account.accountNumber).slice(-4)}`
              : "—";
            const typeLabelMap = {
              checking: "Checking",
              savings: "Savings",
              loan: "Loan",
              car_loan: "Auto Loan",
              mortgage: "Mortgage",
              credit: "Credit",
              investment: "Investment",
              money_market: "Money Market",
            };
            const typeLabel =
              typeLabelMap[acctType] ||
              acctType.charAt(0).toUpperCase() + acctType.slice(1);

            return (
              <div
                key={account.id}
                className={`account-card account-card--${acctType}`}
                style={account._demo ? { opacity: 0.65 } : {}}
              >
                <div className="account-card__body">
                  <div className="account-header">
                    <div>
                      <h3>{account.name}</h3>
                      <p className="account-number">{maskedNum}</p>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span className={`account-type-badge ${acctType}`}>
                        {typeLabel}
                      </span>
                      {account._demo && (
                        <span className="account-demo-badge">demo</span>
                      )}
                    </div>
                  </div>

                  <div className="account-balance-row">
                    <p
                      className={`balance${isNegative ? " balance--negative" : ""}`}
                    >
                      {fmt(account.balance)}
                    </p>
                    <span className="balance-label">
                      {isNegative ? "Outstanding" : "Available"}
                    </span>
                  </div>

                  <div className="account-actions">
                    <button
                      type="button"
                      className="select-account-btn"
                      onClick={() =>
                        user
                          ? setSelectedAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Transfer
                    </button>
                    <button
                      type="button"
                      className="deposit-btn"
                      onClick={() =>
                        user
                          ? setDepositAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      className="withdraw-btn"
                      onClick={() =>
                        user
                          ? setWithdrawAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                {/* Account Details accordion — always visible */}
                <div className="account-details-section">
                  <button
                    type="button"
                    className={`account-profile-toggle${isExpanded ? " open" : ""}`}
                    onClick={() => toggleAccountProfile(account.id)}
                  >
                    Account Details
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="4 6 8 10 12 6" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="account-profile-details">
                      <div className="account-detail-row">
                        <span className="detail-label">Account Number</span>
                        <span className="detail-value">
                          {account.accountNumber}
                        </span>
                      </div>
                      <div className="account-detail-row">
                        <span className="detail-label">Account Type</span>
                        <span className="detail-value">{typeLabel}</span>
                      </div>
                      {account.routingNumber && (
                        <div className="account-detail-row">
                          <span className="detail-label">Routing Number</span>
                          <span className="detail-value">
                            {account.routingNumber}
                          </span>
                        </div>
                      )}
                      {account.swiftCode && (
                        <div className="account-detail-row">
                          <span className="detail-label">SWIFT</span>
                          <span className="detail-value">
                            {account.swiftCode}
                          </span>
                        </div>
                      )}
                      {account.iban && (
                        <div className="account-detail-row">
                          <span className="detail-label">IBAN</span>
                          <span className="detail-value">{account.iban}</span>
                        </div>
                      )}
                      {account.branchName && (
                        <div className="account-detail-row">
                          <span className="detail-label">Branch</span>
                          <span className="detail-value">
                            {account.branchName}
                          </span>
                        </div>
                      )}
                      {account.openedDate && (
                        <div className="account-detail-row">
                          <span className="detail-label">Opened</span>
                          <span className="detail-value">
                            {new Date(account.openedDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {account.accountHolderName && (
                        <div className="account-detail-row">
                          <span className="detail-label">Account Holder</span>
                          <span className="detail-value">
                            {account.accountHolderName}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transfer Form */}
      {selectedAccount && (
        <div className="section">
          <h2>Transfer Money</h2>
          <div className="transfer-form">
            <p>
              From: {selectedAccount.accountType} -{" "}
              {selectedAccount.accountNumber} ({fmt(selectedAccount.balance)})
            </p>
            <form onSubmit={handleTransfer} aria-label="Transfer form">
              <div className="form-group">
                <label>To Account:</label>
                <select
                  value={transferForm.toAccountId}
                  onChange={(e) =>
                    setTransferForm({
                      ...transferForm,
                      toAccountId: e.target.value,
                    })
                  }
                  required
                >
                  <option value="">Select destination account</option>
                  {accounts
                    .filter((account) => account.id !== selectedAccount.id)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.accountType} - {account.accountNumber} (
                        {fmt(account.balance)})
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={transferForm.description}
                  onChange={(e) =>
                    setTransferForm({
                      ...transferForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Transfer description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="transfer-btn"
                  disabled={!user}
                  title={!user ? "Sign in to transfer funds" : undefined}
                >
                  Transfer
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setSelectedAccount(null);
                    setTransferForm({
                      toAccountId: "",
                      amount: "",
                      description: "",
                    });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deposit Form */}
      {depositAccount && (
        <div className="section">
          <h2>Deposit Money</h2>
          <div className="deposit-form">
            <p>
              To: {depositAccount.accountType} - {depositAccount.accountNumber}{" "}
              ({fmt(depositAccount.balance)})
            </p>
            <form onSubmit={handleDeposit}>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={depositForm.amount}
                  onChange={(e) =>
                    setDepositForm({ ...depositForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={depositForm.description}
                  onChange={(e) =>
                    setDepositForm({
                      ...depositForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Deposit description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="deposit-submit-btn"
                  disabled={!user}
                  title={!user ? "Sign in to deposit funds" : undefined}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setDepositAccount(null);
                    setDepositForm({ amount: "", description: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Withdraw Form */}
      {withdrawAccount && (
        <div className="section">
          <h2>Withdraw Money</h2>
          <div className="withdraw-form">
            <p>
              From: {withdrawAccount.accountType} -{" "}
              {withdrawAccount.accountNumber} ({fmt(withdrawAccount.balance)})
            </p>
            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={withdrawForm.amount}
                  onChange={(e) =>
                    setWithdrawForm({ ...withdrawForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={withdrawForm.description}
                  onChange={(e) =>
                    setWithdrawForm({
                      ...withdrawForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Withdrawal description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="withdraw-submit-btn"
                  disabled={!user}
                  title={!user ? "Sign in to withdraw funds" : undefined}
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setWithdrawAccount(null);
                    setWithdrawForm({ amount: "", description: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recent Transactions — hidden if empty */}
      {transactions.length > 0 && (
      <div className="section">
        <h2>Recent Transactions</h2>
        {isDemoMode && (
          <p
            className="demo-notice"
            style={{
              color: "#6b7280",
              fontSize: "0.85rem",
              marginBottom: "0.75rem",
            }}
          >
            Demo mode —{" "}
            <button
              type="button"
              onClick={navigateToCustomerOAuthLogin}
              style={{
                background: "none",
                border: "none",
                color: "var(--brand-navy)",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                textDecoration: "underline",
              }}
            >
              sign in
            </button>{" "}
            to see your real transactions
          </p>
        )}
        {(() => {
          const sorted = [...transactions]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);

          if (sorted.length === 0) {
            return null;
          }

          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const yesterdayStart = new Date(todayStart);
          yesterdayStart.setDate(todayStart.getDate() - 1);

          const txGroups = [];
          for (const tx of sorted) {
            const dStart = new Date(tx.createdAt);
            dStart.setHours(0, 0, 0, 0);
            const label =
              dStart >= todayStart
                ? "Today"
                : dStart >= yesterdayStart
                  ? "Yesterday"
                  : format(dStart, "EEE, MMM d");
            const last = txGroups[txGroups.length - 1];
            if (!last || last.label !== label)
              txGroups.push({ label, items: [tx] });
            else last.items.push(tx);
          }

          const txTypeStyle = (type) => {
            if (type === "withdrawal")
              return { bg: "#fff1f2", color: "#be123c", symbol: "↑" };
            if (type === "deposit")
              return { bg: "#f0fdf4", color: "#15803d", symbol: "↓" };
            if (type === "transfer")
              return { bg: "#eff6ff", color: "#1d4ed8", symbol: "⇆" };
            return { bg: "#f9fafb", color: "#6b7280", symbol: "·" };
          };

          return (
            <div className="tx-feed">
              {txGroups.map((group) => (
                <div key={group.label} className="tx-feed__group">
                  <div className="tx-feed__date-row">
                    <span className="tx-feed__date-label">{group.label}</span>
                    <span className="tx-feed__date-line" />
                  </div>
                  {group.items.map((tx) => {
                    const neg = isTransactionNegative(tx);
                    const ts = txTypeStyle(tx.type);
                    const isAgent = tx.clientType === "ai_agent";
                    return (
                      <div
                        key={tx.id}
                        className="tx-row"
                        style={tx._demo ? { opacity: 0.5 } : {}}
                      >
                        <div
                          className="tx-row__icon"
                          style={{ background: ts.bg, color: ts.color }}
                        >
                          {ts.symbol}
                        </div>
                        <div className="tx-row__body">
                          <div className="tx-row__desc">
                            {tx.description || tx.type}
                          </div>
                          <div className="tx-row__meta">
                            <span className="tx-row__account">
                              {tx.accountInfo || "Unknown"}
                            </span>
                            <span className="tx-row__sep">·</span>
                            <span className="tx-row__time">
                              {format(new Date(tx.createdAt), "HH:mm")}
                            </span>
                            {tx.performedBy && tx.performedBy !== "Unknown" && (
                              <>
                                <span className="tx-row__sep">·</span>
                                <span className="tx-row__time">
                                  {tx.performedBy}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="tx-row__right">
                          <div
                            className={`tx-row__amount ${neg ? "tx-row__amount--neg" : "tx-row__amount--pos"}`}
                          >
                            {neg ? "−" : "+"}
                            {fmt(tx.amount)}
                          </div>
                          {isAgent && (
                            <div className="tx-row__badges">
                              <span className="tx-badge tx-badge--agent">
                                AI
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      )}
    </>
  );


  // ── Global modals ─────────────────────────────────────────────────────────
  // Rendered in BOTH the clinical-split branch and the main return so that
  // Reset Demo, HITL consent, and step-up overlays are always reachable.
  const renderGlobalModals = () => (
    <>
      {consentChallengeId?.id && (
        <TransactionConsentModal
          open
          challengeId={consentChallengeId.id}
          preloadedSnapshot={consentChallengeId.snapshot}
          user={user}
          autoConfirm={agentHitlAutoConfirm}
          onClose={() => {
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            agentHitlDetailRef.current = null;
          }}
          onTransactionSuccess={async (msg) => {
            const agentDetail = agentHitlDetailRef.current;
            const challenge = consentChallengeId;
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            agentHitlDetailRef.current = null;

            if (agentDetail) {
              // Agent-triggered: agent handles re-fire via banking-agent-hitl-confirmed event
              notifySuccess(msg);
              void fetchUserData(true);
              window.dispatchEvent(
                new CustomEvent("banking-agent-hitl-confirmed", {
                  detail: { actionId: agentDetail.actionId, successMsg: msg },
                }),
              );
            } else if (challenge?.payload) {
              // Dashboard-triggered: re-fire the transaction with the approved challenge
              try {
                await apiClient.post("/api/transactions", {
                  ...challenge.payload,
                  consentChallengeId: challenge.id,
                });
                if (challenge.payload.type === "transfer") {
                  setTransferForm({
                    toAccountId: "",
                    amount: "",
                    description: "",
                  });
                  setSelectedAccount(null);
                } else if (challenge.payload.type === "deposit") {
                  setDepositForm({ amount: "", description: "" });
                  setDepositAccount(null);
                } else if (challenge.payload.type === "withdrawal") {
                  setWithdrawForm({ amount: "", description: "" });
                  setWithdrawAccount(null);
                }
                notifySuccess("Transaction completed successfully!");
                void fetchUserData(true);
                window.dispatchEvent(
                  new CustomEvent("banking-transaction-completed", {
                    detail: { type: challenge.payload.type },
                  }),
                );
              } catch (err) {
                const rfc9470StepUp = extractRfc9470Challenge(err.response);
                if (err.response?.status === 428) {
                  beginStepUp(err.response.data);
                } else if (rfc9470StepUp) {
                  beginStepUp(rfc9470StepUp);
                } else {
                  notifyError(
                    err.response?.data?.error_description ||
                      err.response?.data?.error ||
                      "Transaction failed after consent.",
                  );
                }
              }
            } else {
              notifySuccess(msg);
              void fetchUserData(true);
            }
          }}
          onDeclinedConfirmed={() => {
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            notifyInfo(
              "You declined high-value consent. The AI banking assistant is paused — dismiss the decline notice to keep using it.",
            );
          }}
        />
      )}

      <ConfirmModal
        isOpen={showResetModal}
        title="Reset Demo"
        message="Clear all agent history, token chain events, and MCP audit logs? You will be signed out and the theme will reset to default."
        confirmLabel="Reset"
        danger
        onConfirm={async () => {
          setShowResetModal(false);
          try {
            await fetch("/api/admin/reset-demo", {
              method: "POST",
              credentials: "include",
            });
          } catch (_) {}
          // Clear traffic-store cache (onLogout does not know about this key)
          try { localStorage.removeItem("api-traffic-store"); } catch (_) {}
          // Use the App-level logout so userLoggedOut flag is set and the
          // session-check effect fast-paths past the auth endpoints on reload.
          onLogout();
        }}
        onCancel={() => setShowResetModal(false)}
      />

      {/* Email OTP Step-Up Modal */}
      {otpModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => {
            setOtpModalOpen(false);
            setOtpCode("");
            setOtpError("");
            window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
          }}
        >
          <div
            className="otp-step-up-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Verify Your Identity</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => {
                  setOtpModalOpen(false);
                  setOtpCode("");
                  setOtpError("");
                  window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                A 6-digit verification code was sent to{" "}
                <strong>{otpEmail}</strong>. Enter it below to authorise your
                transaction.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ""));
                  setOtpError("");
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    otpCode.length === 6 &&
                    !otpSubmitting
                  )
                    handleVerifyOtp();
                }}
                placeholder="000000"
                autoFocus
                className={`otp-step-up-modal__input${otpError ? " otp-step-up-modal__input--error" : ""}`}
              />
              {otpError && (
                <p className="otp-step-up-modal__error">{otpError}</p>
              )}
              {mfaChallengeExpired && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p className="otp-step-up-modal__error">
                    MFA session expired.
                  </p>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => {
                      setMfaChallengeExpired(false);
                      setOtpModalOpen(false);
                      handleInitiateOtpRef.current &&
                        handleInitiateOtpRef.current();
                    }}
                  >
                    Try Again
                  </button>
                </div>
              )}
              <p className="otp-step-up-modal__hint">
                Code expires in 5 minutes.
              </p>
              <div className="otp-step-up-modal__actions">
                <button
                  type="button"
                  className="otp-step-up-modal__btn-primary"
                  disabled={otpCode.length !== 6 || otpSubmitting}
                  onClick={handleVerifyOtp}
                >
                  {otpSubmitting ? "Verifying…" : "Verify"}
                </button>
                <button
                  type="button"
                  className="otp-step-up-modal__btn-ghost"
                  onClick={() => handleInitiateOtp()}
                >
                  Resend code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOTP Step-Up Modal */}
      {totpModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => setTotpModalOpen(false)}
        >
          <div
            className="otp-step-up-modal otp-step-up-modal--totp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Verify Your Identity</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => {
                  setTotpModalOpen(false);
                  window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Enter the 6-digit code from your{" "}
                <strong>authenticator app</strong>.
              </p>
              <input
                className={`otp-step-up-modal__input${totpError ? " otp-step-up-modal__input--error" : ""}`}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value.replace(/\D/g, ""));
                  setTotpError(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    totpCode.length === 6 &&
                    !totpSubmitting
                  )
                    handleTotpSubmit();
                }}
              />
              {totpError && (
                <p className="otp-step-up-modal__error">{totpError}</p>
              )}
              <p className="otp-step-up-modal__hint">
                Open your authenticator app and enter the current 6-digit code.
              </p>
            </div>
            <div className="otp-step-up-modal__actions">
              <button
                className="otp-step-up-modal__btn-ghost"
                onClick={() => setTotpModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="otp-step-up-modal__btn-primary"
                disabled={totpCode.length !== 6 || totpSubmitting}
                onClick={handleTotpSubmit}
              >
                {totpSubmitting ? "Verifying…" : "Verify"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Picker — shown when multiple MFA devices are enrolled */}
      {devicePickerOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => setDevicePickerOpen(false)}
        >
          <div
            className="otp-step-up-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">
                Choose Verification Method
              </h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => setDevicePickerOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Select how you want to verify your identity:
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginTop: "8px",
                }}
              >
                {devicePickerDevices.map((device) => (
                  <button
                    key={device.id}
                    className="otp-step-up-modal__btn-ghost"
                    style={{ textAlign: "left" }}
                    onClick={() => handleDevicePick(device)}
                  >
                    {device.type === "EMAIL"
                      ? "Email code"
                      : device.type === "SMS"
                        ? "SMS code"
                        : device.type === "TOTP"
                          ? "Authenticator app"
                          : device.type === "MOBILE"
                            ? "Push notification"
                            : "Passkey / FIDO2"}
                    {device.nickname ? ` (${device.nickname})` : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Push Notification Waiting Panel */}
      {pushModalOpen && (
        <div className="otp-step-up-overlay">
          <div className="otp-step-up-modal otp-step-up-modal--push">
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Check Your Device</h3>
            </div>
            <div
              className="otp-step-up-modal__body"
              style={{ textAlign: "center", padding: "1rem 0" }}
            >
              <div className="push-waiting-spinner" />
              <p
                className="otp-step-up-modal__lead"
                style={{ marginTop: "1rem" }}
              >
                A push notification was sent to your registered device.
                <br />
                <strong>Tap Approve</strong> in the PingOne app to continue.
              </p>
              <p className="otp-step-up-modal__hint">Waiting for approval…</p>
            </div>
            <div
              className="otp-step-up-modal__actions"
              style={{ justifyContent: "center" }}
            >
              <button
                className="otp-step-up-modal__btn-ghost"
                onClick={() => {
                  setPushPolling(false);
                  setPushModalOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIDO2 Passkey Step-Up */}
      {fido2ModalOpen && (
        <Fido2Challenge
          daId={fido2DaId}
          deviceId={fido2DeviceId}
          onSuccess={() => {
            setFido2ModalOpen(false);
            setStepUpRequired(false);
            notifySuccess(
              agentTriggeredStepUp
                ? "Identity verified — resuming agent request…"
                : "Identity verified — please retry your transaction.",
            );
            if (agentTriggeredStepUp) {
              setAgentTriggeredStepUp(false);
              window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
            }
          }}
          onCancel={() => {
            setFido2ModalOpen(false);
            window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
          }}
          onError={(msg) => {
            setFido2ModalOpen(false);
            notifyError(msg);
          }}
          onRegisterPasskey={() => {
            // No passkey for this site on this device — send the user to the
            // enrollment modal rather than dead-ending the step-up.
            setFido2ModalOpen(false);
            setEnrollError("");
            setEnrollModalOpen(true);
          }}
        />
      )}

      {/* MFA Challenge Expired — Try Again bubble (shown outside modals) */}
      {mfaChallengeExpired &&
        !otpModalOpen &&
        !totpModalOpen &&
        !pushModalOpen &&
        !fido2ModalOpen && (
          <div
            className="otp-step-up-overlay"
            onClick={() => setMfaChallengeExpired(false)}
          >
            <div
              className="otp-step-up-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="otp-step-up-modal__header">
                <h3 className="otp-step-up-modal__title">
                  MFA Session Expired
                </h3>
                <button
                  className="otp-step-up-modal__close"
                  onClick={() => setMfaChallengeExpired(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="otp-step-up-modal__body">
                <p className="otp-step-up-modal__lead">
                  Your MFA session has expired. Click below to start a new
                  challenge.
                </p>
                <div className="otp-step-up-modal__actions">
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-primary"
                    onClick={() => {
                      setMfaChallengeExpired(false);
                      handleInitiateOtpRef.current &&
                        handleInitiateOtpRef.current();
                    }}
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    onClick={() => setMfaChallengeExpired(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* MFA Device Enrollment — no devices enrolled, or none usable here */}
      {enrollModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => {
            if (!enrolling) closeEnrollModal();
          }}
        >
          <div
            className="otp-step-up-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Set Up MFA</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={closeEnrollModal}
                aria-label="Close"
                disabled={enrolling}
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Set up a verification method to continue. Email, SMS, and
                passkeys can each be registered here.
              </p>
              {enrollError && (
                <p className="otp-step-up-modal__error">{enrollError}</p>
              )}

              {smsEnrollStep === "choose" && (
                <div
                  className="otp-step-up-modal__actions"
                  style={{ flexDirection: "column", gap: "0.75rem" }}
                >
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-primary"
                    disabled={enrolling}
                    onClick={handleEnrollEmail}
                    data-testid="enroll-email"
                  >
                    {enrolling ? "Setting up…" : "Set up Email OTP"}
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    disabled={enrolling}
                    onClick={() => {
                      setEnrollError("");
                      setSmsEnrollStep("phone");
                    }}
                    data-testid="enroll-sms"
                  >
                    Set up SMS OTP
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    disabled={enrolling}
                    onClick={handleEnrollFido2}
                    data-testid="enroll-passkey"
                  >
                    {enrolling ? "Setting up…" : "Register a Passkey"}
                  </button>
                </div>
              )}

              {smsEnrollStep === "phone" && (
                <>
                  <label
                    className="otp-step-up-modal__lead"
                    htmlFor="enroll-sms-phone"
                  >
                    Mobile number (E.164 format)
                  </label>
                  <input
                    id="enroll-sms-phone"
                    className="otp-step-up-modal__input"
                    type="tel"
                    placeholder="+15551234567"
                    value={smsEnrollPhone}
                    onChange={(e) => setSmsEnrollPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEnrollSmsInit();
                    }}
                    data-testid="enroll-sms-phone"
                  />
                  <div
                    className="otp-step-up-modal__actions"
                    style={{ flexDirection: "column", gap: "0.75rem" }}
                  >
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-primary"
                      disabled={enrolling}
                      onClick={handleEnrollSmsInit}
                      data-testid="enroll-sms-send"
                    >
                      {enrolling ? "Sending…" : "Send activation code"}
                    </button>
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-ghost"
                      disabled={enrolling}
                      onClick={() => {
                        setEnrollError("");
                        setSmsEnrollStep("choose");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                </>
              )}

              {smsEnrollStep === "otp" && (
                <>
                  <label
                    className="otp-step-up-modal__lead"
                    htmlFor="enroll-sms-otp"
                  >
                    Enter the 6-digit code we texted you
                  </label>
                  <input
                    id="enroll-sms-otp"
                    className="otp-step-up-modal__input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={smsEnrollOtp}
                    onChange={(e) =>
                      setSmsEnrollOtp(e.target.value.replace(/\D/g, ""))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEnrollSmsComplete();
                    }}
                    data-testid="enroll-sms-otp"
                  />
                  <div
                    className="otp-step-up-modal__actions"
                    style={{ flexDirection: "column", gap: "0.75rem" }}
                  >
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-primary"
                      disabled={enrolling}
                      onClick={handleEnrollSmsComplete}
                      data-testid="enroll-sms-activate"
                    >
                      {enrolling ? "Activating…" : "Activate SMS"}
                    </button>
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-ghost"
                      disabled={enrolling}
                      onClick={() => {
                        setEnrollError("");
                        setSmsEnrollStep("phone");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Session Token Modal */}
      {showTokenModal && (
        <FloatingPanel
          title="User Session Token"
          onClose={() => setShowTokenModal(false)}
          defaultWidth={820}
          defaultHeight={Math.min(window.innerHeight - 80, 940)}
          defaultX={Math.max(0, Math.round((window.innerWidth - 820) / 2))}
          defaultY={60}
          minWidth={360}
          minHeight={200}
        >
          <div style={{ overflowY: "auto", height: "100%" }}>
            <OAuthTokenDisplayPage />
          </div>
        </FloatingPanel>
      )}
    </>
  );

  // ff_agent_clinical_split — render the 2B-refined clinical split instead of
  // the legacy split3 chrome. The clinical layout owns the whole dashboard
  // area when on; legacy chrome remains unchanged when off.
  //
  // IMPORTANT: modals (ConfirmModal, TransactionConsentModal, OTP/step-up) are
  // hoisted into the clinical branch via renderGlobalModals() so their state
  // setters remain reachable even when this early return fires.
  if (clinicalSplitEnabled) {
    return (
      <>
        <div className="customer-skin-p1 user-dashboard user-dashboard--clinical-split agent-clinical-host">
          <AgentClinicalHost />
        </div>
        {renderGlobalModals()}
      </>
    );
  }

  if (loading) {
    return (
      <div className="main-content--auth-loading">
        <div className="auth-loading-card">
          <div className="auth-loading-dots">
            <span className="auth-loading-dot" />
            <span className="auth-loading-dot" />
            <span className="auth-loading-dot" />
          </div>
          <div className="auth-loading-title">Loading your dashboard</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`customer-skin-p1 user-dashboard user-dashboard--2026${
        agentPlacement === "middle"
          ? " user-dashboard--split3"
          : ""
      }${agentPlacement === "none" ? " user-dashboard--float-fab-left" : ""} refined-customer-surface`}
      data-refined-surface="customer"
      data-rd-v2
    >
      {/* ── Token | (split: agent + banking columns) | classic: banking + float reserve ── */}
      {agentPlacement === "middle" ? (
        <div
          // ud-focus-mode overrides the split grid to a single column: the agent
          // takes the full width and the chain lies underneath it, which is the
          // whole point of Focus Mode. The grid classes stay so the collapsed
          // and banking-column states keep their existing rules.
          className={`dashboard-content ud-body ud-body--2026 ud-focus-mode ${splitGridClass(
            showBankingInMiddle,
          )}${middleAgentOpen ? "" : " ud-middle-collapsed"}`}
          style={{ '--ud-agent-col-width': `${agentColWidth}px` }}
        >
          {/* Full width above both columns, where the mock puts it. Inside the
              agent column it had ~760px for ~14 controls and wrapped onto five
              rows, taking 161px straight out of the transcript. The controls
              already carry the mock's grouping (ba-hg groups, labels, dividers);
              they were being asked to fit half the width they were built for. */}
          <div className="ud-dashboard-config-strip" ref={toolbarHostRef} />
          <section
            className="ud-agent-column"
            ref={agentColumnRef}
            aria-label="AI banking assistant"
            data-testid="dashboard-agent-column"
            {...(!showBankingInMiddle && {
              id: "main-dashboard-content",
              tabIndex: -1,
            })}
          >
            <div className="embedded-banking-agent ud-dashboard-inline-agent">
              {/* Host stays mounted so the BankingAgent portal target's ref always
                  attaches. Guests have no portaled agent here (App.js gates the
                  inline mount on a signed-in user), so the blank host shows this
                  login prompt instead of empty white space. */}
              <div
                className="ud-dashboard-inline-agent-host"
                ref={middleHostRefCb}
              />
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag; height handle remains keyboard-reachable. */}
            <div
              className="ud-agent-column__resize-handle"
              onMouseDown={onAgentWidthResizeMouseDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Drag to resize assistant width"
              data-testid="dashboard-agent-column-resize"
            />
            <button
              type="button"
              className="ud-middle-resize-handle"
              onMouseDown={onMiddleResizeMouseDown}
              aria-label="Drag to resize assistant height"
            >
              <span
                className="ud-middle-resize-handle__grip"
                aria-hidden="true"
              >
                <span className="ud-middle-resize-handle__bar" />
              </span>
              <span className="ud-middle-resize-handle__label">
                Resize height
              </span>
            </button>
          </section>

          {/* No banking column in Focus Mode. Stacking it between the agent and
              the chain puts balances in the middle of the evidence — and the
              balances are the proof, not the subject. The 'bottom' and 'none'
              branches below still render it. */}


          {/* Collapsed middle: agent column is CSS-hidden (host stays mounted so
              the portaled BankingAgent keeps its chat state); surface the same
              float-reserve affordance the else-branch shows so the collapsed
              visual matches today. */}
          {!middleAgentOpen && (
            <aside className="ud-float-reserve" aria-hidden="true">
              <div className="ud-float-reserve__card">
                <span className="ud-float-reserve__label">
                  Floating assistant
                </span>
                <p className="ud-float-reserve__hint">
                  The corner FAB and panel stay in this zone so your balances
                  and token flow stay readable.
                </p>
              </div>
            </aside>
          )}

          {/* Focus Mode: the chain lies along the bottom, full width, so a click
              raises a sheet across the whole width instead of confining the
              evidence to the narrowest column. TokenChainFilmstrip is a sibling
              over the same store — the shared TokenChainTraceRail, which mounts
              on ~20 other surfaces, is not modified. The 'bottom' and 'none'
              branches below keep the vertical rail unchanged.

              Gated on showFilmstrip like the float-mode copy below. This render
              was unconditional, so in Focus Mode — the default layout — the
              More › Movie reel switch flipped state, persisted it, and changed
              nothing on screen: it governed only the float branch, which does
              not mount in this layout. The reel was never lost, the control
              was simply wired to the copy you were not looking at. */}
          {showFilmstrip && <TokenChainFilmstrip />}
        </div>
      ) : (
        // V2 bottom-dock layout: 2-col grid (main + rail) + fixed dock + under-the-hood panels
        // OR float mode when agentPlacement === 'none': 2-column layout — token rail + content; FAB from App.js
        agentPlacement === "bottom" ? (
          <>
            <div className="rd2-page-grid">
              <main
                className="rd2-main-col"
                id="main-dashboard-content"
                tabIndex={-1}
              >
                {isRetailDashboard ? (
                  <RetailDashboard data={pageMockData} />
                ) : (
                  renderBankingMain()
                )}
              </main>
              <aside className="rd2-right-rail" aria-label="Agent and token chain">
                <AgentIdentityCard />
                <div className="rd2-token-card">
                  <ExchangeModeToggle hideTable />
                  <TokenChainTraceRail />
                </div>
              </aside>
            </div>
            <EmbeddedAgentDock
              user={user}
              agentPlacement={agentPlacement}
            />
          </>
        ) : (
          // Float mode ('none'): 2-column layout — token rail + content; FAB is a
          // fixed overlay from App.js
          <div className="ud-body-outer">
            <div className="dashboard-content ud-body ud-body--2026 ud-body--floating ud-body--float-mode">
              <main
                className="ud-center"
                id="main-dashboard-content"
                tabIndex={-1}
              >
                {isRetailDashboard ? (
                  <RetailDashboard data={pageMockData} />
                ) : (
                  renderBankingMain()
                )}
              </main>

              <DashboardTokenRail>
                <ExchangeModeToggle hideTable />
                <TokenChainTraceRail />
                <SimpleStepperBar />
                <div className="ud-float-chain-actions">
                  <button
                    type="button"
                    className="ud-float-chain-btn"
                    title="Real-time token topology — RFC 8693 delegation chain"
                    onClick={() => window.dispatchEvent(new CustomEvent('token-topology-open'))}
                  >
                    Topology
                  </button>
                  <button
                    type="button"
                    className="ud-float-chain-btn"
                    title="Floating token chain — RFC 8693 delegation trace rail"
                    onClick={() => window.dispatchEvent(new CustomEvent('floating-token-chain-open'))}
                  >
                    Token chain
                  </button>
                  <button
                    type="button"
                    className="ud-float-chain-btn"
                    title="Open 15-Min Security Demo Script"
                    onClick={() => window.dispatchEvent(new CustomEvent('demo-script-toggle'))}
                  >
                    Script
                  </button>
                </div>
              </DashboardTokenRail>

              {/* Float mode: no reserve column — the FAB is a fixed overlay from App.js. */}
            </div>
            {/* Response mirror — shows last agent reply on main page when toggled on */}
            <AgentResponseMirror />
            {/* Movie reel filmstrip — toggled via More › Movie reel in the agent header */}
            {showFilmstrip && (
              <div className="tcfs-float-host">
                <TokenChainFilmstrip />
              </div>
            )}
          </div>
        )
      )}

      {/* Middle-layout open FAB — shown when middle placement hasn't been expanded yet.
          App.js global float is suppressed for middle so there is exactly one FAB. */}
      {agentPlacement === "middle" && !middleAgentOpen && (
        <button
          type="button"
          className="banking-agent-fab"
          onClick={() => setMiddleAgentOpen(true)}
          aria-label="Open AI banking assistant in middle column"
          title="Open AI Agent"
        >
          <span className="banking-agent-fab-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4 10h3v7H4zM10.5 10h3v7h-3zM2 19h20v3H2zM17 10h3v7h-3zM12 1 2 6v2h20V6z" />
            </svg>
          </span>
          <span className="banking-agent-fab-label">AI Agent</span>
        </button>
      )}

      {renderGlobalModals()}
    </div>
  );
};

export default UserDashboardPing2026;
