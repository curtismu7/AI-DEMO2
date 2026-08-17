/**
 * Shared sessionStorage key constants for the launcher → AIAgent deep-link.
 * Both UseCaseLauncherPage (writer) and AIAgent (reader/claimer) must use
 * these — a rename here catches both sides at build time.
 */

/** NL message to replay after customer OAuth redirect from the launcher. */
export const BX_AGENT_PENDING_NL_KEY = 'bx_agent_pending_nl';

/** useCaseId stored by UseCaseLauncherPage alongside the pending NL (for A2.1/A2.2 stamping). */
export const BX_AGENT_PENDING_UC_ID_KEY = 'bx_agent_pending_uc_id';

/**
 * Feature flags the pending step needs, as a JSON array. Arming is admin-gated,
 * so a step queued while signed out cannot arm until login lands — and login is
 * a full OAuth redirect, so a React ref does not survive to see it.
 */
export const BX_AGENT_PENDING_FLAGS_KEY = 'bx_agent_pending_flags';

/**
 * Auth level the pending step still needs ('user' | 'admin'). Persisted for the
 * same reason as the flags: without it the resume effect cannot tell a step that
 * is waiting for a session from one that may run as a guest, and on a
 * guest-chat surface it fires during hydration — before the session it waited for.
 */
export const BX_AGENT_PENDING_AUTH_KEY = 'bx_agent_pending_auth';
