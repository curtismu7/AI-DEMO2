// banking_api_ui/src/services/agentAccessConsent.js
/** Set when the user declines high-value consent; AI banking agent is disabled until the decline notice is dismissed. */
const STORAGE_KEY = 'banking_agent_blocked_consent_decline';

// In-memory flag is the actual source of truth — isAgentBlockedByConsentDecline
// reads THIS, never localStorage directly, so a later storage failure can't
// make the gate silently report "not blocked". localStorage is only a
// best-effort persistence layer for surviving reloads. If the initial read
// itself fails (storage inaccessible from the start — enterprise policy,
// privacy-hardening extension, sandboxed iframe), fail CLOSED: treat the
// agent as blocked until a decline/dismiss call establishes a real value.
let _memoryBlocked;
try {
  _memoryBlocked = localStorage.getItem(STORAGE_KEY) === 'true';
} catch {
  _memoryBlocked = true;
}

export function isAgentBlockedByConsentDecline() {
  return _memoryBlocked;
}

/** @param {boolean} blocked */
export function setAgentBlockedByConsentDecline(blocked) {
  _memoryBlocked = blocked;
  try {
    if (blocked) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort persistence only — the in-memory flag above is already
    // authoritative and unaffected by this failing.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bankingAgentConsentBlockChanged'));
  }
}

export const AGENT_CONSENT_BLOCK_USER_MESSAGE =
  'You declined to authorize a high-value transaction. The AI banking assistant is paused — dismiss the decline notice to keep using it.';
