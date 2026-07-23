import React, { useEffect, useState } from "react";
import "./BankingChips.css";
import { useVertical } from '../vertical/useVertical';
import { useSessionToken } from "../context/SessionTokenContext";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import SecurityShowcasePanel from "./SecurityShowcasePanel";
import { chipPermState } from "../utils/chipPermissions";
import FallbackBadge from "./FallbackBadge";
import {
  BX_UC_PROGRESS_EVENT,
  isUseCaseCompleted,
} from "../utils/useCaseDemoProgress";

// Overlay manifest chip LABELS by key. id + message (routing keys) are never
// changed — the chip→routing→MCP pipeline is invariant (skip-proof contract).
export function applyChipLabels(chips, manifestChips) {
  if (!Array.isArray(manifestChips)) return chips;
  const byKey = new Map(manifestChips.map((c) => [c.key, c.label]));
  return chips.map((c) => (byKey.has(c.id) ? { ...c, label: byKey.get(c.id) } : c));
}

const ADMIN_CHIPS = [
  { id: 'lookup_customer',           label: 'Look Up Customer',   message: 'look up a customer' },
  { id: 'get_customer_transactions', label: 'View Transactions',  message: 'show last 5 transactions for this customer' },
  { id: 'get_customer_profile',      label: 'View Profile',       message: 'show full profile for this customer' },
  { id: 'get_customer_accounts',     label: 'View Accounts',      message: 'show all accounts for this customer' },
  { id: 'freeze_account',            label: 'Freeze Account',     message: 'freeze this account' },
  { id: 'adjust_balance',            label: 'Adjust Balance',     message: 'adjust account balance' },
  { id: 'reset_customer_password',   label: 'Reset Password',     message: 'reset password for this customer' },
  { id: 'delete_customer',           label: 'Delete Customer',    message: 'delete this customer' },
];

const PINGONE_ADMIN_CHIPS = [
  { id: 'p1_list_apps',        label: 'List all apps',              message: 'List all applications in our PingOne environment' },
  { id: 'p1_list_envs',        label: 'List environments',          message: 'Show all environments I have access to in PingOne' },
  { id: 'p1_services_enabled', label: 'What services are enabled?', message: 'What services are enabled in our PingOne environment?' },
  { id: 'p1_identity_count',   label: 'Identity count this week',   message: 'How many identities are in our PingOne environment?' },
  { id: 'p1_ai_agent_config',  label: 'Show Demo AI Agent config',  message: 'Get the configuration for the Demo AI Agent application in PingOne' },
  { id: 'p1_verify_apps',      label: 'Verify all 8 demo apps',     message: 'Confirm all 8 demo apps exist in PingOne: Demo Admin App, Demo User App, Demo MCP Server, Demo Worker, Demo MCP Exchanger, Demo MCP Gateway, Demo Agent, Demo AI Agent' },
];

export const PINGONE_ADMIN_CHIP_IDS = new Set(PINGONE_ADMIN_CHIPS.map((c) => c.id));

/** Map narrative useCaseId → Demo Steps catalog id (UC*). */
const USE_CASE_TO_DEMO_STEP = {
  'delegated-access-with-proof': 'UC1',
  'hitl-consent': 'UC8',
  'step-up-required': 'UC7',
  'rar-intent-verified': 'UC14b',
  'token-theft-replay': 'UC12',
  'authz-denied': 'UC6',
  'a2a-delegation': 'UC2',
  'ciba-out-of-band-approval': 'UC22',
};

/** Resolve Demo Steps catalog id for a chip (explicit or via useCaseId). */
function demoStepIdFor(chip) {
  if (chip?.demoStepId) return chip.demoStepId;
  if (chip?.useCaseId && USE_CASE_TO_DEMO_STEP[chip.useCaseId]) {
    return USE_CASE_TO_DEMO_STEP[chip.useCaseId];
  }
  return null;
}

// Fallback chip set rendered when the vertical manifest can't supply chips10
// (e.g. /api/verticals/me failed — auth blip, network error, cold start). The
// chips→routing→MCP pipeline keys (id/message/tool) match the banking baseline
// manifest, so they route correctly. Guarantees the agent always shows actions
// instead of an empty dropdown. Overridden the moment a real manifest loads.
const DEFAULT_CHIPS10 = [
  { id: 'bk-flow', label: 'Check balance', message: 'what is my balance', mode: 'both', tool: 'get_account_balance', useCaseId: 'delegated-access-with-proof', demoStepId: 'UC1' },
  { id: 'bk-consent', label: '👤 Transfer $300', message: 'transfer $300 from checking to savings', mode: 'both', hitlTrigger: true, challenge: 'consent', tool: 'create_transfer', useCaseId: 'hitl-consent', demoStepId: 'UC8' },
  { id: 'bk-mfa', label: '🔑 Transfer $600', message: 'transfer $600 from checking to savings', mode: 'both', hitlTrigger: true, challenge: 'step_up', tool: 'create_transfer', useCaseId: 'step-up-required', demoStepId: 'UC7' },
  { id: 'bk7', label: 'My mortgage', message: 'show my mortgage', mode: 'both', tool: 'show_mortgage', useCaseId: 'delegated-access-with-proof', demoStepId: 'UC1' },
  { id: 'bk-intent', label: 'Intent-bound transfer', message: 'run an intent-bound transfer within my RAR grant', mode: 'both', tool: 'create_transfer', useCaseId: 'rar-intent-verified', demoStepId: 'UC14b' },
  { id: 'bk-dpop', label: 'DPoP / replay defense', message: 'fire a token with the wrong audience at the gateway', mode: 'direct', useCaseId: 'token-theft-replay', demoStepId: 'UC12' },
  { id: 'bk8', label: 'Biggest spending categories', message: 'What are my biggest categories', mode: 'llm' },
  { id: 'bk-direct', label: 'Direct MCP', message: 'get my accounts', mode: 'direct', tool: 'get_my_accounts' },
  { id: 'bk-deny', label: 'Authz DENY', message: 'show my health record', mode: 'direct', denyTool: 'show_health_record', useCaseId: 'authz-denied', demoStepId: 'UC6' },
  { id: 'bk1', label: 'My accounts', message: 'show my accounts', mode: 'both', tool: 'get_my_accounts', useCaseId: 'delegated-access-with-proof', demoStepId: 'UC1', group: 'advanced' },
  { id: 'bk3', label: 'Recent transactions', message: 'recent transactions', mode: 'both', tool: 'get_my_transactions', useCaseId: 'delegated-access-with-proof', demoStepId: 'UC1', group: 'advanced' },
  { id: 'bk-a2a', label: 'A2A sensitive details', message: 'show my sensitive account details', mode: 'both', challenge: 'consent', hitlTrigger: true, tool: 'get_sensitive_account_details', useCaseId: 'a2a-delegation', demoStepId: 'UC2', group: 'advanced' },
  { id: 'bk-ciba', label: 'CIBA out-of-band', message: 'transfer $150 from checking to savings with CIBA approval', mode: 'both', challenge: 'both', hitlTrigger: true, tool: 'create_transfer', useCaseId: 'ciba-out-of-band-approval', demoStepId: 'UC22', group: 'advanced' },
];

// Minimal banking fallback for last-resort use only (when API call fails)
const DEFAULT_BANKING_CHIPS = DEFAULT_CHIPS10;

export default function BankingChips({
  onChipClick,
  isLoading,
  customChips = [],
  user,
  llmAvailable = true,
  isHelixMode = false,
  // Map of toolName → { permitted, deniedReason } from the live Authorize-filtered
  // tool list (POST /api/demo-agent/tools). Empty until loaded — when empty, all
  // chips show (no regression). onDeniedChip is called when a greyed chip is clicked.
  toolPermissions = {},
  // True when the tool-list fetch failed. With no permission data we can't verify
  // a tool-backed chip, so we disable it rather than fail open to a doomed click.
  toolsError = false,
  onDeniedChip,
  // User's most recent message/prompt for intent-aware fallback resolution
  userPrompt = '',
}) {
  const { pageManifest } = useVertical();
  const dashboard = pageManifest?.dashboard;

  // State for intent-aware fallback resolution
  const [chips10, setChips10] = useState(null);
  const [isFallback, setIsFallback] = useState(false);
  const [fallbackVertical, setFallbackVertical] = useState('banking');
  /** More demos (CIBA, A2A, extras) — collapsed by default in the Actions dropdown. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Bumps when Demo Steps progress changes (same-tab custom event). */
  const [progressTick, setProgressTick] = useState(0);

  useEffect(() => {
    const onProgress = () => setProgressTick((n) => n + 1);
    window.addEventListener(BX_UC_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(BX_UC_PROGRESS_EVENT, onProgress);
  }, []);

  // No usable access token (same derived signal as the TopNav "No token —
  // please sign in" pill) distinguishes "not signed in" from a real authorize
  // outage, so the chips prompt sign-in instead of a misleading error.
  // staleSession is excluded: StaleSessionBanner owns that state with a
  // force-login remedy.
  const { hasActiveToken, tokenLoading, staleSession } = useSessionToken();
  const needsSignIn = !tokenLoading && !staleSession && !hasActiveToken;
  const handleSignIn = () => {
    const returnTo =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/dashboard";
    navigateToCustomerOAuthLogin(returnTo);
  };
  // chipPermState (shared with SecurityShowcasePanel) joins a chip with the live
  // Authorize-filtered tool list — see utils/chipPermissions.js.
  const permState = (chip) => chipPermState(chip, toolPermissions, toolsError);

  // Load chips: use manifest chips10 if available, otherwise call fallback resolver
  useEffect(() => {
    async function loadChips() {
      // If manifest loaded and has chips, use them
      if (Array.isArray(dashboard?.chips10) && dashboard.chips10.length) {
        setChips10(dashboard.chips10);
        setIsFallback(false);
        return;
      }

      // Manifest didn't load or empty chips — use intent-aware fallback
      try {
        const response = await fetch(
          `/api/fallback/chips?${new URLSearchParams({
            prompt: userPrompt || 'hello',
            verticalId: 'undefined',
          })}`
        );

        if (!response.ok) throw new Error('Failed to fetch fallback chips');

        const { chips: fallbackChips, verticalId, isFallback: isUsingFallback } = await response.json();
        setChips10(fallbackChips);
        setIsFallback(isUsingFallback);
        setFallbackVertical(verticalId);
      } catch (error) {
        console.error('[BankingChips] Fallback resolver error, using banking default:', error);
        // Last resort: use hardcoded banking chips (but mark as fallback)
        setChips10(DEFAULT_BANKING_CHIPS);
        setIsFallback(true);
        setFallbackVertical('banking');
      }
    }

    loadChips();
  }, [dashboard?.chips10, userPrompt]);


  const handleChipClick = (chip, requiresLlm = false) => {
    if (onChipClick) {
      onChipClick({ message: chip.message, label: chip.label, requiresLlm, chipId: chip.id, direct: chip.direct, useCaseId: chip.useCaseId });
    }
  };

  /** Hitl badge label from challenge (consent vs MFA) — never conflate both on consent-only chips. */
  function hitlBadge(chip) {
    if (!chip.hitlTrigger && !chip.challenge) return null;
    const ch = chip.challenge || 'both';
    if (ch === 'consent') {
      return { text: 'Consent', title: 'Requires human approval (HITL consent)' };
    }
    if (ch === 'step_up') {
      return { text: 'MFA', title: 'Requires step-up authentication (MFA)' };
    }
    return { text: 'Consent+MFA', title: 'Requires consent and step-up (MFA)' };
  }

  /** Title tooltip for a suggestions chip. */
  function chipTitle(chip, { isDirect, llmDisabled, perm, deniedReason }) {
    if (perm.unverified) {
      return needsSignIn
        ? 'Sign in to use these actions.'
        : "Authorize unavailable — couldn't reach PingOne or the demo authorize server. Retry shortly.";
    }
    if (perm.denied) return `Denied by Authorize: ${deniedReason}`;
    if (isDirect) return `${chip.message} — calls MCP server directly, no gateway auth`;
    if (llmDisabled) return 'Needs an LLM — switch to llama.cpp, Anthropic, or Helix mode';
    if (chip.challenge === 'consent') return `${chip.message} — requires human approval (consent)`;
    if (chip.challenge === 'step_up') return `${chip.message} — requires step-up MFA`;
    if (chip.challenge === 'both' || chip.hitlTrigger) {
      return `${chip.message} — requires consent and identity verification`;
    }
    if (chip.elicitationTrigger) {
      return `${chip.message} — may request additional user input during execution`;
    }
    return chip.message;
  }

  /**
   * Render one suggestions-chip button (primary or advanced).
   * @param {object} chip
   */
  function renderSuggestionChip(chip) {
    const isDirect = chip.mode === 'direct';
    const isLlm = chip.mode === 'llm';
    const llmDisabled = isLlm && !llmAvailable;
    const perm = permState(chip);
    if (!perm.show) return null;
    const deniedReason = perm.denied
      ? (perm.reason || 'not permitted by Authorize for the current scope')
      : null;
    const badge = hitlBadge(chip);
    const stepId = demoStepIdFor(chip);
    void progressTick;
    const done = stepId ? isUseCaseCompleted(stepId) : false;
    return (
      <button
        type="button"
        key={chip.id}
        data-chip-id={chip.id}
        className={`banking-chips-dropdown__button banking-chips-dropdown__button--${isDirect ? 'direct' : isLlm ? 'llm' : 'heuristic'}${perm.denied ? ' banking-chips-dropdown__button--denied' : ''}${perm.unverified ? ' banking-chips-dropdown__button--unverified' : ''}${done ? ' banking-chips-dropdown__button--done' : ''}`}
        onClick={() => {
          if (perm.denied) {
            if (onDeniedChip) onDeniedChip({ id: chip.id, label: chip.label, tool: chip.tool }, deniedReason);
            return;
          }
          handleChipClick(
            { id: chip.id, label: chip.label, message: chip.message, direct: isDirect, useCaseId: chip.useCaseId },
            isLlm,
          );
        }}
        aria-disabled={perm.denied || undefined}
        aria-label={done ? `${chip.label}, completed` : undefined}
        disabled={isLoading || llmDisabled || perm.unverified}
        title={chipTitle(chip, { isDirect, llmDisabled, perm, deniedReason })}
      >
        {done && (
          <span className="banking-chips-dropdown__check" aria-hidden="true">
            ✓
          </span>
        )}
        <span className="banking-chips-dropdown__chip-name">{chip.label}</span>
        {isDirect && (
          <span className="banking-chips-dropdown__mcp-badge">MCP</span>
        )}
        {isLlm && isHelixMode && (
          <span className="banking-chips-dropdown__helix-badge">Helix</span>
        )}
        {isLlm && !isHelixMode && (
          <span className="banking-chips-dropdown__mcp-badge">LLM</span>
        )}
        {badge && (
          <span className="banking-chips-dropdown__hitl-badge" title={badge.title}>
            {badge.text}
          </span>
        )}
        {chip.elicitationTrigger && (
          <span
            className="banking-chips-dropdown__elicitation-badge"
            title="Requests additional user input or authorization during execution (MCP Elicitation)"
          >
            ◆
          </span>
        )}
      </button>
    );
  }

  if (!chips10) return <div className="chips-loading">Loading chips...</div>;

  const primaryChips = chips10.filter((c) => !c.group || c.group === 'primary');
  const advancedChips = chips10.filter((c) => c.group === 'advanced');
  void progressTick;
  const primaryDoneCount = primaryChips.filter((c) => {
    const id = demoStepIdFor(c);
    return id && isUseCaseCompleted(id);
  }).length;

  return (
    <div className="banking-chips-content">
      {isFallback && (
        <FallbackBadge
          isFallback={isFallback}
          verticalId={fallbackVertical}
          onDismiss={() => setIsFallback(false)}
        />
      )}
      {user?.role === 'admin' && (
        <div className="banking-chips-dropdown__section">
          <div className="banking-chips-dropdown__label">Admin Actions</div>
          <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
            {ADMIN_CHIPS.map((chip) => (
              <button
                type="button"
                key={chip.id}
                className="banking-chips-dropdown__button banking-chips-dropdown__button--heuristic"
                onClick={() => handleChipClick(chip, false)}
                disabled={isLoading}
                title={chip.message}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {user?.role === 'admin' && pageManifest?.id !== 'pingone-admin' && (
        <div className="banking-chips-dropdown__section banking-chips-dropdown__section--pingone">
          <div className="banking-chips-dropdown__label">
            PingOne Admin <span className="banking-chips-dropdown__mcp-badge">MCP</span>
          </div>
          <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
            {PINGONE_ADMIN_CHIPS.map((chip) => (
              <button
                type="button"
                key={chip.id}
                className="banking-chips-dropdown__button banking-chips-dropdown__button--pingone"
                onClick={() => handleChipClick(chip, true)}
                disabled={isLoading}
                title={chip.message}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Primary suggestions (trust ladder) + collapsed More demos (CIBA / A2A / extras).
          Testing + Attacks live in the Actions popout as separate collapsed groups. */}
      {chips10 && (
        <div className="banking-chips-dropdown__section">
          <div className="banking-chips-dropdown__sec-head">
            <div className="banking-chips-dropdown__label">
              {pageManifest?.identity?.displayName
                ? `${pageManifest.identity.displayName} Actions`
                : 'Suggestions'}
            </div>
            {primaryDoneCount > 0 && (
              <span className="banking-chips-dropdown__done-count">
                {primaryDoneCount} done
              </span>
            )}
          </div>
          {needsSignIn && (
            <button
              type="button"
              className="banking-chips-dropdown__signin"
              onClick={handleSignIn}
            >
              🔐 Sign in to use these actions
            </button>
          )}
          <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
            {primaryChips.map((chip) => renderSuggestionChip(chip))}
          </div>
          {advancedChips.length > 0 && (
            <div className="banking-chips-dropdown__categories" style={{ marginTop: 8 }}>
              <div className="banking-chips-dropdown__category">
                <button
                  type="button"
                  className="banking-chips-dropdown__category-header"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  aria-expanded={advancedOpen}
                  data-testid="chips-advanced-toggle"
                >
                  <span className="banking-chips-dropdown__category-name">
                    More demos ({advancedChips.length})
                  </span>
                  <span className="banking-chips-dropdown__category-toggle">
                    {advancedOpen ? '▾' : '▸'}
                  </span>
                </button>
                {advancedOpen && (
                  <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
                    {advancedChips.map((chip) => renderSuggestionChip(chip))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security Showcase — manifest-driven tabbed panel (Defenses / AI / Attacks).
          Each chip fires one security behavior live; rendered only when the active
          vertical's manifest defines dashboard.securityShowcase. */}
      {dashboard?.securityShowcase?.tabs?.length ? (
        <SecurityShowcasePanel
          securityShowcase={dashboard.securityShowcase}
          onChipClick={onChipClick}
          isLoading={isLoading}
          llmAvailable={llmAvailable}
          isHelixMode={isHelixMode}
          isAdmin={user?.role === 'admin'}
          toolPermissions={toolPermissions}
          toolsError={toolsError}
          onDeniedChip={onDeniedChip}
        />
      ) : null}

      {/* User-defined custom chips — always shown when present, below curated chips */}
      {customChips.length > 0 && (
        <div className="banking-chips-dropdown__section">
          <div className="banking-chips-dropdown__label">My Actions</div>
          <div className="banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic">
            {customChips.map((chip) => {
              const isLlm = chip.type === 'llm';
              const llmDisabled = isLlm && !llmAvailable;
              return (
                <button
                  type="button"
                  key={chip.id}
                  className={`banking-chips-dropdown__button banking-chips-dropdown__button--${isLlm ? 'llm' : 'heuristic'}`}
                  onClick={() => handleChipClick({ message: chip.prompt, label: chip.label, id: chip.id }, isLlm)}
                  disabled={isLoading || llmDisabled}
                  title={llmDisabled ? 'Needs an LLM — switch to llama.cpp, Anthropic, or Helix mode' : chip.prompt}
                >
                  {chip.label}
                  {isLlm && isHelixMode && <span className="banking-chips-dropdown__helix-badge">Helix</span>}
                  {isLlm && !isHelixMode && <span className="banking-chips-dropdown__mcp-badge">LLM</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
