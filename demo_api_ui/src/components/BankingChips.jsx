import React from "react";
import "./BankingChips.css";
import { useVertical } from '../vertical/useVertical';
import SecurityShowcasePanel from "./SecurityShowcasePanel";
import { chipPermState } from "../utils/chipPermissions";

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

// Fallback chip set rendered when the vertical manifest can't supply chips10
// (e.g. /api/verticals/me failed — auth blip, network error, cold start). The
// chips→routing→MCP pipeline keys (id/message/tool) match the banking baseline
// manifest, so they route correctly. Guarantees the agent always shows actions
// instead of an empty dropdown. Overridden the moment a real manifest loads.
const DEFAULT_CHIPS10 = [
  { id: 'bk1',  label: 'My accounts',                 message: 'show my accounts',                         mode: 'both', tool: 'get_my_accounts' },
  { id: 'bk2',  label: 'Check balance',               message: 'what is my balance',                       mode: 'both', tool: 'get_account_balance' },
  { id: 'bk3',  label: 'Recent transactions',         message: 'recent transactions',                      mode: 'both', tool: 'get_my_transactions' },
  { id: 'bk4',  label: 'Transfer money',              message: 'transfer $100 from checking to savings',   mode: 'both', tool: 'create_transfer' },
  { id: 'bk5',  label: 'Deposit',                     message: 'deposit $50 into savings',                 mode: 'both', tool: 'create_deposit' },
  { id: 'bk6',  label: 'Withdraw',                    message: 'withdraw $40 from checking',               mode: 'both', tool: 'create_withdrawal' },
  { id: 'bk7',  label: 'My mortgage',                 message: 'show my mortgage',                         mode: 'both', tool: 'show_mortgage' },
  { id: 'bk8',  label: 'Biggest spending categories', message: 'What are my biggest categories',           mode: 'both' },
  { id: 'bk9',  label: 'Check for unusual patterns',  message: 'Check for unusual patterns',               mode: 'llm' },
  { id: 'bk10', label: 'Can I afford a big expense?', message: 'Could my savings cover a big upcoming expense?', mode: 'llm' },
];

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
  // True when there's no usable access token (same signal as the TopNav "No
  // token — please sign in" pill). Distinguishes "not signed in" from a real
  // authorize outage so the chips prompt sign-in instead of a misleading error.
  needsSignIn = false,
  onDeniedChip,
}) {
  const { pageManifest } = useVertical();
  const dashboard = pageManifest?.dashboard;
  const handleSignIn = () => {
    const returnTo =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/dashboard";
    window.location.href = `/api/auth/oauth/user/login?return_to=${encodeURIComponent(
      returnTo,
    )}`;
  };
  // chipPermState (shared with SecurityShowcasePanel) joins a chip with the live
  // Authorize-filtered tool list — see utils/chipPermissions.js.
  const permState = (chip) => chipPermState(chip, toolPermissions, toolsError);
  // Always render a chip set: use the manifest's chips10 when present, else the
  // baked-in DEFAULT_CHIPS10 fallback so the dropdown is never empty even when
  // the vertical manifest failed to load (auth blip, network error, cold start).
  const chips10 = Array.isArray(dashboard?.chips10) && dashboard.chips10.length
    ? dashboard.chips10
    : DEFAULT_CHIPS10;


  const handleChipClick = (chip, requiresLlm = false) => {
    if (onChipClick) {
      onChipClick({ message: chip.message, label: chip.label, requiresLlm, chipId: chip.id, direct: chip.direct });
    }
  };

  return (
    <div className="banking-chips-content">
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
      {user?.role === 'admin' && (
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
      {/* Curated 10-chip Suggestions section (vertical manifest chips10).
          Renders INSTEAD of the legacy Quick Actions + Advanced Analysis split.
          `both` chips → heuristic-eligible (requiresLlm=false). `llm` chips →
          requiresLlm=true and are disabled when no LLM provider is available. */}
      {chips10 && (
        <div className="banking-chips-dropdown__section">
          <div className="banking-chips-dropdown__label">
            {pageManifest?.identity?.displayName
              ? `${pageManifest.identity.displayName} Actions`
              : 'Suggestions'}
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
            {chips10.map((chip) => {
              const isDirect = chip.mode === "direct";
              const isLlm = chip.mode === "llm";
              const llmDisabled = isLlm && !llmAvailable;
              const perm = permState(chip);
              // Vertical-foreign tool (absent from the live list) → don't render.
              if (!perm.show) return null;
              const deniedReason = perm.denied
                ? (perm.reason || "not permitted by Authorize for the current scope")
                : null;
              return (
                <button
                  type="button"
                  key={chip.id}
                  data-chip-id={chip.id}
                  className={`banking-chips-dropdown__button banking-chips-dropdown__button--${isDirect ? "direct" : isLlm ? "llm" : "heuristic"}${perm.denied ? " banking-chips-dropdown__button--denied" : ""}${perm.unverified ? " banking-chips-dropdown__button--unverified" : ""}`}
                  onClick={() => {
                    if (perm.denied) {
                      if (onDeniedChip) onDeniedChip({ id: chip.id, label: chip.label, tool: chip.tool }, deniedReason);
                      return;
                    }
                    handleChipClick(
                      { id: chip.id, label: chip.label, message: chip.message, direct: isDirect },
                      isLlm,
                    );
                  }}
                  aria-disabled={perm.denied || undefined}
                  disabled={isLoading || llmDisabled || perm.unverified}
                  title={
                    perm.unverified
                      ? needsSignIn
                        ? "Sign in to use these actions."
                        : "Authorize unavailable — couldn't reach PingOne or the demo authorize server. Retry shortly."
                      : perm.denied
                      ? `Denied by Authorize: ${deniedReason}`
                      : isDirect
                      ? `${chip.message} — calls MCP server directly, no gateway auth`
                      : llmDisabled
                      ? "Needs an LLM — switch to llama.cpp, Anthropic, or Helix mode"
                      : chip.hitlTrigger && chip.elicitationTrigger
                      ? `${chip.message} — requires consent, identity verification, and may request additional input`
                      : chip.hitlTrigger
                      ? `${chip.message} — requires consent + identity verification`
                      : chip.elicitationTrigger
                      ? `${chip.message} — may request additional user input or authorization during execution`
                      : chip.message
                  }
                >
                  {chip.label}
                  {isDirect && (
                    <span className="banking-chips-dropdown__mcp-badge">MCP</span>
                  )}
                  {isLlm && isHelixMode && (
                    <span className="banking-chips-dropdown__helix-badge">Helix</span>
                  )}
                  {isLlm && !isHelixMode && (
                    <span className="banking-chips-dropdown__mcp-badge">LLM</span>
                  )}
                  {chip.hitlTrigger && (
                    <span
                      className="banking-chips-dropdown__hitl-badge"
                      title="Requires consent + identity verification (MFA)"
                    >
                      <svg
                        className="banking-chips-dropdown__hitl-icon"
                        width="9"
                        height="11"
                        viewBox="0 0 9 11"
                        aria-hidden="true"
                      >
                        <path
                          d="M2.2 4.2V3a2.3 2.3 0 0 1 4.6 0v1.2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.1"
                        />
                        <rect x="1" y="4.2" width="7" height="5.8" rx="1.2" fill="currentColor" />
                      </svg>
                      MFA
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
            })}
          </div>
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
