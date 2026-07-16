import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useIndustryBranding } from "../context/IndustryBrandingContext";
import { useVertical } from "../vertical/useVertical";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useEventStream } from "../context/EventStreamContext";
import TokenChainModal from "./TokenChainModal";
import SimpleStepperBar from './SimpleStepperBar';
import ReasoningPanel from './ReasoningPanel';
import ConversationSummaryPanel from './ConversationSummaryPanel';
import ProofStrip from './ProofStrip';
import { navigateToCustomerOAuthForceLogin, requestSilentReauth } from "../utils/authUi";
import { setAgentAuthorization } from "../services/agentAuthorizationService";
import {
  AGENT_CONSENT_BLOCK_USER_MESSAGE,
  isAgentBlockedByConsentDecline,
  setAgentBlockedByConsentDecline,
} from "../services/agentAccessConsent";
import { agentFlowDiagram } from "../services/agentFlowDiagramService";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { appendTokenEvents } from "../services/apiTrafficStore";
import { fetchNlStatus } from "../services/demoAgentNlService";
import {
  callMcpTool,
  createDeposit,
  createDepositWithConsent,
  createTransfer,
  createTransferWithConsent,
  createWithdrawal,
  createWithdrawalWithConsent,
  getAccountBalance,
  getMyAccounts,
  getMyTransactions,
  refreshOAuthSession,
  sendAgentMessage,
  fetchAgentTools,
  warmupAuthz,
} from "../services/demoAgentService";
import bffAxios from "../services/bffAxios";
import { getCachedStatus } from "../services/cachedStatusService";
import { loadPublicConfig } from "../services/configService";
import { spinner } from "../services/spinnerService";
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  toast,
} from "../utils/appToast";
import { isPublicMarketingAgentPath } from "../utils/embeddedAgentFabVisibility";
import { PURE_LLM_MODES, PURE_LLM_LABELS, MODE_PROVIDER, sourceLabel } from "../config/agentModes";
import AccountDetailsPanel from "./AccountDetailsPanel";
import VerticalResult from "./VerticalResult";
import JsonField from "./shared/JsonField";
import AgentConsentModal from "./AgentConsentModal";
import AgentDemoGuide from "./AgentDemoGuide";
import DemoStepsDropdown from "./DemoStepsDropdown";
import BankingChips, { PINGONE_ADMIN_CHIP_IDS } from "./BankingChips";
import { markUseCaseCompleted } from "../utils/useCaseDemoProgress";
import apiClient from "../services/apiClient";
import { formatAxiosError } from "../utils/formatAxiosError";
import { adminCustomerContext } from "../services/adminCustomerContext";
import ScopePicker from "./ScopePicker";
import ComplianceModal from "./ComplianceModal";
import GatewayConsentModal from "./GatewayConsentModal";
import { EDU } from "./education/educationIds";
import FidoStepUpModal from "./FidoStepUpModal";
import MCPToolsListModal from "./MCPToolsListModal";
import OtpStepUpModal from "./OtpStepUpModal";
import QuickLoginModal from "./QuickLoginModal";
import DemoAuthzFallbackModal from "./DemoAuthzFallbackModal";
import TransactionConsentModal from "./TransactionConsentModal";
import ElicitationDialog from "./ElicitationDialog";
import useElicitation from "../hooks/useElicitation";
import "./AIAgent.css";
import { postAppEvent } from "../services/appEventClient";
import sessionStorageService from "../services/sessionStorageService";
import PendingActionManager from "../services/pendingActionManager";
import {
  extractAccounts,
  normalizeAccount,
  validateHttpResponse,
  safeResponseJson,
} from "../services/apiResponseValidator";
import { getColdStartRetryDelays } from "../services/apiErrorHandler";
import APP_CONFIG from "../services/appConfig";
import { useCustomChips } from "../hooks/useCustomChips";
import AgentModeSelector from "./AgentModeSelector";
import Check from "./common/Check";
import useLangchainProvider from "../hooks/useLangchainProvider";
import { claimPendingNl, clampPanelPosition, makeReentrancyGuard, isAbortError, anySignal, isLocalModelTimeout, prewarmTierAndRetry, opportunisticPrewarm } from "./demoAgentSafety";
import { BX_AGENT_PENDING_NL_KEY, BX_AGENT_PENDING_UC_ID_KEY } from "../constants/agentPendingKeys";
// AG-UI Step 3 — hooks (feature-flagged; only active when ff_agui_enabled=true)
import { useAgentRun } from "../hooks/useAgentRun";
import { useAgentState } from "../hooks/useAgentState";
import useHitlConsent from "../hooks/useHitlConsent";
import { useNewItems } from "../hooks/useNewItems";
// Activity narration — "What's happening" plain-English story panel (ff_activity_narration)
import { useActivityNarrative } from "../context/ActivityNarrativeContext";
import { reconcileToolSteps, authorizeDecisionToStep, errorStep, answerStep, hitlStep, mapActivityRecord } from "./activity/activityNarration";
import ActivityNarrativePanel from "./activity/ActivityNarrativePanel";
// AG-UI Steps 5–6 — observability stores (push model; replaces poll when flag is on)
import { appendMcpCall } from "../services/mcpCallStore";
import { appendAuthorizeDecision } from "../services/authorizeDecisionStore";
import {
  resolveSessionFromAuthTrio,
  normalizeAgentToolResult,
  enforceVerticalAccountTypes,
  buildConsentIntent,
  inferAgentResultTypeAndData,
  isAgentToolErrorResult,
  formatHttpTrace,
  buildTokenEventMsg,
  formatResult,
  buildSessionNotHydratedChat,
  SESSION_NOT_HYDRATED_CHAT,
  welcomeMessage,
  normalizeBankingParams,
  parseLogPrompt,
} from "./agentFormatters";
// Re-export pure helpers kept on AIAgent's public surface for tests/consumers.
export {
  formatResult,
  buildResultsPanelTitle,
  buildClarificationQuestions,
  buildCustomerGreeting,
} from "./agentFormatters";
import {
  ReasoningSteps,
  ToolProgressChips,
  MessageContent,
  ResultsPanel,
} from "./agentResultPanels";
// Re-export the presentational result components on AIAgent's public surface for tests.
export {
  AccountsTable,
  TransactionsTable,
  MessageContent,
  ResultsPanel,
} from "./agentResultPanels";
import {
  ACTION_GROUPS,
  CHIP_APPLICABLE_STEPS,
  ACTIONS,
  getStepSkipExplanation,
  SUGGESTIONS_CUSTOMER,
  SUGGESTIONS_ADMIN,
  SUGGESTIONS_CONFIG_CUSTOMER,
  SUGGESTIONS_CONFIG_ADMIN,
  TOPIC_MESSAGES,
  API_DIRECT_CHIPS,
  CHIP_NL_PROMPTS,
} from "./agentActions";
import {
  SessionExpiryTimer,
  ParamHintCopy,
  verticalSuggestionChips,
  HitlChipMark,
} from "./agentChrome";

// Phase 266 H2 audit: TokenChain credentialPath stamping origins per setTokenEvents call:
//   line 3433 (scopeTestRes.tokenEvents)  — origin: scope-test path via callMcpTool; credentialPath: oauth_bearer (default; stamped by bankingAgentService)
//   line 3503 (audTestRes.tokenEvents)    — origin: aud-test path via callMcpTool; credentialPath: oauth_bearer (default; stamped by bankingAgentService)
//   line 4060 (tokenEventsErr)            — origin: error path from callMcpTool response; credentialPath: stamped by bankingAgentService before throw
//   line 4259 (tokenEvents)               — origin: bankingAgentService.callMcpTool success path ✓ stamped
//   line 5811 (response.tokenEvents)      — origin: sendAgentMessage (LangGraph/NL agent path); credentialPath: oauth_bearer (default; no credential swap on NL agent path)
//   line 6052 (data.tokenEvents)          — origin: scope_upgrade token exchange; credentialPath: oauth_bearer (default; BFF /api/scope/upgrade path)
//   line 7042 (response.tokenEvents)      — origin: HITL replay sendAgentMessage; credentialPath: oauth_bearer (default; same as NL agent path)
// Conclusion: all 7 existing call sites produce oauth_bearer chains. The three new Phase 266
// credential paths (api_key, dual_token, bankingdata) will all flow through bankingAgentService.callMcpTool
// where the stamp is applied. No additional stamping needed at BankingAgent call sites.

// BX_AGENT_PENDING_NL_KEY and BX_AGENT_PENDING_UC_ID_KEY are imported from
// ../constants/agentPendingKeys — shared with UseCaseLauncherPage (single source of truth).

/** Agent modes that invoke a frontier LLM on every query — used for the model advisory. */
const FRONTIER_MODES = ["claude"];

// PURE_LLM_MODES / PURE_LLM_LABELS come from the shared SSOT (config/agentModes.js).
// They are the pure single-brain LLM modes: when the selected provider is
// unavailable we must NOT silently answer with heuristics — we tell the user and
// offer Heuristics as an explicit choice (heuristics-only is the deterministic
// fourth mode). Keeping them in one place is what prevents the ollama/llamacpp
// drift that made a down llama.cpp fail silently.

// Shown when the agent endpoint returns success but no reply text — almost always
// means the LLM/agent runtime (:3006 / :8888) was unreachable or returned nothing.
// Surfacing this instead of a silent "Done." tells the operator where to look.
const AGENT_UNAVAILABLE_MESSAGE =
  "The assistant didn't return a response — the agent service may be unavailable. Check that the agent runtime is running.";

// Security Showcase dispatch tables (static — defined once at module scope).
// showcase keys whose live harness is an existing runAction case.
const SHOWCASE_RUN_ACTION = {
  bad_scope: "test_wrong_scope",
  atk_scope_escalation: "test_wrong_scope",
  atk_wrong_aud: "test_wrong_audience",
};
// Injection showcase chips → which seed endpoint plants the payload and which
// read tool surfaces it to the agent.
const SHOWCASE_INJECTION = {
  atk_prompt_injection: { seed: "seed-poisoned-transaction", readTool: "get_my_transactions", where: "transaction history" },
  atk_indirect_injection: { seed: "seed-poisoned-account-note", readTool: "get_my_accounts", where: "account notes" },
};

export default function BankingAgent({
  user,
  onLogout,
  mode = "float",
  embeddedDockBottom = false,
  embeddedFocus = "banking",
  distinctFloatingChrome = false,
  splitColumnChrome = false,
  showPopOut = false,
  onPopout,
  surfaceHostEl = null,
  forceVertical = null,
}) {
  const isInline = mode === "inline";
  const isBottomDock = isInline && embeddedDockBottom;
  const isConfigEmbeddedFocus = embeddedFocus === "config";
  const splitChrome = Boolean(splitColumnChrome && isInline);
  // Phase 246: also show Actions popout for dashboard inline agents that use distinctFloatingChrome
  const useActionsPopout =
    !isInline || Boolean(distinctFloatingChrome && isInline);
  const { preset: industryPreset } = useIndustryBranding();
  const brandShortName = industryPreset.shortName;
  const edu = useEducationUIOptional();
  const tokenChain = useTokenChainOptional();
  const { mode: agentUiMode } = useAgentUiMode();
  const { chips: customChips, groups: customGroups } = useCustomChips();
  const { mode: agentProviderMode } = useLangchainProvider();
  const { addEvent } = useEventStream();
  const { pageManifest, agentManifest, activeId: activeVerticalId } = useVertical();
  const effectiveVerticalId = forceVertical || activeVerticalId;
  const themeAgent = agentManifest?.agent;
  const themeManifest = pageManifest;
  const terminology = pageManifest?.terminology;

  // Keep the llama.cpp agent-brain tier loaded while this surface is mounted so
  // the first chip/tool turn does not pay a cold swap.
  useEffect(() => {
    const provider = MODE_PROVIDER[agentProviderMode] ?? agentProviderMode;
    if (provider !== "llamacpp") return undefined;
    opportunisticPrewarm("gpt-oss-20b");
    return undefined;
  }, [agentProviderMode]);

  // Always start collapsed on page load — never restore open state from localStorage.
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  /** Discovery popout — "All actions" overlay. */
  const [showDiscovery, setShowDiscovery] = useState(false);
  /** Demo steps popout — same list as /use-cases Demo section. */
  const [showDemoSteps, setShowDemoSteps] = useState(false);
  const [discoverySearch, setDiscoverySearch] = useState("");
  const discoveryTriggerRef = useRef(null);
  const actionsPopoutRef = useRef(null);

  /** Close discovery popout on Escape. First Escape clears search; second closes popout. */
  useEffect(() => {
    if (!showDiscovery) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (discoverySearch) {
          setDiscoverySearch("");
        } else {
          setShowDiscovery(false);
          discoveryTriggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDiscovery, discoverySearch]);

  /** Close discovery popout when clicking outside the popout or trigger button. */
  useEffect(() => {
    if (!showDiscovery) return;
    const onPointerDown = (e) => {
      if (
        actionsPopoutRef.current?.contains(e.target) ||
        discoveryTriggerRef.current?.contains(e.target)
      ) return;
      setShowDiscovery(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showDiscovery]);

  // Reset scroll to top only when the dropdown first opens
  useEffect(() => {
    if (showDiscovery && actionsPopoutRef.current) {
      actionsPopoutRef.current.scrollTop = 0;
    }
  }, [showDiscovery]);

  // Position the actions popout as fixed so it escapes panel overflow:hidden clipping.
  useEffect(() => {
    if (!showDiscovery || !actionsPopoutRef.current || !discoveryTriggerRef.current) return;
    const reposition = () => {
      const trigger = discoveryTriggerRef.current;
      const popout = actionsPopoutRef.current;
      if (!trigger || !popout) return;
      const rect = trigger.getBoundingClientRect();
      const popoutWidth = 320;
      // Align right edge of popout with right edge of trigger; clamp to viewport
      let left = rect.right - popoutWidth;
      if (left < 8) left = 8;
      if (left + popoutWidth > window.innerWidth - 8) left = window.innerWidth - 8 - popoutWidth;
      popout.style.left = `${left}px`;
      popout.style.top = `${rect.bottom + 4}px`;
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [showDiscovery]);

  const [nlInput, setNlInput] = useState("");
  const [inputHistory, setInputHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [nlLoading, setNlLoading] = useState(false);
  const [nlMeta, setNlMeta] = useState(null);
  // Map agentProviderMode (updated immediately on mode switch via useLangchainProvider)
  // to the provider string the BFF expects, using the shared SSOT (config/agentModes.js).
  // nlMeta.activeLlmProvider is fetched once on mount and goes stale after a mode
  // change, so agentProviderMode wins for every KNOWN mode — including heuristics,
  // whose SSOT provider is null. That null is authoritative, not a fallback trigger:
  // it makes /nl send provider:"heuristic" (heuristic-only short-circuit in
  // demoAgentNl) and keeps typed messages off the AG-UI LLM path. Falling back to
  // stale nlMeta here made "Heuristics only" silently use the last LLM provider.
  // Only unknown/legacy modes fall back to nlMeta.
  const activeLlmProvider = (agentProviderMode && agentProviderMode in MODE_PROVIDER)
    ? MODE_PROVIDER[agentProviderMode]
    : (nlMeta?.activeLlmProvider ?? null);
  // Degraded-mode banner: true when the user selected an LLM provider (Helix)
  // but routing fell back to the heuristic parser (Helix unreachable / not
  // configured). Drives a persistent banner in the panel header. Cleared as
  // soon as a Helix-sourced answer comes back.
  const [helixDegraded, setHelixDegraded] = useState(false);
  // Message id currently running the pre-warm-and-retry action (Task: prewarm-retry-timeout).
  const [prewarming, setPrewarming] = useState(null);
  const prewarmGuardRef = useRef(null);
  if (!prewarmGuardRef.current) prewarmGuardRef.current = makeReentrancyGuard();
  const [modelAdvisory, setModelAdvisory] = useState(null);
  const modelAdvisoryTimerRef = useRef(null);
  // Single-slot conversation state for clarification follow-ups.
  // Set when we asked "Which account?"/"How much?" and we're waiting on
  // the user's next message to fill that slot. Shape: { action, slot, asked }.
  // - action: one of 'balance' | 'deposit' | 'withdraw' | 'transfer'
  // - slot:   which field of the action's params the next message fills
  //           (e.g. 'accountType' for balance, free-text-parse for others).
  // Cleared the moment we consume it OR a turn later if user changed topic.
  const [pendingClarification, setPendingClarification] = useState(null);
  /** Set when a pure LLM mode (Helix/LM Studio/Claude only) was selected but the
   *  provider was unavailable. Holds the deferred heuristic result so the user can
   *  explicitly choose Heuristics instead of getting a silent fallback. */
  const [pendingLlmFallback, setPendingLlmFallback] = useState(null);
  /** Set when returning from PingOne with a pending banking NL line to run after session exists. */
  const [nlResumeAfterAuth, setNlResumeAfterAuth] = useState(null);
  /** useCaseId claimed alongside a pending NL (from launcher deep-link); attached to the next send. */
  const pendingUcIdRef = useRef(null);
  const pendingNlResumeRef = useRef(null);
  const nlSendGuardRef = useRef(null);
  if (!nlSendGuardRef.current) nlSendGuardRef.current = makeReentrancyGuard();
  const sendAbortRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [sessionTokens, setSessionTokens] = useState({ input: 0, output: 0 });
  const [lifetimeTokens, setLifetimeTokens] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ba_tokens_lifetime') || 'null');
      return stored && typeof stored.input === 'number' ? stored : { input: 0, output: 0 };
    } catch (_) {
      return { input: 0, output: 0 };
    }
  });
  const [loading, setLoading] = useState(false);
  /** null = loading; which OAuth flows have client IDs + environment */
  const [oauthConfig, setOauthConfig] = useState(null);
  /** {x,y} when panel has been dragged; null = CSS-anchored default position */
  const [dragPos, setDragPos] = useState(null);
  /** Panel dimensions for resizing — floating default is large enough for header, chips, and two-column body */
  const [panelSize, setPanelSize] = useState({ width: 620, height: 860 });
  const panelSizeRef = useRef(panelSize);
  useEffect(() => {
    panelSizeRef.current = panelSize;
  }, [panelSize]);
  /** Side panel showing rich results next to the agent */
  const [resultPanel, setResultPanel] = useState(null);
  const resultPanelRef = useRef(null);
  const terminologyRef = useRef(null);
  /** Live bounding rect of the agent panel — used to anchor the results pop-out */
  const [agentBounds, setAgentBounds] = useState(null);
  /** MCP server connection status for header display */
  const [mcpStatus, setMcpStatus] = useState({
    toolCount: null,
    connected: false,
  });
  /** Real accounts from /api/accounts/my — used for the balance/deposit/withdraw/transfer form
   *  dropdowns so IDs always match what the server has stored (avoids chk-{uid} mismatch). */
  const [liveAccounts, setLiveAccounts] = useState([]);
  /**
   * Self-detected session user — populated by independent auth check so the
   * agent knows the session even if the parent App.js user prop hasn't resolved yet.
   */
  const [sessionUser, setSessionUser] = useState(null);
  const sessionUserRef = useRef(null);
  sessionUserRef.current = sessionUser;
  const [sessionRefreshing, setSessionRefreshing] = useState(false);
  /** True while the 2s reconnect poll is actively running (shows "Reconnecting…" banner). */
  const [, setSessionReconnecting] = useState(false);
  /** True when identity came from _auth cookie / stub token — MCP and NL need a Redis-backed session. */
  const [cookieOnlyBffSession, setCookieOnlyBffSession] = useState(false);
  /** Avoid repeating the session-fix error bubble after we showed it on load or after a failed action. */
  const sessionFixBubbleShownRef = useRef(false);
  /** User declined high-value consent — tools/chat disabled until sign-out (agentAccessConsent). */
  // Always start false — the block is session-scoped, not page-load-scoped.
  // Clear any stale localStorage value immediately so refresh/login never shows the banner.
  // OTP step-up modal state (Phase 174)
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpContextLine, setOtpContextLine] = useState("");
  // OTP delivery outcome surfaced into the modal — no silent "code sent" lies.
  const [otpDeliveryError, setOtpDeliveryError] = useState(null);
  const pendingOtpActionRef = useRef(null);
  // Callback to fire after OTP step-up completes (e.g. sensitive data fetch post-HITL)
  const pendingStepUpCallbackRef = useRef(null);
  // MCP tools list modal state
  const [showMcpToolsModal, setShowMcpToolsModal] = useState(false);
  const [mcpToolsList, setMcpToolsList] = useState([]);
  // Demo guide modal state
  const [showDemoGuide, setShowDemoGuide] = useState(false);
  // Account details panel state
  const [accountDetailsPanel, setAccountDetailsPanel] = useState(null);
  const [accountDetailsPanelPos, setAccountDetailsPanelPos] = useState({
    x: 200,
    y: 100,
  });
  // FIDO2 + P1MFA state (Phase 174-03/04)
  const [stepUpMethod, setStepUpMethod] = useState("otp"); // 'otp' or 'fido'
  const [supportsFido, setSupportsFido] = useState(false);
  const [p1mfaMode, setP1mfaMode] = useState(false);
  const [p1mfaDaId, setP1mfaDaId] = useState(null);
  const [p1mfaDevices, setP1mfaDevices] = useState([]);
  const [consentBlocked, setConsentBlocked] = useState(false);
  /** MCP auth mode from oauth status — consumer vs enterprise-managed. */
  const [mcpAuthMode, setMcpAuthMode] = useState("consumer");
  const [txErrorModal, setTxErrorModal] = useState(null); // { title, message } or null
  const [complianceStripState, setComplianceStripState] = useState(() => {
    try {
      const s = agentFlowDiagram.getState();
      return {
        complianceStep: s.complianceStep || null,
        complianceSteps: s.complianceSteps || [],
      };
    } catch {
      return { complianceStep: null, complianceSteps: [] };
    }
  });
  const [showCompliancePanel, setShowCompliancePanel] = useState(() => {
    try {
      return localStorage.getItem("ba_show_compliance_panel") === "1";
    } catch {
      return false;
    }
  });
  const [complianceSlideout, setComplianceSlideout] = useState(() => {
    try {
      return localStorage.getItem("ba_compliance_slideout") === "1";
    } catch {
      return false;
    }
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  // MCP Elicitation (form mode + URL mode input requests)
  const {
    elicitation,
    isSubmitting: elicitationSubmitting,
    handleElicitationRequest,
    submitElicitation,
    cancel: cancelElicitation,
  } = useElicitation();

  // Listen for elicitation events from the MCP tool SSE stream
  useEffect(() => {
    const handleElicitationEvent = (event) => {
      const data = event.detail;
      handleElicitationRequest({
        elicitationId: data.elicitationId,
        mode: data.mode,
        message: data.message,
        requestedSchema: data.requestedSchema,
        url: data.url,
      });
    };

    window.addEventListener('mcp-elicitation-requested', handleElicitationEvent);
    return () => window.removeEventListener('mcp-elicitation-requested', handleElicitationEvent);
  }, [handleElicitationRequest]);

  // Detect FIDO2/WebAuthn support on mount
  useEffect(() => {
    setSupportsFido(
      typeof window !== "undefined" && window.PublicKeyCredential !== undefined,
    );
  }, []);
  /** Group expand/collapse state for chip categories — defaults per D-06, persisted in localStorage. */
  const [chipGroupsState, setChipGroupsState] = useState(() => {
    try {
      const saved = localStorage.getItem("ba_chip_groups_state");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load ba_chip_groups_state from localStorage:", e);
    }
    // Default: Account expanded; Testing / Attacks / Advanced stay collapsed
    return {
      account: true,
      transaction: false,
      admin: false,
      ai: false,
      testing: false,
      attacks: false,
      advanced: false,
    };
  });

  /** Persist chipGroupsState changes to localStorage. */
  useEffect(() => {
    try {
      localStorage.setItem(
        "ba_chip_groups_state",
        JSON.stringify(chipGroupsState),
      );
    } catch (e) {
      console.warn("Failed to save ba_chip_groups_state to localStorage:", e);
    }
  }, [chipGroupsState]);

  /** Reset chipGroupsState when layout mode changes (floating ↔ inline ↔ bottom-dock).
   *  Prevents stale expanded groups persisting in the DOM after switching layouts.
   */
  useEffect(() => {
    setChipGroupsState(() => ({
      account: true,
      transaction: false,
      admin: false,
      ai: false,
      testing: false,
      attacks: false,
      advanced: false,
    }));
  }, [useActionsPopout, isBottomDock]);

  /** Toggle expanded/collapsed state for a group. */
  const toggleGroupExpanded = (groupName) => {
    setChipGroupsState((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  /** True when any action group is currently expanded. */
  const anyExpanded = Object.values(chipGroupsState).some(Boolean);

  /** Collapse all action groups. */
  const collapseAllGroups = () => {
    setChipGroupsState(
      Object.fromEntries(Object.keys(ACTION_GROUPS).map((k) => [k, false])),
    );
  };

  /** Expand all action groups. */
  const expandAllGroups = () => {
    setChipGroupsState(
      Object.fromEntries(Object.keys(ACTION_GROUPS).map((k) => [k, true])),
    );
  };

  /** Token chain visibility — always starts hidden on page load (not persisted). */
  const [showTokenChain, setShowTokenChain] = useState(false);

  const [tokenChainWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("ba_token_chain_width");
      if (saved !== null)
        return Math.max(50, Math.min(600, parseInt(saved, 10)));
    } catch {}
    return 280; // Default: 280px
  });

  /** Persist token chain width to localStorage. */
  useEffect(() => {
    try {
      localStorage.setItem("ba_token_chain_width", String(tokenChainWidth));
    } catch (e) {
      console.warn("Failed to save ba_token_chain_width to localStorage:", e);
    }
  }, [tokenChainWidth]);

  /** Advanced agent UI mode forces the token chain open so developer overlays are visible. */
  useEffect(() => {
    if (agentUiMode === 'advanced') setShowTokenChain(true);
  }, [agentUiMode]);

  /** Show/hide RFC info token-event messages in chat. Persisted. */
  const [showRfcInfo, setShowRfcInfo] = useState(() => {
    try {
      const saved = localStorage.getItem("ba_show_rfc_info");
      if (saved !== null) return saved === "true";
    } catch {}
    return false; // Default: hide RFC info for clean chat
  });
  useEffect(() => {
    try {
      localStorage.setItem("ba_show_rfc_info", String(showRfcInfo));
    } catch {}
  }, [showRfcInfo]);

  /** Whether the heuristic fast-path is enabled (ff_heuristic_enabled). false = LLM-only mode. */
  const [heuristicEnabled, setHeuristicEnabled] = useState(true);
  /** Whether the floating results panel is enabled (ff_agent_results_panel). false = panel hidden; results inline only. */
  const [agentResultsPanelEnabled, setAgentResultsPanelEnabled] = useState(false);
  /** Whether AG-UI streaming is enabled (ff_agui_enabled). false = legacy sendAgentMessage path. */
  const [aguiEnabled, setAguiEnabled] = useState(false);
  /** Whether activity narration is enabled (ff_activity_narration). Controls visibility of the always-on panel. */
  const [activityNarrationEnabled, setActivityNarrationEnabled] = useState(true);
  // AG-UI hooks — only active when aguiEnabled=true; state and run are no-ops otherwise
  const { state: aguiState, handlers: aguiHandlers, reset: aguiReset } = useAgentState();
  // Activity narration context — friendly per-step story (ff_activity_narration).
  const activity = useActivityNarrative();
  // Methods are useCallback-stable; depend on these (not the unstable `activity`
  // object literal) inside effects to avoid an unbounded re-render loop.
  const {
    startRequest: activityStartRequest,
    upsertStep: activityUpsertStep,
    finishRequest: activityFinishRequest,
    reset: activityReset,
  } = activity;
  const { run: aguiRun, abort: aguiAbort } = useAgentRun(aguiHandlers);
  // Refs for stable thread ID and active run ID (needed by HITL resume)
  const aguiThreadIdRef = React.useRef(null);
  const aguiActiveRunIdRef = React.useRef(null);

  /** Render a single action button with optional emoji-only styling. */
  const renderChip = (action, groupName) => {
    return (
      <button
        key={action.id}
        type="button"
        className={
          "ba-action-item ba-action-chip" +
          (complianceStripState.complianceActionId === action.id
            ? " ba-action-chip--active-test"
            : "")
        }
        onClick={() => handleChipActivate(action)}
        disabled={
          loading ||
          (consentBlocked && action.id !== "logout") ||
          (showOtpModal && action.id !== "logout")
        }
        title={action.desc || action.label}
      >
        {action.label}
      </button>
    );
  };

  /** Ordered group list for the discovery popout. */
  const allDiscoveryGroups = useMemo(() => {
    const allGroups = [
      { id: "custom", label: "Custom Actions" },
      ...customGroups,
    ];
    const customEntries = allGroups
      .map((g) => ({
        key: g.id,
        label: g.label,
        chips: customChips
          .filter((c) => (c.groupId || "custom") === g.id)
          .map((c) => ({
            id: c.id,
            label: c.label,
            desc: c.desc || "",
            rfcs: [],
          })),
        isEducation: false,
      }))
      .filter((g) => g.chips.length > 0);

    return [
      {
        key: "testing",
        label: "Testing",
        chips: ACTION_GROUPS.testing,
        isEducation: false,
      },
      {
        key: "attacks",
        label: "Attacks",
        chips: ACTION_GROUPS.attacks || [],
        isEducation: false,
      },
      ...customEntries,
    ];
  }, [customChips, customGroups, effectiveVerticalId, pageManifest]);

  /** Live filtered view of allDiscoveryGroups based on discoverySearch. */
  const filteredDiscoveryGroups = useMemo(() => {
    const q = discoverySearch.trim().toLowerCase();
    if (!q) return allDiscoveryGroups;
    return allDiscoveryGroups
      .map((group) => ({
        ...group,
        chips: group.chips.filter((c) => c.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.chips.length > 0);
  }, [discoverySearch, allDiscoveryGroups]);

  /** Render ACTION_GROUPS with collapsible headers, count badges, and collapse-all toolbar. */
  const renderActionGroups = () => {
    const allCustomGroups = [
      { id: "custom", label: "Custom Actions" },
      ...customGroups,
    ];
    const customGroupMap = Object.fromEntries(
      allCustomGroups
        .map((g) => [
          g.id,
          customChips
            .filter((c) => (c.groupId || "custom") === g.id)
            .map((c) => ({
              id: c.id,
              label: c.label,
              desc: c.desc || "",
              rfcs: [],
            })),
        ])
        .filter(([, chips]) => chips.length > 0),
    );
    // Non-banking verticals: replace the hardcoded banking ACTION_GROUPS with the
    // active vertical's chips10 (the 10 prompt chips), so the left rail shows ONLY
    // the vertical's chips — never "My Accounts / Transfer" in workforce/healthcare.
    // Each chip carries a `message` → renderChip routes it through the NL pipeline.
    // Banking keeps ACTION_GROUPS unchanged (regression-safe).
    const isBankingVertical = !effectiveVerticalId || effectiveVerticalId === "banking";
    let groupsToRender;
    if (!isBankingVertical) {
      const suggestions = verticalSuggestionChips(pageManifest);
      groupsToRender = { ...(suggestions.length ? { suggestions } : {}), ...customGroupMap };
    } else {
      groupsToRender = { ...ACTION_GROUPS, ...customGroupMap };
    }
    if (isConfigEmbeddedFocus) {
      const logoutAction = ACTION_GROUPS.account?.filter((a) => a.id === "logout") || [];
      groupsToRender = { admin: [...(ACTION_GROUPS.admin || []), ...logoutAction] };
    } else if (effectiveUser?.role !== "admin") {
      const { admin: _admin, ...rest } = groupsToRender;
      groupsToRender = rest;
    }

    return (
      <>
        <div className="ba-chips-toolbar">
          <button
            type="button"
            className="ba-collapse-all-btn"
            onClick={anyExpanded ? collapseAllGroups : expandAllGroups}
          >
            {anyExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>

        {Object.entries(groupsToRender).map(([groupName, actions]) => {
          const isExpanded = !!chipGroupsState[groupName];
          const capitalizedName =
            groupName.charAt(0).toUpperCase() + groupName.slice(1);
          return (
            <div
              key={groupName}
              className={"ba-action-group ba-action-group--" + groupName}
            >
              <button
                className="ba-group-header"
                onClick={() => toggleGroupExpanded(groupName)}
                type="button"
                title={
                  (isExpanded ? "Collapse" : "Expand") +
                  " " +
                  capitalizedName +
                  " actions"
                }
              >
                <span className="ba-group-name">{capitalizedName}</span>
                <span className="ba-group-count">({actions.length})</span>
                <span
                  className={
                    "ba-group-toggle " + (isExpanded ? "expanded" : "collapsed")
                  }
                >
                  {isExpanded ? "▼" : "▶"}
                </span>
              </button>
              <div
                className={
                  "ba-group-content " + (isExpanded ? "" : "collapsed")
                }
              >
                {actions.map((action) => renderChip(action, groupName))}
              </div>
            </div>
          );
        })}
      </>
    );
  };
  /** True when the user has accepted the in-app agent consent agreement. */
  /** Missing-scopes error from token exchange — shows config-fix modal. */
  const [scopeErrorModal, setScopeErrorModal] = useState(null);
  /** Pending action awaiting scope-upgrade consent — replayed automatically after exchange. */
  const pendingScopeUpgradeRef = useRef(null);

  /** Pending HITL intent — shows AgentConsentModal (transaction mode) before OTP. */
  const [hitlPendingIntent, setHitlPendingIntent] = useState(null);

  /** Challenge ID issued after the user clicks Authorize in AgentConsentModal. */
  const [hitlChallengeId, setHitlChallengeId] = useState(null);
  /** Pending action awaiting CIBA step-up approval (ref: read in event listener closure). */
  const pendingStepUpActionRef = useRef(null);
  /** Pending action awaiting auth-challenge login (ref: read in event listener closure).
   *  Also persisted to sessionStorage so it survives PingOne full-page redirect. */
  const pendingAuthChallengeActionRef = useRef(
    (() => {
      try {
        const stored = sessionStorage.getItem("_agent_pending_auth_action");
        if (stored) {
          sessionStorage.removeItem("_agent_pending_auth_action");
          return JSON.parse(stored);
        }
      } catch {
        /* ignore */
      }
      return null;
    })(),
  );

  const bottomRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const nlInputRef = useRef(null);
  // Bridge for external (window-event) attack triggers — e.g. the AI Attacks
  // learning drawer's "Run this attack" buttons. Assigned each render (see the
  // useEffect below) so window listeners always call the current closure.
  const runDrawerAttackRef = useRef(null);
  const toolProgressIdRef = useRef(null);
  const panelRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // On the /agent route the inline/full-page instance is shown — hide duplicate float
  const isAgentPage = location.pathname === "/agent";
  /** Landing `/`: agent success/info/error toasts use longer autoClose (readable for guests). */
  const agentToastMs = useMemo(() => {
    const slow = isPublicMarketingAgentPath(location.pathname);
    return {
      successAction: slow ? 7500 : 2500,
      toolsLoaded: slow ? 7000 : 2000,
      errShort: slow ? 10000 : 5000,
      infoToken: slow ? 8500 : 4500,
    };
  }, [location.pathname]);

  useEffect(() => {
    const sync = () => setConsentBlocked(isAgentBlockedByConsentDecline());
    window.addEventListener("bankingAgentConsentBlockChanged", sync);
    return () =>
      window.removeEventListener("bankingAgentConsentBlockChanged", sync);
  }, []);

  useEffect(() => {
    return agentFlowDiagram.subscribe((state) => {
      setComplianceStripState({
        complianceStep: state.complianceStep || null,
        complianceSteps: state.complianceSteps || [],
        complianceActionLabel: state.complianceActionLabel || null,
        complianceActionId: state.complianceActionId || null,
      });
    });
  }, []);

  // Clear parent's consent decline state on mount (React Rule: no setState in render initializers)
  useEffect(() => {
    setAgentBlockedByConsentDecline(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for UserDashboard confirming a HITL consent challenge.
  // The modal already executes the transaction — we just surface the success message in the agent.
  useEffect(() => {
    const onConfirmed = (e) => {
      const { actionId, successMsg } = e.detail || {};
      const label = ACTIONS.find((a) => a.id === actionId)?.label || actionId;
      addMessage(
        "assistant",
        `✅ ${label} approved and completed.\n\n${successMsg || "The transaction went through after your consent."}`,
        actionId,
      );
      notifySuccess(`✅ ${label} complete`);
    };
    window.addEventListener("banking-agent-hitl-confirmed", onConfirmed);
    return () =>
      window.removeEventListener("banking-agent-hitl-confirmed", onConfirmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist open state so the panel survives a page refresh
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (isInline) return;
    try {
      localStorage.setItem("banking-agent-open", String(isOpen));
    } catch {}
  }, [isOpen, isInline]);

  // Floating mode: always collapse on route changes. Explicit open intents
  // (Agent nav button → `banking-agent-open` event, return from /config with
  // state.scrollToAgent/openAgent) re-open the panel via their own effects below.
  // Do not tie this to user/session (see REGRESSION_LOG — auth sync was resetting isOpen and closing the panel).
  useEffect(() => {
    if (isInline) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    setIsOpen(false);
    // location.pathname is the intentional trigger — fire on every route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isInline]);

  // Auto-open when returning from /config (Config.js navigates back with scrollToAgent:true)
  // Also handles Agent nav button redirect (state.openAgent)
  useEffect(() => {
    if (location.state?.scrollToAgent || location.state?.openAgent) {
      setIsOpen(true);
      window.history.replaceState({}, "");
    }
    if (location.state?.openDemoGuide) {
      setShowDemoGuide(true);
      window.history.replaceState({}, "");
    }
    // Use-case launcher: consume triggerText + useCaseId from navigate state
    if (location.state?.triggerText) {
      if (location.state.useCaseId) {
        pendingUcIdRef.current = location.state.useCaseId;
      }
      setNlResumeAfterAuth(location.state.triggerText);
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  // Open floating panel when 'banking-agent-open' event is dispatched (e.g. nav Agent button)
  useEffect(() => {
    if (isInline) return;
    const handler = () => setIsOpen(true);
    window.addEventListener("banking-agent-open", handler);
    return () => window.removeEventListener("banking-agent-open", handler);
  }, [isInline]);

  // Pre-fill NL input from external event (e.g. "Test Revocation" button after kill switch).
  // When detail.autoSend is set (AI Attacks drawer "Run this attack" prompts), open the
  // agent and submit the message through the live NL pipeline instead of just prefilling.
  // Only one <AIAgent> instance mounts at a time (App.js shouldMountSingleAgent), so the
  // mounted instance — floating OR inline — must handle the run; an inline early-return
  // here made the drawer buttons dead on /dashboard (inline is always open, no double-run risk).
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail?.message;
      if (!msg) return;
      if (e.detail?.autoSend) {
        setIsOpen(true); // no-op for inline (effectiveIsOpen is already true)
        // Defer so the panel mounts and runDrawerAttackRef points at the live closure.
        const tid = setTimeout(() => runDrawerAttackRef.current?.({ message: msg }), 80);
        timerIds.push(tid);
        return;
      }
      setNlInput(msg);
      const tid2 = setTimeout(() => nlInputRef.current?.focus(), 50);
      timerIds.push(tid2);
    };
    const timerIds = [];
    window.addEventListener("banking-agent-prefill", handler);
    return () => {
      window.removeEventListener("banking-agent-prefill", handler);
      timerIds.forEach(clearTimeout);
    };
  }, []);

  // Open demo guide when event dispatched from side menu
  useEffect(() => {
    const handler = () => setShowDemoGuide(true);
    window.addEventListener("agent-demo-guide-open", handler);
    return () => window.removeEventListener("agent-demo-guide-open", handler);
  }, []);

  // Run Intent Bypass attack demo from admin sidebar
  useEffect(() => {
    const _push = (content) =>
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()), role: 'assistant', content },
      ]);
    const handler = async (e) => {
      if (e.detail?.type !== 'intent-bypass') return;
      setIsOpen(true);
      _push('⚠️ Attack Demo: Sending mismatched Intent Token (view_balance IT → create_transfer call)...');
      try {
        const resp = await bffAxios.post('/api/dev/intent-bypass-demo');
        if (resp.data?.tokenEvents) tokenChain.setTokenEvents('intent-bypass-attack', resp.data.tokenEvents);
        _push('⚠️ Gateway did not deny — intent enforcement may be disabled. Check gateway logs.');
      } catch (err) {
        const data = err.response?.data;
        if (data?.tokenEvents) tokenChain.setTokenEvents('intent-bypass-attack', data.tokenEvents);
        if (data?.error === 'intent_mismatch_demo') {
          _push('✅ Attack blocked — Gateway returned 403 intent_mismatch. The agent cannot call create_transfer because the Intent Token was bound to view_balance. See Token Chain for the full delegation trail.');
        } else {
          _push(`❌ Demo error: ${data?.message || err.message}. Check that you are signed in and services are running.`);
        }
      }
    };
    window.addEventListener('banking-attack-demo', handler);
    return () => window.removeEventListener('banking-attack-demo', handler);
  }, [tokenChain]);

  // Bridge for the AI Attacks learning drawer's "Run this attack" buttons.
  // Reassigned on every render so the window listeners below always invoke the
  // current closures (callMcpTool/addMessage/runAction/sendAsNl/tokenChain).
  //   - { message }  → auto-send a prompt through the live NL pipeline
  //   - { showcase } → run a Security Showcase attack (scope-escalation runAction,
  //                    or an injection: seed a poisoned payload + surface it via the
  //                    agent's read tool, mirroring the in-chat showcase chip).
  useEffect(() => {
    runDrawerAttackRef.current = (detail = {}) => {
      const { message, showcase, label } = detail;
      if (message) { sendAsNl(message); return; }
      if (!showcase) return;
      if (SHOWCASE_RUN_ACTION[showcase]) { runAction(SHOWCASE_RUN_ACTION[showcase]); return; }
      const inj = SHOWCASE_INJECTION[showcase];
      if (!inj) return;
      addMessage("user", `Run attack: ${label || showcase}`);
      setNlLoading(true);
      (async () => {
        try {
          const apiBase = process.env.REACT_APP_API_URL || "";
          const seedRes = await fetch(`${apiBase}/api/demo/attacks/${inj.seed}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const seedData = await seedRes.json().catch(() => ({}));
          const payload = seedData.description || seedData.notes || "(payload planted)";
          // Pin to banking (seed plants there) + higher limit so the poisoned
          // memo is in the read window; result must be `assistant` (not
          // token-event) so it stays visible when RFC info is off.
          const readParams = inj.readTool === "get_my_transactions" ? { limit: 100 } : {};
          const readResp = await callMcpTool(inj.readTool, readParams, { vertical: "banking" });
          const surfaced = JSON.stringify(readResp?.result ?? "").includes("[SYSTEM:");
          addMessage(
            "assistant",
            [
              `Injection planted in your ${inj.where} and surfaced to the agent via ${inj.readTool}:`,
              `   "${payload}"`,
              "",
              surfaced
                ? "The poisoned directive is now in the agent's context — but it cannot auto-execute:"
                : "(payload planted; agent read completed)",
              "❌ Any write the injection demands (e.g. create_transfer) is gated by PingOne Authorize + HITL consent.",
              "   The policy evaluates the request independently of whatever the LLM 'decided' from the poisoned text.",
            ].join("\n"),
            null,
          );
          if (tokenChain && Array.isArray(readResp?.tokenEvents)) {
            tokenChain.setTokenEvents(inj.readTool, readResp.tokenEvents);
          }
        } catch (err) {
          addMessage("assistant", `Injection demo error: ${err.code || err.message || "failed"}`, null);
        } finally {
          setNlLoading(false);
        }
      })();
    };
  });

  // Run a Security Showcase attack from an external trigger (AI Attacks drawer).
  // Handled by whichever single instance is mounted — floating or inline (see note
  // on the banking-agent-prefill effect above).
  useEffect(() => {
    const handler = (e) => {
      const showcase = e.detail?.showcase;
      if (!showcase) return;
      setIsOpen(true); // no-op for inline (effectiveIsOpen is already true)
      // Defer so the panel mounts and runDrawerAttackRef points at the live closure.
      setTimeout(() => runDrawerAttackRef.current?.({ showcase, label: e.detail?.label }), 80);
    };
    window.addEventListener("banking-run-showcase", handler);
    return () => window.removeEventListener("banking-run-showcase", handler);
  }, []);

  // Presence flag + deferred replay for the AI Attacks drawer. On routes with no
  // mounted agent (most admin sub-pages) AiAttacksPanel sees the flag unset,
  // persists the pending run to sessionStorage, and navigates to /admin — the
  // agent that mounts there replays it here. Defined after the runDrawerAttackRef
  // effect so the ref is populated before the replay timer is armed.
  useEffect(() => {
    window.__bankingAgentMounted = true;
    let raw = null;
    try {
      raw = sessionStorage.getItem("banking-agent-pending-attack");
      if (raw) sessionStorage.removeItem("banking-agent-pending-attack");
    } catch (_) {
      raw = null; // sessionStorage unavailable — nothing to replay
    }
    if (raw) {
      try {
        const pending = JSON.parse(raw);
        const payload = pending?.payload || {};
        if (pending?.type === "showcase" && payload.showcase) {
          setIsOpen(true);
          setTimeout(() => runDrawerAttackRef.current?.({ showcase: payload.showcase, label: payload.label }), 300);
        } else if (pending?.type === "prefill" && payload.message) {
          setIsOpen(true);
          setTimeout(() => runDrawerAttackRef.current?.({ message: payload.message }), 300);
        }
      } catch (_) {
        // malformed pending action — drop it
      }
    }
    return () => {
      delete window.__bankingAgentMounted;
    };
  }, []);

  // Reset conversation when demo is cleared (no full page reload needed)
  useEffect(() => {
    const currentUser = user || sessionUser;
    const handler = () => {
      const freshWelcome = currentUser
        ? [
            {
              id: `${Date.now()}-w`,
              role: "assistant",
              content: welcomeMessage(
                currentUser,
                embeddedFocus,
                brandShortName,
                themeAgent && themeAgent.greeting,
              ),
            },
          ]
        : [];
      setMessages(freshWelcome);
      setNlInput("");
      setInputHistory([]);
      setHistoryIndex(-1);
      activityReset();
    };
    window.addEventListener("demo-reset-complete", handler);
    return () => window.removeEventListener("demo-reset-complete", handler);
  }, [user, sessionUser, embeddedFocus, brandShortName, industryPreset.id, themeAgent, activityReset]);

  // Auto-open when redirected back from OAuth login (?oauth=success in URL)
  useEffect(() => {
    if (searchParams.get("oauth") === "success") {
      // Atomically claim the pending NL command BEFORE any retry timer fires.
      // This guarantees exactly one instance/retry replays it (prevents
      // double-execute of a banking command; REGRESSION_PLAN §4 2026-05-18).
      // Claimed on effect entry: if session hydration never succeeds the
      // command is intentionally dropped, not retained for a later page load.
      const pendingNl = claimPendingNl(BX_AGENT_PENDING_NL_KEY);

      setIsOpen(true);
      // Strip oauth params from URL so they don't re-trigger on navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth");
      url.searchParams.delete("stepup");
      window.history.replaceState({}, "", url.toString());

      // Auth cookie is set on the callback response, but on Vercel the status
      // check may land on a cold instance before Redis propagates.  Retry with
      // increasing backoff (immediate, 600, 1400, 2500 ms).
      const retryDelays = getColdStartRetryDelays();
      const timers = [];
      retryDelays.forEach((delay, i) => {
        const t = setTimeout(async () => {
          const result = await Promise.all([
            getCachedStatus("/api/auth/oauth/status").catch(() => null),
            getCachedStatus("/api/auth/oauth/user/status").catch(() => null),
            getCachedStatus("/api/auth/session").catch(() => null),
          ]);
          const [admin, endUser, session] = result;
          const { found, cookieOnlyBffSession: cookieOnly } =
            resolveSessionFromAuthTrio(admin, endUser, session);
          if (found) {
            setCookieOnlyBffSession(cookieOnly);
            setSessionUser(found);
            if (pendingNl) {
              setNlResumeAfterAuth(pendingNl);
            }
            setMessages((prev) => {
              const isOnlyGuestMsg = prev.length === 1 && prev[0]?.id?.endsWith("-guest");
              if (prev.length > 0 && !isOnlyGuestMsg) return prev;
              const welcome = {
                id: `${Date.now()}-w`,
                role: "assistant",
                content: welcomeMessage(
                  found,
                  embeddedFocus,
                  brandShortName,
                  themeAgent && themeAgent.greeting,
                ),
              };
              if (cookieOnly) {
                sessionFixBubbleShownRef.current = true;
                return [
                  welcome,
                  {
                    id: `${Date.now()}-fix`,
                    role: "error",
                    content: buildSessionNotHydratedChat(
                      session?.sessionStoreError ?? null,
                      session?.sessionStoreHealthy ?? null,
                    ),
                    showSessionFixActions: true,
                  },
                ];
              }
              return [welcome];
            });
            // Dispatch on every successful retry so pendingAuthChallengeActionRef replay fires
            // even when the 0ms check races against Redis on cold-start
            window.dispatchEvent(new CustomEvent("userAuthenticated"));
            // Cancel remaining retries
            timers.forEach(clearTimeout);
          }
        }, delay);
        timers.push(t);
      });
      return () => timers.forEach(clearTimeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Deep-link from UseCaseLauncherPage: claim pending NL on mount (direct navigation,
  // no ?oauth=success).  Guards:
  //   1. isInline — only the primary inline instance claims it (floating copy skips).
  //   2. searchParams.get("oauth") — the oauth path already claims+replays it; skip here.
  // mount-only: claim is one-shot; isInline and searchParams are stable at mount.
  useEffect(() => {
    if (!isInline) return;
    if (searchParams.get("oauth") === "success") return; // handled by the oauth effect above
    // BUG 1 fix: always claim ucId BEFORE the early-return so a stale key can't
    // bleed into the next launcher run (e.g. second tab claims the NL first).
    let pendingUcId = null;
    try {
      pendingUcId = sessionStorage.getItem(BX_AGENT_PENDING_UC_ID_KEY);
      if (pendingUcId) sessionStorage.removeItem(BX_AGENT_PENDING_UC_ID_KEY);
    } catch (_) {}
    const pendingNl = claimPendingNl(BX_AGENT_PENDING_NL_KEY);
    if (!pendingNl) return;
    if (pendingUcId) pendingUcIdRef.current = pendingUcId;
    setNlResumeAfterAuth(pendingNl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open when the user prop transitions from null → authenticated user
  // (fires on initial mount when App.js has already resolved the session,
  //  and again if the user changes while the component is mounted)
  // Also replaces a sole initial greeting when themeAgent resolves asynchronously
  // after the initial render (vertical manifest race condition).
  useEffect(() => {
    if (!user) return;
    setMessages((prev) => {
      const isSoleGreeting =
        prev.length === 1 &&
        prev[0].role === "assistant" &&
        !prev[0].tool;
      if (prev.length > 0 && !isSoleGreeting) return prev;
      return [
        {
          id: Date.now().toString(),
          role: "assistant",
          content: welcomeMessage(
            user,
            embeddedFocus,
            brandShortName,
            themeAgent && themeAgent.greeting,
          ),
        },
      ];
    });
  }, [user, embeddedFocus, brandShortName, industryPreset.id, themeAgent]);

  // Effective user: prefer prop (App.js state), fall back to self-detected session
  const effectiveUser = user || sessionUser;
  const isLoggedIn = !!effectiveUser;

  // ── Authorize-driven dynamic chips ──────────────────────────────────────────
  // availableTools is the live, Authorize-filtered tool list for the active
  // vertical + scope (POST /api/demo-agent/tools). Scope-denied tools are present
  // with permitted:false (greyed in the UI); vertical-foreign tools are absent.
  // agentAllowWrite is the in-agent write toggle (ScopePicker). Flipping it or
  // switching vertical re-fetches the list — the visible Authorize moment.
  const [availableTools, setAvailableTools] = useState([]);
  const [agentAllowWrite, setAgentAllowWrite] = useState(true);
  const [agentToolsLoading, setAgentToolsLoading] = useState(false);
  const [agentToolsError, setAgentToolsError] = useState(false);
  const [degradedAuthz, setDegradedAuthz] = useState(false);
  const [showAuthzFallbackModal, setShowAuthzFallbackModal] = useState(false);
  // Per-session dedupe key for the demo-authorize fallback modal (see effect below).
  const AUTHZ_FALLBACK_SHOWN_KEY = "authzFallbackModalShown";
  const authzFallbackShownRef = useRef(false);
  const toolPermissions = useMemo(() => {
    const map = {};
    for (const t of availableTools) if (t && t.name) map[t.name] = t;
    return map;
  }, [availableTools]);
  // Cold-start warm of the PingOne Authorize connection as soon as the user is
  // logged in, so the first tool discovery / tool call doesn't blip into the
  // "Demo Authorize" degraded fallback. Best-effort + server-side throttled.
  useEffect(() => {
    if (isLoggedIn) warmupAuthz();
  }, [isLoggedIn]);
  // Re-fetch the Authorize-filtered tool list whenever the user logs in, the
  // active vertical changes, or the write toggle flips. Stale-guarded so an
  // out-of-order response can't overwrite a newer one. On error we KEEP the
  // last-known-good list and raise agentToolsError so the UI can avoid failing
  // open (fetchAgentTools resolves with {error} on non-OK rather than throwing).
  useEffect(() => {
    if (!isLoggedIn) { setAvailableTools([]); setAgentToolsError(false); return; }
    let cancelled = false;
    setAgentToolsLoading(true);
    fetchAgentTools({ vertical: activeVerticalId || undefined, allowWrite: agentAllowWrite })
      .then((res) => {
        if (cancelled) return;
        if (res && res.error) {
          setAgentToolsError(true); // keep last-known-good toolPermissions
        } else {
          setAvailableTools((res && res.availableTools) || []);
          setAgentToolsError(false);
          const isDegraded = !!(res && res.degraded);
          setDegradedAuthz(isDegraded);
          // Only the real, persistent failover (PingOne Authorize reachable-but-
          // -down, gateway fell over to the mock) warrants the heads-up modal,
          // whose text says exactly that. A transient discovery blip
          // (degradedReason 'discovery_unreachable' — WS reconnect / token race,
          // common right after a restart) sets the badge but must NOT pop the
          // alarmist modal, which would otherwise misreport a healthy P1AZ as
          // unreachable. The badge (degradedAuthz) still shows for both, so the
          // degraded state is never hidden.
          const isFailover = isDegraded && res.degradedReason === "authz_failover";
          // Show the fallback heads-up at most once per browser session. A useRef
          // alone dedupes only within a single page load and would re-pop on every
          // refresh; sessionStorage persists across reloads and clears on tab close.
          const alreadyShown = authzFallbackShownRef.current
            || sessionStorageService.getItem(AUTHZ_FALLBACK_SHOWN_KEY, false) === true;
          if (isFailover && !alreadyShown) {
            authzFallbackShownRef.current = true;
            sessionStorageService.setItem(AUTHZ_FALLBACK_SHOWN_KEY, true);
            setShowAuthzFallbackModal(true);
          }
          if (!isDegraded) setDegradedAuthz(false);
        }
      })
      .catch(() => { if (!cancelled) setAgentToolsError(true); })
      .finally(() => { if (!cancelled) setAgentToolsLoading(false); });
    return () => { cancelled = true; };
  }, [isLoggedIn, activeVerticalId, agentAllowWrite]);
  /** Marketing `/` guests may chat (education / hints); banking triggers PingOne + return here. */
  const marketingGuestChatEnabled = useMemo(() => {
    const p = (location.pathname || "").replace(/\/$/, "") || "/";
    return !isLoggedIn && isPublicMarketingAgentPath(p);
  }, [isLoggedIn, location.pathname]);
  const isConfigured = oauthConfig && (oauthConfig.admin || oauthConfig.user);

  // Fetch real account IDs from the server whenever the user logs in.
  // Also re-runs when the vertical changes because themeManifest.id changes,
  // which causes isLoggedIn's referencing closure to re-evaluate. We call the
  // imperative helper directly from the vertical-switch effect below.
  const fetchLiveAccounts = useCallback(() => {
    fetch("/api/accounts/my", { credentials: "include", _silent: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.accounts?.length) return;
        setLiveAccounts(
          data.accounts.map((a) => ({
            id: a.id,
            name: a.name || a.accountType || "Account",
            type: a.accountType || a.account_type || "checking",
            balance: a.balance || 0,
            accountNumber: a.accountNumber || a.account_number || a.id,
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setLiveAccounts([]);
      return;
    }
    fetchLiveAccounts();
  }, [isLoggedIn, fetchLiveAccounts]);

  // Re-fetch accounts when the vertical switches so stale banking accounts
  // are replaced with the new vertical's seeded data. Also clear the chat
  // so messages from the previous vertical don't persist.
  const prevVerticalRef = useRef(null);
  useEffect(() => {
    const vid = themeManifest?.id ?? null;
    if (vid !== prevVerticalRef.current) {
      prevVerticalRef.current = vid;
      if (isLoggedIn) {
        fetchLiveAccounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
        setMessages(
          user
            ? [
                {
                  id: `${Date.now()}-vsw`,
                  role: "assistant",
                  content: welcomeMessage(
                    user,
                    embeddedFocus,
                    brandShortName,
                    themeAgent && themeAgent.greeting,
                  ),
                },
              ]
            : [],
        );
      }
    }
  }, [themeManifest, isLoggedIn, fetchLiveAccounts]);

  const suggestionList = useMemo(() => {
    if (isConfigEmbeddedFocus) {
      return effectiveUser?.role === "admin"
        ? SUGGESTIONS_CONFIG_ADMIN
        : SUGGESTIONS_CONFIG_CUSTOMER;
    }
    return effectiveUser?.role === "admin"
      ? SUGGESTIONS_ADMIN
      : SUGGESTIONS_CUSTOMER;
  }, [isConfigEmbeddedFocus, effectiveUser?.role]);

  /**
   * Independently check auth endpoints.  Called on mount, on panel open, and
   * when the 'userAuthenticated' event fires (App.js dispatches this after login).
   * Checks all three session types: admin OAuth, end-user OAuth, and basic auth.
   * Does NOT dispatch userAuthenticated — that caused an infinite loop with App.js
   * (App listens → checkOAuthSession → agent listener → checkSelfAuth → dispatch → …).
   * Mount / OAuth-retry paths dispatch once when they first discover a session.
   */
  const checkSelfAuth = useCallback(() => {
    Promise.all([
      getCachedStatus("/api/auth/oauth/status").catch(() => null),
      getCachedStatus("/api/auth/oauth/user/status").catch(() => null),
      getCachedStatus("/api/auth/session").catch(() => null),
    ]).then(([admin, endUser, session]) => {
      const { found, cookieOnlyBffSession: cookieOnly } =
        resolveSessionFromAuthTrio(admin, endUser, session);
      setCookieOnlyBffSession(cookieOnly);
      if (found) {
        setSessionUser(found);
        // Clear any stale consent-decline block — user has a fresh session.
        setAgentBlockedByConsentDecline(false);
      }
      if (endUser?.enterpriseManagedMode) {
        setMcpAuthMode("enterprise-managed");
      } else {
        setMcpAuthMode("consumer");
      }
    });
  }, []);

  // P1 — When the BFF returns cookieOnlyBffSession:true, poll /api/auth/session
  // every 2s for up to 10s. Once the Upstash write has propagated (cookieOnlyBffSession
  // becomes false) clear the banner and let normal interaction resume.
  useEffect(() => {
    if (!cookieOnlyBffSession) {
      setSessionReconnecting(false);
      return;
    }
    setSessionReconnecting(true);
    let attempts = 0;
    const MAX_ATTEMPTS = 5; // 5 × 2s = 10s
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const r = await fetch("/api/auth/session", {
          credentials: "include",
          _silent: true,
        });
        if (r.ok) {
          const data = await r.json();
          if (!data.cookieOnlyBffSession) {
            setCookieOnlyBffSession(false);
            setSessionReconnecting(false);
            clearInterval(interval);
            return;
          }
        }
      } catch (_) {
        /* non-fatal */
      }
      if (attempts >= MAX_ATTEMPTS) {
        setSessionReconnecting(false);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [cookieOnlyBffSession]);

  /** RFC 6749 refresh — does not log out; retries server-side session tokens. */
  const handleSessionRefresh = useCallback(async () => {
    setSessionRefreshing(true);
    try {
      const r = await refreshOAuthSession();
      if (r.ok) {
        notifySuccess("Access token refreshed. You can retry your action.");
        checkSelfAuth();
      } else {
        notifyError(
          "Could not refresh — use Sign in again or reload the page.",
        );
      }
    } catch (e) {
      notifyError(e?.message || "Refresh failed");
    } finally {
      setSessionRefreshing(false);
    }
  }, [checkSelfAuth]);

  // Check on mount — auto-open if already authenticated (e.g. page refresh after login)
  useEffect(() => {
    // If App.js already resolved a session, use it immediately — no async needed.
    if (effectiveUser) {
      setMessages((prev) => {
        if (prev.length > 0 && prev.some((m) => m.role === "assistant" && !m.tool)) return prev;
        const welcome = {
          id: `${Date.now()}-w`,
          role: "assistant",
          content: welcomeMessage(effectiveUser, embeddedFocus, brandShortName, themeAgent && themeAgent.greeting),
        };
        return prev.length === 0 ? [welcome] : [welcome, ...prev];
      });
      return;
    }
    Promise.all([
      getCachedStatus("/api/auth/oauth/status").catch(() => null),
      getCachedStatus("/api/auth/oauth/user/status").catch(() => null),
      getCachedStatus("/api/auth/session").catch(() => null),
    ]).then(([admin, endUser, session]) => {
      const { found, cookieOnlyBffSession: cookieOnly } =
        resolveSessionFromAuthTrio(admin, endUser, session);
      setCookieOnlyBffSession(cookieOnly);
      if (found) {
        setSessionUser(found);
        // Clear any stale consent-decline block from previous sessions.
        setAgentBlockedByConsentDecline(false);
        const welcome = {
          id: `${Date.now()}-w`,
          role: "assistant",
          content: welcomeMessage(
            found,
            embeddedFocus,
            brandShortName,
            themeAgent && themeAgent.greeting,
          ),
        };
        if (cookieOnly) {
          sessionFixBubbleShownRef.current = true;
          setMessages([
            welcome,
            {
              id: `${Date.now()}-fix`,
              role: "error",
              content: buildSessionNotHydratedChat(
                session?.sessionStoreError ?? null,
                session?.sessionStoreHealthy ?? null,
              ),
              showSessionFixActions: true,
            },
          ]);
        } else {
          // Prepend welcome without wiping auto-loaded account/transaction messages that may have raced ahead.
          // If a non-tool assistant message already exists (duplicate welcome), skip.
          setMessages((prev) => {
            if (prev.length === 0) return [welcome];
            if (prev.some((m) => m.role === "assistant" && !m.tool))
              return prev;
            return [welcome, ...prev];
          });
        }
      } else {
        // No session — show a guest greeting so the chat isn't a blank void.
        // Guard: only seed if empty, so a re-run of this effect doesn't wipe
        // an in-progress conversation.
        setMessages((prev) =>
          prev.length === 0
            ? [{
                id: `${Date.now()}-guest`,
                role: "assistant",
                content: `Hi! I'm the ${brandShortName || "AI"} assistant.\n\nSign in with your customer account to access banking features — account balances, transfers, and more. Or ask me about OAuth, PKCE, MCP, or how AI agents work.`,
              }]
            : prev
        );
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInline, embeddedFocus, effectiveUser]);

  // Re-check when App.js confirms a login, and auto-open the agent
  useEffect(() => {
    const onAuth = () => {
      checkSelfAuth();
      setMessages((prev) => {
        const isOnlyGuestMsg = prev.length === 1 && prev[0]?.id?.endsWith("-guest");
        if (prev.length === 0 || isOnlyGuestMsg) {
          return [{
            id: Date.now().toString(),
            role: "assistant",
            content: welcomeMessage(
              user || sessionUserRef.current,
              embeddedFocus,
              brandShortName,
              themeAgent && themeAgent.greeting,
            ),
          }];
        }
        return prev;
      });
    };
    window.addEventListener("userAuthenticated", onAuth);
    return () => window.removeEventListener("userAuthenticated", onAuth);
  }, [
    checkSelfAuth,
    user,
    isInline,
    embeddedFocus,
    brandShortName,
    industryPreset.id,
    themeAgent,
  ]);

  // Auto-retry after CIBA step-up approval
  useEffect(() => {
    const onStepUpApproved = () => {
      agentFlowDiagram.completeMfaChallenge(true);
      if (!pendingStepUpActionRef.current) return;
      const { actionId, form, method } = pendingStepUpActionRef.current;
      pendingStepUpActionRef.current = null;
      const methodLabel = method === "ciba" ? "CIBA" : "Email OTP";
      const ts = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      addMessage(
        "assistant",
        `✅ ${methodLabel} approved — continuing your request (${ts})`,
        actionId,
      );
      runAction(actionId, form, { isRefire: true });
    };
    const onStepUpCancelled = () =>
      agentFlowDiagram.completeMfaChallenge(false);
    window.addEventListener("cibaStepUpApproved", onStepUpApproved);
    window.addEventListener("cibaStepUpCancelled", onStepUpCancelled);
    return () => {
      window.removeEventListener("cibaStepUpApproved", onStepUpApproved);
      window.removeEventListener("cibaStepUpCancelled", onStepUpCancelled);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-retry after login (auth challenge path)
  useEffect(() => {
    const onAuthChallengeLogin = () => {
      if (!pendingAuthChallengeActionRef.current) return;
      const { actionId, form } = pendingAuthChallengeActionRef.current;
      pendingAuthChallengeActionRef.current = null;
      PendingActionManager.clear();
      addMessage(
        "assistant",
        "✅ Signed in — retrying your request…",
        actionId,
      );
      runAction(actionId, form, { isRefire: true });
    };
    window.addEventListener("userAuthenticated", onAuthChallengeLogin);
    return () =>
      window.removeEventListener("userAuthenticated", onAuthChallengeLogin);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check when panel opens (catches sessions established after mount)
  useEffect(() => {
    if (isOpen) checkSelfAuth();
  }, [isOpen, checkSelfAuth]);

  // Mutual exclusion: close agent when an education panel opens
  useEffect(() => {
    if (edu?.panel) setIsOpen(false);
  }, [edu?.panel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mutual exclusion: close any open education panel when agent opens.
  // Deps intentionally omit edu?.panel — if edu.panel is included, this effect fires when
  // the user opens an edu panel (edu.panel null→set), sees isOpen=true (stale render snapshot),
  // and immediately calls edu.close(), killing the panel before it renders.
  useEffect(() => {
    if (isOpen && edu?.panel) edu.close();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check config status from IndexedDB cache whenever panel opens
  useEffect(() => {
    if (isOpen && !isLoggedIn) {
      loadPublicConfig()
        .then((cfg) => {
          const env = !!cfg.pingone_environment_id;
          setOauthConfig({
            admin: env && !!cfg.admin_client_id,
            user: env && !!cfg.user_client_id,
          });
        })
        .catch(() => setOauthConfig({ admin: false, user: false }));
    }
  }, [isOpen, isLoggedIn]);

  useEffect(() => {
    if (!isOpen && !isInline) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    // requestAnimationFrame ensures scrollHeight is measured after the browser paints new content
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isOpen, isInline, loading, nlLoading]);

  useEffect(() => {
    if (!isOpen && !isInline) return;
    if (!isLoggedIn && !marketingGuestChatEnabled) return;
    fetchNlStatus()
      .then(setNlMeta)
      .catch(() => setNlMeta({ geminiConfigured: false }));
    // Load feature flags to sync UI-controlled toggles
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const heuristicFlag = data?.flags?.find((f) => f.id === "ff_heuristic_enabled");
        if (heuristicFlag != null) setHeuristicEnabled(Boolean(heuristicFlag.value));
        const panelFlag = data?.flags?.find((f) => f.id === "ff_agent_results_panel");
        if (panelFlag != null) setAgentResultsPanelEnabled(Boolean(panelFlag.value));
        const aguiFlag = data?.flags?.find((f) => f.id === "ff_agui_enabled");
        if (aguiFlag != null) setAguiEnabled(Boolean(aguiFlag.value));
        const actFlag = data?.flags?.find((f) => f.id === "ff_activity_narration");
        if (actFlag != null) setActivityNarrationEnabled(Boolean(actFlag.value));
      })
      .catch(() => {});
  }, [isOpen, isInline, isLoggedIn, marketingGuestChatEnabled]);

  // Keep MCP status lightweight here to avoid auth/noise calls while browsing dashboards.
  useEffect(() => {
    if (!isOpen || !isLoggedIn) return;
    setMcpStatus({ toolCount: ACTIONS.length, connected: true });
  }, [isOpen, isLoggedIn]);


  // AG-UI Step 3 — sync streamed messages from aguiState into the chat thread.
  // Only active when ff_agui_enabled=true; no-op otherwise.
  // Each new assistant message from AG-UI appears as a chat bubble as it streams.
  useEffect(() => {
    if (!aguiEnabled) return;
    const lastMsg = aguiState.messages[aguiState.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    // Update or add the final assistant message in the BA chat thread.
    // Shape must match the chat renderer: { role, content } — it filters on
    // msg.role and renders msg.content, so a { sender, text } message is
    // silently invisible.
    setMessages((prev) => {
      const existing = prev.findIndex((m) => m.id === lastMsg.id);
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = { ...next[existing], content: lastMsg.content, streaming: lastMsg.streaming };
        return next;
      }
      // New message: append
      return [...prev, { id: lastMsg.id, role: 'assistant', content: lastMsg.content, streaming: lastMsg.streaming }];
    });
  }, [aguiEnabled, aguiState.messages]);

  // AG-UI Step 3 — sync observability slices into TokenChain when flag is on.
  useEffect(() => {
    if (!aguiEnabled || !aguiState.tokenEvents.length) return;
    if (tokenChain) {
      tokenChain.setTokenEvents('agent', aguiState.tokenEvents);
    }
    const rfcMsg = buildTokenEventMsg(aguiState.tokenEvents);
    if (rfcMsg) addMessage('token-event', rfcMsg, null);
    // `tokenChain` is deliberately NOT a dependency: setTokenEvents always
    // prepends a history entry, which rebuilds the context value — listing it
    // here re-fired this effect on its own write, an infinite render loop
    // ("Maximum update depth exceeded" ~4/s). setTokenEvents has stable
    // identity (useCallback []), so the captured reference stays valid.
  }, [aguiEnabled, aguiState.tokenEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  // AG-UI token usage — accumulate into Token Teller when agent reports counts.
  useEffect(() => {
    if (!aguiEnabled) return;
    const usage = aguiState.lastTokenUsage;
    if (!usage || (!usage.inputTokens && !usage.outputTokens)) return;
    setSessionTokens((prev) => ({ input: prev.input + usage.inputTokens, output: prev.output + usage.outputTokens }));
    setLifetimeTokens((prev) => {
      const next = { input: prev.input + usage.inputTokens, output: prev.output + usage.outputTokens };
      try { localStorage.setItem('ba_tokens_lifetime', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  }, [aguiEnabled, aguiState.lastTokenUsage]); // eslint-disable-line react-hooks/exhaustive-deps

  // AG-UI Step 5 — push MCP traffic entries into mcpCallStore (live, no polling).
  const onNewMcpEntries = useCallback((newEntries) => {
    for (const entry of newEntries) {
      appendMcpCall(
        entry.tool,
        entry.durationMs != null ? 200 : 0,
        entry.durationMs ?? null,
        entry.direction === 'response' ? entry.payload : null,
        entry.direction === 'response' && entry.payload?.error ? String(entry.payload.error) : null,
      );
    }
  }, []);
  useNewItems(aguiState.mcpTraffic, aguiEnabled, onNewMcpEntries);

  // AG-UI Step 6 — push Authorize decisions into authorizeDecisionStore (live, no polling).
  const onNewAuthorizeDecisions = useCallback((newDecisions) => {
    for (const d of newDecisions) appendAuthorizeDecision(d);
  }, []);
  useNewItems(aguiState.authorizeDecisions, aguiEnabled, onNewAuthorizeDecisions);

  // Activity narration — friendly per-step story (mirrors the useNewItems pattern above).
  // Vertical-aware institution noun for the narration copy (recomputed each render — fine).
  const activityInstitution = (pageManifest?.identity?.displayName) || 'service';
  const onNewAuthorizeNarration = useCallback((newDecisions) => {
    for (const d of newDecisions) activityUpsertStep(authorizeDecisionToStep(d, activityInstitution));
  }, [activityUpsertStep, activityInstitution]);
  useNewItems(aguiState.authorizeDecisions, aguiEnabled && activityNarrationEnabled, onNewAuthorizeNarration);

  // Tool calls update in place (status running→done), so reconcile on every change rather than on growth.
  useEffect(() => {
    if (!aguiEnabled || !activityNarrationEnabled) return;
    for (const step of reconcileToolSteps(aguiState.toolCalls)) activityUpsertStep(step);
  }, [aguiEnabled, activityNarrationEnabled, aguiState.toolCalls, activityUpsertStep]);

  // Error → friendly recovery step.
  useEffect(() => {
    if (!aguiEnabled || !activityNarrationEnabled || !aguiState.error) return;
    activityUpsertStep(errorStep(activityInstitution));
  }, [aguiEnabled, activityNarrationEnabled, aguiState.error, activityUpsertStep, activityInstitution]);

  // AG-UI run error → visible chat bubble. Without this a failed run (RUN_ERROR
  // from the BFF, stream failure, MCP tool 503) left the thread silent — the
  // user saw only RFC-info token events and no reply, which made config faults
  // look like a dead agent. Dedupe per error value: useAgentState resets error
  // to null on RUN_STARTED, so each new failure produces exactly one bubble.
  const aguiErrorBubbleRef = useRef(null);
  useEffect(() => {
    if (!aguiState.error) {
      // RUN_STARTED cleared the error — re-arm so an identical failure on the
      // next run still gets its own bubble.
      aguiErrorBubbleRef.current = null;
      return;
    }
    if (aguiErrorBubbleRef.current === aguiState.error) return;
    aguiErrorBubbleRef.current = aguiState.error;
    addMessage(
      "error",
      `⚠️ The agent request failed: ${aguiState.error} — open Token Chain or MCP Traffic to see the failing step, then try again.`,
    );
    // addMessage has stable identity for the life of the component; listing it
    // would re-fire this effect on unrelated renders.
  }, [aguiState.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run finished → close the story (unless it's an HITL/step-up interrupt,
  // in which case the agent is suspended waiting for the user — keep running).
  useEffect(() => {
    if (!aguiEnabled || !activityNarrationEnabled || !aguiState.lastOutcome) return;
    if (aguiState.lastOutcome?.type === 'interrupt') {
      // Pending approval: narrate the wait, do NOT finish the request.
      activityUpsertStep(hitlStep());
      return;
    }
    const failed = aguiState.lastOutcome?.type === 'error';
    if (!failed) activityUpsertStep(answerStep());
    activityFinishRequest(failed ? 'failed' : 'done');
  }, [aguiEnabled, activityNarrationEnabled, aguiState.lastOutcome, activityUpsertStep, activityFinishRequest]);

  // Legacy (non-AG-UI) narration: the BFF returns server-authoritative semantic
  // steps in response.activity.steps. Feed them into the same panel the AG-UI
  // path uses. Gated to !aguiEnabled so the two paths never double-narrate.
  const ingestActivity = useCallback((response, prompt) => {
    if (aguiEnabled || !activityNarrationEnabled) return;
    const steps = response?.activity?.steps;
    if (!Array.isArray(steps) || steps.length === 0) return;
    activityStartRequest(prompt || '');
    for (const record of steps) {
      const step = mapActivityRecord(record, activityInstitution);
      if (step) activityUpsertStep(step);
    }
    // finalStatus is the BFF's authoritative terminal state: 'done'|'failed'
    // closes the story; null = suspended awaiting user approval (step-up/HITL),
    // so the request stays open.
    const finalStatus = response?.activity?.finalStatus;
    if (finalStatus) activityFinishRequest(finalStatus);
  }, [aguiEnabled, activityNarrationEnabled, activityInstitution, activityStartRequest, activityUpsertStep, activityFinishRequest]);

  // AG-UI cleanup — abort in-flight run and reset state on unmount.
  useEffect(() => {
    return () => {
      aguiAbort();
      aguiReset();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AG-UI Step 7 — HITL via interrupt: show GatewayConsentModal when the agent suspends.
  // aguiState.hitlPending is set by useAgentState on RUN_FINISHED { outcome.type: 'interrupt' }.
  const [aguiHitlPending, setAguiHitlPending] = React.useState(null);
  useEffect(() => {
    if (!aguiEnabled) return;
    if (aguiState.hitlPending) {
      setAguiHitlPending({
        ...aguiState.hitlPending,
        runId: aguiActiveRunIdRef.current,
      });
    } else {
      setAguiHitlPending(null);
    }
  }, [aguiEnabled, aguiState.hitlPending]);

  const { submitConsent } = useHitlConsent({
    hitlPending: aguiHitlPending,
    runId: aguiHitlPending?.runId ?? null,
  });

  const handleAguiHitlApprove = useCallback(async () => {
    const interrupt = aguiHitlPending;
    if (!interrupt) return;
    setAguiHitlPending(null);

    // Initiate OTP (non-fatal — OTP modal still shows even if this fails)
    try {
      await initiateStepUpOtp();
    } catch (_) { /* non-fatal */ }

    // Post-OTP callback: signal consent via pub/sub, then resume the AG-UI agent
    pendingStepUpCallbackRef.current = async () => {
      try {
        await submitConsent(true);
      } catch (err) {
        console.warn("[AIAgent] HITL consent signal failed:", err?.message || err);
      }
      const threadId = aguiThreadIdRef.current || ('ba-' + Date.now());
      const runId = 'resume-' + Date.now();
      aguiActiveRunIdRef.current = runId;
      setNlLoading(true);
      const conversationHistory = (aguiState.messages || [])
        .filter((m) => !m.streaming)
        .map(({ role, content }) => ({ role, content }));
      aguiRun({
        threadId,
        runId,
        messages: conversationHistory,
        resume: [{ interruptId: interrupt.id, status: 'approved' }],
      }).finally(() => setNlLoading(false));
    };

    setOtpContextLine("Verify your identity to approve this agent action");
    setShowOtpModal(true);
  }, [aguiHitlPending, aguiRun, aguiState.messages, submitConsent]);

  const handleAguiHitlDismiss = useCallback(async () => {
    const interrupt = aguiHitlPending;
    if (!interrupt) return;
    setAguiHitlPending(null);
    try {
      await submitConsent(false);
    } catch (err) {
      console.warn("[AIAgent] HITL consent denial signal failed:", err?.message || err);
    }
    const threadId = aguiThreadIdRef.current || ('ba-' + Date.now());
    const runId = 'cancel-' + Date.now();
    // Pass conversation history even for cancel so the agent can acknowledge gracefully.
    const conversationHistory = (aguiState.messages || [])
      .filter((m) => !m.streaming)
      .map(({ role, content }) => ({ role, content }));
    aguiRun({
      threadId,
      runId,
      messages: conversationHistory,
      resume: [{ interruptId: interrupt.id, status: 'cancelled' }],
    });
  }, [aguiHitlPending, aguiRun, aguiState.messages, submitConsent]);

    // Cancel any previous in-flight send, create a fresh AbortController, and
  // return the new signal. Called once at the top of every real send path.
  const beginAbortableSend = useCallback(() => {
    // Abort any prior in-flight send. Load-bearing: the nlResumeAfterAuth
    // effect is NOT reentrancy-guard-protected, so it can supersede a
    // guarded send's I/O — cancel it rather than let it race.
    if (sendAbortRef.current) {
      try { sendAbortRef.current.abort(); } catch (_) {}
    }
    const c = new AbortController();
    sendAbortRef.current = c;
    return c.signal;
  }, []);

  // Clamp a floating-panel position into the current viewport using the
  // latest panel size (read via ref so listeners needn't resubscribe).
  const clampDragPosToViewport = useCallback((prev) => {
    if (!prev) return prev;
    return clampPanelPosition(prev, panelSizeRef.current, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }, []);

  // ── Drag-to-move ──────────────────────────────────────────────────────────
  // Uses pointer capture so dragging continues off-screen onto a second monitor.
  const handleDragStart = useCallback((e) => {
    // Don't intercept interactive controls. Switch toggles render as a <label>
    // wrapping an input with pointer-events:none, so the pointerdown target is
    // the label, not the input — match label too or the preventDefault() below
    // kills the click that toggles the checkbox.
    if (e.target.closest("button, input, textarea, select, label")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    // Always anchor to current visual position and exit expanded mode so panelStyle
    // uses the drag coordinates (isExpanded causes the centered style to win otherwise)
    setIsExpanded(false);
    setDragPos({ x: rect.left, y: rect.top });
    e.preventDefault();
    document.body.style.userSelect = "none";

    // Capture pointer on the panel so events keep firing even off-browser-window
    const target = panelRef.current || e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop if not pointer event */
    }

    function onMove(ev) {
      if (!isDraggingRef.current) return;
      // No clamping — allow drag to second screen
      const x = ev.clientX - dragOffsetRef.current.x;
      const y = ev.clientY - dragOffsetRef.current.y;
      setDragPos({ x, y });
    }
    function onUp() {
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      // Drag itself is unclamped (second-monitor drag is intentional); on
      // RELEASE, pull the panel back so the header strip stays reachable.
      setDragPos(clampDragPosToViewport);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, [clampDragPosToViewport]);

  // (drag listeners now attached inline in handleDragStart via pointer capture)
  useEffect(() => {
    /* no-op — kept for hook ordering stability */
  }, []);

  // Resize handler — works whether the panel is at CSS default position or has been dragged.
  // Supports all 8 directions: n, ne, e, se, s, sw, w, nw.
  // N/W/NW/NE/SW directions shift dragPos so the opposite edge stays fixed.
  const handleResize = useCallback(
    (e, direction) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      // Pointer capture keeps events firing even when the cursor leaves the handle
      try {
        target.setPointerCapture(e.pointerId);
      } catch (_) {}
      document.body.style.userSelect = "none";

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = panelSize.width;
      const startHeight = panelSize.height;

      // Exit expanded mode on resize (same as drag)
      setIsExpanded(false);

      // Capture starting position from current dragPos or from getBoundingClientRect.
      // Must be done synchronously so onMove calculations are anchored correctly.
      let startPosX, startPosY;
      const rect = panelRef.current?.getBoundingClientRect();
      if (dragPos) {
        startPosX = dragPos.x;
        startPosY = dragPos.y;
      } else if (rect) {
        startPosX = rect.left;
        startPosY = rect.top;
        setDragPos({ x: rect.left, y: rect.top });
      } else {
        startPosX = 0;
        startPosY = 0;
      }

      function onMove(ev) {
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;
        const MIN_W = 280,
          MIN_H = 220;
        const MAX_W = Math.floor(window.innerWidth * 0.95);
        const MAX_H = Math.floor(window.innerHeight * 0.95);

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newX = startPosX;
        let newY = startPosY;

        // Right edge — grows rightward, position unchanged
        if (direction === "e" || direction === "se" || direction === "ne") {
          newWidth = Math.min(MAX_W, Math.max(MIN_W, startWidth + deltaX));
        }
        // Left edge — grows leftward, left position shifts
        if (direction === "w" || direction === "sw" || direction === "nw") {
          newWidth = Math.min(MAX_W, Math.max(MIN_W, startWidth - deltaX));
          newX = startPosX + (startWidth - newWidth);
        }
        // Bottom edge — grows downward, position unchanged
        if (direction === "s" || direction === "se" || direction === "sw") {
          newHeight = Math.min(MAX_H, Math.max(MIN_H, startHeight + deltaY));
        }
        // Top edge — grows upward, top position shifts
        if (direction === "n" || direction === "ne" || direction === "nw") {
          newHeight = Math.min(MAX_H, Math.max(MIN_H, startHeight - deltaY));
          newY = startPosY + (startHeight - newHeight);
        }

        setPanelSize({ width: newWidth, height: newHeight });
        setDragPos({ x: newX, y: newY });
      }

      function onUp() {
        document.body.style.userSelect = "";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [panelSize, dragPos],
  );

  // Panel position: override CSS anchoring when user has dragged the window
  // In inline mode the CSS (.ba-mode-inline) handles size — no inline style needed
  const panelStyle = isInline
    ? {}
    : isExpanded
      ? {
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(94vw, 520px)",
          height: "min(85vh, 720px)",
          maxWidth: 560,
          maxHeight: "85vh",
          right: "auto",
          bottom: "auto",
        }
      : dragPos
        ? {
            left: dragPos.x,
            top: dragPos.y,
            bottom: "auto",
            right: "auto",
            width: panelSize.width,
            height: panelSize.height,
            transform: "none",
          }
        : {
            width: panelSize.width,
            height: panelSize.height,
            transform: "none",
          };
  /** Results panel width (CSS) — keep gap in sync when dragging / expanded layout */
  const resultsPanelWidthPx = 340;

  // In inline mode the panel is always visible; in float mode respect the open/closed state
  const effectiveIsOpen = isInline || isOpen;

  // Keep agentBounds fresh whenever the panel resizes (chips expand/collapse, resize handle use)
  useEffect(() => {
    const update = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect)
        setAgentBounds({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        });
    };
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    update();
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsOpen, panelSize, isExpanded]);

  // Also update bounds on drag (ResizeObserver fires only on size changes, not position)
  useEffect(() => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect)
      setAgentBounds({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
  }, [dragPos]);

  // Recover the floating panel if the viewport shrinks (or rotates) while the
  // panel was dragged near/over an edge. Float mode only — inline uses CSS.
  useEffect(() => {
    if (isInline) return;
    function onResize() {
      setDragPos(clampDragPosToViewport);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isInline, clampDragPosToViewport]);

  const resultsPanelStyle = useMemo(() => {
    const gap = 12;
    const rpW = resultsPanelWidthPx;
    // Anchor to actual agent panel bounds when available — works for all modes (inline, drag, expanded, default)
    if (agentBounds) {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
      const topEdge = Math.max(8, agentBounds.top);
      const maxH = Math.min(
        (typeof window !== "undefined" ? window.innerHeight : 800) -
          topEdge -
          16,
        520,
      );
      // Place the results panel to the LEFT of the agent, pushed right if it would overflow
      const desiredLeft = Math.max(8, agentBounds.left - rpW - gap);
      return {
        position: "fixed",
        left: Math.min(desiredLeft, vw - rpW - 8),
        top: topEdge,
        bottom: "auto",
        right: "auto",
        maxHeight: maxH,
        zIndex: 10058,
      };
    }
    // Fallbacks when bounds not yet measured
    if (isInline) {
      // Try to read panel bounds synchronously from the ref (avoids CSS flash at wrong position)
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        const topEdge = Math.max(8, rect.top);
        const maxH = Math.min(window.innerHeight - topEdge - 16, 520);
        const desiredLeft = Math.max(8, rect.left - rpW - gap);
        return {
          position: "fixed",
          left: Math.min(desiredLeft, window.innerWidth - rpW - 8),
          top: topEdge,
          bottom: "auto",
          right: "auto",
          maxHeight: maxH,
          zIndex: 10058,
        };
      }
      // Ref not yet mounted — use off-screen coords to prevent CSS flash at wrong edge
      return { position: "fixed", left: -9999, top: -9999, zIndex: -1 };
    }
    if (dragPos) {
      return {
        position: "fixed",
        left: Math.max(8, dragPos.x - rpW - gap),
        top: dragPos.y,
        bottom: "auto",
        right: "auto",
        zIndex: 10058,
      };
    }
    if (isExpanded) {
      return {
        position: "fixed",
        left: `max(8px, calc(50vw - min(94vw, 520px) / 2 - ${gap}px - ${rpW}px))`,
        top: "50vh",
        transform: "translateY(-50%)",
        bottom: "auto",
        right: "auto",
        zIndex: 10058,
      };
    }
    return undefined;
  }, [dragPos, isExpanded, isInline, resultsPanelWidthPx, agentBounds]);

  function addMessage(role, content, tool, extra = {}) {
    const { id: exId, ...rest } = extra;
    const id = exId || `${Date.now()}`;
    // Ensure content is always a string for React rendering
    const contentString =
      typeof content === "string" ? content : JSON.stringify(content);
    setMessages((prev) => [
      ...prev,
      { id, role, content: contentString ?? "", tool, ...rest },
    ]);
  }

  // Route an agent response's verticalResult to its renderer and return the
  // addMessage `extra` for inline display. The render descriptor is resolved
  // from the active manifest (the mapping verticals provide). When the floating
  // Results Panel is enabled it owns the card; otherwise the card renders inline
  // under the reply bubble ("results inline only" — the documented default).
  // Mutually exclusive so the same card never shows twice.
  function verticalResultExtra(response) {
    const vr = response?.verticalResult;
    if (!vr) return {};
    const descriptor = pageManifest?.render?.[vr.render] || null;
    if (agentResultsPanelEnabled) {
      setResultPanel({
        type: "vertical",
        title: descriptor?.title || "Result",
        descriptor,
        data: vr.data,
        terminology,
      });
      return {};
    }
    return { verticalResult: { descriptor, data: vr.data, terminology } };
  }

  function markToolProgressOutcome(success, errorDetail = null) {
    const tid = toolProgressIdRef.current;
    if (!tid) return;
    toolProgressIdRef.current = null;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === tid && m.role === "tool-progress"
          ? {
              ...m,
              steps: (m.steps || []).map((s) => ({
                ...s,
                status: success ? "success" : "error",
                ...(!success && errorDetail ? { error: errorDetail } : {}),
              })),
            }
          : m,
      ),
    );
  }

  /** Show overlay then redirect to PingOne login. */
  async function handleLoginAction(actionId) {
    const label = actionId === "login_admin" ? "Admin" : "Customer";
    spinner.show(`Signing in as ${label}…`, "Redirecting to PingOne");
    // Save any pending prompt so it can be re-executed after OAuth return.
    // nlInput holds the current typed/pre-filled text; capture it before navigation.
    const pendingText = (nlInput || "").trim();
    if (pendingText) {
      sessionStorageService.setItem(BX_AGENT_PENDING_NL_KEY, pendingText);
    }
    // BUG 2 fix: persist pending ucId across the OAuth redirect so it survives
    // component unmount (the ref dies; sessionStorage survives the redirect).
    try {
      const ucIdInFlight = pendingUcIdRef.current
        || sessionStorage.getItem(BX_AGENT_PENDING_UC_ID_KEY);
      if (ucIdInFlight) sessionStorage.setItem(BX_AGENT_PENDING_UC_ID_KEY, ucIdInFlight);
    } catch (_) {}
    const apiUrl = process.env.REACT_APP_API_URL || window.location.origin;
    if (actionId === "login_admin") {
      setTimeout(() => {
        window.location.href = `${apiUrl}/api/auth/oauth/login`;
      }, 150);
      return;
    }
    if (actionId === "login_user") {
      let usePiFlow = false;
      try {
        const r = await fetch("/api/admin/config", { credentials: "include" });
        const j = await r.json();
        const cfg = j?.config || {};
        if (cfg.marketing_customer_login_mode === "slide_pi_flow")
          usePiFlow = true;
      } catch (_) {
        /* keep default redirect */
      }
      setTimeout(() => {
        const p = (location.pathname || "").replace(/\/$/, "") || "/";
        const params = new URLSearchParams();
        if (isPublicMarketingAgentPath(p))
          params.set("return_to", p === "/dashboard" ? "/dashboard" : "/");
        if (usePiFlow) params.set("use_pi_flow", "1");
        const q = params.toString();
        window.location.href = `${apiUrl}/api/auth/oauth/user/login${q ? `?${q}` : ""}`;
      }, 150);
      return;
    }
    // Default behavior for other action IDs
    let usePiFlow = false;
    try {
      const r = await fetch("/api/admin/config", { credentials: "include" });
      const j = await r.json();
      const cfg = j?.config || {};
      if (cfg.marketing_customer_login_mode === "slide_pi_flow")
        usePiFlow = true;
    } catch (_) {
      /* keep default redirect */
    }
    setTimeout(() => {
      const p = (location.pathname || "").replace(/\/$/, "") || "/";
      const params = new URLSearchParams();
      if (isPublicMarketingAgentPath(p))
        params.set("return_to", p === "/dashboard" ? "/dashboard" : "/");
      if (usePiFlow) params.set("use_pi_flow", "1");
      const q = params.toString();
      window.location.href = `${apiUrl}/api/auth/oauth/user/login${q ? `?${q}` : ""}`;
    }, 150);
  }

  /**
   * Runs a banking tool. When fromNl is true, skips the extra user bubble (NL already echoed the ask).
   */
  async function runAction(actionId, form, opts = {}) {
    if (isAgentBlockedByConsentDecline()) {
      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
      return;
    }
    // Layer-zero auth gate: save pending action and auto-redirect to PingOne so the
    // request replays automatically after login (via onAuthChallengeLogin)
    if (!isLoggedIn) {
      pendingAuthChallengeActionRef.current = { actionId, form };
      PendingActionManager.save({ actionId, form });
      addMessage(
        "assistant",
        " Signing you in — your request will run automatically after you sign in.",
      );
      handleLoginAction("login_user");
      return;
    }
    // nlSource: when this action was reached via the NL pipeline, the routing
    // engine ("heuristic" | "helix" | "lmstudio" | ...) is threaded here so the
    // assistant result carries the same source pill the conversational
    // answers already render (see msg.source label, ~line 8300).
    // hitlRetryChallengeId: set on a HITL-approval refire so the write tool
    // echoes the approved challenge id back to the BFF gate (verified → consent
    // gate discharged → retry PERMITs instead of re-issuing the 428). Named
    // distinctly from the component-scope `hitlChallengeId` state (direct-UI
    // consent modal) to avoid shadowing it inside runAction.
    // useCaseId/vertical: threaded from the chip/dispatch caller so the tool
    // call carries proof-of-enforcement context (mirrors callMcpTool's own
    // useCaseId/vertical opts — see demoAgentService.js).
    const { skipUserLabel = false, isRefire = false, nlSource = null, hitlRetryChallengeId = null, useCaseId = null, vertical = null } = opts;
    const resultExtra = nlSource ? { source: nlSource } : {};
    const label = ACTIONS.find((a) => a.id === actionId)?.label || actionId;
    if (!skipUserLabel) {
      addMessage("user", label);
    }
    if (!isRefire) {
      try {
        agentFlowDiagram.resetComplianceSteps(label, actionId);
      } catch (_) {}
      try {
        agentFlowDiagram.startLlmReasoning(label);
      } catch (_) {}
    }
    setLoading(true);
    postAppEvent("agent", "info", "Agent processing started", {
      tag: "agent/processing-start",
      metadata: { userId: effectiveUser?.id || effectiveUser?.username },
    });

    // Toast: show in-progress indicator
    const toastId = `agent-${actionId}-${Date.now()}`;
    toast.info(`${label}...`, { toastId, autoClose: false, isLoading: true });

    try {
      // Chips/tool-progress messages removed per user request (show only user + assistant messages)

      let response;
      switch (actionId) {
        case "demo_guide":
          // Show the interactive demo guide modal
          toast.dismiss(toastId);
          setShowDemoGuide(true);
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        case "accounts":
          toast.update(toastId, { render: " Calling get_my_accounts…" });
          response = await getMyAccounts({ useCaseId, vertical });
          response = { ...response, result: enforceVerticalAccountTypes(response.result, terminology) };
          break;
        case "mortgage_demo": {
          // Phase 267 Path A — api_key disposition, end-to-end:
          //   1. Call gateway MCP tool 'show_mortgage' (apikey disposition)
          //   2. Gateway enforces mortgage:read on the user bearer
          //   3. Gateway drops the OAuth bearer, attaches the service API key
          //   4. Gateway calls demo_mortgage_service (X-API-Key + X-User-Sub)
          //   5. Navigate to /path/mortgage with the payload in location.state
          // Destination route is hard-coded (T-266-04-01: no open-redirect).
          toast.update(toastId, {
            render:
              " Routing to mortgage path (gateway swaps OAuth bearer for service API key)…",
          });
          let mortgageResp;
          try {
            mortgageResp = await callMcpTool("show_mortgage", {}, { useCaseId, vertical });
          } catch (e) {
            console.error(
              "[BankingAgent] mortgage_demo dispatch failed:",
              e?.message,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            addMessage(
              "assistant",
              `Could not load mortgage data: ${e?.message || "gateway call failed"}.`,
              actionId,
              resultExtra,
            );
            return;
          }
          const mortgageMcp = mortgageResp?.result;
          const mortgageNorm = normalizeAgentToolResult(mortgageMcp);
          // Scope gate / backend error → JSON-RPC error surfaces as { error, message }.
          if (isAgentToolErrorResult(mortgageNorm)) {
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            const insufficient =
              mortgageNorm.error === "insufficient_scope" ||
              /scope/i.test(mortgageNorm.message || "");
            addMessage(
              "assistant",
              insufficient
                ? `The agent's access token does not carry the mortgage:read scope, so the gateway refused to swap it for the mortgage service API key. Sign out and sign back in to consent to mortgage access, then try "show mortgage data" again.`
                : `Could not load mortgage data: ${mortgageNorm.message || "backend error"}.`,
              actionId,
              resultExtra,
            );
            return;
          }
          const mortgageMeta = mortgageMcp?._meta || {};
          const mortgagePayload = {
            mortgage: mortgageNorm.mortgage,
            apiKeyMaskedLast4: mortgageMeta.apiKeyMaskedLast4,
            apiCall: mortgageMeta.apiCall,
            message: mortgageNorm.note || mortgageMeta.note,
            backend: {
              source: mortgageNorm.source,
              authMechanism: mortgageNorm.authMechanism,
              note: mortgageNorm.note,
            },
          };
          if (tokenChain && Array.isArray(mortgageResp?.tokenEvents)) {
            tokenChain.setTokenEvents(actionId, mortgageResp.tokenEvents);
          }
          toast.dismiss(toastId);
          setLoading(false);
          toolProgressIdRef.current = null;
          navigate("/path/mortgage", { state: { mortgagePayload } });
          return;
        }
        case "invest_demo": {
          // Path A — api_key disposition for show_investment (available on every customer vertical).
          // Always calls show_investment and renders with the investment featurePage schema,
          // even when the active vertical's own featurePage is mortgage/health/etc.
          toast.update(toastId, {
            render:
              " Routing to portfolio path (gateway swaps OAuth bearer for service API key)…",
          });
          let investResp;
          try {
            investResp = await callMcpTool("show_investment", {}, { useCaseId, vertical });
          } catch (e) {
            console.error(
              "[BankingAgent] invest_demo dispatch failed:",
              e?.message,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            addMessage(
              "assistant",
              `Could not load portfolio data: ${e?.message || "gateway call failed"}.`,
              actionId,
              resultExtra,
            );
            return;
          }
          const investMcp = investResp?.result;
          const investNorm = normalizeAgentToolResult(investMcp);
          if (isAgentToolErrorResult(investNorm)) {
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            const insufficient =
              investNorm.error === "insufficient_scope" ||
              /scope/i.test(investNorm.message || "");
            addMessage(
              "assistant",
              insufficient
                ? "The agent's access token does not carry the invest:read scope, so the gateway refused to swap it for the investment service API key. Sign out and sign back in to consent to investment access, then try \"Portfolio status\" again."
                : `Could not load portfolio data: ${investNorm.message || "backend error"}.`,
              actionId,
              resultExtra,
            );
            return;
          }
          const investMeta = investMcp?._meta || {};
          const featurePayload = {
            ...(investNorm || {}),
            apiKeyMaskedLast4: investMeta.apiKeyMaskedLast4,
            apiCall: investMeta.apiCall,
            message: investNorm.note || investMeta.note,
            backend: {
              source: investNorm.source,
              authMechanism: investNorm.authMechanism,
              note: investNorm.note,
            },
          };
          if (tokenChain && Array.isArray(investResp?.tokenEvents)) {
            tokenChain.setTokenEvents(actionId, investResp.tokenEvents);
          }
          toast.dismiss(toastId);
          setLoading(false);
          toolProgressIdRef.current = null;
          navigate("/path/feature", {
            state: {
              featurePayload,
              featurePageOverride: {
                mcpTool: "show_investment",
                pageTitle: "Portfolio Status",
                badgeLabel: "API-KEY PATH",
                accentColor: "#047857",
                dataKey: "invest",
                fields: [
                  { label: "Portfolio ID", path: "portfolioId" },
                  { label: "Holder", path: "holder" },
                  { label: "Total value", path: "totalValue", format: "money", accent: true },
                  { label: "Cash sweep", path: "cashSweep", format: "money" },
                  { label: "YTD return", path: "ytdReturnPct", format: "percent" },
                  { label: "Risk profile", path: "riskProfile" },
                ],
                sectionTitle: "Portfolio details",
                emptyPrompt: "show portfolio status",
              },
            },
          });
          return;
        }
        case "vertical_feature_demo": {
          // Path A — api_key disposition for all non-banking verticals.
          // The active vertical's featurePage config drives tool name, scope error message,
          // and field rendering on VerticalFeaturePage. Falls back to show_mortgage so the
          // chip never silently does nothing on the banking vertical.
          const fp = themeManifest?.featurePage;
          const featureTool = fp?.mcpTool || "show_mortgage";
          const featureRoute = "/path/feature";
          const scopeName = themeManifest?.scopes?.featureScope || "feature";
          toast.update(toastId, {
            render: ` Routing to feature path (gateway swaps OAuth bearer for service API key)…`,
          });
          let featureResp;
          try {
            featureResp = await callMcpTool(featureTool, {}, { useCaseId, vertical });
          } catch (e) {
            console.error("[BankingAgent] vertical_feature_demo dispatch failed:", e?.message);
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            addMessage("assistant", `Could not load feature data: ${e?.message || "gateway call failed"}.`, actionId, resultExtra);
            return;
          }
          const featureMcp  = featureResp?.result;
          const featureNorm = normalizeAgentToolResult(featureMcp);
          if (isAgentToolErrorResult(featureNorm)) {
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            const insufficient =
              featureNorm.error === "insufficient_scope" ||
              /scope/i.test(featureNorm.message || "");
            addMessage(
              "assistant",
              insufficient
                ? (fp?.scopeError || `The agent's access token does not carry the ${scopeName} scope. Sign out and sign back in to consent, then try again.`)
                : `Could not load feature data: ${featureNorm.message || "backend error"}.`,
              actionId,
              resultExtra,
            );
            return;
          }
          const featureMeta = featureMcp?._meta || {};
          const featurePayload = {
            ...(featureNorm || {}),
            apiKeyMaskedLast4: featureMeta.apiKeyMaskedLast4,
            apiCall: featureMeta.apiCall,
            message: featureNorm.note || featureMeta.note,
            backend: {
              source: featureNorm.source,
              authMechanism: featureNorm.authMechanism,
              note: featureNorm.note,
            },
          };
          if (tokenChain && Array.isArray(featureResp?.tokenEvents)) {
            tokenChain.setTokenEvents(actionId, featureResp.tokenEvents);
          }
          toast.dismiss(toastId);
          setLoading(false);
          toolProgressIdRef.current = null;
          navigate(featureRoute, {
            state: {
              featurePayload,
              chipContext: {
                actionId,
                featureTool,
                verticalName: themeManifest?.identity?.displayName || 'Demo',
                tokenEvents: featureResp?.tokenEvents || [],
              },
            },
          });
          return;
        }
        case "transactions":
          toast.update(toastId, { render: " Calling get_my_transactions…" });
          response = await getMyTransactions(undefined, { useCaseId, vertical });
          break;
        case "balance":
          toast.update(toastId, { render: " Calling get_account_balance…" });
          response = await getAccountBalance(form.accountId, { useCaseId, vertical });
          break;
        case "account_nickname":
          toast.update(toastId, { render: " Calling get_account_nickname…" });
          response = await callMcpTool(
            "get_account_nickname",
            form.accountId ? { account_id: form.accountId } : {},
            { useCaseId, vertical },
          );
          break;
        case "deposit":
          toast.update(toastId, { render: "⬇️ Calling create_deposit…" });
          response = await createDeposit(
            form.accountId || form.toId,
            parseFloat(form.amount),
            form.note,
            hitlRetryChallengeId,
            { useCaseId, vertical },
          );
          break;
        case "withdraw":
          toast.update(toastId, { render: "⬆️ Calling create_withdrawal…" });
          response = await createWithdrawal(
            form.accountId || form.fromId,
            parseFloat(form.amount),
            form.note,
            hitlRetryChallengeId,
            { useCaseId, vertical },
          );
          break;
        case "transfer":
          toast.update(toastId, { render: "↔️ Calling create_transfer…" });
          response = await createTransfer(
            form.fromId,
            form.toId,
            parseFloat(form.amount),
            form.note,
            hitlRetryChallengeId,
            { useCaseId, vertical },
          );
          break;
        case "sensitive-account-details": {
          try {
            agentFlowDiagram.markHitlPreConsent();
          } catch (_) {}
          // Gate behind HITL — show consent card first, fetch data only after user confirms.
          addMessage(
            "assistant",
            " Sensitive Account Data Request\n\nThis will reveal your full account numbers, routing numbers, SWIFT, and IBAN. Please confirm before proceeding.",
            actionId,
          );
          toast.dismiss(toastId);
          setLoading(false);
          toolProgressIdRef.current = null;
          setHitlPendingIntent({
            actionId: "sensitive-account-details",
            form,
            intentPayload: {
              type: "Sensitive Data Access",
              description:
                "Full account numbers · Routing numbers · SWIFT / IBAN",
              amount: 0,
            },
            threshold: 1, // 0 < 1 → not flagged as high-value
            isSensitiveData: true,
          });
          return;
        }
        case "mcp_tools": {
          toast.update(toastId, { render: " Fetching MCP tool list…" });
          agentFlowDiagram.startInspectorToolsList();
          let mcpRes;
          try {
            mcpRes = await fetch("/api/mcp/inspector/tools", {
              credentials: "include",
            });
          } catch (netErr) {
            agentFlowDiagram.completeInspectorToolsList({
              ok: false,
              errorMessage: netErr.message || "Network error",
            });
            throw netErr;
          }
          if (!mcpRes.ok) {
            agentFlowDiagram.completeInspectorToolsList({
              ok: false,
              errorMessage: `HTTP ${mcpRes.status}`,
            });
            throw new Error(`MCP tools fetch failed: ${mcpRes.status}`);
          }
          let data;
          try {
            data = await mcpRes.json();
          } catch (parseErr) {
            agentFlowDiagram.completeInspectorToolsList({
              ok: false,
              errorMessage: parseErr.message || "Invalid JSON",
            });
            throw parseErr;
          }
          // MFA gate: server requires step-up before listing tools.
          if (data.mfa_required) {
            agentFlowDiagram.completeInspectorToolsList({
              ok: false,
              errorMessage: "mfa_required",
            });
            toast.update(toastId, {
              render:
                " MFA verification required to load tools — verify your identity below",
              type: "warning",
              isLoading: false,
              autoClose: 6000,
            });
            setLoading(false);
            toolProgressIdRef.current = null;
            // Store pending action so cibaStepUpApproved can retry tools/list
            pendingStepUpActionRef.current = {
              actionId,
              form,
              method: data.step_up_method || "email",
            };
            window.dispatchEvent(
              new CustomEvent("agentStepUpRequested", {
                detail: {
                  step_up_method: data.step_up_method || "email",
                  step_up_acr: data.step_up_acr || "",
                },
              }),
            );
            return;
          }
          const tools = data.tools || [];
          agentFlowDiagram.completeInspectorToolsList({
            ok: true,
            source: data._source || "mcp_server",
          });
          // Show tools in modal instead of chat message
          setMcpToolsList(tools);
          setShowMcpToolsModal(true);
          addMessage(
            "assistant",
            ` MCP Tools (${tools.length} available) — check the popup window`,
            "tools/list",
          );
          toast.update(toastId, {
            render: `✅ ${tools.length} tools loaded`,
            type: "success",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
        case "web_search": {
          toast.update(toastId, { render: "\u{1F50D} Searching the web…" });
          const q = encodeURIComponent(form.query || "");
          let srRes;
          try {
            srRes = await fetch(`/api/demo-agent/search?q=${q}`, {
              credentials: "include",
            });
          } catch (netErr) {
            throw new Error(`Web search network error: ${netErr.message}`);
          }
          const srData = await srRes.json().catch(() => ({}));
          if (!srRes.ok) {
            if (srData.error === "BRAVE_NOT_CONFIGURED") {
              addMessage(
                "assistant",
                `\u26A0\uFE0F Web search is not configured.\n\n${srData.message || "Set BRAVE_SEARCH_API_KEY in the server environment to enable web search."}`,
                actionId,
              );
              toast.dismiss(toastId);
              setLoading(false);
              toolProgressIdRef.current = null;
              return;
            }
            throw new Error(srData.message || `Search failed: ${srRes.status}`);
          }
          const srResults = (srData.results || [])
            .map(
              (r, i) =>
                `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ""}`,
            )
            .join("\n\n");
          addMessage(
            "assistant",
            `\u{1F50D} Web search results for "${srData.query || form.query || ""}":\n\n${srResults || "No results found."}`,
            actionId,
          );
          toast.update(toastId, {
            render: "\u2705 Search complete",
            type: "success",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
        // ── Testing scenarios ──────────────────────────────────────────────────
        case "test_wrong_scope": {
          // Exercises the BFF gateway scope denial flow: calls an admin-only MCP tool
          // (admin_get_all_users) with an end-user token lacking the required scope.
          // The gateway should respond with 403 + required_scopes metadata.
          // RFC 6749 §3.3 — Resource servers MUST reject tokens that don't carry required scopes.
          toast.update(toastId, {
            render:
              "⚠️ Calling admin tool with customer token (no admin scope)…",
          });
          let scopeTestRes;
          try {
            // admin_get_all_users requires admin scope not in customer token
            scopeTestRes = await callMcpTool("admin_get_all_users", {}, { useCaseId, vertical });
          } catch (scopeErr) {
            scopeTestRes = {
              error: scopeErr.code || scopeErr.message,
              status: scopeErr.status,
              missingScopes: scopeErr.missingScopes,
              tokenEvents: scopeErr.tokenEvents || [],
            };
          }
          const scopeRejected =
            scopeTestRes?.status === 403 ||
            scopeTestRes?.error === "agent_mcp_scope_denied" ||
            scopeTestRes?.error?.includes("scope");
          const scopeOutcome = scopeRejected
            ? `✅ Gateway correctly rejected (403): required_scopes=[${(scopeTestRes.missingScopes || []).join(", ") || "admin"}]`
            : `❌ Expected 403 denial, got: ${scopeTestRes?.error || scopeTestRes?.status || "success"}`;
          addMessage(
            "token-event",
            [
              "⚠️ Authorization Test: Insufficient Scope (RFC 6749 §3.3)",
              "",
              scopeOutcome,
              "",
              "Step 4b-c: Gateway denial includes required_scopes metadata",
              `Status: ${scopeTestRes?.status || "?"}`,
              `Error: ${scopeTestRes?.error || "none"}`,
              `Missing scopes: [${(scopeTestRes?.missingScopes || []).join(", ") || "admin"}]`,
              "",
              "RFC 6749 §3.3 — The `scope` parameter limits what an access token can do.",
              "   Resource servers MUST reject requests where the token lacks required scopes.",
              "RFC 8693 §2.1 — Token exchange can only narrow (not expand) scopes.",
              "   MCP token inherits user token's scopes; cannot gain new scopes.",
            ].join("\n"),
            actionId,
          );
          if (scopeTestRes?.tokenEvents?.length) {
            tokenChain?.setTokenEvents(actionId, scopeTestRes.tokenEvents);
          }
          toast.update(toastId, {
            render: scopeRejected
              ? "✅ Scope rejection + denial metadata confirmed"
              : "❌ Expected 403 denial not received",
            type: scopeRejected ? "info" : "error",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
        case "test_wrong_audience": {
          // Calls the MCP tool endpoint with a deliberately wrong audience value in the
          // exchange request by temporarily disabling mcp_resource_uri and requesting a
          // non-existent audience. The RFC 8693 exchange will fail with an audience error.
          // RFC 8693 §2.1 + RFC 8707 — token exchange requires the `audience` to match a
          // resource server the AS is authorised to issue for.
          toast.update(toastId, {
            render: "⚠️ Testing wrong audience on MCP token exchange…",
          });
          let audTestRes;
          try {
            // Request a tool whose exchange will target a nonsense audience
            const apiBase = process.env.REACT_APP_API_URL || "";
            const r = await fetch(`${apiBase}/api/mcp/tool`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              _silent: true,
              body: JSON.stringify({
                tool: "get_my_accounts",
                params: {},
                _testAudience: "https://invalid-audience.example.com",
              }),
            });
            audTestRes = await r.json();
            audTestRes._httpStatus = r.status;
          } catch (audErr) {
            audTestRes = { error: audErr.message };
          }
          // Gateway should reject with 403 if audience validation is enforced
          const audRejected = audTestRes._httpStatus >= 400;
          const audOutcome = audRejected
            ? `✅ Gateway correctly rejected (${audTestRes._httpStatus}): ${audTestRes.error || "invalid audience"}`
            : `ℹ️ Server fell back to local handler (token exchange skipped or not configured) — HTTP ${audTestRes._httpStatus ?? 200}`;
          addMessage(
            "token-event",
            [
              "⚠️ Authorization Test: Wrong Audience (RFC 8693 §2.1 · RFC 8707)",
              "",
              audOutcome,
              "",
              "Step 5b-c: Gateway denial includes audience validation",
              `Status: ${audTestRes._httpStatus ?? "?"}`,
              `Error: ${audTestRes?.error || "none"}`,
              "",
              "RFC 8693 §2.1 — The `audience` parameter in a token exchange request identifies which",
              "   resource server the resulting token is valid for. The AS verifies it against its policy.",
              "RFC 8707 — Resource Indicators bind access tokens to specific resource URIs.",
              "   A token issued for `banking-api.example.com` MUST be rejected by `mcp-server.example.com`.",
              "   The `aud` claim in the MCP token must exactly match the MCP server's registered audience.",
              "",
              "Open Token Chain 🪟 → MCP access token → `aud` claim to see the audience after exchange.",
            ].join("\n"),
            actionId,
          );
          if (audTestRes?.tokenEvents?.length) {
            tokenChain?.setTokenEvents(actionId, audTestRes.tokenEvents);
          }
          toast.update(toastId, {
            render: audRejected
              ? "✅ Audience rejection confirmed"
              : "ℹ️ Audience test sent",
            type: "info",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
        case "test_hitl_required": {
          // Routes through the real transfer path with a high-value amount that exceeds the HITL
          // threshold ($500). Uses live account IDs so the transfer lookup succeeds server-side.
          // HITL (Human-in-the-Loop) pauses the agent and requires explicit user consent before
          // the operation proceeds — a key security pattern for agentic AI systems.
          toast.update(toastId, {
            render:
              " Sending high-value transfer to trigger Human-in-the-Loop (HITL)…",
          });
          const hitlAccounts =
            liveAccounts && liveAccounts.length >= 2 ? liveAccounts : null;
          const hitlFrom =
            hitlAccounts?.find(
              (a) => a.type === "checking" || a.type === "chk",
            ) || hitlAccounts?.[0];
          const hitlTo =
            hitlAccounts?.find(
              (a) => a.type === "savings" || a.type === "sav",
            ) || hitlAccounts?.[1];
          if (!hitlFrom || !hitlTo) {
            addMessage(
              "assistant",
              [
                "⚠️ HITL Test: accounts not loaded",
                "",
                "Need at least 2 accounts (checking + savings) to run this test.",
                "Try clicking My Accounts first to load your account list.",
              ].join("\n"),
              actionId,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            return;
          }
          addMessage(
            "token-event",
            [
              " Human-in-the-Loop (HITL) Test",
              "",
              `Attempting transfer of $99,999.99 from ${hitlFrom.name || hitlFrom.type} → ${hitlTo.name || hitlTo.type}`,
              "This exceeds the HITL threshold — the agent will be paused pending your consent.",
              "",
              "HITL Gate — High-value agentic transactions require explicit human approval before",
              "   the AI agent can proceed. The agent is paused until you approve or deny in the modal.",
              "PingOne Authorize — The consent decision can be enforced via a PingOne Authorize policy,",
              "   making the approval decision auditable and policy-driven (not just a frontend guard).",
            ].join("\n"),
            actionId,
          );
          response = await createTransfer(
            hitlFrom.id,
            hitlTo.id,
            APP_CONFIG.THRESHOLDS.DEMO_LARGE_TRANSFER,
            "Test HITL threshold",
            undefined,
            { useCaseId, vertical },
          );
          // Falls through to normalizeAgentToolResult — HITL gate fires there and shows consent modal
          break;
        }
        case "transfer_600_test": {
          // Test HITL consent + MFA flow with a realistic $600 transfer
          toast.update(toastId, {
            render: "Initiating $600 transfer to test HITL consent + MFA flow…",
          });
          const testAccounts =
            liveAccounts && liveAccounts.length >= 2 ? liveAccounts : null;
          // Find account with sufficient balance for $600 transfer (prioritize savings over checking)
          const testFrom =
            testAccounts?.find(
              (a) =>
                (a.type === "savings" || a.type === "sav") && a.balance >= 600,
            ) ||
            testAccounts?.find(
              (a) =>
                (a.type === "checking" || a.type === "chk") && a.balance >= 600,
            ) ||
            testAccounts?.find((a) => a.balance >= 600) ||
            testAccounts?.[0];
          const testTo =
            testAccounts?.find(
              (a) => a.type === "savings" || a.type === "sav",
            ) ||
            testAccounts?.find(
              (a) => a.type === "checking" || a.type === "chk",
            ) ||
            testAccounts?.[1];
          if (!testFrom || !testTo) {
            addMessage(
              "assistant",
              [
                "⚠️ Transfer Test: accounts not loaded",
                "",
                "Need at least 2 accounts (checking + savings) to run this test.",
                "Try clicking My Accounts first to load your account list.",
              ].join("\n"),
              actionId,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            return;
          }
          addMessage(
            "token-event",
            [
              "Testing HITL Consent + MFA Flow",
              "",
              `Attempting transfer of $${APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER} from ${testFrom.name || testFrom.type} → ${testTo.name || testTo.type}`,
              "",
              "Expected flow:",
              "  1. Consent modal appears (HITL gate triggers at $250+)",
              "  2. Review transaction details and check 'I agree'",
              "  3. Click 'Agree & send code'",
              "  4. Device selection modal appears (select OTP or FIDO2)",
              "  5. Complete MFA challenge (OTP: enter 123456 or code from email)",
              "  6. Transaction completes",
            ].join("\n"),
            actionId,
          );
          try {
            // Call HTTP endpoint directly (not MCP) to trigger authorization + HITL
            const httpRes = await fetch("/api/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                fromAccountId: testFrom.id,
                toAccountId: testTo.id,
                amount: APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER,
                type: "transfer",
                description: "HITL + MFA test",
              }),
            });
            const httpBody = await httpRes.json();
            console.log(
              "[Transfer600Test] HTTP Transfer status:",
              httpRes.status,
            );
            console.log("[Transfer600Test] HTTP Transfer body:", httpBody);
            response = { result: httpBody, status: httpRes.status };

            // If 428 (HITL), show consent modal
            if (httpRes.status === 428) {
              toast.dismiss(toastId);
              setLoading(false);
              setHitlPendingIntent({
                actionId: "transfer_600_test",
                form: {
                  fromId: testFrom.id,
                  toId: testTo.id,
                  amount: String(APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER),
                  note: "HITL + MFA test",
                },
                intentPayload: {
                  type: "transfer",
                  description: `Transfer $${APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER}`,
                  amount: APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER,
                },
                threshold: 250,
              });
              return;
            }

            // If 403 (deny), format as error result
            if (httpRes.status === 403) {
              response.result = {
                ok: false,
                error: httpBody.error,
                ...httpBody,
              };
            }
          } catch (err) {
            console.error("[Transfer600Test] Transfer failed:", err);
            addMessage("assistant", `Error: ${err.message}`);
            toast.dismiss(toastId);
            setLoading(false);
            return;
          }
          // Falls through to normalizeAgentToolResult for 200/other responses
          break;
        }
        case "demo_intent_delegation": {
          // Demonstrates intent-bound, constraint-based delegation:
          // RFC 8693 token exchange narrows scope+audience (constraint enforcement),
          // HITL consent gate enforces the delegated spend limit before the agent proceeds.
          toast.update(toastId, {
            render:
              " Intent-Bound Transfer — RFC 8693 constraints + HITL consent gate…",
          });
          const intentAccounts =
            liveAccounts && liveAccounts.length >= 2 ? liveAccounts : null;
          const intentFrom =
            intentAccounts?.find(
              (a) => a.type === "checking" || a.type === "chk",
            ) || intentAccounts?.[0];
          const intentTo =
            intentAccounts?.find(
              (a) => a.type === "savings" || a.type === "sav",
            ) || intentAccounts?.[1];
          if (!intentFrom || !intentTo) {
            addMessage(
              "assistant",
              [
                "⚠️ Intent-Bound Transfer: accounts not loaded",
                "",
                "Need at least 2 accounts (checking + savings) to run this demo.",
                "Try clicking My Accounts first to load your account list.",
              ].join("\n"),
              actionId,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            return;
          }
          addMessage(
            "token-event",
            [
              " Intent-Bound Delegation Demo",
              "",
              `Attempting transfer of $99,999.99 from ${intentFrom.name || intentFrom.type} → ${intentTo.name || intentTo.type}`,
              "",
              "RFC 8693 Token Exchange — The agent's MCP token is scope- and audience-constrained",
              "   (write scope, MCP server audience) — the delegated intent is encoded in the token.",
              "HITL Consent Gate — Transfer exceeds threshold; agent is paused pending your explicit approval.",
              "   This enforces the spend constraint and delegates only what was authorized.",
            ].join("\n"),
            actionId,
          );
          response = await createTransfer(
            intentFrom.id,
            intentTo.id,
            APP_CONFIG.THRESHOLDS.DEMO_LARGE_TRANSFER,
            "Intent-bound delegation demo",
            undefined,
            { useCaseId, vertical },
          );
          // Falls through to normalizeAgentToolResult — HITL gate fires there and shows consent modal
          break;
        }
        case "test_full_compliance_flow": {
          // Comprehensive test exercising ALL 12 compliance steps:
          // 1. agent-llm-reasoning — NL intent routing
          // 2. agent-token-init — token acquisition
          // 3. gw-scope-map — scope mapping at gateway
          // 4. agent-scope-aware-cache — scoped caching
          // 5. olb-resource-token — token exchange for resource
          // 6. gw-denial-metadata — gateway denial signals
          // 7. gw-hitl-challenge-type — HITL challenge type detection
          // 8. bff-response-shape — BFF response formatting
          // 9. ui-gateway-consent — consent modal in UI
          // 10. ui-auto-refire — auto-refire after consent
          // 11. agent-error-propagation — error propagation
          // 12. claim-diagnostics — token claim analysis
          toast.update(toastId, {
            render:
              " Full Compliance Flow: high-value sensitive transfer (HITL + MFA)…",
          });
          const compAccounts =
            liveAccounts && liveAccounts.length >= 2 ? liveAccounts : null;
          // Find account with sufficient balance for $600 transfer (prioritize savings over checking)
          const compFrom =
            compAccounts?.find(
              (a) =>
                (a.type === "savings" || a.type === "sav") && a.balance >= 600,
            ) ||
            compAccounts?.find(
              (a) =>
                (a.type === "checking" || a.type === "chk") && a.balance >= 600,
            ) ||
            compAccounts?.find((a) => a.balance >= 600) ||
            compAccounts?.[0];
          const compTo =
            compAccounts?.find(
              (a) => a.type === "savings" || a.type === "sav",
            ) ||
            compAccounts?.find(
              (a) => a.type === "checking" || a.type === "chk",
            ) ||
            compAccounts?.[1];
          if (!compFrom || !compTo) {
            addMessage(
              "assistant",
              [
                "⚠️ Full Compliance Test: accounts not loaded",
                "",
                "Need at least 2 accounts to run this test.",
                "Try clicking My Accounts first to load your account list.",
              ].join("\n"),
              actionId,
            );
            toast.dismiss(toastId);
            setLoading(false);
            toolProgressIdRef.current = null;
            return;
          }
          addMessage(
            "token-event",
            [
              " FULL COMPLIANCE FLOW TEST (All 12 Steps)",
              "",
              `Attempting $${APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER} transfer from ${compFrom.name || compFrom.type} → ${compTo.name || compTo.type}`,
              "This scenario exercises all 12 compliance steps:",
              "",
              "- Step 1: LLM intent reasoning (NL → transfer intent)",
              "- Step 2: Token initialization (get user token)",
              "- Step 3: Gateway scope mapping (write scope)",
              "- Step 4: Scope-aware caching",
              "- Step 5: Resource token exchange (RFC 8693)",
              "- Step 6: Gateway denial metadata collection",
              "- Step 7: HITL challenge type detection (>$250)",
              "- Step 8: BFF response formatting with consent challenge",
              "- Step 9: UI consent modal display",
              "- Step 10: Auto-refire after user approves consent",
              "- Step 11: Error propagation (if MFA needed)",
              "- Step 12: Token claim diagnostics + MFA verification",
              "",
              "Approve the consent modal → MFA step-up will be required → transfer completes",
            ].join("\n"),
            actionId,
          );
          try {
            // Call HTTP endpoint directly (not MCP) to trigger authorization + HITL
            const httpRes = await fetch("/api/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                fromAccountId: compFrom.id,
                toAccountId: compTo.id,
                amount: APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER,
                type: "transfer",
                description: " Full compliance scenario test",
              }),
            });
            const httpBody = await httpRes.json();
            console.log(
              "[FullCompliance] HTTP Transfer status:",
              httpRes.status,
            );
            console.log("[FullCompliance] HTTP Transfer body:", httpBody);
            response = { result: httpBody, status: httpRes.status };

            // If 428 (HITL), show consent modal
            if (httpRes.status === 428) {
              console.log(
                "[FullCompliance] Detected HITL, showing consent modal",
              );
              toast.dismiss(toastId);
              setLoading(false);
              setHitlPendingIntent({
                actionId: "full_compliance_test",
                form: {
                  fromId: compFrom.id,
                  toId: compTo.id,
                  amount: String(APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER),
                  note: "Full compliance scenario test",
                },
                intentPayload: {
                  type: "transfer",
                  description: `Transfer $${APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER}`,
                  amount: APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER,
                },
                threshold: 250,
              });
              return;
            }

            // If 403 (deny), format as error result
            if (httpRes.status === 403) {
              response.result = {
                ok: false,
                error: httpBody.error,
                ...httpBody,
              };
              console.log("[FullCompliance] Formatted as deny response");
            }
          } catch (err) {
            console.error("[FullCompliance] Transfer failed:", err);
            addMessage("assistant", `Error: ${err.message}`);
            toast.dismiss(toastId);
            setLoading(false);
            return;
          }
          // Falls through to normalizeAgentToolResult — consent + MFA gates fire here
          break;
        }
        case "test_otp_required": {
          // Triggers the sensitive-account-details flow which requires step-up MFA via RFC 9470.
          // RFC 9470 (OAuth 2.0 Step-Up Authentication Challenge Protocol) defines how resource
          // servers signal that a stronger authentication is required via WWW-Authenticate challenges.
          toast.update(toastId, {
            render: " Triggering step-up authentication (RFC 9470)…",
          });
          // Fetch live thresholds so the message can quote exact values
          let _thresholds = {
            confirm_threshold_usd: APP_CONFIG.THRESHOLDS.HITL_DEFAULT,
            mfa_threshold_usd: APP_CONFIG.THRESHOLDS.MFA_DEFAULT,
          };
          try {
            const _tr = await fetch("/api/config/thresholds", {
              credentials: "include",
            });
            if (_tr.ok) _thresholds = await _tr.json();
          } catch (_) {
            /* non-fatal */
          }
          const _stepUpThreshold =
            _thresholds.mfa_threshold_usd ?? APP_CONFIG.THRESHOLDS.MFA_DEFAULT;
          const _hitlThreshold =
            _thresholds.confirm_threshold_usd ??
            APP_CONFIG.THRESHOLDS.HITL_DEFAULT;
          // Fetch live thresholds so the message can quote exact values
          const stepUpRes = await sendAgentMessage(
            "Show me my full account details with routing numbers",
          );
          if (
            stepUpRes.step_up_required === true ||
            stepUpRes.error === "step_up_required"
          ) {
            addMessage(
              "token-event",
              [
                " Step-Up Authentication Test (RFC 9470)",
                "",
                "✅ Step-up challenge correctly triggered.",
                "",
                "RFC 9470 — OAuth 2.0 Step-Up Authentication Challenge Protocol.",
                "   A resource server can require stronger authentication (higher `acr`) for sensitive operations.",
                "   The server returns a challenge; the client must obtain a new token with the required `acr` value.",
                "acr claim — Authentication Context Class Reference. `Multi_Factor` or `MFA` indicates",
                "   the user authenticated with a second factor (OTP, FIDO2, push notification).",
                "",
                `Current thresholds (Admin → Security Settings):`,
                `   • Step-up MFA:   transfers/withdrawals ≥ $${_stepUpThreshold} trigger an MFA challenge`,
                `   • HITL consent:  transfers/withdrawals ≥ $${_hitlThreshold} require explicit approval`,
                "",
                "Complete the OTP challenge below — the agent will resume after your identity is verified.",
              ].join("\n"),
              actionId,
            );
            toast.update(toastId, {
              render: " Step-up challenge triggered — verify identity below",
              type: "info",
              isLoading: false,
              autoClose: 6000,
            });
            setLoading(false);
            toolProgressIdRef.current = null;
            window.dispatchEvent(
              new CustomEvent("agentStepUpRequested", {
                detail: {
                  step_up_method: stepUpRes.step_up_method || "email",
                  step_up_acr: stepUpRes.step_up_acr || "",
                },
              }),
            );
            return;
          }
          addMessage(
            "token-event",
            [
              " Step-Up Authentication Test (RFC 9470)",
              "",
              stepUpRes.reply ||
                "Step-up not triggered — MFA may already be satisfied for this session.",
              "",
              "RFC 9470 — Step-up is only triggered when the session `acr` is below the required level.",
              "   If you already authenticated with MFA, the challenge is skipped (acr already satisfied).",
              "",
              `Current thresholds (Admin → Security Settings):`,
              `   • Step-up MFA:   transfers/withdrawals ≥ $${_stepUpThreshold} trigger an MFA challenge`,
              `   • HITL consent:  transfers/withdrawals ≥ $${_hitlThreshold} require explicit approval`,
              `   Since your session acr is already at the required level, no new challenge was issued.`,
            ].join("\n"),
            actionId,
          );
          toast.update(toastId, {
            render: "✅ Step-up test complete",
            type: "info",
            isLoading: false,
            autoClose: agentToastMs.toolsLoaded,
          });
          setLoading(false);
          toolProgressIdRef.current = null;
          return;
        }
        case "ai_ask":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query: "What can I help you with today?",
          }, { useCaseId, vertical });
          break;
        case "ai_helix_demo":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query: "What are best practices for account security?",
          }, { useCaseId, vertical });
          break;
        case "ai_explain":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query:
              "Explain how OAuth 2.0 and RFC 8693 token exchange work in this demo",
          }, { useCaseId, vertical });
          break;
        case "ai_helix_explain":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query: "Explain the difference between OAuth and SAML",
          }, { useCaseId, vertical });
          break;
        case "ai_analyze":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query: "Summarize how the MCP tool flow works in this demo",
          }, { useCaseId, vertical });
          break;
        case "ai_advice":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query:
              "What are some good tips for managing checking and savings accounts?",
          }, { useCaseId, vertical });
          break;
        case "ai_helix_advice":
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query:
              "Give me 5 tips for reducing transaction fees and managing money better",
          }, { useCaseId, vertical });
          break;
        case "api_key_demo": {
          // Phase 266/267 Path A: exercise the gateway API-key credential swap.
          // Tool name 'show_mortgage' is the canonical apikey-disposition tool
          // (Phase 267 replaced the Phase 266 'special_offers' stub). Gateway
          // swaps OAuth bearer for service API key, records swap in
          // _meta.tokenEvents. This chip only demonstrates the swap and routes
          // to the info page (it does NOT render the mortgage payload — that's
          // the 'mortgage_demo' chip / "show mortgage data").
          // Destination route is hard-coded (T-266-04-01: no open-redirect via infoPageHint).
          toast.update(toastId, {
            render: "Routing to API-key credential path…",
          });
          try {
            await callMcpTool("show_mortgage", {}, { useCaseId, vertical });
          } catch (e) {
            console.error(
              "[BankingAgent] api_key_demo dispatch failed:",
              e?.message,
            );
          }
          setLoading(false);
          toolProgressIdRef.current = null;
          navigate("/path/apikey-info");
          return;
        }
        case "dual_token_demo": {
          // Phase 266 Path B: exercise the gateway dual-token (access + id_token) path.
          // Tool name 'user_profile_card' is defined ONLY by Phase 266-01 gateway router.
          // R2: gateway forwards to /api/resource-server/identity; SPA page fetches it directly.
          // Destination route is hard-coded (T-266-04-01: no open-redirect via infoPageHint).
          toast.update(toastId, {
            render: "Routing to access + id-token credential path…",
          });
          try {
            await callMcpTool("user_profile_card", {}, { useCaseId, vertical });
          } catch (e) {
            console.error(
              "[BankingAgent] dual_token_demo dispatch failed:",
              e?.message,
            );
          }
          setLoading(false);
          toolProgressIdRef.current = null;
          navigate("/path/dualtoken-info");
          return;
        }
        case "unusual_patterns":
        case "afford_check": {
          // LLM-analysis intents (bk9/bk10 chips and their typed phrasings).
          // The heuristic parser resolves these action ids, but they have no
          // deterministic tool — they need an LLM. In heuristics mode say so
          // (fail loud per the agentModes.js contract) instead of falling to
          // the default "Unknown action" throw; in LLM modes reason via the
          // same sequential_think path the ai_* actions use.
          if (!activeLlmProvider) {
            toast.update(toastId, {
              render: "Needs an LLM mode",
              type: "info",
              isLoading: false,
              autoClose: agentToastMs.toolsLoaded,
            });
            addMessage(
              "assistant",
              "This analysis needs an LLM mode — Heuristics can't reason over your transactions. Switch the Agent mode to llama.cpp, Anthropic, or Helix and ask again.",
            );
            setLoading(false);
            toolProgressIdRef.current = null;
            return;
          }
          toast.update(toastId, { render: "Reasoning…" });
          response = await callMcpTool("sequential_think", {
            query:
              actionId === "unusual_patterns"
                ? "Check my recent transactions for unusual patterns"
                : "Could my savings cover a big upcoming expense?",
          }, { useCaseId, vertical });
          break;
        }
        default: {
          const customChip = customChips.find((c) => c.id === actionId);
          if (customChip) {
            toast.update(toastId, { render: "Reasoning…" });
            response = await callMcpTool("sequential_think", {
              query: customChip.prompt,
            }, { useCaseId, vertical });
            break;
          }
          throw new Error(`Unknown action: ${actionId}`);
        }
      }

      const normalized = normalizeAgentToolResult(response.result);

      if (isAgentToolErrorResult(normalized)) {
        markToolProgressOutcome(false);
        const tokenEventsErr = response.tokenEvents || [];
        if (tokenChain && tokenEventsErr.length > 0) {
          tokenChain.setTokenEvents(actionId, tokenEventsErr);
        }

        console.log(`[DEBUG-FRONTEND-ERROR]  RECEIVED ERROR FROM MCP:
  normalized.error: ${normalized.error}
  normalized.consent_challenge_required: ${normalized.consent_challenge_required}
  normalized.step_up_required: ${normalized.step_up_required}
  normalized.hitl_threshold_usd: ${normalized.hitl_threshold_usd}
  normalized.amount_threshold: ${normalized.amount_threshold}
  normalized.debug_mcp_consent_handler: ${normalized.debug_mcp_consent_handler}
  normalized.debug_mcp_stepup_handler: ${normalized.debug_mcp_stepup_handler}
  full normalized: ${JSON.stringify(normalized)}`);

        const consent =
          normalized.error === "hitl_required" ||
          normalized.error === "mcp_hitl_required";

        console.log(`[DEBUG-FRONTEND-DECISION]  DECISION POINT:
  consent=${consent}
  will show consent modal: ${consent}
  will show stepup modal: ${!consent && (normalized.step_up_required === true || normalized.error === "step_up_required" || normalized.error === "mcp_step_up_required")}`);

        if (consent) {
          try {
            agentFlowDiagram.markHitlPreConsent();
          } catch (_) {}

          // Build intent from MCP error response (which includes amount, accounts, type)
          // Fall back to form object if MCP response doesn't have the details
          let intentPayload;
          if (normalized.amount !== undefined && normalized.fromAccountId) {
            console.log(`[DEBUG-FRONTEND-INTENT]  Building consent intent from MCP error response:
  amount: $${normalized.amount}
  fromAccountId: ${normalized.fromAccountId}
  toAccountId: ${normalized.toAccountId}
  type: ${normalized.type}`);
            intentPayload = {
              type: normalized.type || "transfer",
              fromAccountId:
                normalized.fromAccountId || normalized.from_account_id,
              toAccountId: normalized.toAccountId || normalized.to_account_id,
              amount: normalized.amount,
              description:
                form.note || `Agent ${normalized.type || "transfer"}`,
            };
          } else {
            console.log(
              `[DEBUG-FRONTEND-INTENT]  Building consent intent from form object`,
            );
            intentPayload = buildConsentIntent(actionId, form);
          }
          if (!intentPayload) {
            // Unexpected: consent required but no intent builder for this action.
            addMessage(
              "assistant",
              `⚠️ This action requires consent but the transaction details could not be determined. Please use the dashboard to complete it.`,
              actionId,
            );
            toast.dismiss(toastId);
            setLoading(false);
            return;
          }
          addMessage(
            "assistant",
            ` Human-in-the-Loop (HITL) — your manual approval is required.\n\nTransactions over $${normalized.hitl_threshold_usd ?? APP_CONFIG.THRESHOLDS.HITL_DEFAULT} require your consent before the agent can proceed. The agent is paused and cannot continue until you approve or cancel.\n\nReview the authorization popup, then enter the verification code sent to your email.`,
            actionId,
          );
          toast.dismiss(toastId);
          setHitlPendingIntent({
            actionId,
            form,
            intentPayload,
            threshold:
              normalized.hitl_threshold_usd ??
              APP_CONFIG.THRESHOLDS.HITL_DEFAULT,
          });
        } else if (
          normalized.step_up_required === true ||
          normalized.error === "step_up_required"
        ) {
          // Set context for modal
          let contextLine = "Identity verification required";
          if (normalized.step_up_reason) {
            contextLine = normalized.step_up_reason;
          } else if (
            normalized.amount_threshold &&
            normalized.transaction_amount > normalized.amount_threshold
          ) {
            const threshold = normalized.amount_threshold;
            contextLine = `Transfer over $${threshold} requires identity verification`;
          } else if (form) {
            contextLine = "This action requires identity verification";
          }

          // Store pending action and show modal
          setOtpContextLine(contextLine);
          pendingOtpActionRef.current = { actionId, form };

          // Check for P1MFA mode
          if (normalized.step_up_method === "p1mfa") {
            try {
              const apiBase = process.env.REACT_APP_API_URL || "";
              const mfaResp = await fetch(`${apiBase}/api/auth/mfa/challenge`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
              });
              if (!mfaResp.ok)
                throw new Error(`MFA initiation failed: ${mfaResp.status}`);
              const { daId, devices } = await mfaResp.json();
              setP1mfaDaId(daId);
              setP1mfaDevices(devices || []);
              setP1mfaMode(true);
            } catch (err) {
              console.error(
                "[BankingAgent] P1MFA initiation failed, falling back to stub:",
                err,
              );
              setP1mfaMode(false);
            }
          } else {
            setP1mfaMode(false);
          }

          // Passkey verification always runs through the real PingOne p1mfa
          // path inside OtpStepUpModal (register-then-authenticate), so we keep
          // the OTP modal here rather than the legacy standalone FIDO modal.
          setStepUpMethod("otp");

          setShowOtpModal(true);

          // Show waiting message
          addMessage(
            "assistant",
            " Waiting for MFA verification… Choose Email code, SMS, or Passkey in the modal above.",
            `mfa-step-${Date.now()}`,
          );
          toast.dismiss(toastId);
          agentFlowDiagram.completeMfaChallenge(null); // Pending
          setLoading(false);
          return;
        } else if (
          normalized.authChallenge &&
          normalized.authChallenge.authorizationUrl
        ) {
          const loginUrl =
            (process.env.REACT_APP_API_URL || "") +
            "/api/auth/oauth/user/login";
          pendingAuthChallengeActionRef.current = { actionId, form };
          // Persist to sessionStorage so it survives the PingOne full-page redirect
          PendingActionManager.save({ actionId, form });
          addMessage(
            "assistant",
            ` Login required.\n\nThis operation requires you to be signed in. Click the button below — your request will resume automatically after you authenticate.`,
            actionId,
          );
          addMessage(
            "assistant",
            '<a href="' +
              loginUrl +
              '" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#4f7df3;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Sign in →</a>',
            actionId,
          );
          toast.dismiss(toastId);
          setLoading(false);
          return;
        } else {
          addMessage(
            "assistant",
            formatResult(response.result),
            actionId,
            resultExtra,
          );
          toast.dismiss(toastId);
          const isTransactionAction = [
            "transfer",
            "deposit",
            "withdraw",
          ].includes(actionId);
          if (isTransactionAction) {
            const _rawMsg = normalized.message || normalized.error || "Request failed";
            setTxErrorModal({
              title: "Transaction Failed",
              message: typeof _rawMsg === "string" ? _rawMsg : JSON.stringify(_rawMsg),
            });
          } else {
            notifyError(
              `❌ ${normalized.message || normalized.error || "Request failed"}`,
              { autoClose: agentToastMs.errShort },
            );
          }
        }
        setLoading(false);
        return;
      }

      markToolProgressOutcome(true);

      // Push token events to TokenChainContext (updates TokenChainDisplay on dashboard)
      const tokenEvents = response.tokenEvents || [];
      if (tokenChain && tokenEvents.length > 0) {
        tokenChain.setTokenEvents(actionId, tokenEvents);
      }

      // Show inline token event summary in the chat + dedicated toasts
      if (tokenEvents.length > 0) {
        const exchanged = tokenEvents.find(
          (e) =>
            e.id === "exchanged-token" ||
            e.id === "two-ex-final-token" ||
            e.id === "two-ex-exchange1",
        );
        const badScopes = tokenEvents.find((e) => e.id === "user-scopes-insufficient");
        const failed = tokenEvents.find((e) => e.id === "exchange-failed");
        // Fire relevant toasts
        if (exchanged) {
          notifyInfo(
            `Token Exchange complete — MCP token issued (aud: ${exchanged.audienceNarrowed || "set"}, scope: ${exchanged.scopeNarrowed || "narrowed"})`,
            { autoClose: agentToastMs.infoToken },
          );
        } else if (badScopes) {
          notifyError(
            "❌ Sign in again with broader scopes (at least 5) for MCP token exchange",
            { autoClose: 7000 },
          );
        } else if (failed && !(response._localFallback && response._exchangeFailed)) {
          notifyError(
            `❌ Token Exchange failed: ${failed.error || "unknown error"}`,
            { autoClose: 6000 },
          );
        }
        const tokenMsg = buildTokenEventMsg(tokenEvents, { localFallback: !!(response._localFallback && response._exchangeFailed) });
        if (tokenMsg) {
          addMessage("token-event", tokenMsg, actionId);
        }
      }

      // Populate results panel + notify hosting dashboard (same CustomEvent in both display modes)
      const isWriteAction = ["transfer", "deposit", "withdraw"].includes(
        actionId,
      );
      let displayNormalized = normalizeAgentToolResult(response.result);
      if (isWriteAction) {
        try {
          const txRes = await getMyTransactions(30);
          const txNorm = normalizeAgentToolResult(txRes.result);
          if (Array.isArray(txNorm?.transactions)) {
            displayNormalized = txNorm;
          }
        } catch {
          // MCP getMyTransactions failed — fall back to direct REST so the panel still shows fresh data
          try {
            const r = await fetch("/api/transactions/my?limit=30", {
              credentials: "include",
            });
            if (r.ok) {
              const d = await r.json();
              if (d?.transactions?.length)
                displayNormalized = { transactions: d.transactions };
            }
          } catch {
            // keep write payload for inferAgentResultTypeAndData
          }
        }
        // Refresh live account balances after write operations so form dropdowns are current
        fetch("/api/accounts/my", { credentials: "include", _silent: true })
          .then(async (r) => {
            const validation = validateHttpResponse(r, "/api/accounts/my");
            if (!validation.isValid) return null;
            return safeResponseJson(r, "/api/accounts/my");
          })
          .then((data) => {
            if (!data) return;
            const validated = extractAccounts(data);
            if (!validated || validated.length === 0) return;
            const normalized = validated
              .map((a) => normalizeAccount(a))
              .filter((a) => a !== null);
            if (normalized.length > 0) {
              setLiveAccounts(normalized);
            }
          })
          .catch((err) => {
            console.warn("[Account Refresh] Failed:", err.message);
          });
      }

      const { resultType, resultData } =
        inferAgentResultTypeAndData(displayNormalized);

      // Always dispatch so Flow Inspector (OAuthInspectorSection) refreshes token data
      // regardless of whether we could infer a structured result type.
      {
        const eventType = isWriteAction
          ? "confirm"
          : resultType || "tool_complete";
        window.dispatchEvent(
          new CustomEvent("banking-agent-result", {
            detail: { type: eventType, data: resultData, label },
          }),
        );
      }

      if (resultType) {
        const titleMap = {
          accounts:      terminology?.accounts     || "Accounts",
          transactions:  terminology?.transactions || "Recent Transactions",
          balance:       terminology?.balance      || "Balance",
          confirm: `${label} confirmed`,
        };
        setResultPanel({
          type: resultType,
          title: titleMap[resultType],
          data: resultData,
          terminology,
        });
      }

      // Always add the result to the chat, including accounts/transactions/balance
      // that also display in the side panel. This ensures the response is visible
      // in the main agent conversation flow.
      addMessage(
        "assistant",
        formatResult(response.result),
        actionId,
        resultExtra,
      );

      // Append HTTP trace (banking API call detail) as a token-event so it
      // shares the RFC-info checkbox gate at the render filter (line ~8120).
      // Previously rendered as 'assistant' which made every successful read
      // action look like two assistant bubbles ("Balance: $X" + JSON dump).
      const successTrace = response.result?.httpTrace;
      if (successTrace && successTrace.length > 0) {
        addMessage("token-event", formatHttpTrace(successTrace), actionId);
      }

      // ── Post-result educational RFC annotation ──
      {
        const exchanged = tokenEvents.find(
          (e) =>
            e.id === "exchanged-token" ||
            e.id === "two-ex-final-token" ||
            e.id === "two-ex-exchange1",
        );
        if (isWriteAction) {
          addMessage(
            "token-event",
            [
              `✅ ${label} complete — what just happened:`,
              "",
              exchanged
                ? `RFC 8693 Token Exchange — MCP token scoped to \`${exchanged.audienceNarrowed || "mcp-server"}\`, scope \`${exchanged.scopeNarrowed || "write"}\``
                : `Local handler — RFC 8693 token exchange not configured or skipped`,
              `HITL gate (RFC 8693 §2.1) — Transfers over the threshold require your explicit consent before the agent proceeds. The agent cannot self-approve: enforcement is server-side, before tool execution.`,
              "",
              `RFCs in play — \`RFC 8693\` (token exchange) · \`RFC 6749 §3.3\` (scope) · \`RFC 8707\` (audience binding)`,
              `Open Token Chain 🪟 to inspect the MCP access token's \`act\`, \`aud\`, and \`scope\` claims.`,
            ].join("\n"),
            actionId,
          );
        } else if (exchanged) {
          addMessage(
            "token-event",
            [
              ` Authorized by scope ${exchanged.scopeNarrowed || "read"} · · audience ${exchanged.audienceNarrowed || "mcp-server"}`,
              `   RFC 6749 §3.3 — every MCP call requires a scoped token; read operations use read, writes require write.`,
              `   RFC 8707 — the resource indicator binds the token to this specific audience and prevents it being accepted elsewhere.`,
            ].join("\n"),
            actionId,
          );
        }
      }

      postAppEvent("agent", "info", "Agent processing complete", {
        tag: "agent/processing-end",
        metadata: { userId: effectiveUser?.id || effectiveUser?.username },
      });
      // Dismiss loading toast and show success
      toast.update(toastId, {
        render: `✅ ${label} complete`,
        type: "success",
        isLoading: false,
        autoClose: agentToastMs.successAction,
        closeButton: true,
        draggable: true,
      });
    } catch (err) {
      // Debug: log all error details for troubleshooting
      const _errDetail = {
        code: err?.code,
        statusCode: err?.statusCode,
        message: err?.message,
        needsAuth: err?.need_auth,
        fullErr: err,
      };
      console.log(`[BankingAgent] ${actionId} error:`, _errDetail);
      // Store for ErrorBoundary "Error Details" panel (dev only)
      if (process.env.NODE_ENV === 'development') {
        try {
          window.__lastAgentError = {
            action: actionId,
            timestamp: new Date().toISOString(),
            code: err?.code,
            statusCode: err?.statusCode,
            message: err?.message,
            needsAuth: err?.need_auth,
            tokenEvents: err?.tokenEvents?.length ?? 0,
          };
        } catch (_) { /* ignore */ }
      }

      markToolProgressOutcome(
        false,
        err
          ? {
              code: err.gatewayErrorCode || err.code,
              message: err.message,
              tool: err.tool || actionId,
            }
          : null,
      );
      // Denied/failed calls still carry the full token-event trail (exchange,
      // intent token, introspection…) on the thrown error. Push it into the
      // Token Chain so the rail shows WHAT was minted before the hop failed.
      if (tokenChain && Array.isArray(err?.tokenEvents) && err.tokenEvents.length > 0) {
        try {
          tokenChain.setTokenEvents(err.tool || actionId, err.tokenEvents);
        } catch (_) { /* display-only — never mask the real error */ }
      }
      toast.dismiss(toastId);

      // Phase 187 D-05: BFF signaled need_auth.
      // Guest path (not logged in): save pending action and redirect to PingOne so
      // onAuthChallengeLogin can auto-replay after the OAuth callback.
      // Stale-session path (logged in but token expired at PingOne): skip the guest
      // login flow — just say the session expired and redirect to refresh it. Without
      // this guard, an authenticated user with a dead PingOne token was treated as an
      // unauthenticated guest and sent through the full re-consent flow.
      if (err?.need_auth && !isLoggedIn) {
        pendingAuthChallengeActionRef.current = { actionId, form };
        PendingActionManager.save({ actionId, form });
        addMessage(
          "assistant",
          " MCP requires your authorization — logging you in…",
        );
        handleLoginAction("login_user");
        setLoading(false);
        return;
      }
      if (err?.need_auth && isLoggedIn) {
        addMessage(
          "assistant",
          "Your session has expired — please sign in again to continue.\n\nRedirecting you to PingOne to sign in…",
          actionId,
        );
        setTimeout(() => navigateToCustomerOAuthForceLogin(), 1500);
        setLoading(false);
        return;
      }

      if (actionId === "mcp_tools") {
        const st = agentFlowDiagram.getState();
        if (st.phase === "running" && st.toolName === "tools/list") {
          agentFlowDiagram.completeInspectorToolsList({
            ok: false,
            errorMessage: err.message || "Request failed",
          });
        }
      }

      const isConnErr =
        err.message.includes("timed out") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENETUNREACH") ||
        err.message.includes("mcp_error") ||
        err.message.includes("Failed to fetch") ||
        err.message.includes("502");

      const mcpToolsUnauthorized =
        actionId === "mcp_tools" &&
        /MCP tools fetch failed:\s*401/i.test(String(err?.message || ""));

      const hydrationAuthFailure =
        err?.code === "session_not_hydrated" ||
        (cookieOnlyBffSession &&
          (err?.statusCode === 401 ||
            err?.code === "authentication_required" ||
            mcpToolsUnauthorized ||
            /sign in to use the banking agent/i.test(
              String(err?.message || ""),
            )));

      const killSwitchActivated = (() => {
        try {
          return !!localStorage.getItem("kill_switch_activated");
        } catch (_) {
          return false;
        }
      })();

      if (isConnErr) {
        notifyError(" MCP server unreachable — check your server connection", {
          autoClose: 8000,
        });
      } else if (err?.code === "hitl_required" || err?.code === "mcp_hitl_required") {
        // 428 Precondition Required — HITL consent required for transaction
        let intentPayload;

        // For transfer_600_test, build payload from liveAccounts since form is empty
        if (actionId === "transfer_600_test" && liveAccounts?.length >= 2) {
          const testFrom =
            liveAccounts.find(
              (a) => a.type === "checking" || a.type === "chk",
            ) || liveAccounts[0];
          const testTo =
            liveAccounts.find(
              (a) => a.type === "savings" || a.type === "sav",
            ) || liveAccounts[1];
          intentPayload = {
            type: "transfer",
            fromAccountId: testFrom?.id,
            toAccountId: testTo?.id,
            amount: APP_CONFIG.THRESHOLDS.DEMO_HITL_TRANSFER,
            description: "HITL + MFA test",
          };
        } else {
          intentPayload = buildConsentIntent(actionId, form);
        }

        if (!intentPayload) {
          notifyError(
            "Could not start consent flow — transaction details missing.",
          );
          setLoading(false);
          toast.dismiss(toastId);
          return;
        }
        addMessage(
          "assistant",
          ` Human-in-the-Loop (HITL) — your manual approval is required.\n\nTransactions over $${APP_CONFIG.THRESHOLDS.HITL_DEFAULT} require your consent before the agent can proceed. The agent is paused and cannot continue until you approve or cancel.\n\nReview the authorization popup, then enter the verification code sent to your email.`,
          actionId,
        );
        toast.dismiss(toastId);
        setHitlPendingIntent({
          actionId,
          form,
          intentPayload,
          threshold: APP_CONFIG.THRESHOLDS.HITL_DEFAULT,
        });
        setLoading(false);
      } else if (
        (err?.statusCode === 428 || err?.response?.status === 428) &&
        // HITL consent + step-up 428s carry a recognized code and are handled by
        // their own branches (consent modal / in-app OTP). Only a 428 WITHOUT one
        // of those codes is a genuine session-expired-during-MFA case. Without
        // this guard, a step-up 428 was misread as "session expired" and forced a
        // full PingOne re-login that cleared the session — an infinite loop.
        err?.code !== "mcp_step_up_required" &&
        err?.code !== "step_up_required" &&
        err?.code !== "mcp_hitl_required" &&
        err?.code !== "hitl_required"
      ) {
        // 428 Precondition Required — token expired during MFA
        window.dispatchEvent(
          new CustomEvent("token-chain-inject", {
            detail: {
              tool: actionId || "HITL Re-Authentication",
              events: [
                {
                  id: "hitl-session-expired",
                  label: "428 Precondition Required — Session Expired During MFA",
                  status: "failed",
                  tokenType: "session",
                  rfc: "RFC 9470",
                  explanation:
                    "The access token expired while MFA step-up was in progress. Customer re-authentication is required to complete the HITL approval step. The BFF will clear the existing session and send prompt=login to PingOne to force a fresh credential challenge.",
                },
              ],
            },
          }),
        );
        addMessage(
          "assistant",
          "Session expired during MFA step-up. Re-authentication is required to complete the HITL approval — sign in again with your customer account to continue.",
          actionId,
        );
        setShowLoginModal(true);
      } else if (hydrationAuthFailure && cookieOnlyBffSession) {
        // Inline session-fix banner already shown on load for cookie-only Backend-for-Frontend (BFF); avoid duplicate toasts.
      } else if (err?.code === "session_not_hydrated") {
        notifyError(
          "Sign in again: server session has no tokens (Vercel needs Redis/Upstash + redeploy, then sign out & sign in).",
          { autoClose: 12000 },
        );
      } else if (err?.statusCode === 401 && killSwitchActivated) {
        // Kill switch was activated — token revoked at PingOne → introspection returns active: false
        const ksData = (() => {
          try {
            return JSON.parse(localStorage.getItem("kill_switch_activated"));
          } catch (_) {
            return null;
          }
        })();
        window.dispatchEvent(
          new CustomEvent("token-chain-inject", {
            detail: {
              tool: "Test Revocation",
              events: [
                {
                  id: "introspection-denied",
                  label:
                    'RFC 7662 Introspection: { "active": false } — Token Revoked',
                  status: "failed",
                  tokenType: "introspection",
                  rfc: "RFC 7662",
                  explanation:
                    'PingOne introspection returned { "active": false }. The access token was revoked by the STOP AGENT kill switch and is no longer valid. This confirms end-to-end token revocation: the authorization server rejected the token.',
                  ...(ksData
                    ? {
                        killSwitchReason: ksData.reason,
                        revokedAt: ksData.revokedAt,
                      }
                    : {}),
                },
              ],
            },
          }),
        );
        addMessage(
          "assistant",
          'Introspection Denied — Token Revoked\n\nPingOne returned { "active": false }. The access token was revoked by the STOP AGENT kill switch.\n\nOpen the Token Chain to see the RFC 7662 introspection result. Sign out and sign back in to get a fresh token.',
          actionId,
        );
      } else if (
        err?.statusCode === 401 &&
        (err?.response?.error === "unauthenticated" ||
          /Login required/i.test(String(err?.message || "")))
      ) {
        // Phase 122: Non-logged-in users attempting banking actions
        addMessage(
          "assistant",
          " You need to sign in first to perform banking operations. Tap Customer Sign In in the left panel to get started.",
        );
      } else if (
        (err?.statusCode === 401 ||
          err?.code === "authentication_required" ||
          /sign in to use the banking agent/i.test(String(err?.message || ""))) &&
        !isLoggedIn
      ) {
        window.dispatchEvent(
          new CustomEvent("token-chain-inject", {
            detail: {
              tool: actionId || "HITL Re-Authentication",
              events: [
                {
                  id: "hitl-unauthenticated",
                  label: "401 Unauthenticated — Customer Sign-In Required",
                  status: "failed",
                  tokenType: "session",
                  rfc: "RFC 6750",
                  explanation:
                    "No active customer session. Sign in with your PingOne customer account to use the banking agent. The HITL approval step requires an authenticated session with a valid access token.",
                },
              ],
            },
          }),
        );
        setShowLoginModal(true);
      } else if (err?.code === "missing_exchange_scopes") {
        addMessage(
          "token-event",
          [
            "❌ RFC 6749 §3.3 — Scope Error: missing required scopes",
            `   Token lacks: \`${(err.missingScopes || []).join(", ") || "write"}`,
            "   RFC 6749 §3.3: access tokens carry a scope claim; resource servers MUST reject tokens missing required scopes.",
            "   RFC 8693 §2.1: token exchange cannot expand scopes — the MCP token can only carry scopes already on the user token.",
            "",
            "Fix: Sign out → sign in with the PingOne app that requests the required banking scopes.",
          ].join("\n"),
          actionId,
        );
        setScopeErrorModal({
          missingScopes: err.missingScopes || [],
          userScopes: err.userScopes || "(none)",
          requiredScopes: err.requiredScopes || "",
          tokenEvents: err.tokenEvents || [],
        });
      } else if (err?.code === "mcp_scope_denied") {
        // Phase 211: scope-upgrade flow — save pending action and show consent modal
        // Phase 210 enforcement: MCP server returned JSON-RPC -32005 (INSUFFICIENT_SCOPE)
        addMessage(
          "token-event",
          [
            "⚠️ OAuth 2.0 §3.3 — Scope Gate: write required",
            `   Tool ${err.tool || actionId} requires: ${(err.requiredScopes || []).join(", ")}`,
            `   Your MCP token is missing: \`${(err.missingScopes || []).join(", ")}`,
            "   The MCP server returned JSON-RPC -32005 (INSUFFICIENT_SCOPE).",
            "   Approve the scope upgrade below to exchange for a write-capable token (RFC 8693).",
          ].join("\n"),
          actionId,
        );
        // Phase 211: save pending action for auto-replay after scope upgrade
        pendingScopeUpgradeRef.current = { actionId, form };
        setScopeErrorModal({
          missingScopes: err.missingScopes || [],
          userScopes: (err.availableScopes || []).join(" ") || "(none)",
          requiredScopes: (err.requiredScopes || []).join(" "),
          tokenEvents: err.tokenEvents || [],
          scopeUpgradeState: "error", // Phase 211: 4-state machine
        });
      } else if (err?.code === "mcp_step_up_required") {
        // MCP Authorize gate: PingOne (or simulated) requires step-up MFA before tool access
        const contextLine =
          err.message ||
          "MCP tool access requires identity verification (PingOne Authorize policy)";
        setOtpContextLine(contextLine);
        pendingOtpActionRef.current = { actionId, form };
        // Attempt P1MFA challenge
        try {
          const apiBase = process.env.REACT_APP_API_URL || "";
          const mfaResp = await fetch(`${apiBase}/api/auth/mfa/challenge`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
          });
          if (mfaResp.ok) {
            const { daId, devices } = await mfaResp.json();
            setP1mfaDaId(daId);
            setP1mfaDevices(devices || []);
            setP1mfaMode(true);
          }
        } catch (mfaErr) {
          console.warn(
            "[MCP Authorize] P1MFA challenge failed, using basic OTP modal:",
            mfaErr.message,
          );
        }
        setShowOtpModal(true);
        addMessage(
          "assistant",
          ` Identity verification required\n\n${contextLine}\n\nPlease complete the verification to continue.`,
          actionId,
        );
        addMessage(
          "token-event",
          [
            " RFC 9470 — OAuth 2.0 Step-Up Authentication Challenge Protocol",
            '   The resource server returned `WWW-Authenticate: Bearer error="insufficient_user_authentication"`.',
            "   This means the current token was issued with a lower ACR (Authentication Context Reference) than the resource requires.",
            "   After MFA, PingOne issues a new token with `acr: Multi_Factor` (or equivalent) — the agent then retries automatically.",
            "",
            "RFCs: RFC 9470 (step-up) · RFC 6750 §3.1 (WWW-Authenticate) · RFC 8693 (token exchange for new ACR token)",
          ].join("\n"),
          actionId,
        );
      } else if (err?.code === "policy_not_found") {
        // P1AZ has no policy matching this action (missing decision endpoint or
        // NOT_APPLICABLE) — config drift, not a deny. Tell the user plainly and
        // return control to the agent.
        addMessage(
          "assistant",
          "Policy not found, please contact administrator.",
          actionId,
        );
      } else if (err?.code === "mcp_authorization_denied") {
        // MCP Authorize gate: PingOne (or simulated) denied tool access
        const reason =
          err.message || "MCP tool access was denied by authorization policy";
        const engine = err.authorizeEngine || "unknown";
        const denyLines = ["Access Denied", "", reason];
        if (err.denyReason) {
          denyLines.push("", `Rule: ${err.denyReason}`);
        }
        if (err.denyParameters) {
          const relevant = ["TokenAudience", "McpResourceUri", "ActClientId", "ToolName", "UserId"];
          const pairs = relevant
            .filter((k) => err.denyParameters[k] !== undefined && err.denyParameters[k] !== "")
            .map((k) => `  ${k}: ${err.denyParameters[k]}`);
          if (pairs.length) {
            denyLines.push("", "Policy inputs:", ...pairs);
          }
        }
        if (err.decisionId) {
          denyLines.push("", `Decision ID: ${err.decisionId}`);
        }
        addMessage("assistant", denyLines.join("\n"), actionId);
        const tokenEventLines = [
          ` RFC 6749 §3.1 / RFC 8693 — Authorization Policy Denied (engine: ${engine})`,
          "   The Authorize policy evaluated the request context (user, agent, action) and returned DENY.",
          "   This is a dynamic authorization decision — even a valid token can be rejected based on policy.",
        ];
        if (err.denyReason) {
          tokenEventLines.push(`   Deny rule: ${err.denyReason}`);
        }
        if (err.denyParameters?.TokenAudience && err.denyParameters?.McpResourceUri) {
          tokenEventLines.push(
            `   Token aud: ${err.denyParameters.TokenAudience}`,
            `   Expected aud (McpResourceUri): ${err.denyParameters.McpResourceUri}`,
          );
        }
        tokenEventLines.push(
          "",
          "RFCs: RFC 6749 §3.1 (authorization endpoint) · RFC 8693 §2.1 (exchange claims) · RFC 8707 (resource indicators)",
        );
        addMessage("token-event", tokenEventLines.join("\n"), actionId);
      } else if (err?.code === "mcp_hitl_required") {
        // MCP Authorize gate: HITL approval needed before tool can execute
        const reason =
          err.message ||
          "This action requires your approval before the agent can proceed";
        // Extract taskId from the error (bankingAgentService puts response fields on the thrown error)
        const taskId = err.taskId;
        addMessage(
          "assistant",
          ` Approval Required\n\n${reason}\n\nPlease review and approve or deny this action.`,
          actionId,
        );
        // Reuse existing HITL consent intent: actionId + form for retry, plus taskId for polling
        setHitlPendingIntent({
          actionId,
          form,
          taskId,
          reason,
          tool: err.tool || null,
          isMcpHitl: true,
          intentPayload: null,
        });
      } else if (err?.code === "agent_restrictions_hitl") {
        const reason =
          err.reason ||
          err.message ||
          "This action is restricted by agent policy. Approval required.";
        const taskId = err.taskId;
        addMessage(
          "assistant",
          `⛔ Restricted Action\n\n${reason}\n\nPlease review and approve or deny this action.`,
          actionId,
        );
        setHitlPendingIntent({
          actionId,
          form,
          taskId,
          reason,
          tool: err.tool || null,
          isMcpHitl: true,
          intentPayload: null,
        });
      } else if (err?.code === "agent_consent_required") {
        // Old server deployment still enforcing startup consent gate.
        // The consent gate has been removed — sign out and sign in to refresh the session,
        // or ask the admin to redeploy the latest server code.
        notifyError(
          "Server configuration: please sign out and sign in again to clear the consent state.",
          { autoClose: 10000 },
        );
      } else if (err?.requiresLogin) {
        // Genuine user session expiry (server sends requiresLogin: true).
        // actor_token_invalid (server CC config issue) no longer sets this flag.
        addMessage(
          "assistant",
          " Your session token has expired or is no longer valid.\n\n" +
            "Redirecting you to PingOne to sign in again…",
          actionId,
        );
        setTimeout(() => navigateToCustomerOAuthForceLogin(), 1500);
      } else if (err?.code === "gateway_policy_denied") {
        // MCP gateway rejected the token before it reached the MCP server.
        // Show a structured educational breakdown: what happened, which policy
        // rule fired, and how to fix it.
        const gwCode = err.gatewayErrorCode || "forbidden";
        const gwMsg = err.message || "Gateway policy denied the tool call";

        // Map gateway error codes to plain-English explanations + fix hints.
        const GW_POLICY_EXPLAINERS = {
          invalid_token: {
            label: "Invalid or malformed token",
            explain:
              "The MCP access token could not be parsed as a valid JWT. " +
              "This usually means the RFC 8693 token exchange produced a bad token, " +
              "or the token was altered in transit.",
            fix: "Retry the action. If this persists, sign out and sign in again to force a fresh token exchange.",
            rfcs: "RFC 7519 §7.2 (JWT validation) · RFC 8693 §3 (token exchange)",
          },
          expired_token: {
            label: "Token expired",
            explain:
              "The exchanged MCP token's `exp` claim is in the past. " +
              "Tokens are short-lived by design (RFC 7519 §4.1.4); the BFF should " +
              "exchange a fresh token on every tool call but something went wrong here.",
            fix: "Use Refresh access token in the left panel, then retry.",
            rfcs: "RFC 7519 §4.1.4 (exp claim) · RFC 6749 §5.1 (token lifetime)",
          },
          invalid_aud: {
            label: "Audience mismatch (RFC 8707)",
            explain:
              "The token's `aud` claim does not include the gateway's resource URI. " +
              "RFC 8707 (Resource Indicators) requires the token to be scoped to the " +
              "exact resource that will consume it. " +
              `Gateway received: "${(gwMsg.match(/got \[([^\]]+)\]/) || [])[1] || "(see logs)"}"`,
            fix:
              "Check that MCP_GW_RESOURCE_URI in the BFF config matches the " +
              "`resource` parameter sent during token exchange (RFC 8693 §2.1).",
            rfcs: "RFC 8707 (resource indicators) · RFC 8693 §2.1 · RFC 7519 §4.1.3 (aud)",
          },
          missing_token: {
            label: "Bearer token missing",
            explain:
              "The gateway received the request with no `Authorization: Bearer …` header. " +
              "The BFF should always attach the RFC 8693-issued MCP token before forwarding.",
            fix: "This is a BFF configuration issue. Check that MCP_GATEWAY_HTTP_URL is set correctly and the token resolution step succeeded.",
            rfcs: "RFC 6750 §2.1 (Bearer token usage)",
          },
          forbidden: {
            label: "Request forbidden by gateway policy",
            explain:
              "The gateway's policy layer blocked the request. " +
              "This could be a CORS origin restriction, a missing claim, " +
              "or a PingOne Authorize policy evaluation returning DENY.",
            fix: "Check the gateway logs for the specific policy that fired. Ensure the BFF origin is in the gateway's allowed list.",
            rfcs: "RFC 6749 §3.1 (authorization) · RFC 8693 §2.2 (exchange constraints)",
          },
        };
        const hint =
          GW_POLICY_EXPLAINERS[gwCode] || GW_POLICY_EXPLAINERS.forbidden;

        addMessage(
          "assistant",
          ` Gateway Policy Denied — \`${err.tool || actionId}\n\n` +
            `${hint.label}: ${hint.explain}\n\n` +
            `Fix: ${hint.fix}`,
          actionId,
        );
        addMessage(
          "token-event",
          [
            ` Ping Agent Gateway — Policy Denial: \`${gwCode}`,
            `   Tool: \`${err.tool || actionId}`,
            `   Gateway error code: \`${gwCode}`,
            `   Message: ${gwMsg}`,
            "",
            `   ${hint.explain}`,
            "",
            `RFCs: ${hint.rfcs}`,
          ].join("\n"),
          actionId,
        );
      } else {
        notifyError(`❌ ${err.message}`, { autoClose: 6000 });
      }

      const authHint =
        err?.code === "session_not_hydrated"
          ? ""
          : err?.statusCode === 401 || err?.code === "authentication_required"
            ? "\n\nTip: use Refresh access token (left column), then retry. Sign in again only if refresh fails."
            : "";

      const showSessionFixBubble =
        err?.code === "session_not_hydrated" ||
        (cookieOnlyBffSession &&
          (err?.statusCode === 401 ||
            err?.code === "authentication_required" ||
            mcpToolsUnauthorized ||
            /sign in to use the banking agent/i.test(
              String(err?.message || ""),
            )));

      if (showSessionFixBubble) {
        if (!sessionFixBubbleShownRef.current) {
          sessionFixBubbleShownRef.current = true;
          addMessage("error", SESSION_NOT_HYDRATED_CHAT, actionId, {
            showSessionFixActions: true,
          });
        }
      } else if (err?.code === "agent_consent_required") {
        // Legacy startup consent gate — no longer enforced in current server code.
        addMessage(
          "assistant",
          "The server is requesting consent to use the agent, but this gate has been removed in the current version.\n\nPlease sign out and sign in again to clear the old session state.",
          actionId,
        );
      } else {
        addMessage(
          "error",
          isConnErr
            ? "AI Agent is unavailable.\n\nThe MCP server is not reachable.\n\nLocal: cd demo_mcp_server && npm run dev\nHosted: set MCP_SERVER_URL to your reachable MCP server URL (if your platform allows outbound WS)."
            : `Error: ${err.message}${authHint}`,
          actionId,
        );
      }

      const pathNorm = (location.pathname || "").replace(/\/$/, "") || "/";
      const onMarketingPublic = isPublicMarketingAgentPath(pathNorm);
      const authRelatedMarketingNudge =
        onMarketingPublic &&
        !isConnErr &&
        err?.code !== "agent_consent_required" &&
        (hydrationAuthFailure ||
          err?.statusCode === 401 ||
          err?.code === "authentication_required" ||
          err?.code === "session_not_hydrated" ||
          mcpToolsUnauthorized ||
          /sign in to use the banking agent/i.test(String(err?.message || "")));
      if (authRelatedMarketingNudge && !isLoggedIn) {
        addMessage("assistant", " Signing you in with PingOne…", actionId);
        handleLoginAction("login_user");
      }
    } finally {
      setLoading(false);
    }
  }

  function setNlInputFromTile(text) {
    setNlInput(text);
    requestAnimationFrame(() => {
      nlInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      nlInputRef.current?.focus();
    });
  }

  // Slot-filling parser for the second turn of a clarification dialog.
  // The user just answered our "Which account?" / "How much?" prompt; we
  // know which action they were trying to do, so we only need to pull the
  // specific slot(s) out of the reply.
  //
  // Returns merged params on success, or null when we couldn't extract
  // anything useful (the caller re-asks once before giving up).
  function parseClarificationReply(action, text, partialParams, missingParams) {
    const t = String(text || "")
      .toLowerCase()
      .trim();
    if (!t) return null;

    // Extract account-type mentions. Use live account types from the current vertical
    // first (e.g. "Primary Care", "HSA" in healthcare) so the clarification slot-fill
    // works outside banking. Fall back to the standard banking types.
    const liveTypes = (liveAccounts || [])
      .map((a) => (a.type || "").toLowerCase())
      .filter(Boolean);
    const accountTypes = liveTypes.length
      ? liveTypes
      : ["checking", "savings", "credit", "credit card", "loan", "mortgage"];
    const matchedTypes = accountTypes.filter((kind) => t.includes(kind));

    // Extract dollar amount. Accepts "$200", "200 dollars", "200".
    const amountMatch = t.match(
      /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?/,
    );
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    // Extract direction prepositions for transfers: "from X to Y".
    const fromTo = t.match(/from\s+(\w+)\s+to\s+(\w+)/);

    if (action === "balance") {
      // Slot: which account. Take the first account-type we found.
      // (Bare "checking" → matchedTypes=["checking"] → fills accountType.)
      if (matchedTypes.length > 0) {
        return { ...partialParams, accountType: matchedTypes[0] };
      }
      return null;
    }

    if (action === "deposit" || action === "withdraw") {
      // Slots: amount + account. Either or both can come in this turn.
      const next = { ...partialParams };
      if (amount != null) next.amount = amount;
      if (matchedTypes.length > 0) {
        // For deposit, the account is the destination (toId); for withdraw, source (fromId).
        if (action === "deposit") next.toId = matchedTypes[0];
        else next.fromId = matchedTypes[0];
      }
      // Need at least an amount AND an account to actually run.
      const hasAmount = next.amount != null;
      const hasAcct = action === "deposit" ? next.toId : next.fromId;
      return hasAmount && hasAcct ? next : null;
    }

    if (action === "transfer") {
      const next = { ...partialParams };
      if (amount != null) next.amount = amount;
      if (fromTo) {
        next.fromId = fromTo[1];
        next.toId = fromTo[2];
      } else if (matchedTypes.length >= 2) {
        // "checking to savings" without explicit "from"
        next.fromId = matchedTypes[0];
        next.toId = matchedTypes[1];
      } else if (matchedTypes.length === 1) {
        // Single account type provided — fill in the first missing slot.
        if (!next.fromId) next.fromId = matchedTypes[0];
        else if (!next.toId) next.toId = matchedTypes[0];
      }
      // Return partial progress even if not all slots are filled — the caller
      // will re-ask for remaining missing params on the next turn.
      const hasProgress = (next.amount != null && !partialParams.amount) ||
        (next.fromId && !partialParams.fromId) ||
        (next.toId && !partialParams.toId);
      if (next.amount != null && next.fromId && next.toId) return next;
      // Return partial if we made progress — caller will update partialParams and re-ask.
      return hasProgress ? next : null;
    }

    // Generic slot-fill: treat the entire reply as the value for the first
    // missing param (e.g. user provides an order ID, tracking number, etc.)
    if (missingParams && missingParams.length > 0 && text.trim()) {
      return { ...partialParams, [missingParams[0]]: text.trim() };
    }

    return null;
  }

  // Reshape a filled-in clarification into the result envelope dispatchNlResult
  // expects. Banking actions (balance/transfer/deposit/withdraw) must be nested
  // under `banking` so the kind:"banking" branch runs; vertical actions keep the
  // top-level `action`/`params` shape the kind:"vertical" branch reads. Without
  // this, the reply was dispatched as kind:"action" (handled by no branch) and
  // fell through to the canned "I didn't catch that" message.
  function buildClarificationResult(pc, merged) {
    if (pc.kind === "vertical") {
      return {
        kind: "vertical",
        action: pc.action,
        params: merged,
        consentGiven: !!pc.consentGiven,
      };
    }
    return {
      kind: "banking",
      banking: { action: pc.action, params: merged },
      consentGiven: !!pc.consentGiven,
    };
  }

  // Inner body of sendAsNl — called only after the guard is acquired.
  // Contains all 3 original release sites (explicit release before no-merge
  // return; .finally on the clarification dispatch chain; .finally on the
  // rAF fetch chain). Do NOT add a fourth release here.
  function prepNlCompliance(text) {
    try {
      agentFlowDiagram.resetComplianceSteps();
      agentFlowDiagram.startLlmReasoning(text);
    } catch (_) {}
  }

  function sendAsNlInner(text) {
    // A typed message is a new turn: start a fresh token-chain trace with the
    // user's actual prompt so the trace rail shows "Pipeline — <prompt>" and
    // the prompt step lights up (demoAgentService's chip path only begins a
    // trace when none was started in the last 60s).
    try {
      tokenChainTraceStore.beginTrace({ prompt: text });
    } catch (_) { /* display-only */ }
    // AG-UI path (ff_agui_enabled=true): stream via POST /api/agent/run
    // The old NL pipeline is bypassed entirely when this flag is on.
    // Heuristics mode (activeLlmProvider=null) must NOT take this path: the
    // BFF's provider fallback would silently send the message to the default
    // LLM (agentRun.js resolves null → llm_provider config → 'anthropic'),
    // violating the agentModes.js contract that Heuristics needs no provider.
    if (aguiEnabled && activeLlmProvider) {
      // Stable thread ID for the session (persists across HITL resumes).
      // runId is per-message so each turn is distinct.
      if (!aguiThreadIdRef.current) {
        aguiThreadIdRef.current = 'ba-' + Date.now();
      }
      const threadId = aguiThreadIdRef.current;
      const runId = 'run-' + Date.now();
      aguiActiveRunIdRef.current = runId;
      addMessage('user', text);
      activityStartRequest(text);
      setNlLoading(true);
      // Send prior visible turns so the agent has multi-turn context ("reverse
      // that" needs the earlier turn). `messages` here is the pre-add closure
      // value, so the current turn is appended explicitly (no duplication). The
      // BFF windows this array (agent_history_limit) before forwarding.
      const priorHistory = (messages || [])
        .filter((m) => (m.role === 'user' || m.role === 'assistant')
          && typeof m.content === 'string' && m.content.trim() && !m.streaming)
        .map((m) => ({ role: m.role, content: m.content }));
      aguiRun({
        threadId,
        runId,
        messages: [...priorHistory, { role: 'user', content: text }],
        provider: activeLlmProvider,
      }).finally(() => {
        setNlLoading(false);
        nlSendGuardRef.current.release();
      });
      return;
    }

    const signal = beginAbortableSend();

    // Clarification-follow-up path: if our previous turn asked "Which
    // account?"/"How much?", treat this message as the missing slot
    // instead of re-parsing it as a brand-new intent. This is what was
    // broken: the parser saw "checking" in isolation, found no keyword
    // match, and fell through to "I didn't recognize that."
    if (pendingClarification) {
      const pc = pendingClarification;
      setPendingClarification(null);

      // Echo the user's reply in the transcript before dispatching.
      setNlInput("");
      addMessage("user", text);

      // Parse the reply into params based on what we asked.
      // Heuristic but tight: enough to handle the common shapes a user
      // would type ("checking", "$50 to savings", "200 from checking
      // to savings"). Anything we can't parse falls back to one more
      // round of clarification.
      const merged = parseClarificationReply(
        pc.action,
        text,
        pc.partialParams || {},
        pc.missingParams,
      );
      if (!merged) {
        // Couldn't extract — re-ask once. After that, give up and let
        // the parser try a normal interpretation.
        addMessage("assistant", `Sorry, I didn't catch that. ${pc.asked}`, null, { paramHint: pc.hint || null });
        setPendingClarification(pc);
        nlSendGuardRef.current.release();
        return;
      }

      // For transfers: check if all required slots are filled. If not, re-ask
      // with the accumulated partial params so incremental slot-filling works.
      if (pc.action === "transfer" && !(merged.amount != null && merged.fromId && merged.toId)) {
        const still = [];
        if (!merged.fromId) still.push('source account (e.g. "from checking")');
        if (!merged.toId) still.push('destination account (e.g. "to savings")');
        if (merged.amount == null) still.push('amount (e.g. "$100")');
        const reAsk = `Got it. I still need: ${still.join(', ')}.\n\nExample: "from checking to savings $100"`;
        addMessage("assistant", reAsk, null, { paramHint: pc.hint || null });
        setPendingClarification({
          ...pc,
          partialParams: merged,
          asked: reAsk,
        });
        nlSendGuardRef.current.release();
        return;
      }

      // Build a synthetic NL result that mirrors what the server would
      // have produced, and dispatch through the same path. source='clarify'
      // so the token-chain panel can label it correctly.
      const syntheticResult = buildClarificationResult(pc, merged);
      dispatchNlResult(syntheticResult, "clarify", text)
        .catch((err) => { if (!isAbortError(err)) reportNlFailure(err); })
        .finally(() => nlSendGuardRef.current.release());
      return;
    }

    prepNlCompliance(text);
    setNlInput(text);
    // Use rAF so the input state settles before the synthetic submit fires
    requestAnimationFrame(() => {
      setNlInput("");
      addMessage("user", text);
      setNlLoading(true);
      fetch("/api/demo-agent/nl", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          provider: activeLlmProvider || "heuristic",
          vertical: effectiveVerticalId,
        }),
        signal: anySignal([AbortSignal.timeout(activeLlmProvider === "anthropic-lmstudio" || activeLlmProvider === "llamacpp" || activeLlmProvider === "mlx" || activeLlmProvider === "helix" ? 60000 : 15000), signal]),
      })
        .then((r) =>
          r.json().catch(() => ({
            result: { kind: "none", message: "Could not parse response." },
            source: "heuristic",
          })),
        )
        .then(({ result, source, llm_not_configured }) => {
          tokenChain?.setNlRoutingEvent({
            prompt: text,
            source: source || "heuristic",
            intent: result,
            timestamp: new Date().toISOString(),
            heuristicSaved: !source || source === "heuristic",
          });
          // Pure-mode provider unavailable → ask before using heuristics (#1).
          if (maybeDeferToHeuristicPrompt({ result, source, text, llm_not_configured })) {
            return undefined;
          }
          return dispatchNlResult(result, source || "heuristic", text);
        })
        .catch((err) => { if (!isAbortError(err)) reportNlFailure(err); })
        .finally(() => {
          setNlLoading(false);
          nlSendGuardRef.current.release();
        });
    });
  }

  // Sends text through the full NL pipeline (same path as typing in the chat box).
  function sendAsNl(text) {
    if (!nlSendGuardRef.current.tryAcquire()) return;
    try {
      sendAsNlInner(text);
    } catch (e) {
      // Synchronous failure before any async release path ran — free the
      // guard so the send box doesn't stay locked. (Parity with
      // handleNaturalLanguage's try/finally.)
      nlSendGuardRef.current.release();
      throw e;
    }
  }

  // Activate a discovery/rail chip: manifest-derived vertical chips carry a
  // `message` → NL pipeline (vertical service); banking ACTION_GROUPS chips
  // dispatch by action ID.
  function handleChipActivate(action) {
    if (action.message) sendAsNl(action.message);
    else handleActionClick(action.id);
  }

  function handleActionClick(actionId) {
    if (actionId !== "logout" && isAgentBlockedByConsentDecline()) {
      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
      return;
    }
    if (actionId === "logout") {
      aguiAbort();
      aguiReset();
      onLogout?.();
      return;
    }
    if (actionId === "demo_guide") {
      setShowDemoGuide(true);
      return;
    }

    // In LLM-only mode, route conversational chips through the NL pipeline so Helix handles them.
    // Data-retrieval chips always bypass Helix and hit the real API.
    if (!heuristicEnabled && !API_DIRECT_CHIPS.has(actionId)) {
      const prompt = CHIP_NL_PROMPTS[actionId];
      if (prompt) {
        // Prompts that need user input (e.g. query_user) still pre-fill the box.
        if (prompt.endsWith(": ")) {
          setNlInputFromTile(prompt);
        } else {
          sendAsNl(prompt);
        }
        return;
      }
    }

    // Run API-direct chips (and all chips in heuristic mode).
    if (API_DIRECT_CHIPS.has(actionId)) {
      runAction(actionId, {});
    } else if (actionId === "query_user") {
      setNlInputFromTile("Query user by email: ");
    } else if (actionId === "sequential_think") {
      setNlInputFromTile(
        "Think: Should I transfer money from checking to savings?",
      );
    } else if (actionId === "demo_nl_routing") {
      setNlInputFromTile("What is my checking account balance?");
    } else if (
      actionId === "ai_ask" ||
      actionId === "ai_helix_demo" ||
      actionId === "ai_explain" ||
      actionId === "ai_helix_explain" ||
      actionId === "ai_analyze" ||
      actionId === "ai_advice" ||
      actionId === "ai_helix_advice"
    ) {
      runAction(actionId, {});
    } else {
      runAction(actionId, {});
    }
  }

  function openEducationCommand(cmd) {
    if (isAgentBlockedByConsentDecline()) {
      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
      return;
    }
    if (cmd.ciba && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("education-open-ciba", {
          detail: { tab: cmd.tab || "what" },
        }),
      );
      setIsOpen(false);
      return;
    }
    if (cmd.panel) {
      edu?.open(cmd.panel, cmd.tab || null);
      setIsOpen(false);
    }
  }

  /**
   * Shared NL dispatch: education panels, banking tools, or fallback hint.
   * @param {object} result - NL routing result from server
   * @param {string} _source - routing source tag ("heuristic" | "helix" |
   *   "lmstudio" | ...). Threaded into runAction via opts.nlSource so the
   *   assistant result renders the same source pill as conversational answers.
   * @param {string} nlUserText - original user text for post-auth replay
   */
  /**
   * #1 consistency: in a PURE LLM mode (Helix/LM Studio/Claude only) the user
   * asked for that provider exclusively. If the BFF reports the provider was
   * unavailable (llm_not_configured), do NOT silently answer with heuristics —
   * stash the heuristic result and surface an explicit "use Heuristics?" prompt.
   * Returns true when it deferred (caller must skip its own dispatch).
   */
  function maybeDeferToHeuristicPrompt({ result, source, text, llm_not_configured }) {
    if (!PURE_LLM_MODES.includes(agentProviderMode)) return false;
    // In a pure LLM mode (heuristicRouting:false) a `heuristic` source can only
    // mean the chosen provider didn't answer — unconfigured, unreachable, or it
    // couldn't map the request. Any non-heuristic source is a real LLM answer.
    if (source && source !== "heuristic") return false;
    const label = PURE_LLM_LABELS[agentProviderMode] || "the selected model";
    const why = llm_not_configured ? "not configured" : "unavailable or couldn't answer that";
    addMessage(
      "assistant",
      `⚠️ ${label} is selected but ${why} right now. I didn't fall back automatically. ` +
        `Want me to answer with the built-in Heuristics instead?`,
    );
    setPendingLlmFallback({ result, source: "heuristic", text });
    return true;
  }

  async function dispatchNlResult(
    result,
    _source = "heuristic",
    nlUserText = "",
    useCaseId = undefined,
  ) {
    // A /nl error envelope (e.g. the Vite proxy's 502 {"error":"proxy_error"}
    // while the BFF restarts) parses as JSON but carries no `result`, so all
    // three call paths land here with undefined. Reading result.kind then threw
    // and the user saw "Could not parse: Cannot read properties of undefined" —
    // say what actually happened instead.
    if (!result || typeof result.kind !== "string") {
      addMessage(
        "assistant",
        "The agent backend didn't return a usable response — it may be restarting. Please try again in a moment.",
        null,
        { source: _source },
      );
      return;
    }
    // Degraded-mode detection: only relevant in helix_google (Helix-only) mode.
    // In heuristics-only mode a heuristic response is expected, not a fallback —
    // don't show the "AI offline" banner for normal operation.
    if (_source === "helix" || _source === "helix_fallback") {
      setHelixDegraded(false);
    } else if (agentProviderMode === "helix_google" && _source === "heuristic") {
      setHelixDegraded(true);
    }

    // Model advisory: surface mismatches between configured mode and query complexity.
    if (modelAdvisoryTimerRef.current) clearTimeout(modelAdvisoryTimerRef.current);
    let _advisoryMsg = null;
    if (FRONTIER_MODES.includes(agentProviderMode) && _source === "heuristic") {
      _advisoryMsg = "Tip: simple query matched a pattern — heuristics mode skips the LLM entirely.";
    } else if (agentProviderMode === "heuristics" && result.kind === "none") {
      _advisoryMsg = "Tip: query not understood in heuristics-only mode — enable an LLM provider.";
    }
    setModelAdvisory(_advisoryMsg);
    if (_advisoryMsg) {
      modelAdvisoryTimerRef.current = setTimeout(() => setModelAdvisory(null), 6000);
    }

    if (result.kind === "education" && result.ciba) {
      openEducationCommand({ ciba: true, tab: result.tab });
      setIsOpen(false);
      addMessage(
        "assistant",
        ` CIBA Guide opened — see the sliding panel on the right.\n\n` +
          `CIBA (Client-Initiated Backchannel Authentication) lets the server request user approval out-of-band:\n` +
          `• Server calls POST /bc-authorize → PingOne sends email or push to user\n` +
          `• User approves from their inbox or device — no browser redirect needed\n` +
          `• Server polls POST /token until approved, then stores tokens server-side\n\n` +
          `Great for chat agents (redirect would break the flow) and high-value step-up transactions.\n` +
          `The guide has 8 tabs: What is CIBA · Sign-in & roles · Full stack · Token exchange · vs Login · Try It (live demo) · App Flows · PingOne Setup`,
      );
      return;
    }
    if (result.kind === "education" && result.education?.panel) {
      const panel = result.education.panel;
      const tab = result.education.tab || null;
      if (panel === EDU.CIMD) {
        window.dispatchEvent(
          new CustomEvent("education-open-cimd", {
            detail: { tab: tab || "what" },
          }),
        );
        setIsOpen(false);
        addMessage(
          "assistant",
          ` CIMD Simulator opened — see the sliding panel on the right.\n\n` +
            `OAuth Client ID Metadata Document (CIMD) redefines what a client_id is:\n` +
            `• Instead of an opaque string, the client_id is a URL you control\n` +
            `• That URL hosts a JSON document describing the client (redirect_uris, grant_types, scopes…)\n` +
            `• A CIMD-capable AS fetches the URL to learn the client's metadata — no pre-registration needed\n` +
            `• The client controls updates: just update the hosted document\n\n` +
            `This demo registers the client in PingOne via the Management API and hosts the document at:\n` +
            `/.well-known/oauth-client/{pingone-app-id}\n\n` +
            `Panel tabs: What is CIMD · CIMD vs DCR · Doc format · How AS uses it · Flow diagram · Simulate · PingOne`,
        );
        return;
      }
      // Conversational LLM answer — no panel to open, just display the text.
      if (panel === "general-knowledge") {
        addMessage(
          "assistant",
          result.message || "I don't have an answer for that.",
        );
        return;
      }
      const topicMsg = TOPIC_MESSAGES[panel];
      edu?.open(panel, tab);
      addMessage(
        "assistant",
        topicMsg
          ? topicMsg
          : `Opened help panel: ${panel}. See the sliding panel on the right for details.`,
      );
      return;
    }
    if (result.kind === "banking" && result.banking?.action) {
      const { action, params } = result.banking;
      if (action === "logout") {
        addMessage("assistant", "Signing you out…");
        setTimeout(() => onLogout?.(), 800);
        return;
      }
      if (marketingGuestChatEnabled) {
        try {
          if (nlUserText && nlUserText.trim()) {
            sessionStorage.setItem(BX_AGENT_PENDING_NL_KEY, nlUserText.trim());
          }
        } catch (_) {}
        addMessage(
          "assistant",
          "Taking you to PingOne — after you sign in you’ll return here and we’ll continue with that request.",
        );
        handleLoginAction("login_user");
        return;
      }
      const p = normalizeBankingParams(params);
      if (action === "mcp_tools") {
        await runAction(
          "mcp_tools",
          {},
          { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId },
        );
        return;
      }
      if (action === "biggest_purchase" || action === "spending_summary") {
        const txRes = await getMyTransactions(50, {
          useCaseId,
          vertical: effectiveVerticalId,
        }).catch(() => null);
        const txNorm = txRes ? normalizeAgentToolResult(txRes.result) : null;
        const txList = txNorm?.transactions;
        if (!Array.isArray(txList) || txList.length === 0) {
          addMessage(
            "assistant",
            "No transaction history found for your accounts.",
          );
          return;
        }
        if (action === "biggest_purchase") {
          const purchases = txList.filter(
            (tx) =>
              tx.type === "debit" || tx.type === "purchase" || tx.amount < 0,
          );
          const candidates = purchases.length > 0 ? purchases : txList;
          const biggest = candidates.reduce((max, tx) =>
            Math.abs(tx.amount) > Math.abs(max.amount) ? tx : max,
          );
          const amt = Math.abs(biggest.amount).toFixed(2);
          const desc = biggest.merchant || biggest.description || "Unknown";
          const when = biggest.createdAt
            ? new Date(biggest.createdAt).toLocaleDateString()
            : "";
          addMessage(
            "assistant",
            `Your biggest purchase was $${amt} at ${desc}${when ? ` on ${when}` : ""}.`,
          );
        } else {
          const debits = txList.filter(
            (tx) =>
              tx.type === "debit" || tx.type === "purchase" || tx.amount < 0,
          );
          const total = debits.reduce(
            (sum, tx) => sum + Math.abs(tx.amount),
            0,
          );
          const byCategory = debits.reduce((acc, tx) => {
            const cat = tx.category || tx.merchant || "Other";
            acc[cat] = (acc[cat] || 0) + Math.abs(tx.amount);
            return acc;
          }, {});
          const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
          const lines = sorted
            .slice(0, 5)
            .map(([cat, amt]) => `- ${cat}: $${amt.toFixed(2)}`)
            .join("\n");
          addMessage(
            "assistant",
            `Total spending across ${debits.length} transactions: $${total.toFixed(2)}\n\nTop categories:\n${lines}`,
          );
        }
        setResultPanel({
          type: "transactions",
          title:
            action === "biggest_purchase"
              ? (terminology?.transactions || "Transactions")
              : "Spending Breakdown",
          data: txList,
          terminology,
        });
        return;
      }
      if (action === "accounts" || action === "transactions") {
        await runAction(action, {}, { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId });
      } else if (action === "balance" && (p.accountId || p.accountType)) {
        let resolvedId = p.accountId;
        if (!resolvedId && p.accountType) {
          const match = liveAccounts.find(
            (a) => a.type?.toLowerCase() === p.accountType.toLowerCase(),
          );
          resolvedId = match?.id;
        }
        if (resolvedId) {
          await runAction(
            "balance",
            { accountId: resolvedId },
            { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId },
          );
        } else {
          addMessage(
            "assistant",
            `I couldn't find a ${p.accountType || "matching"} ${terminology?.account || "account"}. Which ${terminology?.account || "account"} would you like to check?`,
          );
        }
      } else if (action === "transfer" && p.fromId && p.toId && p.amount) {
        // NL returns account type names ("checking"/"savings") — resolve to real IDs
        const resolveAcct = (val) => {
          if (!val) return val;
          const byId = liveAccounts.find((a) => a.id === val);
          if (byId) return byId.id;
          const byType = liveAccounts.find(
            (a) => a.type?.toLowerCase() === val.toLowerCase(),
          );
          return byType ? byType.id : val;
        };
        await runAction(
          "transfer",
          { ...p, fromId: resolveAcct(p.fromId), toId: resolveAcct(p.toId) },
          { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId },
        );
      } else if (action === "deposit" && p.amount) {
        const depAcct = liveAccounts.find(
          (a) => a.type?.toLowerCase() === (p.toId || "checking").toLowerCase(),
        );
        await runAction(
          "deposit",
          { ...p, accountId: p.accountId || (depAcct ? depAcct.id : p.toId) },
          { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId },
        );
      } else if (action === "withdraw" && p.amount) {
        const wdAcct = liveAccounts.find(
          (a) =>
            a.type?.toLowerCase() === (p.fromId || "checking").toLowerCase(),
        );
        await runAction(
          "withdraw",
          { ...p, accountId: p.accountId || (wdAcct ? wdAcct.id : p.fromId) },
          { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId },
        );
      } else if (
        ["balance", "transfer", "deposit", "withdraw"].includes(action)
      ) {
        const termAccount  = terminology?.account  || "account";
        const termAccounts = terminology?.accounts || "accounts";
        const termBalance  = terminology?.balance  || "balance";
        const termHighValue = terminology?.highValueAction || "Transfer";
        // Tell the user which accounts they can pick. The list is derived from
        // liveAccounts (vertical-aware: re-fetched on every vertical switch), so
        // this works for all verticals that use the account model — not just
        // banking. parseClarificationReply matches on account type, so we list
        // the distinct types (e.g. "Checking, Savings").
        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        const acctTypes = [
          ...new Set((liveAccounts || []).map((a) => a.type).filter(Boolean)),
        ];
        const optionsHint = acctTypes.length
          ? ` Options: ${acctTypes.map(cap).join(", ")}.`
          : "";
        const questions = {
          balance:  `Which ${termAccount} would you like to check the ${termBalance} for?${optionsHint}`,
          deposit:  `How much would you like to deposit, and to which ${termAccount}?${optionsHint}`,
          withdraw: `How much would you like to withdraw, and from which ${termAccount}?${optionsHint}`,
          transfer: `Which ${termAccounts} would you like to ${termHighValue.toLowerCase()} between, and how much?${optionsHint}`,
        };
        addMessage("assistant", questions[action], null, { source: _source });
        // Remember WHAT we asked so the next user message can fill the slot.
        // sendAsNl() inspects this on the next turn and skips re-parsing
        // when we already know the intent. We also remember any partial
        // params the parser already filled so e.g. "checking" + previous
        // amount=$50 still works on the next turn.
        setPendingClarification({
          action,
          partialParams: p || {},
          asked: questions[action],
        });
      } else {
        await runAction(action, p, { skipUserLabel: true, nlSource: _source, useCaseId, vertical: effectiveVerticalId });
      }
      return;
    }
    if (result.kind === "vertical" && result.action) {
      // Banking plugin NL returns kind:vertical — use the same runAction/MCP path as
      // kind:banking (Check Balance chip, accounts, etc.) instead of re-invoking /agent/invoke.
      const verticalId = result.vertical || effectiveVerticalId;
      if (verticalId === "banking") {
        return dispatchNlResult(
          {
            kind: "banking",
            banking: { action: result.action, params: result.params || {} },
          },
          _source,
          nlUserText,
          useCaseId,
        );
      }
      // The /nl endpoint only routed intent; execute via the agent endpoint to get data+render.
      // forceHeuristic: /nl already resolved a deterministic vertical action, so the
      // re-dispatch must run that vertical's service (canned response) regardless of
      // agent_mode — otherwise "Helix only" mode re-routes it to the LLM and the chip
      // returns an empty reply. Applies to every vertical.
      try {
        // When clarification already filled the missing params, reconstruct a
        // message the heuristic can re-parse with the complete params intact
        // (e.g. "order status 1003" so orderId extraction fires).
        const hasFilledParams = result.params && Object.keys(result.params).length > 0;
        const agentMessage = hasFilledParams
          ? `${result.action.replace(/_/g, ' ')} ${Object.values(result.params).join(' ')}`
          : (nlUserText || result.action);
        const verticalOpts = { forceHeuristic: true, vertical: verticalId, consentGiven: !!result.consentGiven, ...(useCaseId ? { useCaseId } : {}) };
        const response = await sendAgentMessage(agentMessage, null, verticalOpts);
        // Admin token on the customer agent → action card (login as customer / cancel).
        if (maybeHandleCustomerLogin(response, _source)) return;
        // A tokenless session must surface as "sign in again" + redirect — not as
        // the reply text alone (the user can't tell a sign-in problem from an
        // agent outage; see 2026-06-12 expired-token incident).
        // Also catch 401 from authenticateToken when _cookie_session has no
        // _restoredFromCookie flag (returns { error: 'authentication_required' },
        // no requiresLogin/need_auth field, success absent).
        if (response?.requiresLogin || response?.error === "login_required" || response?.need_auth ||
            response?._status === 401 || response?.error === "authentication_required" || response?.error === "session_expired") {
          addMessage(
            "assistant",
            response.reply ||
              "Your session is no longer signed in — please sign in again to continue.",
            null,
            { source: _source },
          );
          setTimeout(() => navigateToCustomerOAuthForceLogin(), 1500);
          return;
        }
        ingestActivity(response, nlUserText || result.action);
        if (response?.reply) {
          const paramHint = response.needsParams?.hint || null;
          const replyWithAgentBadge = `[CUSTOMER AGENT - LangGraph]\n${response.reply}`;
          addMessage("assistant", replyWithAgentBadge, null, { source: _source, ...verticalResultExtra(response), paramHint });
          // Teaching directive: open the requested education panel (P2/P3). Mirrors the
          // kind:'education' path; fires only for a resolvable panel id.
          if (response.education?.panel) {
            edu?.open(response.education.panel, response.education.tab || null);
          }
          if (response.tokenEvents?.length) {
            appendTokenEvents(response.tokenEvents);
            if (tokenChain) {
              tokenChain.setTokenEvents(result.action || "agent", response.tokenEvents);
            }
            const agentTokenMsg = buildTokenEventMsg(response.tokenEvents);
            if (agentTokenMsg) {
              addMessage("token-event", agentTokenMsg, result.action || "agent");
            }
          }
          // A vertical HITL directive can be either consent (hitl_required) or
          // step-up (step_up_required). Both must open the approval modal — the
          // step-up path adds an OTP/MFA step before approving the challenge.
          // (Earlier this only fired on hitl_required + requiresConsent, so
          // step-up tools like healthcare release_records printed the text but
          // never opened the modal.)
          if (
            response.error === 'hitl_required' ||
            response.error === 'mcp_hitl_required' ||
            response.error === 'step_up_required' ||
            response.error === 'mcp_step_up_required'
          ) {
            const actionLabel = (response.action || result.action || '').replace(/_/g, ' ');
            const isStepUp =
              response.error === 'step_up_required' ||
              response.error === 'mcp_step_up_required' ||
              !!response.requiresStepUp ||
              !!response.step_up_required;
            setHitlPendingIntent({
              isVerticalConsent: true,
              verticalMessage: agentMessage,
              verticalOpts,
              // challengeId issued by the BFF (pre-flight or gateway). On approve we
              // approve THIS challenge and retry carrying it, so the receipt PERMITs.
              hitlChallengeId: response.hitlChallengeId || null,
              tool: response.action || result.action || null,
              intentPayload: {
                type: isStepUp ? 'Identity Verification Required' : 'Action Confirmation',
                description: actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1),
                amount: 0,
              },
            });
          } else if (response.needsParams?.action && response.needsParams.missing?.length) {
            setPendingClarification({
              kind: 'vertical',
              action: response.needsParams.action,
              missingParams: response.needsParams.missing,
              partialParams: result.params || {},
              asked: response.reply,
              hint: paramHint,
            });
          }
          return;
        }
        if (response && response.success !== false && response._status !== 401) {
          addMessage("assistant", AGENT_UNAVAILABLE_MESSAGE, null, { source: _source });
          return;
        }
      } catch (e) {
        // An expired/missing session (401) here must say so plainly — otherwise it
        // falls through to "I didn't catch that", which sends the user looking at
        // the wrong thing. demoAgentService throws statusCode:401 on a 401.
        const isAuthExpired =
          e?.statusCode === 401 ||
          e?._status === 401 ||
          e?.requiresLogin ||
          e?.code === "authentication_required" ||
          /session expired|expired or is no longer valid/i.test(String(e?.message || ""));
        if (isAuthExpired) {
          addMessage(
            "assistant",
            "Your session has expired — please sign in again to continue.\n\nRedirecting you to PingOne to sign in…",
            null,
            { source: _source },
          );
          setTimeout(() => navigateToCustomerOAuthForceLogin(), 1500);
          return;
        }
        /* otherwise fall through to default below */
      }
    }
    // Prefer the server's message (heuristic / LLM produces a useful one).
    // The hard-coded fallback is only for the rare case where result.message
    // is missing — e.g. server crashed before populating it.
    addMessage(
      "assistant",
      result.message ||
        `I didn't catch that. Try "show my accounts", "balance", "recent transactions", or "explain token exchange".`,
      null,
      { source: _source },
    );
  }

  /**
   * Admin-token-on-customer-agent guard. The BFF refuses to run the customer
   * agent with an admin-client token (it cannot read customer data) and returns
   * { requiresCustomerLogin: true }. Render an action card: "Log in as customer"
   * (fresh user OAuth) vs "Cancel — stay on admin" (keep the admin token, go to
   * the admin console). Returns true when handled so the caller stops.
   */
  function maybeHandleCustomerLogin(response, source) {
    if (!response || (!response.requiresCustomerLogin && response.code !== "admin_token_on_customer")) {
      return false;
    }
    addMessage(
      "error",
      response.reply ||
        "This action needs a customer sign-in. You're signed in with an admin token, which can't read customer banking data. Log in as a customer to continue, or cancel to stay on the admin console.",
      null,
      { showCustomerLoginActions: true, source },
    );
    return true;
  }

  /** NL API errors: 401 is session missing on server — not a parse failure. */
  function reportNlFailure(err, retry) {
    // AbortSignal.timeout() rejects with a TimeoutError (message "signal timed
    // out") — distinct from a user/cancel AbortError, so isAbortError() does NOT
    // swallow it and we land here. A slow local model (e.g. an Ollama reasoning
    // model on cold start) is the usual cause. Show an actionable hint instead
    // of the raw "Could not parse: signal timed out" string.
    const isTimeout =
      err?.name === "TimeoutError" ||
      (typeof err?.message === "string" && err.message.includes("timed out"));
    if (isTimeout) {
      notifyError("⏱️ The model took too long to respond — request timed out.", {
        autoClose: agentToastMs.errShort,
      });
      // Only llama.cpp timeouts get the pre-warm retry action — there's no
      // local tier to pre-warm for Helix/Anthropic.
      const offerPrewarmRetry = retry && isLocalModelTimeout(err, activeLlmProvider);
      addMessage(
        "assistant",
        "That took too long to answer — the local model timed out. Try again (the model is faster once warmed up), or switch to a quicker mode (Helix/Anthropic, or a smaller Ollama model).",
        null,
        offerPrewarmRetry ? { showPrewarmRetryAction: true, retryFn: retry } : undefined,
      );
      return;
    }
    if (err?.code === "session_not_hydrated") {
      if (!cookieOnlyBffSession) {
        notifyError(
          "Sign in again: server session has no tokens (Vercel needs Redis/Upstash + redeploy, then sign out & sign in).",
          { autoClose: 12000 },
        );
      }
      if (!sessionFixBubbleShownRef.current) {
        sessionFixBubbleShownRef.current = true;
        addMessage("error", SESSION_NOT_HYDRATED_CHAT, null, {
          showSessionFixActions: true,
        });
      }
      const pSess = (location.pathname || "").replace(/\/$/, "") || "/";
      if (isPublicMarketingAgentPath(pSess)) {
        window.dispatchEvent(new CustomEvent("marketing-scroll-login"));
      }
      return;
    }
    if (
      err?.statusCode === 401 ||
      err?._status === 401 ||
      err?.code === "authentication_required" ||
      err?.code === "login_required"
    ) {
      if (cookieOnlyBffSession) {
        if (!sessionFixBubbleShownRef.current) {
          sessionFixBubbleShownRef.current = true;
          addMessage("error", SESSION_NOT_HYDRATED_CHAT, null, {
            showSessionFixActions: true,
          });
        }
        return;
      }
      const p401 = (location.pathname || "").replace(/\/$/, "") || "/";
      if (isPublicMarketingAgentPath(p401) && !isLoggedIn) {
        addMessage("assistant", " Signing you in with PingOne…");
        handleLoginAction("login_user");
        return;
      }
      notifyError(
        "Sign in required — the server has no session for this request. Refresh the page and sign in again.",
        { autoClose: agentToastMs.errShort },
      );
      addMessage(
        "assistant",
        "You need an active server session to use the agent. If you already signed in, refresh the page (session may have expired or cookies may not have reached the API).",
      );
      return;
    }
    const errorMessage =
      err.message ||
      err.error ||
      "An unexpected error occurred. Please try again.";
    notifyError(`❌ Could not parse request: ${errorMessage}`, {
      autoClose: agentToastMs.errShort,
    });
    addMessage("assistant", `Could not parse: ${errorMessage}`);
  }

  /** Click handler for the "Pre-warm the model & retry" action (Task: prewarm-retry-timeout). */
  async function handlePrewarmRetry(msgId, retryFn) {
    if (!prewarmGuardRef.current.tryAcquire()) return;
    setPrewarming(msgId);
    try {
      await prewarmTierAndRetry("gpt-oss-20b", retryFn);
    } catch (_err) {
      notifyError("Could not pre-warm the model — try switching mode instead.", {
        autoClose: agentToastMs.errShort,
      });
    } finally {
      setPrewarming(null);
      prewarmGuardRef.current.release();
    }
  }

  /**
   * Run a Demo-section use case from the agent header (same catalog as /use-cases).
   * Chip triggers replay NL with useCaseId stamping; attacks hit the sim API;
   * link/edu open their destinations.
   */
  async function handleDemoStepSelect(uc, stepNumber) {
    if (!uc) return;
    setShowDemoSteps(false);
    setShowDiscovery(false);
    if (isAgentBlockedByConsentDecline()) {
      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
      return;
    }
    markUseCaseCompleted(uc.id);
    const stepLabel = `Demo step ${stepNumber}: ${uc.id} — ${uc.title}`;
    const trigger = uc.trigger || {};

    // Auto-enable feature flags required by flag-gated demo steps.
    // This ensures presenters don't need to manually toggle flags before running.
    if (uc.maturity && typeof uc.maturity === "string" && uc.maturity.startsWith("flag:")) {
      const flagName = uc.maturity.replace("flag:", "");
      try {
        await apiClient.patch("/api/admin/feature-flags", { updates: { [flagName]: true } });
        console.log(`[handleDemoStepSelect] Auto-enabled ${flagName} for ${uc.id}`);
      } catch (e) {
        console.warn(`[handleDemoStepSelect] Could not auto-enable ${flagName}:`, e.message);
      }
    }
    // UC2.5 (A2A orchestrator) needs ff_a2a_delegation but has maturity 'works'
    if (uc.id === "UC2.5") {
      try {
        await apiClient.patch("/api/admin/feature-flags", { updates: { ff_a2a_delegation: true } });
        console.log("[handleDemoStepSelect] Auto-enabled ff_a2a_delegation for UC2.5");
      } catch (e) {
        console.warn("[handleDemoStepSelect] Could not auto-enable ff_a2a_delegation:", e.message);
      }
    }

    if (trigger.type === "chip" && trigger.text) {
      if (!(isLoggedIn || marketingGuestChatEnabled)) {
        addMessage("assistant", "Sign in to run demo steps.");
        return;
      }
      // Resume path stamps useCaseId onto sendAgentMessage (same as /use-cases Run).
      pendingUcIdRef.current = uc.useCaseId || null;
      pendingNlResumeRef.current = null;
      addMessage("assistant", `Running ${stepLabel}…`);
      setNlResumeAfterAuth(trigger.text);
      return;
    }

    if (trigger.type === "edu" && trigger.panel) {
      edu?.open(trigger.panel, trigger.tab || "overview");
      addMessage("assistant", `${stepLabel} — opened learning panel.`);
      return;
    }

    if (trigger.type === "link" && trigger.path) {
      addMessage("assistant", `${stepLabel} — opening ${trigger.path}.`);
      navigate(trigger.path);
      return;
    }

    if (trigger.type === "attack" && trigger.sim) {
      const sim =
        trigger.sim === "wrong-aud-token" ? "wrong-aud" : trigger.sim;
      addMessage("user", stepLabel);
      setNlLoading(true);
      // Reset token chain trace so the proof strip shows this use case, not a stale one
      try { tokenChainTraceStore.beginTrace({ prompt: stepLabel }); } catch (_) {}
      try {
        const { data } = await apiClient.post("/api/demo/attack-sim/run", { sim });
        const status = data?.status;
        const isDeny = typeof status !== "number" || status >= 400;
        const verdict = isDeny ? "DENY" : "PERMIT";
        const reason = data?.reason || data?.errorCode || "";
        addMessage(
          "assistant",
          [
            `${stepLabel}`,
            `Attack sim \`${sim}\` → ${status ?? "?"} ${verdict}`,
            reason ? reason : null,
          ]
            .filter(Boolean)
            .join("\n"),
          null,
          { source: "attack-sim" },
        );
        // Surface token chain events from the attack sim (exchange, gateway deny, etc.)
        if (data?.tokenChainEvents?.length) {
          appendTokenEvents(data.tokenChainEvents);
          if (tokenChain) {
            tokenChain.setTokenEvents("agent", data.tokenChainEvents);
          }
        }
      } catch (err) {
        addMessage(
          "assistant",
          `${stepLabel}\nAttack simulation failed: ${formatAxiosError(err, err.message || "failed")}`,
        );
      } finally {
        setNlLoading(false);
      }
      return;
    }

    addMessage(
      "assistant",
      `${stepLabel} — this use case has no runnable trigger in the agent.`,
    );
  }

  async function handleNaturalLanguage() {
    const text = nlInput.trim();
    if (!text) return;
    // Synchronous single-flight: wins the same-tick double-submit race that
    // disabled={nlLoading} (async state) cannot. Released in the finally below.
    if (!nlSendGuardRef.current.tryAcquire()) return;
    try {
      return await handleNaturalLanguageInner(text);
    } finally {
      nlSendGuardRef.current.release();
    }
  }

  async function handleNaturalLanguageInner(text) {
    if (!isLoggedIn && !marketingGuestChatEnabled) return;
    if (isAgentBlockedByConsentDecline()) {
      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
      return;
    }

    // New typed turn: start a fresh token-chain trace with the user's prompt
    // (same as sendAsNlInner — the chat input box routes here, not there).
    try {
      tokenChainTraceStore.beginTrace({ prompt: text });
    } catch (_) { /* display-only */ }

    const signal = beginAbortableSend();

    // Clarification-follow-up path: if our previous turn asked "Which
    // account?"/"How much?", treat this message as the missing slot instead
    // of re-parsing it as a brand-new intent. The chat input box routes here
    // (not through sendAsNl), so without this the reply "checking" was sent to
    // the stateless /nl endpoint, matched no keyword, and fell through to the
    // capabilities help. Mirrors the same block in sendAsNlInner; the guard is
    // released by handleNaturalLanguage's finally, so we don't touch it here.
    if (pendingClarification) {
      const pc = pendingClarification;
      setPendingClarification(null);

      setNlInput("");
      addMessage("user", text);

      const merged = parseClarificationReply(
        pc.action,
        text,
        pc.partialParams || {},
        pc.missingParams,
      );
      if (!merged) {
        // Couldn't extract — re-ask once, then let a normal interpretation try.
        addMessage("assistant", `Sorry, I didn't catch that. ${pc.asked}`, null, { paramHint: pc.hint || null });
        setPendingClarification(pc);
        return;
      }

      // For transfers: check if all required slots are filled. If not, re-ask
      // with the accumulated partial params so incremental slot-filling works.
      if (pc.action === "transfer" && !(merged.amount != null && merged.fromId && merged.toId)) {
        const still = [];
        if (!merged.fromId) still.push('source account (e.g. "from checking")');
        if (!merged.toId) still.push('destination account (e.g. "to savings")');
        if (merged.amount == null) still.push('amount (e.g. "$100")');
        const reAsk = `Got it. I still need: ${still.join(', ')}.\n\nExample: "from checking to savings $100"`;
        addMessage("assistant", reAsk, null, { paramHint: pc.hint || null });
        setPendingClarification({
          ...pc,
          partialParams: merged,
          asked: reAsk,
        });
        return;
      }

      const syntheticResult = buildClarificationResult(pc, merged);
      try {
        await dispatchNlResult(syntheticResult, "clarify", text);
      } catch (err) {
        if (!isAbortError(err)) reportNlFailure(err);
      }
      return;
    }

    // Sequential thinking trigger: "think: [query]" or "reason: [query]"
    const thinkMatch = text.match(/^(?:think|reason):\s*(.+)/i);
    if (thinkMatch) {
      const query = thinkMatch[1].trim();
      addMessage("user", text);
      setNlInput("");
      setNlLoading(true);
      try {
        // Route through /api/mcp/tool so the call goes through the MCP gateway
        const res = await fetch("/api/mcp/tool", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "sequential_think", params: { query } }),
          signal: anySignal([AbortSignal.timeout(15000), signal]),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let steps = [],
          conclusion = "";
        try {
          const raw = data.result;
          // Handle MCP content-array format: { content: [{ type: "text", text: "..." }] }
          const rawText =
            raw && Array.isArray(raw.content)
              ? raw.content[0]?.text || ""
              : raw;
          const parsed =
            typeof rawText === "string" ? JSON.parse(rawText) : rawText || {};
          steps = parsed.steps || [];
          conclusion = parsed.conclusion || "";
        } catch (_) {}
        if (!signal.aborted) addMessage("reasoning", "", null, { steps, conclusion });
      } catch (err) {
        if (isAbortError(err)) return;
        addMessage("error", `Sequential thinking failed: ${err.message}`);
      } finally {
        setNlLoading(false);
      }
      return;
    }

    prepNlCompliance(text);
    setNlLoading(true);
    addMessage("user", text);
    setNlInput("");
    tokenChain?.clearEvents();
    try {
      const logQuery = parseLogPrompt(text);
      if (logQuery) {
        if (logQuery.type === "errors") {
          const params = new URLSearchParams({
            level: "error",
            limit: String(logQuery.limit),
          });
          const sources = ["console", "app", "exchange"];
          const results = await Promise.allSettled(
            sources.map((src) =>
              fetch(`/api/logs/${src}?${params.toString()}`, {
                credentials: "include",
              }),
            ),
          );
          const merged = [];
          for (let i = 0; i < results.length; i += 1) {
            const res = results[i];
            if (res.status !== "fulfilled" || !res.value.ok) continue;
            const body = await res.value.json();
            (body.logs || []).forEach((log) => {
              merged.push({ ...log, _src: sources[i] });
            });
          }
          const top = merged
            .sort(
              (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0),
            )
            .slice(0, logQuery.limit);
          if (top.length === 0) {
            addMessage(
              "assistant",
              `No error logs found in the last ${logQuery.limit} entries.`,
            );
          } else {
            const lines = top.map((l, idx) => {
              const when = new Date(l.timestamp || Date.now()).toLocaleString();
              return `${idx + 1}. [${(l.level || "error").toUpperCase()}] (${l._src}) ${when}\n   ${String(l.message || "").slice(0, 180)}`;
            });
            addMessage(
              "assistant",
              `Last ${top.length} errors:\n\n${lines.join("\n\n")}`,
            );
          }
        } else if (logQuery.type === "last_login") {
          const p = new URLSearchParams({
            username: logQuery.username,
            action: "LOGIN",
            limit: "1",
          });
          const res = await fetch(`/api/admin/activity?${p.toString()}`, {
            credentials: "include",
          });
          if (!res.ok) {
            if (res.status === 403) {
              addMessage(
                "assistant",
                "Log query requires admin access. Sign in as admin to query activity logs.",
              );
            } else {
              addMessage(
                "assistant",
                `Could not query login activity (HTTP ${res.status}).`,
              );
            }
          } else {
            const body = await res.json();
            const log = body.logs?.[0];
            if (!log) {
              addMessage(
                "assistant",
                `No successful login found for "${logQuery.username}".`,
              );
            } else {
              const when = new Date(log.timestamp).toLocaleString();
              addMessage(
                "assistant",
                `Last successful login for ${logQuery.username}:\n\n- Time: ${when}\n- Endpoint: ${log.endpoint || "/api/auth/login"}\n- IP: ${log.ipAddress || "n/a"}`,
              );
            }
          }
        }
        return;
      }
      // AG-UI path: when streaming is enabled, route the typed query through the
      // same POST /api/agent/run stream the action chips use (sendAsNlInner), so the
      // live panels — Token Chain, MCP Traffic, and Authorize — populate from
      // genuine events. The user message, input clear, and
      // loading state were already applied above; all special typed commands
      // (capabilities, think/reason, log queries, clarifications) returned earlier, so
      // they are unaffected. When aguiEnabled is false this branch is skipped and the
      // legacy /api/demo-agent/nl path below runs exactly as before.
      // Heuristics mode (activeLlmProvider=null) also skips this path: the
      // BFF's provider fallback would silently send the message to the default
      // LLM (agentRun.js resolves null → llm_provider config → 'anthropic'),
      // violating the agentModes.js contract that Heuristics needs no provider.
      if (aguiEnabled && activeLlmProvider) {
        if (!aguiThreadIdRef.current) aguiThreadIdRef.current = "ba-" + Date.now();
        aguiActiveRunIdRef.current = "run-" + Date.now();
        if (activityNarrationEnabled) activityStartRequest(text);
        // Send prior visible turns for multi-turn context; `messages` is the
        // render-time closure (current turn not yet included), so append it.
        const priorHistory = (messages || [])
          .filter((m) => (m.role === "user" || m.role === "assistant")
            && typeof m.content === "string" && m.content.trim() && !m.streaming)
          .map((m) => ({ role: m.role, content: m.content }));
        await aguiRun({
          threadId: aguiThreadIdRef.current,
          runId: aguiActiveRunIdRef.current,
          messages: [...priorHistory, { role: "user", content: text }],
          provider: activeLlmProvider,
        });
        return;
      }
      // Route through /api/demo-agent/nl: heuristic regex first → LLM only if unrecognised.
      // On banking intent: dispatchNlResult → runAction → POST /api/mcp/tool → full 12-step token flow.
      const _nlRes = await fetch("/api/demo-agent/nl", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, provider: activeLlmProvider || "heuristic", vertical: effectiveVerticalId }),
        signal: anySignal([AbortSignal.timeout(activeLlmProvider === "anthropic-lmstudio" || activeLlmProvider === "llamacpp" || activeLlmProvider === "mlx" || activeLlmProvider === "helix" ? 60000 : 15000), signal]),
      });
      const { result: _nlResult, source: _nlSource, llm_not_configured: _nlNotConfigured } = await _nlRes
        .json()
        .catch(() => ({
          result: {
            kind: "none",
            message:
              'Could not parse request. Try: "show my accounts" or "transfer $100 to savings".',
          },
          source: "heuristic",
        }));
      // Record NL routing as step 0 in Token Chain before token events arrive
      tokenChain?.setNlRoutingEvent({
        prompt: text,
        source: _nlSource || "heuristic",
        intent: _nlResult,
        timestamp: new Date().toISOString(),
        heuristicSaved: !_nlSource || _nlSource === "heuristic",
      });
      // Pure-mode provider unavailable → ask before using heuristics (#1 consistency).
      if (maybeDeferToHeuristicPrompt({ result: _nlResult, source: _nlSource, text, llm_not_configured: _nlNotConfigured })) {
        return;
      }
      await dispatchNlResult(_nlResult, _nlSource || "heuristic", text);
    } catch (err) {
      if (isAbortError(err)) return;
      reportNlFailure(err, () => handleNaturalLanguageInner(text));
    } finally {
      setNlLoading(false);
    }
  }

  // After marketing OAuth return OR launcher deep-link: replay NL once logged in.
  useEffect(() => {
    if (!nlResumeAfterAuth || !isLoggedIn || pendingNlResumeRef.current === nlResumeAfterAuth) {
      return;
    }
    const text = nlResumeAfterAuth;
    // Mark that we've consumed this value so effect won't re-execute on subsequent renders
    pendingNlResumeRef.current = text;
    // Consume the useCaseId claimed alongside the pending NL (launcher deep-link).
    // Passed to the BFF so A2.1/A2.2 stamping fires for this run.
    const useCaseId = pendingUcIdRef.current ?? undefined;
    pendingUcIdRef.current = null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const signal = beginAbortableSend();
      addMessage("user", text, null, { isPrompt: !!useCaseId });
      setNlLoading(true);
      try {
        const response = await sendAgentMessage(text, null, { signal, vertical: effectiveVerticalId, useCaseId });
        if (!cancelled && !signal.aborted) {
          // Dispatch backend events to EventStream
          if (response.events && Array.isArray(response.events)) {
            const requestId = `req-${Date.now()}`;
            response.events.forEach(event => {
              addEvent({
                ...event,
                requestId: requestId || event.requestId,
                timestamp: event.timestamp || new Date().toISOString(),
              });
            });
          }
          ingestActivity(response, text);
          if (maybeHandleCustomerLogin(response, response.source)) return;
          // HITL consent / step-up / authorization deny: these are valid gated responses, not errors.
          // Show the agent reply (which explains the gate) and surface token events.
          if (
            response.error === "hitl_required" ||
            response.error === "mcp_hitl_required" ||
            response.error === "step_up_required" ||
            response.error === "mcp_step_up_required" ||
            response.error === "authorization_denied" ||
            response.error === "mcp_authorization_denied"
          ) {
            const replyText = response.reply || "This action requires additional authorization.";
            const replyWithAgentBadge = `[CUSTOMER AGENT]\n${replyText}`;
            addMessage("assistant", replyWithAgentBadge, null, verticalResultExtra(response));
            if (response.tokenEvents?.length) {
              appendTokenEvents(response.tokenEvents);
              if (tokenChain) {
                tokenChain.setTokenEvents("agent", response.tokenEvents);
              }
              const agentTokenMsg = buildTokenEventMsg(response.tokenEvents);
              if (agentTokenMsg) {
                addMessage("token-event", agentTokenMsg, null);
              }
            }
            // Trigger HITL consent modal when the response has transaction details
            if (
              (response.error === "hitl_required" || response.error === "mcp_hitl_required") &&
              response.transactionAmount != null
            ) {
              const intentPayload = {
                type: response.transactionType || "transfer",
                fromAccountId: response.fromAccountId || response.from_account_id,
                toAccountId: response.toAccountId || response.to_account_id,
                amount: response.transactionAmount,
                description: `Agent ${response.transactionType || "transfer"}`,
              };
              setHitlPendingIntent({
                actionId: response.transactionType || "transfer",
                form: {},
                intentPayload,
                threshold: response.hitl_threshold_usd ?? APP_CONFIG.THRESHOLDS.HITL_DEFAULT,
                hitlChallengeId: response.hitlChallengeId || response.challengeId || null,
              });
            }
          } else if (response.error || !response.success) {
            reportNlFailure({ code: response.error || "unknown", message: response.message || response.error || response.reply });
            // Dispatch error event to EventStream
            addEvent({
              type: 'error',
              message: response.error || 'Request failed',
              plainEnglish: response.error || 'An error occurred',
              technicalDetails: {
                details: response.error || 'Unknown error',
                response: response,
              },
              severity: 'error',
              requestId: `req-${Date.now()}`,
              timestamp: new Date().toISOString(),
            });
          } else {
            const replyText = response.reply || AGENT_UNAVAILABLE_MESSAGE;
            const replyWithAgentBadge = `[CUSTOMER AGENT]\n${replyText}`;
            addMessage("assistant", replyWithAgentBadge, null, verticalResultExtra(response));
            if (response.tokenEvents?.length) {
              appendTokenEvents(response.tokenEvents);
              if (tokenChain) {
                tokenChain.setTokenEvents("agent", response.tokenEvents);
              }
              const agentTokenMsg = buildTokenEventMsg(response.tokenEvents);
              if (agentTokenMsg) {
                addMessage("token-event", agentTokenMsg, null);
              }
            }
            if (response.inputTokens || response.outputTokens) {
              const inc = {
                input: response.inputTokens ?? 0,
                output: response.outputTokens ?? 0,
              };
              setSessionTokens((prev) => ({
                input: prev.input + inc.input,
                output: prev.output + inc.output,
              }));
              setLifetimeTokens((prev) => {
                const next = { input: prev.input + inc.input, output: prev.output + inc.output };
                try { localStorage.setItem('ba_tokens_lifetime', JSON.stringify(next)); } catch (_) {}
                return next;
              });
            }
          }
        }
      } catch (e) {
        if (isAbortError(e)) return;
        if (!cancelled) {
          reportNlFailure(e);
          // Dispatch error event to EventStream
          addEvent({
            type: 'error',
            message: e.message || 'Request failed',
            plainEnglish: e.message || 'An error occurred',
            technicalDetails: {
              details: e.stack || e.toString(),
            },
            severity: 'error',
            requestId: `req-${Date.now()}`,
            timestamp: new Date().toISOString(),
          });
        }
      } finally {
        // Only clear pending state if this send wasn't superseded — otherwise we'd
        // clobber a newer nlResumeAfterAuth set while this request was in flight.
        if (!cancelled) {
          setNlLoading(false);
          setNlResumeAfterAuth(null);
          pendingNlResumeRef.current = null;
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger when nlResumeAfterAuth changes
  }, [nlResumeAfterAuth, isLoggedIn, effectiveVerticalId]);

  // Cancel any in-flight agent request when this instance unmounts OR the
  // route changes away from where it was issued — prevents state updates on
  // a dead/wrong instance and mis-attributed Token Chain events.
  useEffect(() => {
    return () => {
      if (sendAbortRef.current) {
        try { sendAbortRef.current.abort(); } catch (_) {}
        sendAbortRef.current = null;
      }
    };
  }, [location.pathname]);

  // Keep resultPanelRef current so the refresh handler below can read it without stale closure.
  useEffect(() => {
    resultPanelRef.current = resultPanel;
  }, [resultPanel]);

  // Same pattern for terminology — the refresh handler reads it without re-subscribing.
  useEffect(() => {
    terminologyRef.current = terminology;
  }, [terminology]);

  // After a dashboard transaction (banking-transaction-completed), refresh liveAccounts and
  // whatever result panel is currently open. Agent-initiated writes are handled inline in
  // runAction (lines above) so this effect only needs to handle dashboard-sourced events.
  useEffect(() => {
    const normalizeAccountRow = (a) => ({
      id: a.id,
      // Vertical-neutral: prefer the server-stored name, then the actual
      // account type (e.g. "Pro Member", "Patient Record"). Never hardcode
      // banking names — absolute rule: render must work for every vertical.
      name: a.name || a.accountType || a.account_type || a.type || "Account",
      type: a.accountType || a.account_type || a.type || "Account",
      balance: a.balance || 0,
      accountNumber: a.accountNumber || a.account_number || a.id,
    });

    const refreshAfterTransaction = () => {
      const currentPanel = resultPanelRef.current;
      const terminology = terminologyRef.current;

      // Always refresh liveAccounts (drives form dropdowns + accounts/balance result panels)
      fetch("/api/accounts/my", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.accounts?.length) return;
          const fresh = data.accounts.map(normalizeAccountRow);
          setLiveAccounts(fresh);
          if (currentPanel?.type === "accounts") {
            setResultPanel({
              type: "accounts",
              title: terminology?.accounts || "Accounts",
              data: fresh,
              terminology,
            });
          } else if (currentPanel?.type === "balance") {
            // Switch to full accounts view so all updated balances are visible
            setResultPanel({
              type: "accounts",
              title: terminology?.accounts || "Accounts",
              data: fresh,
              terminology,
            });
          }
        })
        .catch(() => {});

      // Refresh transactions panel if it's currently open
      if (currentPanel?.type === "transactions") {
        fetch("/api/transactions/my?limit=30", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (!data?.transactions) return;
            setResultPanel({
              type: "transactions",
              title: terminology?.transactions || "Recent Transactions",
              data: data.transactions,
              terminology,
            });
          })
          .catch(() => {});
      }
    };

    window.addEventListener(
      "banking-transaction-completed",
      refreshAfterTransaction,
    );
    return () => {
      window.removeEventListener(
        "banking-transaction-completed",
        refreshAfterTransaction,
      );
    };
  }, []); // stable \u2014 reads state via resultPanelRef

  // Float mode should return nothing when the dedicated /agent page is active
  if (!isInline && isAgentPage) return null;

  // OTP modal handlers (Phase 174)
  const handleOtpSubmit = async (otp) => {
    // Verify the OTP server-side so session.stepUpVerified is set before the refire.
    // The server accepts the demo bypass code (123123) and any session-issued code.
    try {
      const verifyRes = await fetch("/api/auth/oauth/user/verify-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otp }),
      });
      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        addMessage(
          "assistant",
          `❌ Verification failed: ${errData.message || "Incorrect code. Please try again."}`,
          `otp-error-${Date.now()}`,
        );
        // Keep modal open and pending action in place so user can retry
        setShowOtpModal(true);
        return;
      }
    } catch (_) {
      addMessage(
        "assistant",
        "❌ Could not reach the verification service. Please try again.",
        `otp-error-${Date.now()}`,
      );
      setShowOtpModal(true);
      return;
    }

    // If a step-up callback was stored (e.g. sensitive data after HITL), fire it directly
    if (pendingStepUpCallbackRef.current) {
      const cb = pendingStepUpCallbackRef.current;
      pendingStepUpCallbackRef.current = null;
      setShowOtpModal(false);
      setStepUpMethod("otp");
      setP1mfaMode(false);
      setP1mfaDaId(null);
      setP1mfaDevices([]);
      agentFlowDiagram.completeMfaChallenge(true);
      cb();
      return;
    }
    if (pendingOtpActionRef.current) {
      const { actionId, form } = pendingOtpActionRef.current;
      pendingOtpActionRef.current = null;
      setShowOtpModal(false);
      setStepUpMethod("otp");
      setP1mfaMode(false);
      setP1mfaDaId(null);
      setP1mfaDevices([]);
      // Verify MFA in flow diagram
      agentFlowDiagram.completeMfaChallenge(true);
      // Retry the original action with MFA verified
      runAction(actionId, form, { isRefire: true });
    }
  };

  const handleOtpCancel = () => {
    setShowOtpModal(false);
    setOtpContextLine("");
    setOtpDeliveryError(null);
    pendingOtpActionRef.current = null;
    pendingStepUpCallbackRef.current = null;
    setP1mfaMode(false);
    setP1mfaDaId(null);
    setP1mfaDevices([]);
    setStepUpMethod("otp");
    addMessage(
      "assistant",
      "MFA request was cancelled. Please try again if needed.",
      "mfa-cancelled",
    );
    agentFlowDiagram.completeMfaChallenge(false);
  };

  // FIDO submit handler (Phase 174-03)
  const handleFidoSubmit = (credentialResponse) => {
    if (pendingStepUpCallbackRef.current) {
      const cb = pendingStepUpCallbackRef.current;
      pendingStepUpCallbackRef.current = null;
      setShowOtpModal(false);
      setStepUpMethod("otp");
      agentFlowDiagram.completeMfaChallenge(true);
      cb();
      return;
    }
    if (pendingOtpActionRef.current) {
      const { actionId, form } = pendingOtpActionRef.current;
      pendingOtpActionRef.current = null;
      setShowOtpModal(false);
      setStepUpMethod("otp");
      agentFlowDiagram.completeMfaChallenge(true);
      runAction(actionId, form, { isRefire: true });
    }
  };

  const handleSwitchToOtp = () => {
    setStepUpMethod("otp");
  };

  // Initiate the email/SMS step-up OTP and capture whether it actually went out.
  // The modal reads otpDeliveryError so a failed send is shown to the user
  // instead of a misleading "a code was sent to…" line ("no silent fails").
  const initiateStepUpOtp = async () => {
    setOtpDeliveryError(null);
    try {
      const r = await fetch("/api/auth/oauth/user/initiate-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.delivered === false || data.otpSent === false) {
        setOtpDeliveryError(
          data.deliveryError ||
            data.message ||
            "We couldn't send your verification code. Please try again or contact support.",
        );
      }
    } catch (_) {
      setOtpDeliveryError(
        "We couldn't reach the verification service to send your code. Please try again.",
      );
    }
  };

  // After a passkey is registered (real PingOne FIDO2 ceremony), re-initiate the
  // MFA challenge so the new passkey appears as a selectable device, flip into
  // p1mfa mode, and hand the fresh { daId, devices } back to the modal so it can
  // authenticate with the just-registered passkey. (Passkey == p1mfa path.)
  const handlePasskeyRegistered = async () => {
    const apiBase = process.env.REACT_APP_API_URL || "";
    const mfaResp = await fetch(`${apiBase}/api/auth/mfa/challenge`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!mfaResp.ok) {
      throw new Error(`MFA initiation failed: ${mfaResp.status}`);
    }
    const { daId, devices } = await mfaResp.json();
    setP1mfaDaId(daId);
    setP1mfaDevices(devices || []);
    setP1mfaMode(true);
    setStepUpMethod("otp");
    return { daId, devices: devices || [] };
  };

  // P1MFA completion handler (Phase 174-04)
  const handleP1MfaComplete = () => {
    if (pendingStepUpCallbackRef.current) {
      const cb = pendingStepUpCallbackRef.current;
      pendingStepUpCallbackRef.current = null;
      setShowOtpModal(false);
      setP1mfaMode(false);
      setP1mfaDaId(null);
      setP1mfaDevices([]);
      agentFlowDiagram.completeMfaChallenge(true);
      cb();
      return;
    }
    if (pendingOtpActionRef.current) {
      const { actionId, form } = pendingOtpActionRef.current;
      pendingOtpActionRef.current = null;
      setShowOtpModal(false);
      setP1mfaMode(false);
      setP1mfaDaId(null);
      setP1mfaDevices([]);
      agentFlowDiagram.completeMfaChallenge(true);
      runAction(actionId, form, { isRefire: true });
    }
  };

  const handleP1MfaError = (errorMsg) => {
    console.error("[BankingAgent] P1MFA error:", errorMsg);
  };

  /** Phase 211: perform scope upgrade exchange and auto-replay the pending action. */
  async function handleScopeUpgradeConfirm() {
    setScopeErrorModal((prev) =>
      prev ? { ...prev, scopeUpgradeState: "exchanging" } : prev,
    );
    addMessage(
      "token-event",
      " Scope upgrade approved — exchanging token for write access (RFC 8693)…",
      "scope_upgrade",
    );
    try {
      const apiBase = process.env.REACT_APP_API_URL || "";
      const res = await fetch(`${apiBase}/api/mcp/scope-upgrade`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setScopeErrorModal((prev) =>
          prev
            ? {
                ...prev,
                scopeUpgradeState: "error",
                upgradeError: data.message || "Exchange failed",
              }
            : prev,
        );
        addMessage(
          "token-event",
          `❌ Scope upgrade failed: ${data.message || "Exchange did not return a write-scoped token."}`,
          "scope_upgrade",
        );
        return;
      }
      // Push exchange token events to TokenChainContext for educational display
      if (
        tokenChain &&
        Array.isArray(data.tokenEvents) &&
        data.tokenEvents.length > 0
      ) {
        tokenChain.setTokenEvents("scope_upgrade", data.tokenEvents);
      }
      addMessage(
        "token-event",
        [
          " RFC 8693 Token Exchange — Scope Upgrade",
          "   Subject token: user access token (from BFF session)",
          "   Requested scope: write (added to MCP token)",
          "   Result: write-scoped MCP access token stored in session",
          "   RFC 8693 §2.1: token exchange cannot expand beyond subject token scopes.",
          "   RFC 8693 §4.2: `act` claim on result identifies BFF as actor.",
        ].join("\n"),
        "scope_upgrade",
      );
      setScopeErrorModal((prev) =>
        prev ? { ...prev, scopeUpgradeState: "done" } : prev,
      );
      addMessage(
        "token-event",
        " Write-scoped token ready — replaying original request…",
        "tool_replay",
      );
      // Auto-close and replay after brief delay
      setTimeout(() => {
        const pending = pendingScopeUpgradeRef.current;
        setScopeErrorModal(null);
        pendingScopeUpgradeRef.current = null;
        if (pending && pending.actionId) {
          runAction(pending.actionId, pending.form || {}, {
            skipUserLabel: true,
          });
        }
      }, 500);
    } catch (err) {
      setScopeErrorModal((prev) =>
        prev
          ? { ...prev, scopeUpgradeState: "error", upgradeError: err.message }
          : prev,
      );
      addMessage(
        "token-event",
        `❌ Scope upgrade network error: ${err.message}`,
        "scope_upgrade",
      );
    }
  }


  const floatShell = (
    <div
      className={`banking-agent-float-root${distinctFloatingChrome && !isInline ? " banking-agent-float-root--distinct" : ""}`}
      data-agent-ui="floating"
    >
      {/* FAB - only shown when floating agent is collapsed (not in inline mode) */}
      {!isInline && !isOpen && (
        <button
          type="button"
          className="banking-agent-fab"
          onClick={() => setIsOpen(true)}
          aria-label={`Open ${brandShortName} AI Agent`}
          title={`Open ${brandShortName} AI Agent`}
        >
          <span className="banking-agent-fab-icon"></span>
          <span className="banking-agent-fab-label">AI Agent</span>
        </button>
      )}

      {/* Results panel — sits to the left of the agent (portal-renders over page; works in all modes) */}
      {effectiveIsOpen && resultPanel && agentResultsPanelEnabled && (
        <ResultsPanel
          panel={resultPanel}
          onClose={() => setResultPanel(null)}
          style={resultsPanelStyle}
        />
      )}

      {/* Panel */}
      {effectiveIsOpen && (
        <div
          className={`banking-agent-panel ba-mode-light${isExpanded && !isInline ? " ba-expanded" : ""}${isInline ? " ba-mode-inline" : ""}${isBottomDock ? " ba-embedded-bottom-dock" : ""}${splitChrome ? " ba-split-column" : ""}${distinctFloatingChrome && isInline ? " ba-popout-mode" : ""}`}
          role="dialog"
          aria-label={
            isConfigEmbeddedFocus
              ? "Application setup assistant"
              : `${brandShortName} AI Agent`
          }
          ref={panelRef}
          style={{ ...panelStyle, '--ba-agent-bg': pageManifest?.theme?.cssVars?.['--app-primary-red'] }}
        >
          {/* Header — spans full width */}
          {/* In inline mode: no drag handle. In float mode: drag to reposition */}
          <div
            role="button"
            tabIndex={isInline ? -1 : 0}
            className={`ba-header${isInline ? "" : " banking-agent-drag-handle"}`}
            onPointerDown={isInline ? undefined : handleDragStart}
          >
            <div className="ba-header-top">
              <div className="ba-header-left">
                <span className="ba-status-dot" />
                <div>
                  <div className="ba-title">
                    {isConfigEmbeddedFocus
                      ? "Application setup assistant"
                      : splitChrome
                        ? `${brandShortName} Assistant`
                        : `${brandShortName} AI Agent`}
                  </div>
                  <div className="ba-subtitle">
                    {isConfigEmbeddedFocus
                      ? isLoggedIn
                        ? `PingOne · OAuth · branding (${brandShortName}) · environment variables`
                        : "Sign in to get started"
                      : splitChrome
                        ? isLoggedIn
                          ? `${effectiveUser.role === "admin" ? "Admin" : "Customer"} · ${effectiveUser.firstName || effectiveUser.name?.split(" ")[0] || "Signed in"}${mcpAuthMode === "enterprise-managed" ? " · Enterprise-managed MCP" : ""}`
                          : marketingGuestChatEnabled
                            ? "Chat here — PingOne when you use banking"
                            : "Sign in to get started"
                        : isLoggedIn
                          ? `${effectiveUser.firstName || effectiveUser.name?.split(" ")[0] || "Signed in"} · ${effectiveUser.role === "admin" ? " Admin" : " Customer"}${mcpAuthMode === "enterprise-managed" ? " · Enterprise-managed MCP" : ""}`
                          : marketingGuestChatEnabled
                            ? "Chat here — PingOne when you use banking"
                            : "Sign in to get started"}
                  </div>
                </div>
              </div>
              {helixDegraded && (
                <div className="ba-degraded-banner" role="status">
                  ⚠️ AI reasoning offline — running rule-based responses. Some
                  questions may not be understood.
                </div>
              )}
              {splitChrome &&
                isLoggedIn &&
                (effectiveUser?.id || effectiveUser?.username) && (
                  <div className="ba-header-session">
                    <div title="PingOne user id">
                      {effectiveUser?.id || effectiveUser?.username}
                    </div>
                    <SessionExpiryTimer
                      sessionInfo={effectiveUser}
                      className="ba-header-session-timer"
                    />
                  </div>
                )}
              <div className="ba-header-tools">
                {/* Five-mode agent provider selector — leftmost, shared SSOT with /config */}
                <AgentModeSelector
                  compact
                  heuristicFallback={heuristicEnabled}
                  onHeuristicFallbackChange={setHeuristicEnabled}
                />
                {/* RFC info toggle — standard switch control, always visible in header */}
                <Check
                  variant="switch"
                  className="ba-header-toggle-label"
                  checked={showRfcInfo}
                  onChange={(e) => setShowRfcInfo(e.target.checked)}
                  title="Show or hide RFC token-event messages in the chat"
                >
                  RFC info
                </Check>
                {modelAdvisory && (
                  <span
                    className="ams-degraded-chip ba-model-advisory-chip"
                    role="note"
                    title={modelAdvisory}
                  >
                    {modelAdvisory}
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="ba-model-advisory-dismiss"
                      onClick={() => setModelAdvisory(null)}
                    >×</button>
                  </span>
                )}
                {pendingLlmFallback && (
                  <span className="ams-degraded-chip ba-model-advisory-chip" role="note">
                    Provider unavailable
                    <button
                      type="button"
                      className="ba-model-advisory-dismiss"
                      style={{ width: "auto", padding: "0 8px", borderRadius: 10 }}
                      onClick={async () => {
                        const pend = pendingLlmFallback;
                        setPendingLlmFallback(null);
                        await dispatchNlResult(pend.result, "heuristic", pend.text);
                      }}
                    >Use Heuristics</button>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="ba-model-advisory-dismiss"
                      onClick={() => setPendingLlmFallback(null)}
                    >×</button>
                  </span>
                )}
                {/* Compliance 12-step toggle */}
                <Check
                  variant="switch"
                  className="ba-header-toggle-label"
                  checked={showCompliancePanel}
                  onChange={(e) => {
                    const newVal = e.target.checked;
                    try {
                      localStorage.setItem(
                        "ba_show_compliance_panel",
                        newVal ? "1" : "0",
                      );
                    } catch {}
                    if (newVal) setComplianceSlideout(true);
                    setShowCompliancePanel(newVal);
                  }}
                  title="Show or hide the 12-step compliance status"
                >
                  Compliance
                </Check>
                {showCompliancePanel && (
                  <Check
                    variant="switch"
                    className="ba-header-toggle-label"
                    checked={complianceSlideout}
                    onChange={(e) => {
                      try {
                        localStorage.setItem(
                          "ba_compliance_slideout",
                          e.target.checked ? "1" : "0",
                        );
                      } catch {}
                      setComplianceSlideout(e.target.checked);
                    }}
                    title="Show compliance as side-panel overlay"
                  >
                    Side panel
                  </Check>
                )}
                {/* Token Chain floating panel toggle — non-blocking, agent stays usable */}
                <Check
                  variant="switch"
                  className="ba-header-toggle-label"
                  checked={showTokenChain}
                  onChange={(e) => setShowTokenChain(e.target.checked)}
                  title="View Token Chain — RFC 8693 token exchange and authorization decisions (floating panel, agent stays usable)"
                >
                  Token Chain
                </Check>
                {/* Demo Guide trigger — visible to all users */}
                <button
                  type="button"
                  className={`ba-actions-trigger${showDemoGuide ? " active" : ""}`}
                  title="Open Agent Demo Guide"
                  onClick={() => setShowDemoGuide(true)}
                >
                  Guide
                </button>
                {/* Demo steps — same scripted list as /use-cases Demo section */}
                <DemoStepsDropdown
                  vertical={effectiveVerticalId || "banking"}
                  disabled={consentBlocked}
                  open={showDemoSteps}
                  onOpenChange={(next) => {
                    setShowDemoSteps(next);
                    if (next) setShowDiscovery(false);
                  }}
                  onSelect={(uc, stepNumber) => {
                    handleDemoStepSelect(uc, stepNumber);
                  }}
                />
                {/* Actions trigger — float + dashboard inline agents (D-01, D-02) */}
                {useActionsPopout && (
                  <button
                    ref={discoveryTriggerRef}
                    type="button"
                    className={
                      "ba-actions-trigger" + (showDiscovery ? " active" : "")
                    }
                    onClick={() => {
                      setShowDiscovery((v) => {
                        const next = !v;
                        if (next) setShowDemoSteps(false);
                        return next;
                      });
                    }}
                    disabled={consentBlocked}
                    aria-expanded={showDiscovery}
                    aria-haspopup="dialog"
                  >
                    Actions {showDiscovery ? "▴" : "▾"}
                  </button>
                )}
                {/* Expand/restore — float mode only (unchanged) */}
                {!isInline && (
                  <button
                    type="button"
                    className="ba-icon-btn"
                    onClick={() => {
                      setIsExpanded((e) => !e);
                      setDragPos(null);
                    }}
                    title={
                      isExpanded ? "Restore size" : "Expand to larger window"
                    }
                  >
                    {isExpanded ? "⊟" : "⊞"}
                  </button>
                )}
                {/* Split-column sign-out — inline split-column mode only (unchanged, D-02 untouched) */}
                {splitChrome && isLoggedIn && (
                  <button
                    type="button"
                    className="ba-header-signout"
                    onClick={() => onLogout?.()}
                  >
                    Sign out
                  </button>
                )}
                {/* Close — float mode only */}
                {!isInline && (
                  <button
                    type="button"
                    className="ba-icon-btn ba-close-btn"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close agent"
                    title="Close"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {/* Phase 246: Actions popout — anchored to ba-header (position:relative in CSS) */}
            {showDiscovery && (
              <div
                className="ba-actions-popout"
                role="dialog"
                aria-label="Action browser"
                aria-modal="false"
                ref={actionsPopoutRef}
              >
                {/* Search */}
                <input
                  className="ba-popout-search"
                  type="search"
                  placeholder="Search actions or type a question…"
                  value={discoverySearch}
                  onChange={(e) => setDiscoverySearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const text = discoverySearch.trim();
                    if (!text) return;
                    setShowDiscovery(false);
                    setDiscoverySearch("");
                    if (isAgentBlockedByConsentDecline()) {
                      addMessage("assistant", AGENT_CONSENT_BLOCK_USER_MESSAGE);
                      return;
                    }
                    if (!(isLoggedIn || marketingGuestChatEnabled)) return;
                    try {
                      sessionStorage.setItem(BX_AGENT_PENDING_NL_KEY, text);
                    } catch (_) {}
                    setNlInput("");
                    addMessage("user", text);
                    setNlLoading(true);
                    (async () => {
                      try {
                        const _discNlRes = await fetch(
                          "/api/demo-agent/nl",
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              message: text,
                              provider: activeLlmProvider || "heuristic",
                            }),
                            signal: AbortSignal.timeout(15000),
                          },
                        );

                        const { result: _discNlResult } = await _discNlRes
                          .json()
                          .catch(() => ({
                            result: {
                              kind: "none",
                              message: "Could not parse request.",
                            },
                          }));
                        try {
                          sessionStorage.removeItem(BX_AGENT_PENDING_NL_KEY);
                        } catch (_) {}
                        await dispatchNlResult(_discNlResult, "nl", text);
                      } catch (err) {
                        reportNlFailure(err);
                      } finally {
                        setNlLoading(false);
                      }
                    })();
                  }}
                />
                {isLoggedIn && (
                  <ScopePicker
                    allowWrite={agentAllowWrite}
                    disabled={agentToolsLoading}
                    onChange={setAgentAllowWrite}
                  />
                )}
                {isLoggedIn && degradedAuthz && (
                  <div className="ba-authz-degraded-badge" title="PingOne Authorize unreachable — using the demo authorize server">
                    Demo Authorize
                  </div>
                )}
                {isLoggedIn && (
                  <BankingChips
                    customChips={customChips}
                    user={user}
                    llmAvailable={!!activeLlmProvider}
                    isHelixMode={agentProviderMode === 'helix_google'}
                    toolPermissions={toolPermissions}
                    toolsError={agentToolsError}
                    userPrompt={messages[messages.length - 1]?.content || ''}
                    onDeniedChip={(chip, reason) => {
                      addMessage("user", chip.label);
                      addMessage(
                        "assistant",
                        `This action was denied by PingOne Authorize: "${chip.label}" — ${reason}. Switch the Agent scope to "Read + Write" to enable it.`,
                      );
                    }}
                    onChipClick={({ message, label, requiresLlm, chipId, direct, showcase, caption, stepUpMethod, denyTool, useCaseId: chipUseCaseId }) => {
                      setShowDiscovery(false);
                      if (isAgentBlockedByConsentDecline()) {
                        addMessage(
                          "assistant",
                          AGENT_CONSENT_BLOCK_USER_MESSAGE,
                        );
                        return;
                      }
                      addMessage("user", label || message);
                      setNlLoading(true);

                      // ── Security Showcase dispatch ─────────────────────────────
                      // Action-typed showcase chips fire a dedicated live harness here;
                      // message-typed ones (MFA/HITL transfers, LLM prompts) fall through
                      // to the normal routing below. `caption` is the presenter's
                      // plain-language "what this demonstrates" line.
                      if (showcase) {
                        // Showcase outcomes must be `assistant` (not token-event):
                        // token-event bubbles are hidden when RFC info is off (default).
                        if (caption) addMessage("assistant", `Expected: ${caption}`, null);
                        if (showcase === "authz_deny") {
                          // Call a tool from another vertical directly → AllowedVertical DENY.
                          (async () => {
                            const tool = denyTool || "show_health_record";
                            try {
                              const r = await callMcpTool(tool, {});
                              const denied =
                                r?.status === 403 ||
                                isAgentToolErrorResult(normalizeAgentToolResult(r?.result));
                              addMessage(
                                "assistant",
                                denied
                                  ? `❌ PingOne Authorize DENY — '${tool}' is not permitted in this vertical (AllowedVertical).`
                                  : `❌ Expected a DENY for '${tool}', but the call returned a result.`,
                                null,
                              );
                              if (tokenChain && Array.isArray(r?.tokenEvents)) {
                                tokenChain.setTokenEvents(tool, r.tokenEvents);
                              }
                            } catch (err) {
                              addMessage(
                                "assistant",
                                `❌ PingOne Authorize DENY — ${err.code || err.message || "request rejected"}`,
                                null,
                              );
                              if (tokenChain && Array.isArray(err?.tokenEvents)) {
                                tokenChain.setTokenEvents(tool, err.tokenEvents);
                              }
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                          return;
                        }
                        if (showcase === "atk_confused_deputy") {
                          // Confused deputy (live): fire a normal tool call but override the
                          // bridged actor with a rogue, non-allowlisted client_id (_testActClientId).
                          // PingOne Authorize's HasValidActorChain returns a real DENY.
                          (async () => {
                            const rogue = "rogue-agent-9f2a-not-allowlisted";
                            try {
                              const apiBase = process.env.REACT_APP_API_URL || "";
                              const r = await fetch(`${apiBase}/api/mcp/tool`, {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                // Attacks demonstrate the security infrastructure (banking is the
                                // reference), not vertical data — pin to banking so the demo runs the
                                // same regardless of the active vertical instead of dead-ending on a
                                // cross-vertical deny.
                                body: JSON.stringify({ tool: "get_my_accounts", params: {}, vertical: "banking", _testActClientId: rogue }),
                              });
                              const data = await r.json().catch(() => ({}));
                              const denied = r.status >= 400 || isAgentToolErrorResult(normalizeAgentToolResult(data?.result));
                              addMessage(
                                "assistant",
                                denied
                                  ? `❌ PingOne Authorize DENY (HTTP ${r.status}) — ${data.error || data.gatewayErrorCode || "mcp-invalid-actor"}\nHasValidActorChain → false: actor "${rogue}" is not among the registered actors (delegation is bound to the AI Agent, not a may_act allowlist).`
                                  : `❌ Expected a DENY for a rogue actor chain, but the call returned HTTP ${r.status}.`,
                                null,
                              );
                              if (tokenChain && Array.isArray(data?.tokenEvents)) {
                                tokenChain.setTokenEvents("confused_deputy", data.tokenEvents);
                              }
                            } catch (err) {
                              addMessage("assistant", `❌ Rogue actor rejected — ${err.code || err.message || "request blocked"}`, null);
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                          return;
                        }
                        if (SHOWCASE_INJECTION[showcase]) {
                          // Injection (live): plant a poisoned payload in the user's data,
                          // surface it via the agent's read tool, and show the agent cannot
                          // auto-execute the injected instruction (writes stay policy-gated).
                          const inj = SHOWCASE_INJECTION[showcase];
                          (async () => {
                            try {
                              const apiBase = process.env.REACT_APP_API_URL || "";
                              const seedRes = await fetch(`${apiBase}/api/demo/attacks/${inj.seed}`, {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: "{}",
                              });
                              const seedData = await seedRes.json().catch(() => ({}));
                              const payload = seedData.description || seedData.notes || "(payload planted)";
                              // Pin the poisoned read to banking (where the seed plants data) so the
                              // injection surfaces regardless of the active vertical.
                              // Result is `assistant` (not token-event) so chips stay visible when RFC info is off.
                              const readResp = await (await fetch(`${apiBase}/api/mcp/tool`, {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ tool: inj.readTool, params: inj.readTool === "get_my_transactions" ? { limit: 100 } : {}, vertical: "banking" }),
                              })).json().catch(() => ({}));
                              const surfaced = JSON.stringify(readResp?.result ?? "").includes("[SYSTEM:");
                              addMessage(
                                "assistant",
                                [
                                  `Injection planted in your ${inj.where} and surfaced to the agent via ${inj.readTool}:`,
                                  `   "${payload}"`,
                                  "",
                                  surfaced
                                    ? "The poisoned directive is now in the agent's context — but it cannot auto-execute:"
                                    : "(payload planted; agent read completed)",
                                  "❌ Any write the injection demands (e.g. create_transfer) is gated by PingOne Authorize + HITL consent.",
                                  "   The policy evaluates the request independently of whatever the LLM 'decided' from the poisoned text.",
                                ].join("\n"),
                                null,
                              );
                              if (tokenChain && Array.isArray(readResp?.tokenEvents)) {
                                tokenChain.setTokenEvents(inj.readTool, readResp.tokenEvents);
                              }
                            } catch (err) {
                              addMessage("assistant", `Injection demo error: ${err.code || err.message || "failed"}`, null);
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                          return;
                        }
                        if (showcase === "atk_hitl_replay") {
                          // HITL receipt-binding replay (live): approve a consent receipt for
                          // create_transfer, then reuse that same receipt on a DIFFERENT tool
                          // (create_withdrawal). The gateway binds each receipt to the tool it
                          // approved, so the reuse is re-challenged (428), not honored.
                          (async () => {
                            const apiBase = process.env.REACT_APP_API_URL || "";
                            // Pin to banking: the receipt-replay demo exercises the gateway's
                            // per-tool receipt binding (a security control), not vertical data, so it
                            // runs the same everywhere instead of dead-ending on a cross-vertical deny.
                            const call = (tool, params) =>
                              fetch(`${apiBase}/api/mcp/tool`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, params, vertical: "banking" }) });
                            try {
                              const acctD = await (await call("get_my_accounts", {})).json().catch(() => ({}));
                              let accounts = [];
                              try { accounts = JSON.parse(acctD.result?.content?.[0]?.text || "{}").accounts || []; } catch (_) { /* shape */ }
                              if (accounts.length < 2) {
                                addMessage("assistant", "HITL replay demo needs ≥2 accounts — click My accounts first to load them.", null);
                                setNlLoading(false);
                                return;
                              }
                              const [a0, a1] = accounts;
                              const t1 = await call("create_transfer", { fromAccountId: a0.id, toAccountId: a1.id, amount: 300 });
                              const b1 = await t1.json().catch(() => ({}));
                              const challengeId = b1.challengeId || b1.taskId;
                              if (!challengeId) {
                                addMessage("assistant", `Expected a HITL challenge for create_transfer but got HTTP ${t1.status}.`, null);
                                setNlLoading(false);
                                return;
                              }
                              const approve = await fetch(`${apiBase}/api/mcp/decision/${challengeId}/approve`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
                              if (!approve.ok) {
                                addMessage("assistant", `Could not approve the consent receipt (HTTP ${approve.status}) — can't run the replay demo right now.`, null);
                                setNlLoading(false);
                                return;
                              }
                              const replay = await call("create_withdrawal", { fromAccountId: a0.id, amount: 300, _hitl_challenge_id: challengeId });
                              const rb = await replay.json().catch(() => ({}));
                              const blocked = replay.status >= 400;
                              addMessage(
                                "assistant",
                                [
                                  `Approved a consent receipt for create_transfer (challenge ${String(challengeId).slice(0, 8)}…).`,
                                  "Replaying that SAME receipt on a different tool (create_withdrawal):",
                                  blocked
                                    ? `❌ Blocked (HTTP ${replay.status} · ${rb.error || rb.gatewayErrorCode || "re-challenged"}) — the receipt is bound to the tool it approved; reuse is re-challenged, never honored.`
                                    : `❌ Expected the replay to be blocked, but it returned HTTP ${replay.status}.`,
                                ].join("\n"),
                                null,
                              );
                              if (tokenChain && Array.isArray(rb?.tokenEvents)) tokenChain.setTokenEvents("hitl_replay", rb.tokenEvents);
                            } catch (err) {
                              addMessage("assistant", `HITL replay demo error: ${err.code || err.message || "failed"}`, null);
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                          return;
                        }
                        if (SHOWCASE_RUN_ACTION[showcase]) {
                          setNlLoading(false);
                          runAction(SHOWCASE_RUN_ACTION[showcase]);
                          return;
                        }
                        // mfa_otp / mfa_fido / hitl_consent / llm_* → fall through to the
                        // normal message routing below (transfer triggers HITL/step-up;
                        // llm chips route to the active provider).
                      }

                      // Direct MCP path — MCP spec compliant:
                      // 1. NL parser resolves intent + params (same as any other chip)
                      // 2. Resolved action maps to an MCP tool name
                      // 3. callMcpTool issues a typed tools/call — skips only the LangGraph loop
                      if (direct) {
                        (async () => {
                          try {
                            const nlRes = await fetch("/api/demo-agent/nl", {
                              method: "POST",
                              credentials: "include",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                message,
                                provider: "heuristic",
                                ...(effectiveVerticalId && { vertical: effectiveVerticalId }),
                              }),
                              signal: AbortSignal.timeout(10000),
                            });
                            const { result: nlResult } = await nlRes.json().catch(() => ({ result: null }));
                            // Resolve MCP tool name from NL action.
                            // kind:banking accounts → get_my_accounts
                            // kind:banking vertical_feature_demo → featurePage.mcpTool
                            // kind:vertical → action IS the tool name (list_orders, show_health_record…)
                            let resolvedTool = null;
                            let resolvedParams = {};
                            if (nlResult?.kind === "banking" && nlResult.banking?.action) {
                              const ba = nlResult.banking;
                              if (ba.action === "accounts") {
                                resolvedTool = "get_my_accounts";
                              } else if (ba.action === "account_nickname") {
                                resolvedTool = "get_account_nickname";
                              } else if (ba.action === "mortgage_demo") {
                                resolvedTool = "show_mortgage";
                              } else if (ba.action === "invest_demo") {
                                resolvedTool = "show_investment";
                              } else if (ba.action === "vertical_feature_demo") {
                                resolvedTool = themeManifest?.featurePage?.mcpTool || null;
                              }
                              resolvedParams = ba.params || {};
                            } else if (nlResult?.kind === "vertical" && nlResult.action) {
                              resolvedTool = nlResult.action;
                              resolvedParams = nlResult.params || {};
                            }
                            if (!resolvedTool) {
                              addMessage("assistant", "Could not resolve an MCP tool for this request — try rephrasing.", null);
                              return;
                            }
                            const mcpResp = await callMcpTool(resolvedTool, resolvedParams, { useCaseId: chipUseCaseId, vertical: effectiveVerticalId });
                            if (tokenChain && Array.isArray(mcpResp?.tokenEvents)) {
                              tokenChain.setTokenEvents(resolvedTool, mcpResp.tokenEvents);
                            }
                            const normalized = normalizeAgentToolResult(mcpResp?.result);
                            const isErr = isAgentToolErrorResult(normalized);
                            if (isErr) {
                              addMessage(
                                "assistant",
                                `MCP returned an error: ${normalized?.error || normalized?.message || "unknown error"}`,
                                resolvedTool,
                                { source: "direct-mcp" },
                              );
                              return;
                            }
                            // Same human-readable path as heuristic runAction — not a raw JSON wall.
                            let text = formatResult(normalized, terminology);
                            const looksLikeJson =
                              typeof text === "string" &&
                              /^\s*[\[{]/.test(text);
                            const descriptor =
                              pageManifest?.render?.[resolvedTool] || null;
                            if (descriptor && looksLikeJson) {
                              text = `Direct MCP · ${resolvedTool}`;
                            }
                            const { resultType, resultData } =
                              inferAgentResultTypeAndData(normalized);
                            if (resultType) {
                              const titleMap = {
                                accounts: terminology?.accounts || "Accounts",
                                transactions:
                                  terminology?.transactions ||
                                  "Recent Transactions",
                                balance: terminology?.balance || "Balance",
                                confirm: `${resolvedTool} confirmed`,
                              };
                              setResultPanel({
                                type: resultType,
                                title: titleMap[resultType] || resolvedTool,
                                data: resultData,
                                terminology,
                              });
                            }
                            const directExtra = {
                              source: "direct-mcp",
                              rawMcpResult: normalized,
                            };
                            if (descriptor) {
                              directExtra.verticalResult = {
                                descriptor,
                                data: normalized,
                                terminology,
                              };
                            }
                            addMessage(
                              "assistant",
                              text,
                              resolvedTool,
                              directExtra,
                            );
                          } catch (err) {
                            reportNlFailure(err);
                          } finally {
                            setNlLoading(false);
                          }
                        })();
                        return;
                      }

                      // Admin chips invoke the isolated admin agent via /api/admin-agent
                      // which uses hosted PingOne MCP tools with worker client_credentials token.
                      if (PINGONE_ADMIN_CHIP_IDS.has(chipId)) {
                        prepNlCompliance(message);
                        (async () => {
                          try {
                            const res = await fetch("/api/admin-agent/message", {
                              method: "POST",
                              credentials: "include",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                message,
                                customer: adminCustomerContext.get(),
                              }),
                              signal: AbortSignal.timeout(30000),
                            });
                            const data = await res
                              .json()
                              .catch(() => ({ reply: "Admin agent request failed.", success: false }));
                            if (tokenChain && Array.isArray(data?.tokenEvents)) {
                              tokenChain.setTokenEvents("admin-agent", data.tokenEvents);
                            }
                            const reply = `[ADMIN AGENT - LangGraph]\n${data?.reply || "Admin agent: no response."}`;
                            addMessage("assistant", reply, null);
                          } catch (err) {
                            reportNlFailure(err);
                          } finally {
                            setNlLoading(false);
                          }
                        })();
                        return;
                      }

                      // A2A Orchestrator — detect delegation requests and route to /api/a2a
                      const delegationKeywords = [
                        /\bdelegate\b/i,
                        /\bhand\s*off\b/i,
                        /\bescalate\b/i,
                        /\bspecialist\b/i,
                        /\borchestrat/i,
                        /second\s+agent/i,
                      ];
                      const shouldDelegateToA2a = delegationKeywords.some((kw) => kw.test(message));

                      if (shouldDelegateToA2a) {
                        prepNlCompliance(message);
                        (async () => {
                          try {
                            const res = await fetch("/api/a2a/message", {
                              method: "POST",
                              credentials: "include",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                message,
                                vertical: effectiveVerticalId,
                              }),
                              signal: AbortSignal.timeout(30000),
                            });
                            const data = await res
                              .json()
                              .catch(() => ({ reply: "A2A orchestrator request failed.", success: false }));
                            if (tokenChain && Array.isArray(data?.tokenEvents)) {
                              tokenChain.setTokenEvents("a2a-orchestrator", data.tokenEvents);
                            }
                            const reply = `[A2A ORCHESTRATOR - CrewAI]\n${data?.reply || "A2A orchestrator: no response."}`;
                            addMessage("assistant", reply, null);
                          } catch (err) {
                            reportNlFailure(err);
                          } finally {
                            setNlLoading(false);
                          }
                        })();
                        return;
                      }

                      prepNlCompliance(message);
                      (async () => {
                        try {
                          const res = await fetch("/api/demo-agent/nl", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              message: message,
                              // In helix_google (Helix only) mode every chip goes through Helix —
                              // heuristic is only used as a fallback when Helix fails, not as the
                              // first-choice path. Outside of that mode, chips with requiresLlm=false
                              // deliberately bypass the LLM for speed.
                              // PingOne Admin chips are handled above (POST /message); this /nl
                              // path only sees non-pingone chips.
                              provider: (requiresLlm || agentProviderMode === "helix_google")
                                ? (activeLlmProvider || "heuristic")
                                : "heuristic",
                            }),
                            signal: AbortSignal.timeout(15000),
                          });
                          const { result, source, llm_attempted, llm_not_configured } = await res
                            .json()
                            .catch(() => ({
                              result: {
                                kind: "none",
                                message: "Could not parse request.",
                              },
                              source: "heuristic",
                            }));
                          if (result?.kind === "none") {
                            if (llm_not_configured) {
                              const agentName = pageManifest?.agent?.persona || pageManifest?.identity?.displayName || 'the agent';
                              result.message =
                                `This chip needs an LLM (Helix or LM Studio) to interpret freeform questions, ` +
                                `but no provider is configured.\n\n` +
                                `Open the Helix tab in ${agentName} and add base_url + api_key + agent_id, ` +
                                `or pick a different chip — the heuristic chips work without an LLM.`;
                            } else if (llm_attempted) {
                              const agentName = pageManifest?.agent?.persona || pageManifest?.identity?.displayName || 'the agent';
                              result.message =
                                `${agentName} couldn't map this to a supported action. ` +
                                `Try rephrasing, or pick one of the other chips.`;
                            }
                          }
                          await dispatchNlResult(
                            result,
                            source || "heuristic",
                            message,
                            chipUseCaseId,
                          );
                        } catch (err) {
                          reportNlFailure(err);
                        } finally {
                          setNlLoading(false);
                        }
                      })();
                    }}
                    isLoading={nlLoading}
                  />
                )}
                <div className="ba-popout-body">
                  {filteredDiscoveryGroups.map((group) => {
                    if (
                      group.key === "admin" &&
                      effectiveUser?.role !== "admin"
                    )
                      return null;
                    if (group.chips.length === 0) return null;
                    const groupExpanded = !!chipGroupsState[group.key];
                    return (
                      <div key={group.key} className="ba-popout-section">
                        <button
                          type="button"
                          className="ba-popout-section-label ba-popout-section-toggle"
                          onClick={() => toggleGroupExpanded(group.key)}
                        >
                          {groupExpanded ? "▼" : "▶"} {group.label}
                        </button>
                        {groupExpanded && (
                          <div className="ba-popout-list">
                            {group.chips.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                className="ba-popout-list-item"
                                disabled={consentBlocked}
                                onClick={() => {
                                  setShowDiscovery(false);
                                  handleChipActivate(action);
                                }}
                              >
                                <span className="ba-popout-item-name">
                                  {action.label}
                                  {(action.challenge || action.hitlTrigger) && <HitlChipMark challenge={action.challenge || 'both'} />}
                                </span>
                                {action.desc && (
                                  <span className="ba-popout-item-desc">
                                    {action.desc}
                                  </span>
                                )}
                                {action.rfcs?.length > 0 && (
                                  <span className="ba-popout-item-rfcs">
                                    {action.rfcs.map((r) => (
                                      <span key={r} className="ba-rfc-badge">
                                        {r}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {discoverySearch.trim() !== "" &&
                    filteredDiscoveryGroups.filter(
                      (g) => g.chips.length > 0,
                    ).length === 0 && (
                      <div className="ba-popout-empty">
                        <div className="ba-popout-empty-heading">
                          No matching actions
                        </div>
                        <div>
                          Try a different keyword, or type directly in the chat
                          below.
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
          {/* Two-column body */}
          <div className="ba-body">
            {isBottomDock && (
              <aside className="ba-dock-identity" aria-label="Agent identity">
                <div className="ba-dock-identity__tag">
                  <span className="ba-dock-identity__dot" aria-hidden="true" />
                  Active
                </div>
                <div className="ba-dock-identity__name">{brandShortName} Agent</div>
                <p className="ba-dock-identity__desc">Secured via PingOne · RFC&nbsp;8693</p>
                <fieldset className="ba-dock-identity__scopes" aria-label="Granted scopes">
                  <span className="ba-dock-identity__scope">read</span>
                  <span className="ba-dock-identity__scope">write</span>
                  <span className="ba-dock-identity__scope">admin</span>
                </fieldset>
              </aside>
            )}
            {isLoggedIn && consentBlocked && (
              <div className="ba-consent-denied-banner" role="alert">
                <div className="ba-consent-denied-banner__text">
                  <strong>Access denied.</strong> You declined a high-value
                  transaction. The AI banking assistant is not available for
                  this session. Sign out and sign in again to restore it.
                </div>
                <div className="ba-consent-denied-banner__actions">
                  <button
                    type="button"
                    className="ba-consent-denied-banner__btn ba-consent-denied-banner__btn--secondary"
                    onClick={() => edu?.open(EDU.HUMAN_IN_LOOP, "decline")}
                  >
                    Learn: Human-in-the-loop
                  </button>
                  <button
                    type="button"
                    className="ba-consent-denied-banner__btn"
                    onClick={() => onLogout?.()}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}

            {hitlPendingIntent &&
              (() => {
                const handleHitlConfirm = async () => {
                  const { actionId, intentPayload } = hitlPendingIntent;

                  // MCP Authorize HITL flow — consent checkbox + OTP, then approve and retry
                  if (hitlPendingIntent.isMcpHitl && hitlPendingIntent.taskId) {
                    const taskId = hitlPendingIntent.taskId;
                    const retryActionId = hitlPendingIntent.actionId;
                    const retryForm = hitlPendingIntent.form;
                    const toolLabel = hitlPendingIntent.tool || "agent action";
                    setHitlPendingIntent(null);

                    // Initiate OTP (non-fatal — modal still shows even if this fails)
                    try {
                      await initiateStepUpOtp();
                    } catch (_) { /* non-fatal */ }

                    // Post-OTP callback: approve the HITL challenge, then retry the tool
                    pendingStepUpCallbackRef.current = async () => {
                      try {
                        const approveResp = await fetch(
                          `/api/mcp/decision/${taskId}/approve`,
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                          },
                        );
                        if (!approveResp.ok) {
                          const errBody = await approveResp.json().catch(() => ({}));
                          throw new Error(errBody.message || `Approval failed: ${approveResp.status}`);
                        }
                        addMessage("assistant", "✅ Approved — retrying your request…", retryActionId);
                        runAction(retryActionId, retryForm, {
                          isRefire: true,
                          hitlRetryChallengeId: taskId,
                        });
                      } catch (approveErr) {
                        addMessage("error", `Failed to approve: ${approveErr.message}`, retryActionId);
                      }
                    };

                    setOtpContextLine(`Verify your identity to approve: ${toolLabel}`);
                    setShowOtpModal(true);
                    return;
                  }

                  // Sensitive data reveal — confirmed by user, now fetch and display
                  // Vertical tool consent + step-up OTP
                  // Flow: consent approved → initiate OTP email → show OTP modal → callback executes tool
                  if (hitlPendingIntent.isVerticalConsent) {
                    const { verticalMessage, verticalOpts, intentPayload, hitlChallengeId: verticalChallengeId } = hitlPendingIntent;
                    setHitlPendingIntent(null);

                    // Initiate OTP — sends to user's email/SMS (non-fatal if Notifications unconfigured)
                    try {
                      await initiateStepUpOtp();
                    } catch (_) { /* non-fatal */ }

                    // Post-OTP callback: approve the HITL challenge, then retry the
                    // vertical tool carrying the challenge id. Approving records the
                    // receipt in demo_hitl_service; the retry's hitlChallengeId makes
                    // the BFF pre-flight AND the gateway verify that receipt and PERMIT.
                    pendingStepUpCallbackRef.current = async () => {
                      setNlLoading(true);
                      try {
                        if (verticalChallengeId) {
                          const approveResp = await fetch(
                            `/api/mcp/decision/${verticalChallengeId}/approve`,
                            { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } },
                          );
                          if (!approveResp.ok) {
                            const e = await approveResp.json().catch(() => ({}));
                            throw new Error(e.message || `Approval failed: ${approveResp.status}`);
                          }
                        }
                        const consentResp = await sendAgentMessage(
                          verticalMessage, null, { ...verticalOpts, consentGiven: true, hitlChallengeId: verticalChallengeId || null },
                        );
                        const consentParamHint = consentResp.needsParams?.hint || null;
                        addMessage(
                          "assistant",
                          consentResp.reply || "\u2705 Done.",
                          null,
                          { source: "heuristic", ...verticalResultExtra(consentResp), paramHint: consentParamHint },
                        );
                        if (consentResp.needsParams?.action && consentResp.needsParams.missing?.length) {
                          setPendingClarification({
                            kind: 'vertical',
                            action: consentResp.needsParams.action,
                            missingParams: consentResp.needsParams.missing,
                            partialParams: {},
                            asked: consentResp.reply,
                            hint: consentParamHint,
                            consentGiven: true,
                          });
                        }
                      } catch (err) {
                        addMessage("error", `Failed: ${err.message}`);
                      } finally {
                        setNlLoading(false);
                      }
                    };

                    const actionLabel = intentPayload?.description || "this action";
                    setOtpContextLine(
                      `Verify your identity to ${actionLabel.charAt(0).toLowerCase() + actionLabel.slice(1)}`,
                    );
                    setShowOtpModal(true);
                    return;
                  }

                  if (hitlPendingIntent.isSensitiveData) {
                    setHitlPendingIntent(null);
                    setNlLoading(true);
                    const sensToastId = toast.loading(
                      "\uD83D\uDD12 Retrieving sensitive account details\u2026",
                    );
                    try {
                      // Grant session consent so get_sensitive_account_details bypasses step-up gate.
                      // HITL approval IS the authorization — no separate MFA/OTP needed in demo mode.
                      try {
                        await fetch("/api/accounts/sensitive-consent", {
                          method: "POST",
                          credentials: "include",
                        });
                      } catch (_) {
                        /* non-fatal; server will fall back to ACR check */
                      }

                      const sensitiveRes = await sendAgentMessage(
                        "Show me my full account details with routing numbers",
                      );
                      if (sensitiveRes.stepUpRequired) {
                        // Consent fetch may have failed silently — fall back to OTP modal
                        addMessage(
                          "assistant",
                          "\uD83D\uDD10 Identity verification required\n\nViewing full account details requires step-up authentication. Please complete the verification to continue.",
                          "sensitive-account-details",
                        );
                        pendingStepUpCallbackRef.current = async () => {
                          setNlLoading(true);
                          const retryToastId = toast.loading(
                            "\uD83D\uDD12 Retrieving sensitive account details\u2026",
                          );
                          try {
                            const retryRes = await sendAgentMessage(
                              "Show me my full account details with routing numbers",
                            );
                            if (retryRes.error || !retryRes.success) {
                              addMessage(
                                "assistant",
                                `\u26A0\uFE0F ${retryRes.error || retryRes.reply || "Could not retrieve sensitive account details."}`,
                                "sensitive-account-details",
                              );
                              toast.update(retryToastId, {
                                render: "\u26A0\uFE0F Could not load details",
                                type: "error",
                                isLoading: false,
                                autoClose: 4000,
                              });
                            } else {
                              let detailsMsg =
                                retryRes.reply ||
                                "Sensitive account details retrieved.";
                              if (retryRes.accountData?.accounts) {
                                const { user: u, accounts: accs } =
                                  retryRes.accountData;
                                let fmt = "## \uD83D\uDCCB Account Details\n\n";
                                if (u) {
                                  fmt += `Customer: ${u.fullName || u.username}\n`;
                                  if (u.email) fmt += `Email: ${u.email}\n\n`;
                                }
                                fmt += "### Your Accounts\n";
                                accs.forEach((acc) => {
                                  fmt += `\n${acc.accountType.toUpperCase()} (${acc.name || acc.accountType})\n`;
                                  fmt += `\u2022 Balance: $${(acc.balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acc.currency || "USD"}\n`;
                                  const num =
                                    acc.accountNumberFull || acc.accountNumber;
                                  if (num)
                                    fmt += `\u2022 Account #: \`${num}\n`;
                                  if (acc.routingNumber)
                                    fmt += `\u2022 Routing #: \`${acc.routingNumber}\n`;
                                  if (acc.swiftCode)
                                    fmt += `\u2022 SWIFT: \`${acc.swiftCode}\n`;
                                  if (acc.iban)
                                    fmt += `\u2022 IBAN: \`${acc.iban}\n`;
                                  fmt += `\u2022 Status: ${acc.status}\n`;
                                });
                                fmt +=
                                  "\n---\n_Protected by HITL consent \u00B7 scope: `sensitive`_";
                                detailsMsg = fmt;
                              }
                              addMessage(
                                "assistant",
                                detailsMsg,
                                "sensitive-account-details",
                              );
                              if (retryRes.accountData) {
                                setAccountDetailsPanel(retryRes.accountData);
                                setAccountDetailsPanelPos({ x: 200, y: 100 });
                              }
                              toast.update(retryToastId, {
                                render: "\u2705 Account details loaded",
                                type: "success",
                                isLoading: false,
                                autoClose: 3000,
                              });
                            }
                          } catch (retryErr) {
                            addMessage(
                              "error",
                              `Failed to retrieve sensitive data: ${retryErr.message}`,
                              "sensitive-account-details",
                            );
                            toast.update(retryToastId, {
                              render: "\u274C Failed",
                              type: "error",
                              isLoading: false,
                              autoClose: 4000,
                            });
                          } finally {
                            setNlLoading(false);
                          }
                        };
                        setOtpContextLine(
                          "Sensitive account details require identity verification (RFC 9470)",
                        );
                        setShowOtpModal(true);
                        toast.update(sensToastId, {
                          render: "\uD83D\uDD10 MFA required",
                          type: "warning",
                          isLoading: false,
                          autoClose: 4000,
                        });
                        return;
                      }
                      if (sensitiveRes.error || !sensitiveRes.success) {
                        addMessage(
                          "assistant",
                          `\u26A0\uFE0F ${sensitiveRes.error || sensitiveRes.reply || "Could not retrieve sensitive account details."}`,
                          "sensitive-account-details",
                        );
                        toast.update(sensToastId, {
                          render: "\u26A0\uFE0F Could not load details",
                          type: "error",
                          isLoading: false,
                          autoClose: 4000,
                        });
                      } else {
                        let detailsMessage =
                          sensitiveRes.reply ||
                          "Sensitive account details retrieved.";
                        if (
                          sensitiveRes.accountData &&
                          sensitiveRes.accountData.accounts
                        ) {
                          const { user, accounts } = sensitiveRes.accountData;
                          let formattedDetails =
                            "## \uD83D\uDCCB Account Details\n\n";
                          if (user) {
                            formattedDetails += `Customer: ${user.fullName || user.username}\n`;
                            if (user.email)
                              formattedDetails += `Email: ${user.email}\n\n`;
                          }
                          formattedDetails += "### Your Accounts\n";
                          accounts.forEach((acc) => {
                            formattedDetails += `\n${acc.accountType.toUpperCase()} (${acc.name || acc.accountType})\n`;
                            formattedDetails += `\u2022 Balance: $${(acc.balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acc.currency || "USD"}\n`;
                            const displayAcctNum =
                              acc.accountNumberFull || acc.accountNumber;
                            if (displayAcctNum)
                              formattedDetails += `\u2022 Account #: \`${displayAcctNum}\n`;
                            if (acc.routingNumber)
                              formattedDetails += `\u2022 Routing #: \`${acc.routingNumber}\n`;
                            if (acc.swiftCode)
                              formattedDetails += `\u2022 SWIFT: \`${acc.swiftCode}\n`;
                            if (acc.iban)
                              formattedDetails += `\u2022 IBAN: \`${acc.iban}\n`;
                            formattedDetails += `\u2022 Status: ${acc.status}\n`;
                          });
                          formattedDetails +=
                            "\n---\n_Protected by HITL consent \u00B7 scope: `sensitive`_";
                          detailsMessage = formattedDetails;
                        }
                        addMessage(
                          "assistant",
                          detailsMessage,
                          "sensitive-account-details",
                        );
                        if (sensitiveRes.accountData) {
                          setAccountDetailsPanel(sensitiveRes.accountData);
                          setAccountDetailsPanelPos({ x: 200, y: 100 });
                        }
                        toast.update(sensToastId, {
                          render: "\u2705 Account details loaded",
                          type: "success",
                          isLoading: false,
                          autoClose: 3000,
                        });
                      }
                    } catch (err) {
                      addMessage(
                        "error",
                        `Failed to retrieve sensitive data: ${err.message}`,
                        "sensitive-account-details",
                      );
                      toast.update(sensToastId, {
                        render: "\u274C Failed",
                        type: "error",
                        isLoading: false,
                        autoClose: 4000,
                      });
                    } finally {
                      setNlLoading(false);
                    }
                    return;
                  }

                  // Agent HITL resume flow (LangChain agent)
                  if (actionId === "agent-hitl" && intentPayload?.consentId) {
                    const { consentId: pendingId, originalMessage } =
                      intentPayload;
                    setHitlPendingIntent(null);
                    if (originalMessage) {
                      setNlLoading(true);
                      try {
                        const response = await sendAgentMessage(
                          originalMessage,
                          pendingId,
                        );
                        addMessage(
                          "assistant",
                          response.reply || "✅ Operation completed.",
                        );
                        if (!response.error && response.tokenEvents?.length) {
                          appendTokenEvents(response.tokenEvents);
                          if (tokenChain) {
                            tokenChain.setTokenEvents(
                              "agent",
                              response.tokenEvents,
                            );
                          }
                          const hitlTokenMsg = buildTokenEventMsg(response.tokenEvents);
                          if (hitlTokenMsg) {
                            addMessage("token-event", hitlTokenMsg, null);
                          }
                        }
                      } catch (err) {
                        addMessage(
                          "error",
                          `Failed to resume after consent: ${err.message}`,
                        );
                      } finally {
                        setNlLoading(false);
                      }
                    }
                    return;
                  }

                  // Existing transaction HITL flow
                  try {
                    const { data } = await bffAxios.post(
                      "/api/transactions/consent-challenge",
                      intentPayload,
                    );
                    const cid = data?.challengeId;
                    if (!cid) {
                      notifyError(
                        "Could not start consent — no challenge id from server.",
                      );
                      setHitlPendingIntent(null);
                      return;
                    }
                    // Pass snapshot from POST response directly — avoids GET race on Vercel
                    // Store the original form so we can re-fire the tool with consentChallengeId
                    setHitlChallengeId({
                      challengeId: cid,
                      actionId,
                      snapshot: data.snapshot || null,
                      form: hitlPendingIntent.form || {},
                    });
                    setHitlPendingIntent(null);
                  } catch (ex) {
                    const msg =
                      ex.response?.data?.message ||
                      ex.response?.data?.error ||
                      ex.message ||
                      "Could not start consent flow.";
                    notifyError(msg);
                    setHitlPendingIntent(null);
                  }
                };
                const handleHitlCancel = async () => {
                  // MCP HITL: also POST deny to the polling endpoint
                  if (hitlPendingIntent.isMcpHitl && hitlPendingIntent.taskId) {
                    try {
                      await fetch(
                        `/api/mcp/decision/${hitlPendingIntent.taskId}/deny`,
                        {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                        },
                      );
                    } catch {
                      /* best-effort */
                    }
                    addMessage(
                      "assistant",
                      " You denied the MCP tool authorization request.",
                      hitlPendingIntent.actionId,
                    );
                  }
                  setHitlPendingIntent(null);
                };
                return (
                  <AgentConsentModal
                    transaction={hitlPendingIntent.intentPayload}
                    hitlThreshold={hitlPendingIntent.threshold ?? 500}
                    onAccept={handleHitlConfirm}
                    onDismiss={handleHitlCancel}
                    intentAuthDecision={hitlPendingIntent.intentAuthDecision}
                    hitlContext={hitlPendingIntent.isMcpHitl ? {
                      tool: hitlPendingIntent.tool,
                      reason: hitlPendingIntent.reason,
                    } : undefined}
                  />
                );
              })()}

            {/* ── Scope-upgrade consent modal (Phase 211) ── */}
            {scopeErrorModal && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 9999,
                  background: "rgba(0,0,0,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    background: "var(--color-bg-card, #1a1d27)",
                    border: "1px solid var(--color-border, #2e3147)",
                    borderRadius: "12px",
                    padding: "28px 32px",
                    maxWidth: "540px",
                    width: "100%",
                    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                    color: "var(--color-text, #e2e4ef)",
                    fontFamily: "inherit",
                  }}
                >
                  {/* ── error state ────────────────────────────────────────────────────────────────────────── */}
                  {scopeErrorModal.scopeUpgradeState === "error" && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "16px",
                        }}
                      >
                        <span style={{ fontSize: "22px" }}></span>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "17px",
                            fontWeight: 700,
                          }}
                        >
                          Scope Upgrade Required
                        </h3>
                      </div>
                      <p
                        style={{
                          margin: "0 0 12px",
                          lineHeight: 1.6,
                          fontSize: "14px",
                        }}
                      >
                        This action requires{"  "}
                        <code
                          style={{
                            background: "rgba(255,200,80,0.15)",
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          write
                        </code>
                        {"  "}scope. Your current MCP token does not include it.
                        You can approve a scope upgrade — the BFF will exchange
                        your token for a write-capable version via{"  "}
                        <strong>RFC 8693</strong>.
                      </p>
                      <div
                        style={{
                          background: "rgba(255,80,80,0.08)",
                          border: "1px solid rgba(255,80,80,0.25)",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          marginBottom: "16px",
                          fontSize: "13px",
                        }}
                      >
                        <div style={{ marginBottom: "6px" }}>
                          <span style={{ opacity: 0.7 }}>Missing scopes:</span>{" "}
                          {(scopeErrorModal.missingScopes &&
                          scopeErrorModal.missingScopes.length
                            ? scopeErrorModal.missingScopes
                            : ["write"]
                          ).map((s) => (
                            <code
                              key={s}
                              style={{
                                background: "rgba(255,80,80,0.15)",
                                borderRadius: "4px",
                                padding: "1px 6px",
                                marginLeft: "4px",
                                fontSize: "12px",
                              }}
                            >
                              {s}
                            </code>
                          ))}
                        </div>
                        <div>
                          <span style={{ opacity: 0.7 }}>Your token has:</span>{" "}
                          {(scopeErrorModal.userScopes || "")
                            .split(" ")
                            .filter(Boolean)
                            .map((s) => (
                              <code
                                key={s}
                                style={{
                                  background: "rgba(100,100,200,0.15)",
                                  borderRadius: "4px",
                                  padding: "1px 6px",
                                  marginLeft: "4px",
                                  fontSize: "12px",
                                }}
                              >
                                {s}
                              </code>
                            ))}
                        </div>
                      </div>
                      {scopeErrorModal.upgradeError && (
                        <p
                          style={{
                            color: "var(--color-error, #f87171)",
                            fontSize: "13px",
                            marginBottom: "12px",
                          }}
                        >
                          {scopeErrorModal.upgradeError}
                        </p>
                      )}
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setScopeErrorModal(null)}
                          style={{
                            padding: "8px 20px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border, #2e3147)",
                            background: "transparent",
                            color: "var(--color-text, #e2e4ef)",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setScopeErrorModal((prev) =>
                              prev
                                ? { ...prev, scopeUpgradeState: "confirm" }
                                : prev,
                            )
                          }
                          style={{
                            padding: "8px 20px",
                            borderRadius: "8px",
                            border: "none",
                            background: "var(--color-primary, #4f7df3)",
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                          }}
                        >
                          Approve Scope Upgrade
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── confirm state ────────────────────────────────────────────────────────────────────────── */}
                  {scopeErrorModal.scopeUpgradeState === "confirm" && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "16px",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "17px",
                            fontWeight: 700,
                          }}
                        >
                          Confirm Scope Upgrade
                        </h3>
                      </div>
                      <p
                        style={{
                          margin: "0 0 16px",
                          lineHeight: 1.6,
                          fontSize: "14px",
                        }}
                      >
                        You are granting the AI agent{" "}
                        <code
                          style={{
                            background: "rgba(100,200,100,0.12)",
                            padding: "1px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          write
                        </code>{" "}
                        access for this session. This allows the agent to
                        complete{"  "}
                        <strong>transfers, deposits, and withdrawals</strong> on
                        your behalf.
                      </p>
                      <p
                        style={{
                          margin: "0 0 16px",
                          lineHeight: 1.6,
                          fontSize: "13px",
                          opacity: 0.8,
                        }}
                      >
                        The BFF will perform an{"  "}
                        <strong>RFC 8693 Token Exchange</strong> — your user
                        access token becomes the subject, the agent client is
                        the actor, and the result is a narrowly-scoped MCP token
                        valid for this session only.
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setScopeErrorModal((prev) =>
                              prev
                                ? { ...prev, scopeUpgradeState: "error" }
                                : prev,
                            )
                          }
                          style={{
                            padding: "8px 20px",
                            borderRadius: "8px",
                            border: "1px solid var(--color-border, #2e3147)",
                            background: "transparent",
                            color: "var(--color-text, #e2e4ef)",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                          }}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={handleScopeUpgradeConfirm}
                          style={{
                            padding: "8px 20px",
                            borderRadius: "8px",
                            border: "none",
                            background: "var(--color-primary, #4f7df3)",
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                          }}
                        >
                          Confirm &amp; Exchange Token
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── exchanging state ──────────────────────────────────────────────────────────────────────── */}
                  {scopeErrorModal.scopeUpgradeState === "exchanging" && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "16px",
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "17px",
                            fontWeight: 700,
                          }}
                        >
                          Exchanging Token…
                        </h3>
                      </div>
                      <p style={{ margin: 0, fontSize: "14px", opacity: 0.8 }}>
                        Performing RFC 8693 token exchange to obtain a{" "}
                        <code style={{ padding: "1px 5px" }}>
                          write
                        </code>
                        {"-scoped MCP token."}
                      </p>
                    </>
                  )}

                  {/* ── done state ───────────────────────────────────────────────────────────────────────────────── */}
                  {scopeErrorModal.scopeUpgradeState === "done" && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "16px",
                        }}
                      >
                        <span style={{ fontSize: "22px" }}>✅</span>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "17px",
                            fontWeight: 700,
                          }}
                        >
                          Scope Upgraded — Replaying Request
                        </h3>
                      </div>
                      <p style={{ margin: 0, fontSize: "14px", opacity: 0.8 }}>
                        Write-scoped MCP token obtained. Retrying your original
                        request automatically…
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* OTP + transaction execution — rendered once challenge is created */}
            {hitlChallengeId && (
              <TransactionConsentModal
                open
                challengeId={hitlChallengeId.challengeId}
                preloadedSnapshot={hitlChallengeId.snapshot}
                user={effectiveUser}
                onClose={() => setHitlChallengeId(null)}
                onTransactionSuccess={(msg) => {
                  const { actionId, challengeId, form } = hitlChallengeId;
                  setHitlChallengeId(null);
                  addMessage(
                    "assistant",
                    ` Consent verified.\n\nNow checking for additional verification requirements...`,
                    actionId,
                  );
                  // Re-fire the original tool with consentChallengeId so API can check step-up
                  // Use the *WithConsent versions to properly pass consentChallengeId through
                  setTimeout(async () => {
                    try {
                      let response;
                      if (actionId === "transfer") {
                        response = await createTransferWithConsent(
                          form.fromId,
                          form.toId,
                          parseFloat(form.amount),
                          form.note,
                          challengeId,
                        );
                      } else if (actionId === "deposit") {
                        response = await createDepositWithConsent(
                          form.toId || form.accountId,
                          parseFloat(form.amount),
                          form.note,
                          challengeId,
                        );
                      } else if (actionId === "withdraw") {
                        response = await createWithdrawalWithConsent(
                          form.fromId || form.accountId,
                          parseFloat(form.amount),
                          form.note,
                          challengeId,
                        );
                      }
                      // callRestTransaction throws on any non-2xx, so reaching
                      // here means the transaction executed (HTTP 201). Always
                      // confirm to the customer. Transfer responses carry
                      // withdrawal/depositTransaction (no transaction_id), so the
                      // old transaction_id-only check showed nothing for transfers.
                      const r = response?.result || {};
                      const txRef =
                        r.transaction_id ||
                        r.transactionId ||
                        r.withdrawalTransaction?.id ||
                        r.transaction?.id ||
                        r.depositTransaction?.id ||
                        null;
                      const amtNum = parseFloat(form.amount) || 0;
                      const verb =
                        actionId === "transfer"
                          ? "Transfer"
                          : actionId === "deposit"
                            ? "Deposit"
                            : "Withdrawal";
                      const newBal =
                        r.newBalance ??
                        r.withdrawalTransaction?.balanceAfter ??
                        r.transaction?.balanceAfter ??
                        null;
                      console.log(
                        "[HITL Consent] Transaction successful:",
                        txRef || r.message,
                      );
                      addMessage(
                        "assistant",
                        `✅ ${verb} of $${amtNum.toFixed(2)} completed successfully.` +
                          (txRef ? `\n\nReference: ${txRef}` : "") +
                          (newBal != null
                            ? `\nNew balance: $${Number(newBal).toFixed(2)}`
                            : ""),
                        actionId,
                      );
                    } catch (err) {
                      // callRestTransaction throws on non-2xx status codes, so we handle 428 (step_up_required or mcp_step_up_required) here
                      if (
                        err.statusCode === 428 &&
                        (err.code === "step_up_required" || err.code === "mcp_step_up_required")
                      ) {
                        console.log(
                          "[HITL Consent] Step-up required, triggering MFA",
                        );
                        addMessage(
                          "assistant",
                          " Additional verification required.\n\nPlease verify your identity.",
                          actionId,
                        );
                        // Extract step-up method from error response. Legacy
                        // "fido" is routed through the OTP modal, which now owns
                        // the real PingOne passkey register-then-authenticate flow.
                        const rawStepUp = err.data?.step_up_method || "otp";
                        const stepUpMethod = rawStepUp === "fido" ? "otp" : rawStepUp;
                        console.log(
                          "[HITL Consent] Step-up method:",
                          stepUpMethod,
                          "full data:",
                          err.data,
                        );
                        setStepUpMethod(stepUpMethod);

                        // If P1MFA mode, fetch devices
                        if (stepUpMethod === "p1mfa") {
                          try {
                            const apiBase = process.env.REACT_APP_API_URL || "";
                            const mfaResp = await fetch(
                              `${apiBase}/api/auth/mfa/challenge`,
                              {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                              },
                            );
                            if (!mfaResp.ok)
                              throw new Error(
                                `MFA initiation failed: ${mfaResp.status}`,
                              );
                            const { daId, devices } = await mfaResp.json();
                            console.log("[HITL Consent] P1MFA initialized:", {
                              daId,
                              deviceCount: devices?.length || 0,
                            });
                            setP1mfaDaId(daId);
                            setP1mfaDevices(devices || []);
                            setP1mfaMode(true);
                          } catch (mfaErr) {
                            console.error(
                              "[HITL Consent] P1MFA initiation failed, falling back to stub:",
                              mfaErr,
                            );
                            setP1mfaMode(false);
                          }
                        } else {
                          setP1mfaMode(false);
                        }

                        setShowOtpModal(true);
                      } else {
                        console.error(
                          "[HITL Consent] Re-fire tool failed:",
                          err,
                        );
                        notifyError(
                          "Transaction processing failed. Please try again.",
                        );
                      }
                    }
                  }, 500);
                }}
                onDeclinedConfirmed={() => {
                  setHitlChallengeId(null);
                  addMessage(
                    "assistant",
                    "❌ Transaction declined.\n\nThe transaction was not completed.",
                    hitlChallengeId.actionId,
                  );
                }}
              />
            )}

            {/* OTP/FIDO Step-Up Modal (Phase 174) */}
            {stepUpMethod === "fido" && !p1mfaMode ? (
              <FidoStepUpModal
                show={showOtpModal}
                contextLine={otpContextLine}
                onSubmit={handleFidoSubmit}
                onCancel={handleOtpCancel}
                fallbackToOtp={handleSwitchToOtp}
              />
            ) : (
              <OtpStepUpModal
                show={showOtpModal}
                contextLine={otpContextLine}
                onSubmit={handleOtpSubmit}
                onCancel={handleOtpCancel}
                allowFido={supportsFido}
                mode={p1mfaMode ? "p1mfa" : "stub"}
                daId={p1mfaDaId}
                devices={p1mfaDevices}
                onP1MfaComplete={handleP1MfaComplete}
                onP1MfaError={handleP1MfaError}
                userIdentity={{
                  name: effectiveUser?.fullName || effectiveUser?.username,
                  email: effectiveUser?.email,
                  phone: effectiveUser?.phone || effectiveUser?.mobilePhone || effectiveUser?.primaryPhone || null,
                }}
                onPasskeyRegistered={handlePasskeyRegistered}
                deliveryError={otpDeliveryError}
              />
            )}

            {/* AG-UI Step 7 — HITL interrupt consent modal */}
            <GatewayConsentModal
              show={!!aguiHitlPending}
              challengeId={aguiHitlPending?.id || ""}
              challengeType="consent"
              expiresAt={aguiHitlPending?.expiresAt || ""}
              onApprove={handleAguiHitlApprove}
              onDismiss={handleAguiHitlDismiss}
            />

            {/* Transaction failure modal — replaces auto-closing toast for write actions */}
            {txErrorModal && (
              <div
                className="ba-tx-error-overlay"
                onClick={() => setTxErrorModal(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setTxErrorModal(null);
                }}
                role="dialog"
                aria-modal="true"
                aria-label="Transaction error"
              >
                <div className="ba-tx-error-modal">
                  <div className="ba-tx-error-modal__header">
                    ❌ {txErrorModal.title}
                  </div>
                  <div className="ba-tx-error-modal__body">
                    {typeof txErrorModal.message === "string" ? txErrorModal.message : JSON.stringify(txErrorModal.message)}
                  </div>
                  <button
                    type="button"
                    className="ba-tx-error-modal__close"
                    onClick={() => setTxErrorModal(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* MCP Tools List Modal */}
            <MCPToolsListModal
              show={showMcpToolsModal}
              onClose={() => setShowMcpToolsModal(false)}
              tools={mcpToolsList}
              onToolSelect={(tool) => {
                setShowMcpToolsModal(false);
                addMessage('user', `Call ${tool.name}`, 'tool_selected');
                handleSubmit({ agentMode: agentMode || 'helix' });
              }}
            />

            {/* Demo Guide Modal */}
            {showDemoGuide && (
              <AgentDemoGuide onClose={() => setShowDemoGuide(false)} />
            )}

            {/* Account Details Side Panel */}
            {accountDetailsPanel && (
              <AccountDetailsPanel
                accountData={accountDetailsPanel}
                initialPos={accountDetailsPanelPos}
                onClose={() => setAccountDetailsPanel(null)}
              />
            )}

            {/* ── Left column: suggestions + actions/auth ── */}
            {!useActionsPopout && (
              <div className="ba-left-col">
                {isLoggedIn && (
                  <div className="ba-session-row">
                    <button
                      type="button"
                      className="ba-action-item"
                      onClick={() => void handleSessionRefresh()}
                      disabled={sessionRefreshing || loading || consentBlocked}
                      title="Refresh your access token using PingOne refresh token (no logout)"
                    >
                      {sessionRefreshing ? "Refreshing…" : "Refresh"}
                    </button>
                    <button
                      type="button"
                      className="ba-action-item"
                      onClick={() => onLogout?.()}
                      title="Sign out of your session"
                    >
                      Sign out
                    </button>
                  </div>
                )}

                {suggestionList.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ba-suggestion"
                    disabled={consentBlocked}
                    onClick={() => {
                      if (isAgentBlockedByConsentDecline()) {
                        addMessage(
                          "assistant",
                          AGENT_CONSENT_BLOCK_USER_MESSAGE,
                        );
                        return;
                      }
                      setNlInput(s);
                      if (isLoggedIn || marketingGuestChatEnabled) {
                        // Save chip text before clearing input — if an auth error fires mid-flight
                        // and triggers handleLoginAction (which reads sessionStorage), the prompt survives.
                        try {
                          sessionStorage.setItem(
                            BX_AGENT_PENDING_NL_KEY,
                            s.trim(),
                          );
                        } catch (_) {}
                        setNlInput("");
                        addMessage("user", s);
                        setNlLoading(true);
                        // Chip dispatch: check for log queries before hitting BFF sendAgentMessage.
                        // "Show me last 5 errors" is handled client-side via parseLogPrompt to avoid LLM fallback.
                        const _chipLogQuery = parseLogPrompt(s);
                        if (_chipLogQuery && _chipLogQuery.type === "errors") {
                          (async () => {
                            try {
                              const _params = new URLSearchParams({
                                level: "error",
                                limit: String(_chipLogQuery.limit),
                              });
                              const _sources = ["console", "app", "exchange"];
                              const _results = await Promise.allSettled(
                                _sources.map((src) =>
                                  fetch(
                                    `/api/logs/${src}?${_params.toString()}`,
                                    {
                                      credentials: "include",
                                    },
                                  ),
                                ),
                              );
                              const _merged = [];
                              for (let _i = 0; _i < _results.length; _i += 1) {
                                const _r = _results[_i];
                                if (_r.status !== "fulfilled" || !_r.value.ok)
                                  continue;
                                const _body = await _r.value.json();
                                (_body.logs || []).forEach((log) => {
                                  _merged.push({ ...log, _src: _sources[_i] });
                                });
                              }
                              const _top = _merged
                                .sort(
                                  (a, b) =>
                                    new Date(b.timestamp || 0) -
                                    new Date(a.timestamp || 0),
                                )
                                .slice(0, _chipLogQuery.limit);
                              if (_top.length === 0) {
                                addMessage(
                                  "assistant",
                                  `No error logs found in the last ${_chipLogQuery.limit} entries.`,
                                );
                              } else {
                                const _lines = _top.map((l, idx) => {
                                  const when = new Date(
                                    l.timestamp || Date.now(),
                                  ).toLocaleString();
                                  return `${idx + 1}. [${(l.level || "error").toUpperCase()}] (${l._src}) ${when}\n   ${String(l.message || "").slice(0, 180)}`;
                                });
                                addMessage(
                                  "assistant",
                                  `Last ${_top.length} errors:\n\n${_lines.join("\n\n")}`,
                                );
                              }
                              try {
                                sessionStorage.removeItem(
                                  BX_AGENT_PENDING_NL_KEY,
                                );
                              } catch (_) {}
                            } catch (_chipErr) {
                              addMessage(
                                "assistant",
                                `Could not fetch error logs: ${_chipErr.message}`,
                              );
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                        } else {
                          prepNlCompliance(s);
                          (async () => {
                            try {
                              const _chipNlRes = await fetch(
                                "/api/demo-agent/nl",
                                {
                                  method: "POST",
                                  credentials: "include",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    message: s,
                                    provider: activeLlmProvider || "heuristic",
                                  }),
                                  signal: AbortSignal.timeout(15000),
                                },
                              );
                              const { result: _chipNlResult } = await _chipNlRes
                                .json()
                                .catch(() => ({
                                  result: {
                                    kind: "none",
                                    message: "Could not parse request.",
                                  },
                                }));
                              try {
                                sessionStorage.removeItem(
                                  BX_AGENT_PENDING_NL_KEY,
                                );
                              } catch (_) {}
                              await dispatchNlResult(_chipNlResult, "nl", s);
                            } catch (err) {
                              reportNlFailure(err);
                            } finally {
                              setNlLoading(false);
                            }
                          })();
                        }
                      }
                    }}
                  >
                    "{s}"
                  </button>
                ))}

                <div className="ba-left-divider" />

                {isLoggedIn ? (
                  <>
                    {isLoggedIn && renderActionGroups()}

                    <div className="ba-left-divider" />

                    <div className="ba-left-divider" />

                    {/* "All actions" discovery popout trigger */}
                    <button
                      ref={discoveryTriggerRef}
                      type="button"
                      className={
                        "ba-all-actions-btn" + (showDiscovery ? " active" : "")
                      }
                      onClick={() => setShowDiscovery((v) => !v)}
                      disabled={consentBlocked}
                      aria-expanded={showDiscovery}
                      aria-haspopup="dialog"
                    >
                      ⊞ All actions
                    </button>
                  </>
                ) : (
                  <>
                    {/* Enhanced unauthenticated agent chip group with login prompt */}
                    <div className="ba-left-guest-chips">
                      <div className="ba-left-label">
                        Get started with AI Demo:
                      </div>

                      {/* Primary login chip - more prominent */}
                      <button
                        type="button"
                        className="ba-action-item ba-action-item--login"
                        onClick={() => handleLoginAction("login_user")}
                      >
                        <span className="ba-action-item-text">
                          <span className="ba-action-item-title">
                            Sign in to access banking features
                          </span>
                          <span className="ba-action-item-desc">
                            Secure login with PingOne
                          </span>
                        </span>
                        <span className="ba-action-item-arrow">&#8594;</span>
                      </button>

                      <div className="ba-left-label-secondary">
                        Or explore these topics:
                      </div>

                      {/* Educational chips */}
                      <div className="ba-guest-chips-grid">
                        {[
                          { id: "guest_oauth", label: "What is OAuth?" },
                          { id: "guest_pkce", label: "Explain PKCE" },
                          { id: "guest_mcp", label: "Explain MCP" },
                          { id: "guest_agent", label: "How AI agents work" },
                        ].map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            className="ba-action-item ba-action-item--guest"
                            onClick={() => {
                              prepNlCompliance(chip.label);
                              setNlInput("");
                              addMessage("user", chip.label);
                              setNlLoading(true);
                              (async () => {
                                try {
                                  const _guestNlRes = await fetch(
                                    "/api/demo-agent/nl",
                                    {
                                      method: "POST",
                                      credentials: "include",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        message: chip.label,
                                        provider: activeLlmProvider || "heuristic",
                                      }),
                                      signal: AbortSignal.timeout(15000),
                                    },
                                  );
                                  const { result: _guestNlResult } =
                                    await _guestNlRes.json().catch(() => ({
                                      result: {
                                        kind: "none",
                                        message: "Could not parse request.",
                                      },
                                    }));
                                  await dispatchNlResult(
                                    _guestNlResult,
                                    "nl",
                                    chip.label,
                                  );
                                } catch (err) {
                                  reportNlFailure(err);
                                } finally {
                                  setNlLoading(false);
                                }
                              })();
                            }}
                          >
                            <span className="ba-action-item-text">
                              {chip.label}
                              {(chip.challenge || chip.hitlTrigger) && <HitlChipMark challenge={chip.challenge || 'both'} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="ba-left-auth">
                      <div className="ba-left-auth-notice">
                        {marketingGuestChatEnabled
                          ? "Banking uses PingOne — we’ll redirect you when you ask for accounts, transfers, etc."
                          : "Sign in required to access AI banking features"}
                      </div>
                      <button
                        type="button"
                        className="ba-left-auth-btn primary"
                        onClick={() => handleLoginAction("login_user")}
                        disabled={oauthConfig === null || !oauthConfig?.user}
                        title={
                          oauthConfig?.user
                            ? "Sign in as a bank customer"
                            : "Configure credentials first"
                        }
                      >
                        Customer Sign In
                      </button>
                      <button
                        type="button"
                        className="ba-left-auth-btn"
                        onClick={() => handleLoginAction("login_admin")}
                        disabled={oauthConfig === null || !oauthConfig?.admin}
                        title={
                          oauthConfig?.admin
                            ? "Sign in as administrator"
                            : "Configure credentials first"
                        }
                      >
                        Admin Sign In
                      </button>
                      <button
                        type="button"
                        className={`ba-left-config-btn${isConfigured ? " configured" : ""}`}
                        onClick={() => {
                          setIsOpen(false);
                          navigate("/config");
                        }}
                      >
                        {isConfigured
                          ? "PingOne Configured"
                          : "Configure PingOne"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="ba-right-col">
              {/* Simple Stepper — compact bar + pop-out step table */}
              <SimpleStepperBar />
              {/* Live agent reasoning visibility (renders only while a run reports a phase) */}
              {aguiEnabled && <ReasoningPanel reasoningState={aguiState.reasoningState} />}
              {/* Earlier-in-this-conversation summaries (renders only when summaries exist) */}
              {isLoggedIn && (
                <ConversationSummaryPanel vertical={effectiveVerticalId || 'banking'} />
              )}
              {/* Messages */}
              <div
                className="banking-agent-messages"
                ref={messagesContainerRef}
              >
                {messages.length === 0 && (
                  <div className="ba-welcome">
                    <p>
                      {isLoggedIn
                        ? "Type a message or use Actions to explore."
                        : marketingGuestChatEnabled
                          ? isConfigured
                            ? "Ask about OAuth or try a suggestion - we will open PingOne only when you need banking."
                            : "Set up PingOne in Application setup - you can still ask general questions once configured."
                          : isConfigured
                            ? "PingOne is configured - sign in to get started."
                            : "Set up your PingOne credentials to get started."}
                    </p>
                  </div>
                )}
                {messages
                  .filter(
                    (msg) =>
                      msg.role === "user" ||
                      msg.role === "assistant" ||
                      msg.role === "error" ||
                      (showRfcInfo && msg.role === "token-event"),
                  )
                  .map((msg, msgIdx, filteredMsgs) => {
                    const isLastAssistantMsg =
                      msg.role === "assistant" &&
                      !filteredMsgs
                        .slice(msgIdx + 1)
                        .some((m) => m.role === "assistant");
                    if (msg.role === "reasoning") {
                      return (
                        <div
                          key={msg.id}
                          className="banking-agent-msg reasoning"
                        >
                          <span
                            className="banking-agent-msg-avatar banking-agent-msg-avatar--tool"
                            aria-hidden
                          >
                            [R]
                          </span>
                          <div className="banking-agent-msg-bubble banking-agent-msg-bubble--reasoning">
                            <ReasoningSteps
                              steps={msg.steps}
                              conclusion={msg.conclusion}
                            />
                          </div>
                        </div>
                      );
                    }
                    if (msg.role === "tool-progress") {
                      return (
                        <div
                          key={msg.id}
                          className="banking-agent-msg tool-progress"
                        >
                          <span
                            className="banking-agent-msg-avatar banking-agent-msg-avatar--tool"
                            aria-hidden
                          >
                            [T]
                          </span>
                          <div className="banking-agent-msg-bubble banking-agent-msg-bubble--toolsteps">
                            <ToolProgressChips steps={msg.steps} />
                          </div>
                        </div>
                      );
                    }
                    if (msg.role === "assistant" && msg.showPrewarmRetryAction) {
                      const isWarming = prewarming === msg.id;
                      return (
                        <div key={msg.id} className="banking-agent-msg assistant">
                          <div className="banking-agent-msg-bubble banking-agent-msg-bubble--session-fix">
                            <MessageContent text={msg.content} terminology={terminology} />
                            <div className="ba-session-fix-actions">
                              <button
                                type="button"
                                className="ba-session-fix-btn"
                                disabled={isWarming}
                                onClick={() => handlePrewarmRetry(msg.id, msg.retryFn)}
                              >
                                {isWarming ? "Warming up… (up to ~1 min)" : "Pre-warm the model & retry"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (msg.role === "error" && msg.showCustomerLoginActions) {
                      return (
                        <div key={msg.id} className="banking-agent-msg error">
                          <div className="banking-agent-msg-bubble banking-agent-msg-bubble--session-fix">
                            <MessageContent text={msg.content} terminology={terminology} />
                            <div className="ba-session-fix-actions">
                              <button
                                type="button"
                                className="ba-session-fix-btn"
                                onClick={() => navigateToCustomerOAuthForceLogin()}
                              >
                                Log in as customer
                              </button>
                              <button
                                type="button"
                                className="ba-session-fix-btn ba-session-fix-btn--secondary"
                                onClick={() => navigate("/admin")}
                              >
                                Cancel — stay on admin
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (msg.role === "error" && msg.showSessionFixActions) {
                      return (
                        <div key={msg.id} className="banking-agent-msg error">
                          <div className="banking-agent-msg-bubble banking-agent-msg-bubble--session-fix">
                            <MessageContent text={msg.content} terminology={terminology} />
                            <div className="ba-session-fix-actions">
                              <button
                                type="button"
                                className="ba-session-fix-btn ba-session-fix-btn--secondary"
                                onClick={() =>
                                  window.open(
                                    "/api/auth/debug?deep=1",
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                              >
                                Open session debug
                              </button>
                              <button
                                type="button"
                                className="ba-session-fix-btn ba-session-fix-btn--secondary"
                                onClick={() => handleLoginAction("login_admin")}
                              >
                                Admin
                              </button>
                              <button
                                type="button"
                                className="ba-session-fix-btn ba-session-fix-btn--secondary"
                                onClick={() => handleLoginAction("login_user")}
                              >
                                Login
                              </button>
                              <button
                                type="button"
                                className="ba-session-fix-btn"
                                onClick={() => onLogout?.()}
                              >
                                Sign out (then sign in again)
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={msg.id}
                        className={`banking-agent-msg ${msg.role}`}
                        data-source={msg.source}
                      >
                        {msg.role === "user" && (
                          <span
                            className="banking-agent-msg-avatar banking-agent-msg-avatar--user"
                            aria-hidden
                          >
                            You
                          </span>
                        )}
                        {msg.role === "assistant" &&
                          (msg.source === "helix" || msg.source === "helix_fallback") && (
                          <span className="banking-agent-msg-avatar banking-agent-msg-avatar--helix">
                            <img
                              src="/images/helix.png"
                              alt="AI"
                              style={{
                                width: 22,
                                height: "auto",
                                display: "block",
                              }}
                            />
                          </span>
                        )}
                        <div>
                          {msg.isPrompt && (
                            <div className="banking-agent-msg-label banking-agent-msg-label--prompt">
                              Prompt
                            </div>
                          )}
                          {msg.source && msg.role === "assistant" && (
                            <div
                              className={`banking-agent-msg-label banking-agent-msg-label--${String(msg.source).replace(/[^a-z0-9_-]/gi, "")}`}
                            >
                              {sourceLabel(msg.source)}
                            </div>
                          )}
                          <div
                            className={`banking-agent-msg-bubble${msg.tool ? " banking-agent-msg-bubble--tool-result" : ""}${msg.isPrompt ? " banking-agent-msg-bubble--prompt" : ""}`}
                          >
                            <MessageContent text={msg.content} terminology={terminology} />
                            {msg.paramHint && <ParamHintCopy hint={msg.paramHint} />}
                            {msg.verticalResult && (
                              <VerticalResult
                                descriptor={msg.verticalResult.descriptor}
                                data={msg.verticalResult.data}
                              />
                            )}
                            {msg.rawMcpResult != null && (
                              <JsonField
                                label="Raw MCP response"
                                value={msg.rawMcpResult}
                                defaultOpen={false}
                              />
                            )}
                            {msg.tool && (
                              <span className="banking-agent-tool-badge">
                                {msg.tool}
                              </span>
                            )}
                            {msg.isPrompt && (
                              <button
                                type="button"
                                className="banking-agent-msg-copy-prompt"
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.content);
                                  notifySuccess('Prompt copied to clipboard');
                                }}
                                title="Copy prompt"
                                aria-label="Copy prompt"
                              >
                                Copy
                              </button>
                            )}
                          </div>
                          {isLastAssistantMsg && <ProofStrip />}
                        </div>
                      </div>
                    );
                  })}
                {nlLoading && (
                  <div className="banking-agent-msg user">
                    <span
                      className="banking-agent-msg-avatar banking-agent-msg-avatar--user"
                      aria-hidden
                    >
                      You
                    </span>
                    <div>
                      <div className="banking-agent-msg-bubble ba-typing-indicator">
                        <span className="ba-typing-dot" />
                        <span className="ba-typing-dot" />
                        <span className="ba-typing-dot" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Compliance 12-step panel — draggable, resizable modal */}
              <ComplianceModal
                open={showCompliancePanel && complianceSlideout}
                onClose={() => setComplianceSlideout(false)}
                complianceStripState={complianceStripState}
                messages={messages}
                onClearSteps={() => {
                  try {
                    agentFlowDiagram.resetComplianceSteps();
                  } catch (_) {}
                }}
                CHIP_APPLICABLE_STEPS={CHIP_APPLICABLE_STEPS}
                getStepSkipExplanation={getStepSkipExplanation}
              />

              {/* Bottom input bar */}
              <div className="ba-bottom">
                {isLoggedIn || marketingGuestChatEnabled ? (
                  <>
                    <div className="ba-input-row">
                      <input
                        ref={nlInputRef}
                        className="ba-input"
                        value={nlInput}
                        onChange={(e) => {
                          setNlInput(e.target.value);
                          setHistoryIndex(-1);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (nlInput.trim()) {
                              const newHistory = [
                                nlInput,
                                ...inputHistory,
                              ].slice(0, 10);
                              setInputHistory(newHistory);
                            }
                            handleNaturalLanguage();
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            const newIndex = Math.min(
                              historyIndex + 1,
                              inputHistory.length - 1,
                            );
                            if (
                              newIndex >= 0 &&
                              newIndex < inputHistory.length
                            ) {
                              setHistoryIndex(newIndex);
                              setNlInput(inputHistory[newIndex]);
                            }
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            if (historyIndex > 0) {
                              const newIndex = historyIndex - 1;
                              setHistoryIndex(newIndex);
                              setNlInput(inputHistory[newIndex]);
                            } else if (historyIndex === 0) {
                              setHistoryIndex(-1);
                              setNlInput("");
                            }
                          }
                        }}
                        placeholder={
                          marketingGuestChatEnabled && !isLoggedIn
                            ? `Ask about OAuth or type a request…`
                            : splitChrome && !nlMeta?.groqConfigured
                              ? `Ask about your ${terminology?.accounts || "accounts"}…`
                              : nlMeta?.groqConfigured
                                ? `Message ${brandShortName} AI… (Groq AI)`
                                : `Message ${brandShortName} AI…`
                        }
                        disabled={nlLoading || consentBlocked}
                      />
                      <button
                        type="button"
                        className="ba-send-btn"
                        onClick={() => {
                          handleNaturalLanguage();
                        }}
                        disabled={
                          nlLoading || !nlInput.trim() || consentBlocked
                        }
                        aria-label="Send"
                      >
                        {nlLoading ? "…" : "Send"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: "10px 12px",
                      textAlign: "center",
                      color: "var(--ba-muted)",
                      fontSize: "12px",
                    }}
                  >
                    Sign in using the buttons on the left to start chatting
                  </div>
                )}
              </div>

              {/* Start Over + nav + chips — always visible below input bar */}
              <div className="ba-bottom-extra">
                {/* Start Over button — clear conversation */}
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="ba-start-over-btn"
                    onClick={() => {
                      setMessages([]);
                      setNlInput("");
                      setInputHistory([]);
                      setHistoryIndex(-1);
                      // Reset feature flags that demo steps may have auto-enabled
                      apiClient.patch("/api/admin/feature-flags", {
                        updates: {
                          ff_a2a_delegation: false,
                          ff_ciba: false,
                          ff_rar: false,
                          ff_dpop: false,
                        },
                      }).catch(() => {});
                    }}
                    title="Clear conversation and start fresh"
                  >
                    Start Over
                  </button>
                )}

                {/* Dashboard navigation button — pinned below prompt (hidden on marketing pages) */}
                {isLoggedIn &&
                  !isPublicMarketingAgentPath(
                    (location.pathname || "").replace(/\/$/, "") || "/",
                  ) && (
                    <button
                      type="button"
                      className="ba-left-auth-btn primary"
                      style={{ display: "block" }}
                      onClick={() => {
                        setIsOpen(false);
                        navigate(
                          effectiveUser?.role === "admin"
                            ? "/admin"
                            : "/dashboard",
                        );
                      }}
                    >
                      {effectiveUser?.role === "admin"
                        ? "Admin Dashboard"
                        : "My Dashboard"}
                    </button>
                  )}
              </div>
              {/* Token Teller — session + lifetime token counter */}
              <div className="ba-token-footer">
                <span>⬆ {sessionTokens.input.toLocaleString()} in</span>
                <span>⬇ {sessionTokens.output.toLocaleString()} out</span>
                <span>∑ {(lifetimeTokens.input + lifetimeTokens.output).toLocaleString()}</span>
              </div>
            </div>
          </div>
          {/* Resize handles — all 8 directions, float mode only */}
          {!isInline && (
            <>
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--se"
                onPointerDown={(e) => handleResize(e, "se")}
                aria-label="Resize southeast"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--e"
                onPointerDown={(e) => handleResize(e, "e")}
                aria-label="Resize east"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--s"
                onPointerDown={(e) => handleResize(e, "s")}
                aria-label="Resize south"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--n"
                onPointerDown={(e) => handleResize(e, "n")}
                aria-label="Resize north"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--ne"
                onPointerDown={(e) => handleResize(e, "ne")}
                aria-label="Resize northeast"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--nw"
                onPointerDown={(e) => handleResize(e, "nw")}
                aria-label="Resize northwest"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--w"
                onPointerDown={(e) => handleResize(e, "w")}
                aria-label="Resize west"
              />
              <div
                role="button"
                tabIndex="0"
                className="ba-resize-handle ba-resize-handle--sw"
                onPointerDown={(e) => handleResize(e, "sw")}
                aria-label="Resize southwest"
              />
            </>
          )}
        </div>
      )}
      <TokenChainModal
        isOpen={showTokenChain}
        onClose={() => setShowTokenChain(false)}
      />
      {showLoginModal && (
        <QuickLoginModal pathname={window.location.pathname} onClose={() => setShowLoginModal(false)} />
      )}
      <DemoAuthzFallbackModal
        open={showAuthzFallbackModal}
        onClose={() => setShowAuthzFallbackModal(false)}
      />
      {elicitation && (
        <ElicitationDialog
          elicitation={elicitation}
          onSubmit={submitElicitation}
          onCancel={cancelElicitation}
        />
      )}
    </div>
  );

  // Inline/embed stays in React tree; float mounts on body so position:fixed is never trapped
  // by .App / shell overflow or theme transforms, and works the same on /logs and app routes.
  if (surfaceHostEl) return createPortal(floatShell, surfaceHostEl);
  if (isInline) return <>{floatShell}</>;
  return createPortal(floatShell, document.body);
}
