import axios from "axios";
import { format } from "date-fns";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import SignInBrand from "./SignInBrand";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useCurrentUserTokenEvent } from "../hooks/useCurrentUserTokenEvent";
import apiClient from "../services/apiClient";
import { getCachedJson } from "../services/cachedStatusService";
import { spinner } from "../services/spinnerService";
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
  toast,
} from "../utils/appToast";
import { navigateToCustomerOAuthLogin, SESSION_REAUTH_EVENT } from "../utils/authUi";
import { normalizePhoneE164, pickPreferredDevice, isPasskeySupported } from "../utils/mfaEnrollment";
import { DEFAULT_COUNTRY_CODE, composePhone } from "../utils/countryCodes";
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
import {
  clampDetailPaneHeight,
} from "../utils/detailPaneResize";
import { extractRfc9470Challenge } from "../utils/wwwAuthenticate";
import DashboardTokenRail from "./DashboardTokenRail";
import TokenChainFilmstrip from "./TokenChainFilmstrip";
import ReelDock from "./ReelDock";
import SequenceReelDiagram from "./SequenceReelDiagram";
import TokenTopologyPanel from "./TokenTopologyPanel";
import ServerTopologyStory from "./ServerTopologyStory";
import StepDetailPanel from "./StepDetailPanel";
import CollapsibleStepDetail from "./CollapsibleStepDetail";
import SimpleStepperBar from "./SimpleStepperBar";
import AgentResponseMirror from "./AgentResponseMirror";
import ExchangeModeToggle from "./ExchangeModeToggle";
import TokenChainTraceRail from "./TokenChainTraceRail";
import { useSessionToken } from '../context/SessionTokenContext';
import DelegatedAccessPanel from "./DelegatedAccessPanel";
import WebMcpPanel from "./WebMcpPanel";
import "./UserDashboard.css";
import "./customerSkinPing2026.css";
// Ping UI Standard frame for this page. Every rule in it sits under .udp-page.
import "./UserDashboardPing2026.pingUi.css";
import PageHeader from "./common/PageHeader";
import DashboardBankingMain from "./DashboardBankingMain";
import DashboardClinicalSplit from "./DashboardClinicalSplit";
import { DashboardExplainers, FloatChainActions, MiddleAgentFab, MiddleResizeHandle, SimpleStepperInline } from "./DashboardFrameParts";
import DashboardGlobalModals from "./DashboardGlobalModals";
import DashboardStepUpToast from "./DashboardStepUpToast";
import { DetailPaneResizeHandle, RunTraceCard } from "./DashboardTracePanels";
import { SimBanner, StatusChip } from "./pingUi";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { dashboardModeText, chatStatusChip } from "./dashboardFrameStatus";
import { useVertical } from "../vertical/useVertical";
import RetailDashboard from "./RetailDashboard";
import AuthLoadingScreen from "./shared/AuthLoadingScreen";

/**
 * True when the server answered from its idempotency ledger rather than by
 * performing the operation again — i.e. no money moved on this request.
 */
const wasReplayed = (response) =>
  response?.headers?.["idempotency-replayed"] === "true";

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
const DETAIL_PANE_HEIGHT_KEY = "dashboard_detail_pane_height_px";
const DETAIL_PANE_DEFAULT_HEIGHT = 420;

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

function readStoredDetailPaneHeight() {
  try {
    const n = parseInt(localStorage.getItem(DETAIL_PANE_HEIGHT_KEY) || "", 10);
    if (Number.isFinite(n)) return clampDetailPaneHeight(n, window.innerHeight);
  } catch {
    /* ignore */
  }
  return clampDetailPaneHeight(DETAIL_PANE_DEFAULT_HEIGHT, window.innerHeight);
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

  const [movieReelSurface, setMovieReelSurface] = useState(() => {
    try {
      const saved = localStorage.getItem("ba_movie_reel_surface");
      if (["none", "embedded", "popout", "both"].includes(saved)) return saved;
      return localStorage.getItem("ba_show_filmstrip") === "0" ? "none" : "embedded";
    } catch {
      return "embedded";
    }
  });
  const showFilmstrip = movieReelSurface === "embedded" || movieReelSurface === "both";
  const showFilmstripPopout = movieReelSurface === "popout" || movieReelSurface === "both";
  useEffect(() => {
    const handler = (e) => {
      const surface = e.detail?.surface || (e.detail?.on ? "embedded" : "none");
      setMovieReelSurface(surface);
    };
    window.addEventListener("agent-filmstrip-toggle", handler);
    return () => window.removeEventListener("agent-filmstrip-toggle", handler);
  }, []);

  // Quick Config "Simple step" surface — the compact table can stay embedded
  // in the dashboard rail while its draggable panel is independently opened.
  const [showSimpleStepper, setShowSimpleStepper] = useState(() => {
    try {
      const surface = localStorage.getItem("ba_simple_stepper_surface");
      return surface === "embedded" || surface === "both"
        || (surface == null && localStorage.getItem("ba_show_simple_stepper") === "1");
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const handler = (e) => setShowSimpleStepper(!!e.detail?.on);
    window.addEventListener("agent-simple-stepper-toggle", handler);
    return () => window.removeEventListener("agent-simple-stepper-toggle", handler);
  }, []);

  // Quick Config "Sequence view" — swaps the reel for a live lifeline
  // sequence diagram of the same trace data. Persisted to localStorage
  // so the user's view choice survives page refresh.
  const [showSequenceDiagram, setShowSequenceDiagram] = useState(() => {
    try {
      return localStorage.getItem("dashboard-view-mode") === "sequence";
    } catch {
      return false;
    }
  });
  const [showTokenTopology, setShowTokenTopology] = useState(false);
  useEffect(() => {
    const handler = (e) => setShowTokenTopology(!!e.detail?.on);
    window.addEventListener("agent-token-topology-toggle", handler);
    return () => window.removeEventListener("agent-token-topology-toggle", handler);
  }, []);
  const [showServerTopology, setShowServerTopology] = useState(() => {
    try {
      const surface = localStorage.getItem("ba_server_topology_surface");
      return surface === "embedded" || surface === "both";
    } catch { return false; }
  });
  useEffect(() => {
    const handler = (event) => setShowServerTopology(!!event.detail?.on);
    window.addEventListener("agent-server-topology-toggle", handler);
    return () => window.removeEventListener("agent-server-topology-toggle", handler);
  }, []);
  // The step a user clicked on in the diagram, rendered below it via
  // StepDetailPanel — the same narrative/RFC/request-response detail the
  // reel already shows for this exact step shape. Cleared on toggle-off so
  // switching back to the reel doesn't leave a stale panel showing.
  const [selectedSeqStep, setSelectedSeqStep] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const on = !!e.detail?.on;
      setShowSequenceDiagram(on);
      if (!on) setSelectedSeqStep(null);
    };
    window.addEventListener("agent-sequence-diagram-toggle", handler);
    return () => window.removeEventListener("agent-sequence-diagram-toggle", handler);
  }, []);

  // Persist view mode preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("dashboard-view-mode", showSequenceDiagram ? "sequence" : "reel");
    } catch {
      /* ignore */
    }
  }, [showSequenceDiagram]);

  // Quick Config "Slow mode" — narrows the agent column so the sequence
  // diagram gets the width back while narrating a slow-paced reveal. Persisted
  // so presentation mode preference survives refresh.
  const [slowMode, setSlowMode] = useState(() => {
    try {
      return localStorage.getItem("dashboard-slow-mode") === "true";
    } catch {
      return false;
    }
  });
  const [followFlow, setFollowFlow] = useState(() => {
    try {
      return localStorage.getItem("dashboard-sequence-follow-flow") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const handler = (e) => setFollowFlow(e.detail?.on !== false);
    window.addEventListener("agent-sequence-follow-flow-toggle", handler);
    return () => window.removeEventListener("agent-sequence-follow-flow-toggle", handler);
  }, []);
  useEffect(() => {
    const handler = (e) => setSlowMode(!!e.detail?.on);
    window.addEventListener("agent-slow-mode-toggle", handler);
    return () => window.removeEventListener("agent-slow-mode-toggle", handler);
  }, []);

  // Persist slow mode preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("dashboard-slow-mode", String(slowMode));
    } catch {
      /* ignore */
    }
  }, [slowMode]);

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
  const [detailPaneHeight, setDetailPaneHeight] = useState(() =>
    typeof window !== "undefined"
      ? readStoredDetailPaneHeight()
      : DETAIL_PANE_DEFAULT_HEIGHT,
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
  // The run already in the trace store when this page mounted; the Run trace chip calls it an earlier run.
  const [traceBaselineRunId] = useState(() => tokenChainTraceStore.getState().trace?.runId ?? null);
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
  // Which money action is in flight, so its button can refuse a second click.
  const [busyAction, setBusyAction] = useState(null);
  // Set when the server answered from its idempotency ledger rather than by
  // moving money again — the visible proof that the replay was a no-op.
  const [replayNotice, setReplayNotice] = useState(null);
  // One key per SUBMISSION, not per request: a retry has to carry the same key
  // as the attempt it is retrying, or the server sees an unrelated transfer and
  // executes it. Cleared only once the submission settles.
  const idempotencyKeys = useRef({});
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
  const [smsCountryCode, setSmsCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [smsEnrollOtp, setSmsEnrollOtp] = useState("");
  const [smsEnrollDeviceId, setSmsEnrollDeviceId] = useState(null);
  const autoInitiateTimerRef = useRef(null); // [t1, t2, t3] setTimeout IDs
  const handleCibaStepUpRef = useRef(null); // stays current — avoids stale closure
  // Last money movement attempted. A CIBA approval is bound to the exact
  // transaction (type, amount, accounts), so the step-up must send it back.
  const lastMoneyMovementRef = useRef(null);
  const handleInitiateOtpRef = useRef(null); // stays current — avoids stale closure
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
          // The app shell already confirmed this identity. Let the protected
          // data request decide whether its token is still usable.
          if (propUser) sessionUser = propUser;
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
        if (!silent) {
          setLoading(false);
          // Clears the "Loading customer dashboard…" hold that AdminSideNav's
          // Agent/Customer-View links set before navigating here — a fire-and-
          // forget spinner.show() with no other hide() call, previously left
          // to a 60s stuck-timeout that repeat clicks could keep postponing.
          spinner.hide();
        }
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

  useEffect(() => {
    try {
      localStorage.setItem(DETAIL_PANE_HEIGHT_KEY, String(Math.round(detailPaneHeight)));
    } catch {
      /* ignore */
    }
  }, [detailPaneHeight]);

  useEffect(() => {
    const onResize = () => {
      setDetailPaneHeight((height) => clampDetailPaneHeight(height, window.innerHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  /**
   * Focus Mode: drag the agent/spotlight column split. agentFrac is the agent
   * track's fr value against the fixed 1fr spotlight track (1 = half width,
   * the default). Dragging right raises the fr, widening the agent column.
   */
  const [agentFrac, setAgentFrac] = useState(() => {
    try {
      const n = parseFloat(
        localStorage.getItem("ud_focus_agent_frac") || "",
        10,
      );
      if (Number.isFinite(n)) {
        return Math.min(4, Math.max(0.25, n));
      }
    } catch {
      /* ignore */
    }
    return 1;
  });

  useEffect(() => {
    if (agentPlacement !== "middle") return;
    try {
      localStorage.setItem("ud_focus_agent_frac", String(agentFrac));
    } catch {
      /* ignore */
    }
  }, [agentFrac, agentPlacement]);

  const onFocusAgentResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const gridEl = e.currentTarget.parentElement;
      if (!gridEl) return;
      const totalPx = gridEl.getBoundingClientRect().width;
      const startX = e.clientX;
      const startFrac = agentFrac;
      const onMove = (ev) => {
        setAgentFrac(
          Math.min(4, Math.max(0.25, startFrac + (ev.clientX - startX) / totalPx)),
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
    [agentFrac],
  );

  /** Focus Mode: drag the token chain (bottom section) height. */
  const [focusChainHeight, setFocusChainHeight] = useState(() => {
    try {
      const n = parseInt(
        localStorage.getItem("ud_focus_chain_height_px") || "",
        10,
      );
      if (Number.isFinite(n)) return Math.min(720, Math.max(60, n));
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    if (agentPlacement !== "middle" || focusChainHeight == null) return;
    try {
      localStorage.setItem("ud_focus_chain_height_px", String(focusChainHeight));
    } catch {
      /* ignore */
    }
  }, [focusChainHeight, agentPlacement]);

  const onFocusChainResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = focusChainHeight ?? 240;
      const onMove = (ev) => {
        // Handle sits ABOVE the chain: dragging up grows the chain (the
        // divider moves up, revealing more of the panel below it).
        setFocusChainHeight(
          Math.min(720, Math.max(60, startH - (ev.clientY - startY))),
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
    [focusChainHeight],
  );

  const onDetailPaneResizeMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = detailPaneHeight;
      const onMove = (event) => {
        setDetailPaneHeight(
          clampDetailPaneHeight(startHeight - (event.clientY - startY), window.innerHeight),
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
    [detailPaneHeight],
  );

  const onDetailPaneResizeKeyDown = useCallback((e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? 24 : -24;
    setDetailPaneHeight((height) => clampDetailPaneHeight(height + delta, window.innerHeight));
  }, []);

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
    if (!user?.id && !user?.email) {
      notifyError("Cannot initiate CIBA: not signed in.");
      return;
    }
    try {
      const tx = lastMoneyMovementRef.current;
      const txBody = tx?.body || {};
      // No login_hint: the server uses the signed-in user's PingOne ID, so the approval
      // can only be for this user (an email can match another account).
      const { data } = await axios.post("/api/auth/ciba/initiate", {
        binding_message: "Approve",
        scope: "openid profile",
        acr_values: cibaAcr,
        // Bind the approval to this exact transaction (see routes/ciba.js).
        ...(tx
          ? {
              transaction_type: tx.action,
              amount: Number(txBody.amount),
              from_account_id: txBody.fromAccountId,
              to_account_id: txBody.toAccountId,
            }
          : {}),
      });
      setCibaAuthReqId(data.auth_req_id);
      setCibaStatus("pending");
    } catch (err) {
      notifyError(
        "CIBA initiation failed: " +
          (err.response?.data?.message || err.message),
      );
    }
  }, [user?.id, user?.email, cibaAcr]);

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
      // Route by device type — single device: auto-route; multiple: prefer an
      // enrolled passkey (if this browser can use it), else show picker.
      if (devices.length > 1) {
        const preferred = isPasskeySupported() ? pickPreferredDevice(devices) : null;
        if (preferred) {
          handleFido2Challenge(data.daId, preferred);
          return;
        }
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
    const phone = normalizePhoneE164(composePhone(smsCountryCode, smsEnrollPhone));
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
      <DashboardStepUpToast
        stepUpChallengeRaw={stepUpChallengeRaw}
        stepUpMethod={stepUpMethod}
        cibaStatus={cibaStatus}
        agentTriggeredStepUp={agentTriggeredStepUp}
        agentCountdown={agentCountdown}
        cancelAutoInitiate={cancelAutoInitiate}
        handleCibaStepUp={handleCibaStepUp}
        onRetryCiba={() => {
          setCibaStatus("idle");
          setCibaAuthReqId(null);
        }}
        onVerifyEmail={handleInitiateOtpRef.current || handleInitiateOtp}
        dismissStepUp={dismissStepUp}
      />
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

  // Recent-transactions feed: sort + Today/Yesterday/date-bucket grouping.
  // Depends only on `transactions` — memoized so it doesn't re-run on every
  // unrelated re-render (e.g. typing in the transfer amount field).
  const recentTxGroups = useMemo(() => {
    const sorted = [...transactions]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(todayStart.getDate() - 1);

    const groups = [];
    for (const tx of sorted) {
      const dStart = new Date(tx.createdAt);
      dStart.setHours(0, 0, 0, 0);
      const label =
        dStart >= todayStart
          ? "Today"
          : dStart >= yesterdayStart
            ? "Yesterday"
            : format(dStart, "EEE, MMM d");
      const last = groups[groups.length - 1];
      if (!last || last.label !== label) groups.push({ label, items: [tx] });
      else last.items.push(tx);
    }
    return groups;
  }, [transactions]);

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


  /**
   * POST a money movement exactly once per submission.
   *
   * Two guards, because they catch different things: `busyAction` stops the
   * second click ever leaving the browser, and the Idempotency-Key stops a
   * request that DID leave — a retry after a timeout, a resubmitted form — from
   * moving funds twice. The button alone can't help once the request is in
   * flight, and the key alone can't stop a double click reaching the server.
   *
   * Returns null when the click was swallowed as a duplicate, so callers skip
   * their success path.
   */
  const postMoneyMovement = async (action, body) => {
    if (busyAction) return null;
    setBusyAction(action);
    setReplayNotice(null);
    lastMoneyMovementRef.current = { action, body };

    if (!idempotencyKeys.current[action]) {
      idempotencyKeys.current[action] = crypto.randomUUID();
    }

    try {
      const response = await apiClient.post("/api/transactions", body, {
        headers: { "Idempotency-Key": idempotencyKeys.current[action] },
      });
      // Settled: the next submission is a genuinely new operation and must not
      // reuse this key, or it would be answered from the ledger and never run.
      delete idempotencyKeys.current[action];
      if (wasReplayed(response)) {
        setReplayNotice(
          "Replayed — the original request was returned. No second transaction was created.",
        );
      }
      return response;
    } finally {
      // Deliberately NOT clearing the key on failure: that attempt is exactly
      // what a retry needs to be idempotent against.
      setBusyAction(null);
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
      const sent = await postMoneyMovement("transfer", {
        fromAccountId: selectedAccount.id,
        toAccountId: transferForm.toAccountId,
        amount: parseFloat(transferForm.amount),
        type: "transfer",
        description: transferForm.description || "Transfer between accounts",
        userId: user.id,
      });
      if (!sent) return;

      // Reset form and refresh data
      setTransferForm({ toAccountId: "", amount: "", description: "" });
      setSelectedAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "transfer" },
        }),
      );

      // A replay moved no money. Saying "completed successfully" for it would be
      // the exact false confirmation this feature exists to prevent.
      notifySuccess(
        wasReplayed(sent)
          ? "Already processed — the original transfer was returned."
          : "Transfer completed successfully!",
      );
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
      const sent = await postMoneyMovement("deposit", {
        fromAccountId: null,
        toAccountId: depositAccount.id,
        amount: parseFloat(depositForm.amount),
        type: "deposit",
        description: depositForm.description || "Deposit to account",
        userId: user.id,
      });
      if (!sent) return;

      // Reset form and refresh data
      setDepositForm({ amount: "", description: "" });
      setDepositAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "deposit" },
        }),
      );

      notifySuccess(
        wasReplayed(sent)
          ? "Already processed — the original deposit was returned."
          : "Deposit completed successfully!",
      );
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
      const sent = await postMoneyMovement("withdrawal", {
        fromAccountId: withdrawAccount.id,
        toAccountId: null,
        amount: parseFloat(withdrawForm.amount),
        type: "withdrawal",
        description: withdrawForm.description || "Withdrawal from account",
        userId: user.id,
      });
      if (!sent) return;

      // Reset form and refresh data
      setWithdrawForm({ amount: "", description: "" });
      setWithdrawAccount(null);
      await fetchUserData();
      window.dispatchEvent(
        new CustomEvent("banking-transaction-completed", {
          detail: { type: "withdrawal" },
        }),
      );

      notifySuccess(
        wasReplayed(sent)
          ? "Already processed — the original withdrawal was returned."
          : "Withdrawal completed successfully!",
      );
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

  // ── Global modals ─────────────────────────────────────────────────────────
  // Rendered in BOTH the clinical-split branch and the main return so that
  // Reset Demo, HITL consent, and step-up overlays are always reachable.
  const globalModals = (
    <DashboardGlobalModals
      agentHitlAutoConfirm={agentHitlAutoConfirm}
      agentHitlDetailRef={agentHitlDetailRef}
      agentTriggeredStepUp={agentTriggeredStepUp}
      beginStepUp={beginStepUp}
      closeEnrollModal={closeEnrollModal}
      consentChallengeId={consentChallengeId}
      devicePickerDevices={devicePickerDevices}
      devicePickerOpen={devicePickerOpen}
      enrollError={enrollError}
      enrollModalOpen={enrollModalOpen}
      enrolling={enrolling}
      fetchUserData={fetchUserData}
      fido2DaId={fido2DaId}
      fido2DeviceId={fido2DeviceId}
      fido2ModalOpen={fido2ModalOpen}
      handleDevicePick={handleDevicePick}
      handleEnrollEmail={handleEnrollEmail}
      handleEnrollFido2={handleEnrollFido2}
      handleEnrollSmsComplete={handleEnrollSmsComplete}
      handleEnrollSmsInit={handleEnrollSmsInit}
      handleInitiateOtp={handleInitiateOtp}
      handleInitiateOtpRef={handleInitiateOtpRef}
      handleTotpSubmit={handleTotpSubmit}
      handleVerifyOtp={handleVerifyOtp}
      mfaChallengeExpired={mfaChallengeExpired}
      movieReelSurface={movieReelSurface}
      onLogout={onLogout}
      otpCode={otpCode}
      otpEmail={otpEmail}
      otpError={otpError}
      otpModalOpen={otpModalOpen}
      otpSubmitting={otpSubmitting}
      pushModalOpen={pushModalOpen}
      setAgentHitlAutoConfirm={setAgentHitlAutoConfirm}
      setAgentTriggeredStepUp={setAgentTriggeredStepUp}
      setConsentChallengeId={setConsentChallengeId}
      setDepositAccount={setDepositAccount}
      setDepositForm={setDepositForm}
      setDevicePickerOpen={setDevicePickerOpen}
      setEnrollError={setEnrollError}
      setEnrollModalOpen={setEnrollModalOpen}
      setFido2ModalOpen={setFido2ModalOpen}
      setMfaChallengeExpired={setMfaChallengeExpired}
      setMovieReelSurface={setMovieReelSurface}
      setOtpCode={setOtpCode}
      setOtpError={setOtpError}
      setOtpModalOpen={setOtpModalOpen}
      setPushModalOpen={setPushModalOpen}
      setPushPolling={setPushPolling}
      setSelectedAccount={setSelectedAccount}
      setShowResetModal={setShowResetModal}
      setShowTokenModal={setShowTokenModal}
      setSmsCountryCode={setSmsCountryCode}
      setSmsEnrollOtp={setSmsEnrollOtp}
      setSmsEnrollPhone={setSmsEnrollPhone}
      setSmsEnrollStep={setSmsEnrollStep}
      setStepUpRequired={setStepUpRequired}
      setTotpCode={setTotpCode}
      setTotpError={setTotpError}
      setTotpModalOpen={setTotpModalOpen}
      setTransferForm={setTransferForm}
      setWithdrawAccount={setWithdrawAccount}
      setWithdrawForm={setWithdrawForm}
      showFilmstripPopout={showFilmstripPopout}
      showResetModal={showResetModal}
      showTokenModal={showTokenModal}
      smsCountryCode={smsCountryCode}
      smsEnrollOtp={smsEnrollOtp}
      smsEnrollPhone={smsEnrollPhone}
      smsEnrollStep={smsEnrollStep}
      totpCode={totpCode}
      totpError={totpError}
      totpModalOpen={totpModalOpen}
      totpSubmitting={totpSubmitting}
      user={user}
    />
  );

  // The Simple stepper for the two layouts that have no token rail (clinical
  // split and Focus Mode). It was rendered only inside the float layout's rail,
  // so choosing it in Quick Config with the reel off left this area blank.
  const simpleStepperInline = showSimpleStepper && !showSequenceDiagram && !showServerTopology && <SimpleStepperInline />;

  if (clinicalSplitEnabled) {
    return (
      <DashboardClinicalSplit
        detailPaneHeight={detailPaneHeight}
        followFlow={followFlow}
        globalModals={globalModals}
        onDetailPaneResizeKeyDown={onDetailPaneResizeKeyDown}
        onDetailPaneResizeMouseDown={onDetailPaneResizeMouseDown}
        selectedSeqStep={selectedSeqStep}
        setSelectedSeqStep={setSelectedSeqStep}
        setSlowMode={setSlowMode}
        showFilmstrip={showFilmstrip}
        showSequenceDiagram={showSequenceDiagram}
        showServerTopology={showServerTopology}
        showTokenTopology={showTokenTopology}
        simpleStepperInline={simpleStepperInline}
        slowMode={slowMode}
      />
    );
  }

  if (loading) {
    return (
      <div className="main-content--auth-loading">
        <AuthLoadingScreen label="Loading your dashboard…" />
      </div>
    );
  }

  // What this page can actually tell about the mode in use: see dashboardFrameStatus.js.
  const modeText = dashboardModeText(user, accounts);
  const verticalName = pageManifest?.identity?.headerTitle || pageManifest?.identity?.displayName || "Customer";
  const chatStatus = chatStatusChip({ hostPending: !middleHostEl && agentPlacement === "middle", user });

  return (
    <div
      className={`udp-page pu-page customer-skin-p1 user-dashboard user-dashboard--2026${
        agentPlacement === "middle"
          ? " user-dashboard--split3"
          : ""
      }${agentPlacement === "none" ? " user-dashboard--float-fab-left" : ""} refined-customer-surface`}
      data-refined-surface="customer"
      data-rd-v2
    >
      {/* Ping UI Standard frame: mode banner first, then the one h1 in the title band. */}
      <SimBanner data-testid="dashboard-mode-banner">{modeText}</SimBanner>
      <PageHeader
        className="udp-hero"
        eyebrow={verticalName}
        title="Customer dashboard"
        summary="Ask the banking agent, watch each authorization step, and see the evidence behind every answer."
      />
      {/* Brand bar — the same logo + caps + name block the sign-in modal shows,
          at the very top of every dashboard layout. */}
      <SignInBrand />
      {/* Delegated access banner — only renders when this user holds delegations.
          Mounted at the layout top (not inside renderBankingMain) so it shows in
          every agent placement, not just float mode. */}
      <DelegatedAccessPanel />
      {/* ── Token | (split: agent + banking columns) | classic: banking + float reserve ── */}
      {agentPlacement === "middle" ? (
        <div
          // ud-focus-mode overrides the split grid to a single column: the agent
          // takes the full width and the chain lies underneath it, which is the
          // whole point of Focus Mode. The grid classes stay so the collapsed
          // and banking-column states keep their existing rules.
          className={`dashboard-content ud-body ud-body--2026 ud-focus-mode ${splitGridClass(
            showBankingInMiddle,
          )}${middleAgentOpen ? "" : " ud-middle-collapsed"}${showSequenceDiagram ? " ud-sequence-view-active" : ""}${showSequenceDiagram && slowMode ? " ud-slow-mode-active" : ""}${showTokenTopology && !showSequenceDiagram && !showServerTopology ? " ud-token-topology-active" : ""}`}
          style={{
            '--ud-agent-col-width': `${agentColWidth}px`,
            '--ud-focus-agent-frac': `${agentFrac}fr`,            ...(focusChainHeight != null
              ? { '--ud-focus-chain-h': `${focusChainHeight}px` }
              : {}),
          }}
        >
          {/* Full width above both columns, where the mock puts it. Inside the
              agent column it had ~760px for ~14 controls and wrapped onto five
              rows, taking 161px straight out of the transcript. The controls
              already carry the mock's grouping (ba-hg groups, labels, dividers);
              they were being asked to fit half the width they were built for. */}
          <div className="ud-dashboard-config-strip" ref={toolbarHostRef} />
          <section
            className="ud-agent-column udp-card"
            ref={agentColumnRef}
            aria-labelledby="udp-chat-h"
            data-testid="dashboard-agent-column"
            {...(!showBankingInMiddle && {
              id: "main-dashboard-content",
              tabIndex: -1,
            })}
          >
            <div className="udp-card__head">
              <h2 id="udp-chat-h" className="udp-card__title">Banking assistant</h2>
              <StatusChip tone={chatStatus.tone}>{chatStatus.word}</StatusChip>
            </div>
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
              onMouseDown={
                showSequenceDiagram
                  ? onAgentWidthResizeMouseDown
                  : onFocusAgentResizeMouseDown
              }
              role="separator"
              aria-orientation="vertical"
              aria-label="Drag to resize assistant width"
              data-testid="dashboard-agent-column-resize"
            />
            <MiddleResizeHandle onMouseDown={onMiddleResizeMouseDown} />
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
          {showFilmstrip && !showSequenceDiagram && middleAgentOpen && (
            /* Full-width handle between agent/spotlight row and chain row. */
            /* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag. */
            <div
              className="ud-focus-chain-resize"
              onMouseDown={onFocusChainResizeMouseDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Drag to resize token chain height"
              data-testid="dashboard-focus-chain-resize"
            />
          )}
          {showFilmstrip && !showSequenceDiagram && !showServerTopology && <TokenChainFilmstrip />}
          {showTokenTopology && !showSequenceDiagram && !showServerTopology && <TokenTopologyPanel inline />}
          {simpleStepperInline}
          {showServerTopology && <ServerTopologyStory />}
          {showSequenceDiagram && !showServerTopology && (
            <RunTraceCard baselineRunId={traceBaselineRunId}>
              <SequenceReelDiagram
                onSelectStep={setSelectedSeqStep}
                onReset={() => setSelectedSeqStep(null)}
                selectedStepId={selectedSeqStep?.id}
                slowMode={slowMode}
                followFlow={followFlow}
                onToggleSlowMode={() => setSlowMode(!slowMode)}
              />
            </RunTraceCard>
          )}
          {showSequenceDiagram && selectedSeqStep && (
            <>
              <DetailPaneResizeHandle
                height={detailPaneHeight}
                onMouseDown={onDetailPaneResizeMouseDown}
                onKeyDown={onDetailPaneResizeKeyDown}
              />
              <div className="ud-sequence-detail-row" style={{ height: detailPaneHeight }}>
              <CollapsibleStepDetail step={selectedSeqStep} />
              </div>
            </>
          )}
        </div>
      ) : (
        // Float mode ('none'): 2-column layout — token rail + content; FAB is a
        // fixed overlay from App.js.
        //
        // The bottom-dock layout used to sit here as a third branch. The picker
        // stopped offering it ("Phase 4e"), so the only way into it was a value
        // persisted before that — a layout nothing in the UI could enter or
        // leave. AgentUiModeContext now coerces 'bottom' to 'middle', so those
        // browsers land in Focus Mode on their next load.
          <div className="ud-body-outer">
            <div className="dashboard-content ud-body ud-body--2026 ud-body--floating ud-body--float-mode">
              {/* A div, not a second <main>; the shell's <main> is the page's only one. */}
              <div
                className="ud-center"
                id="main-dashboard-content"
                tabIndex={-1}
              >
                {isRetailDashboard ? (
                  <RetailDashboard data={pageMockData} />
                ) : (
                  <DashboardBankingMain
                    accounts={accounts}
                    accountsAnchorRef={accountsAnchorRef}
                    busyAction={busyAction}
                    dashboardLayout={dashboardLayout}
                    depositAccount={depositAccount}
                    depositForm={depositForm}
                    expandedAccounts={expandedAccounts}
                    handleDeposit={handleDeposit}
                    handleScrollToAccounts={handleScrollToAccounts}
                    handleScrollToAssistant={handleScrollToAssistant}
                    handleTransfer={handleTransfer}
                    handleWithdraw={handleWithdraw}
                    isDemoMode={isDemoMode}
                    isTransactionNegative={isTransactionNegative}
                    recentTxGroups={recentTxGroups}
                    replayNotice={replayNotice}
                    selectedAccount={selectedAccount}
                    setDepositAccount={setDepositAccount}
                    setDepositForm={setDepositForm}
                    setSelectedAccount={setSelectedAccount}
                    setTransferForm={setTransferForm}
                    setWithdrawAccount={setWithdrawAccount}
                    setWithdrawForm={setWithdrawForm}
                    toggleAccountProfile={toggleAccountProfile}
                    totalBalance={totalBalance}
                    totalDebt={totalDebt}
                    transactions={transactions}
                    transferForm={transferForm}
                    user={user}
                    withdrawAccount={withdrawAccount}
                    withdrawForm={withdrawForm}
                                          />
                )}
              </div>

              <DashboardTokenRail>
                <ExchangeModeToggle hideTable />
                <TokenChainTraceRail />
                {showSimpleStepper && !showSequenceDiagram && <SimpleStepperBar />}
                <FloatChainActions />
              </DashboardTokenRail>

              {/* Float mode: no reserve column — the FAB is a fixed overlay from App.js. */}
            </div>
            {/* Response mirror — shows last agent reply on main page when toggled on */}
            <AgentResponseMirror />
            {/* Movie reel filmstrip — toggled via More › Movie reel in the agent header */}
            {showFilmstrip && !showSequenceDiagram && !showServerTopology && <ReelDock />}
            {showTokenTopology && !showSequenceDiagram && !showServerTopology && <TokenTopologyPanel inline />}
            {showServerTopology && <ServerTopologyStory />}
          {showSequenceDiagram && !showServerTopology && (
            <RunTraceCard baselineRunId={traceBaselineRunId}>
              <SequenceReelDiagram
                onSelectStep={setSelectedSeqStep}
                onReset={() => setSelectedSeqStep(null)}
                selectedStepId={selectedSeqStep?.id}
                slowMode={slowMode}
                followFlow={followFlow}
                onToggleSlowMode={() => setSlowMode(!slowMode)}
              />
            </RunTraceCard>
          )}
          {showSequenceDiagram && selectedSeqStep && (
            <>
              <DetailPaneResizeHandle
                height={detailPaneHeight}
                onMouseDown={onDetailPaneResizeMouseDown}
                onKeyDown={onDetailPaneResizeKeyDown}
              />
              <div className="ud-sequence-detail-row" style={{ height: detailPaneHeight }}>
              <CollapsibleStepDetail step={selectedSeqStep} />
              </div>
            </>
          )}
          </div>
      )}

      <DashboardExplainers />

      {agentPlacement === "middle" && !middleAgentOpen && (
        <MiddleAgentFab onOpen={() => setMiddleAgentOpen(true)} />
      )}

      {globalModals}
    </div>
  );
};

export default UserDashboardPing2026;
