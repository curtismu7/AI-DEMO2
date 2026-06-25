// banking_api_ui/src/services/errorHandler.js
/**
 * Dual-layer error formatter for agent banking actions.
 *
 * formatAgentError(err)    → { userMessage, technicalDetail, recoverySteps, docLink }
 * getErrorRecoverySteps(code) → { title, steps[], docLink? }
 *
 * User layer:  concise, non-technical sentence shown first.
 * Technical:   error code / status / detail for debugging.
 * Recovery:    step-by-step instructions the user can act on.
 */

/** Friendly message and recovery for known error codes. */
const ERROR_MAP = {
  // Token exchange errors
  insufficient_scope: {
    userMessage: "Agent couldn't complete this action. Your token is missing the required scope.",
    technicalDetail: (err) => `Token exchange error: insufficient_scope — ${err.message || 'scope not present on user token'}`,
    steps: [
      'Sign out and sign in again to refresh your token.',
      'Ensure your PingOne user app has the required banking scopes configured.',
      'If the problem persists, check the Agent Config tab for scope settings.',
    ],
  },
  invalid_grant: {
    userMessage: "Agent action failed — your session has expired or the token is no longer valid.",
    technicalDetail: (err) => `Token exchange error: invalid_grant — ${err.message || 'token expired or revoked'}`,
    steps: [
      'Click "Refresh" in the agent panel to renew your session.',
      "If refresh fails, sign out and sign back in.",
      'Then retry the agent action.',
    ],
  },
  exchange_failed: {
    userMessage: "Agent couldn't exchange your token with PingOne. Check your PingOne configuration.",
    technicalDetail: (err) => `RFC 8693 token exchange failed — ${err.message || 'PingOne returned an error'}`,
    steps: [
      'Verify AGENT_OAUTH_CLIENT_ID and AGENT_OAUTH_CLIENT_SECRET are set in Config.',
      'Confirm the MCP Resource Server audience matches MCP_RESOURCE_URI in Config.',
      'Check that your user token includes a valid may_act claim (go to /demo-data → Enable may_act).',
    ],
  },
  // MCP tool errors
  tool_not_found: {
    userMessage: "The agent tried to call a tool that isn't available on the MCP server.",
    technicalDetail: (err) => `MCP error: tool_not_found — ${err.message || 'tool name not in server registry'}`,
    steps: [
      'Restart the MCP server and retry.',
      'Check PINGONE_MCP_SERVER_URL in Config points to the correct MCP server.',
    ],
  },
  tool_call_failed: {
    userMessage: "The agent's tool call to the banking API failed.",
    technicalDetail: (err) => `MCP tool call error — ${err.message || 'banking operation returned an error'}`,
    steps: [
      'Check the agent error detail above for specific banking API info.',
      'Retry the action. If it fails repeatedly, try the equivalent manual transaction.',
    ],
  },
  // Banking API errors
  insufficient_funds: {
    userMessage: "The agent couldn't complete this transfer — insufficient funds in the account.",
    technicalDetail: (err) => `Banking API: insufficient_funds — ${err.message || 'account balance too low'}`,
    steps: [
      'Check your account balance on the dashboard.',
      'Reduce the transfer amount or choose a different source account.',
    ],
  },
  account_not_found: {
    userMessage: "The account referenced in this transaction couldn't be found.",
    technicalDetail: (err) => `Banking API: account_not_found — ${err.message || 'account ID not found'}`,
    steps: [
      'Refresh the dashboard to reload your current accounts.',
      'Make sure the destination account ID is correct and try again.',
    ],
  },
  // Auth / permission errors
  unauthorized: {
    userMessage: "Agent action wasn't authorized. You may need to sign in again.",
    technicalDetail: (err) => `Auth error: unauthorized (401) — ${err.message || 'no valid session'}`,
    steps: [
      'Click "Sign in" in the agent panel.',
      'After signing in, retry the agent action.',
    ],
  },
  forbidden: {
    userMessage: "The agent doesn't have permission to perform this action.",
    technicalDetail: (err) => `Auth error: forbidden (403) — ${err.message || 'insufficient permissions'}`,
    steps: [
      'Check that your account has the required scopes for this banking operation.',
      'In the Feature Flags page, ensure the relevant agent flags are enabled.',
      'Contact your admin if the issue persists.',
    ],
  },
  // Network / timeout
  network_error: {
    userMessage: "Agent couldn't reach the banking server. Check your connection.",
    technicalDetail: (err) => `Network error — ${err.message || 'request timed out or network unavailable'}`,
    steps: [
      'Check your internet connection.',
      'Verify the MCP server is running (check PINGONE_MCP_SERVER_URL in Config).',
      'Retry in a moment.',
    ],
  },
};

const DOC_LINK = '/feature-flags';

/**
 * Detect the error code from an error object.
 * Checks: err.code, err.response?.data?.code, HTTP status, message keywords.
 * @param {Error & { code?: string; response?: { status?: number; data?: { code?: string; error?: string } } }} err
 * @returns {string} Known error code or 'unknown'
 */
function detectErrorCode(err) {
  const code = err?.code
    || err?.response?.data?.code
    || err?.response?.data?.error
    || '';

  if (code) {
    const c = code.toLowerCase().replace(/-/g, '_');
    if (c in ERROR_MAP) return c;
  }

  const status = err?.response?.status || err?.status;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';

  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('insufficient_scope') || msg.includes('insufficient scope')) return 'insufficient_scope';
  if (msg.includes('invalid_grant'))      return 'invalid_grant';
  if (msg.includes('insufficient funds')) return 'insufficient_funds';
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused')) return 'network_error';
  if (msg.includes('tool') && msg.includes('not found')) return 'tool_not_found';
  if (msg.includes('exchange')) return 'exchange_failed';

  return 'unknown';
}

/**
 * Get structured recovery steps for a known error code.
 * @param {string} code
 * @returns {{ title: string; steps: string[]; docLink: string }}
 */
export function getErrorRecoverySteps(code) {
  const entry = ERROR_MAP[code] || null;
  if (!entry) {
    return {
      title: 'How to troubleshoot',
      steps: [
        'Check the technical details above for more info.',
        'Try the equivalent manual transaction from the dashboard.',
        'Refresh your session (click Refresh in the agent panel).',
        'If the issue persists, check the Feature Flags page for relevant settings.',
      ],
      docLink: DOC_LINK,
    };
  }
  return {
    title: 'How to fix this',
    steps: entry.steps,
    docLink: DOC_LINK,
  };
}

/**
 * Format an agent error into three display layers.
 * @param {Error & { code?: string; response?: any }} err
 * @returns {{ userMessage: string; technicalDetail: string; recoverySteps: { title: string; steps: string[]; docLink: string } }}
 */
export function formatAgentError(err) {
  const code = detectErrorCode(err);
  const entry = ERROR_MAP[code];

  const userMessage = entry
    ? entry.userMessage
    : "Agent couldn't complete this action. Check your token configuration or try manually.";

  const technicalDetail = entry
    ? entry.technicalDetail(err)
    : `Unexpected error: ${err?.message || 'Unknown error'} (code: ${err?.code || err?.response?.status || 'none'})`;

  const recoverySteps = getErrorRecoverySteps(code);

  return { userMessage, technicalDetail, recoverySteps };
}
