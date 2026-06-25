// banking_api_ui/src/services/agentAccessConsent.js
/** Set when the user declines high-value consent; AI banking agent is disabled until sign-out. */
const STORAGE_KEY = 'banking_agent_blocked_consent_decline';

export function isAgentBlockedByConsentDecline() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** @param {boolean} blocked */
export function setAgentBlockedByConsentDecline(blocked) {
  try {
    if (blocked) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bankingAgentConsentBlockChanged'));
  }
}

export const AGENT_CONSENT_BLOCK_USER_MESSAGE =
  'You declined to authorize a high-value transaction. The AI banking assistant is not available for this session. Sign out and sign in again if you need the assistant.';
