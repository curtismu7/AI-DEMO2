/**
 * copilotClient.js — browser-side bridge to a Microsoft Copilot Studio agent.
 *
 * Part 2 of the Copilot Studio round-trip (our-app -> Copilot). Isolated from the
 * banking agent: this module owns the Entra (MSAL) sign-in and the Copilot Studio
 * client. The PingOne side is untouched.
 *
 * Flow: MSAL interactive/silent sign-in -> acquire an Entra access token for the
 * Copilot Studio scope -> construct a CopilotStudioClient -> start a conversation
 * and exchange messages.
 *
 * All config values are public (non-secret) and arrive via loadPublicConfig()
 * (the /api/admin/config -> IndexedDB path). The Entra app registration + the
 * published Copilot agent are created out-of-band (see COPILOT_SETUP.md).
 */

import { PublicClientApplication } from '@azure/msal-browser';
import {
  ConnectionSettings,
  CopilotStudioClient,
  PowerPlatformCloud,
} from '@microsoft/agents-copilotstudio-client';

/** Config keys (public) read from loadPublicConfig(). */
const COPILOT_CONFIG_KEYS = [
  'copilot_entra_client_id',
  'copilot_entra_tenant_id',
  'copilot_environment_id',
  'copilot_agent_schema_name',
];

/** True when every value needed to reach the Copilot agent is present. */
export function isCopilotConfigured(cfg) {
  if (!cfg) return false;
  return COPILOT_CONFIG_KEYS.every((k) => typeof cfg[k] === 'string' && cfg[k].trim() !== '');
}

function buildConnectionSettings(cfg) {
  const settings = new ConnectionSettings();
  settings.environmentId = cfg.copilot_environment_id;
  settings.schemaName = cfg.copilot_agent_schema_name;
  settings.cloud = PowerPlatformCloud.Prod;
  return settings;
}

// One MSAL instance per clientId for the page lifetime (MSAL caches accounts).
let _msal = null;
let _msalClientId = null;

async function getMsal(cfg) {
  const clientId = cfg.copilot_entra_client_id;
  const authority = `https://login.microsoftonline.com/${cfg.copilot_entra_tenant_id}`;
  if (_msal && _msalClientId === clientId) return _msal;
  _msal = new PublicClientApplication({
    auth: {
      clientId,
      authority,
      // Must exactly match a Redirect URI on the Entra app registration (SPA platform).
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await _msal.initialize();
  _msalClientId = clientId;
  return _msal;
}

/**
 * Sign in with Entra (silent if possible, interactive popup otherwise) and return
 * a connected CopilotStudioClient plus the signed-in account.
 */
export async function signInAndCreateClient(cfg) {
  if (!isCopilotConfigured(cfg)) {
    throw new Error('copilot_not_configured');
  }
  const msal = await getMsal(cfg);
  const settings = buildConnectionSettings(cfg);
  const scope = CopilotStudioClient.scopeFromSettings(settings);

  let account = msal.getActiveAccount() || msal.getAllAccounts()[0] || null;
  if (!account) {
    const login = await msal.loginPopup({ scopes: [scope] });
    account = login.account;
    msal.setActiveAccount(account);
  }

  let tokenResult;
  try {
    tokenResult = await msal.acquireTokenSilent({ account, scopes: [scope] });
  } catch {
    tokenResult = await msal.acquireTokenPopup({ account, scopes: [scope] });
  }

  const client = new CopilotStudioClient(settings, tokenResult.accessToken);
  return { client, account };
}

/** Extract the conversationId carried on a Bot Framework Activity array. */
export function conversationIdFrom(activities) {
  for (const a of activities || []) {
    if (a?.conversation?.id) return a.conversation.id;
  }
  return undefined;
}

/** Reduce an Activity array to the renderable assistant message texts. */
export function messageTextsFrom(activities) {
  return (activities || [])
    .filter((a) => a?.type === 'message' && typeof a.text === 'string' && a.text.trim() !== '')
    .map((a) => a.text);
}

/** Sign out of the Entra session for the active account (best-effort). */
async function signOut(cfg) {
  try {
    if (!_msal) return;
    const account = _msal.getActiveAccount() || _msal.getAllAccounts()[0];
    if (account) await _msal.clearCache({ account });
  } catch {
    /* best-effort */
  }
}
