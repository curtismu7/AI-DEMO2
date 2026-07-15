/**
 * runtimeSettings.js
 *
 * In-memory store for settings that can be changed at runtime via the admin UI
 * without restarting the server or editing .env files.
 *
 * Seeded from environment variables on startup. All writes are in-memory only
 * (survive for the lifetime of the process). Add persistence (file/DB) here
 * if you need settings to survive restarts.
 */

/** Parse a numeric env override; empty/unset → undefined so callers can apply a default. */
function envNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? undefined : n;
}

const settings = {
  // Step-up MFA — align with configStore STEP_UP_AMOUNT_THRESHOLD / mfa_threshold_usd ($500).
  // Previous `|| 0` made EVERY transfer MFA when the env var was unset (amount < 0 never wins).
  stepUpAmountThreshold: envNumber('STEP_UP_AMOUNT_THRESHOLD') ?? 500,
  stepUpAcrValue: process.env.STEP_UP_ACR_VALUE || 'Multi_Factor',
  // RFC 9470 freshness: require auth_time within this many seconds (0 = disabled)
  stepUpMaxAge: parseFloat(process.env.STEP_UP_MAX_AGE) || 0,
  // Default ON to match the feature flag registry default for step_up_enabled.
  // The boot seed (server.js) overrides this when a persisted value exists.
  stepUpEnabled: true,
  // Step-up method: 'ciba' (back-channel challenge) or 'email' (OIDC re-auth redirect)
  stepUpMethod: process.env.STEP_UP_METHOD || 'email',

  // Which transaction types require step-up
  stepUpTransactionTypes: ['transfer', 'withdrawal'],
  // When true, ALL withdrawals require step-up regardless of stepUpAmountThreshold
  stepUpWithdrawalsAlways: true,

  // Future: PingOne Authorize integration
  authorizeEnabled: false,
  authorizePolicyId: process.env.PINGONE_AUTHORIZE_POLICY_ID || '',
  // Hard limit for all transactions
  maxTransactionAmount: parseFloat(process.env.MAX_TRANSACTION_AMOUNT) || 1000,
  // Agent delegated transaction stop limits (0 = unlimited)
  agentTransactionCountLimit: parseFloat(process.env.AGENT_TRANSACTION_COUNT_LIMIT) || 0,
  agentTransactionValueLimit: parseFloat(process.env.AGENT_TRANSACTION_VALUE_LIMIT) || 0,
  pingonesMfaPolicyId: process.env.PINGONE_MFA_POLICY_ID || '',

  // AWS / Bedrock (EKS path — default OFF; mirrored from feature flags)
  bedrockGatewayEnabled: false,
  bedrockLlmEnabled: false,
};

// Change history kept in-memory for the admin UI audit trail
const changeHistory = [];

function get(key) {
  return settings[key];
}

function getAll() {
  return { ...settings };
}

/**
 * Update one or more settings.
 * @param {object} updates  - Partial settings object
 * @param {string} changedBy - Identity of the admin making the change
 */
function update(updates, changedBy = 'unknown') {
  const allowedKeys = new Set(Object.keys(settings));
  const applied = {};

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.has(key)) continue; // Ignore unknown keys

    // Type-coerce numeric fields
    if (
      key === 'stepUpAmountThreshold' ||
      key === 'stepUpMaxAge' ||
      key === 'maxTransactionAmount' ||
      key === 'agentTransactionCountLimit' ||
      key === 'agentTransactionValueLimit'
    ) {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed) || parsed < 0) continue;
      applied[key] = parsed;
    } else {
      applied[key] = value;
    }
  }

  if (Object.keys(applied).length === 0) return { updated: false, settings: getAll() };

  const before = { ...settings };
  Object.assign(settings, applied);

  changeHistory.unshift({
    timestamp: new Date().toISOString(),
    changedBy,
    changes: applied,
    previous: Object.fromEntries(Object.keys(applied).map(k => [k, before[k]])),
  });

  // Keep last 50 changes
  if (changeHistory.length > 50) changeHistory.length = 50;

  return { updated: true, settings: getAll() };
}

function getHistory() {
  return [...changeHistory];
}

module.exports = { get, getAll, update, getHistory };
