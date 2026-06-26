/**
 * configService.js — IndexedDB caching layer for non-secret config values.
 *
 * Secrets are NEVER stored here.  Only PUBLIC_FIELDS are persisted to
 * IndexedDB so that the Config form can be pre-filled on the next page load
 * without waiting for the server round-trip.
 *
 * The server remains the source of truth; this is purely a convenience cache.
 */

import bffAxios from './bffAxios';


const DB_NAME    = 'banking-assistant-config';
const STORE_NAME = 'config';
const DB_VERSION = 1;

/** Fields safe to cache in IndexedDB (no secrets). */
export const PUBLIC_FIELDS = [
  'pingone_environment_id',
  'pingone_region',
  'admin_client_id',
  'admin_redirect_uri',
  'user_client_id',
  'user_redirect_uri',
  'admin_role',
  'user_role',
  'debug_oauth',
  'frontend_url',
  'mcp_server_url',
  'ui_industry_preset',
  'agent_mcp_allowed_scopes',
  'marketing_customer_login_mode',
  'marketing_demo_username_hint',
  'marketing_demo_password_hint',
  'show_education_panel',
  'enable_token_chain_display',
  'agent_ui_mode',
  'demo_scenario',
  'industry_id',
  'agent_transaction_count_limit',
  'agent_transaction_value_limit',
  'log_level',
  'debug_show_token_details',
  'debug_show_api_calls',
  'log_filter_categories',
  'copilot_mode_enabled',
  'copilot_entra_client_id',
  'copilot_entra_tenant_id',
  'copilot_environment_id',
  'copilot_agent_schema_name',
];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

/** Persist public fields from a config object to IndexedDB. */
export async function savePublicConfig(data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const field of PUBLIC_FIELDS) {
        if (data[field] !== undefined && data[field] !== null) {
          store.put({ key: field, value: data[field] });
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch (_) {
    // IndexedDB unavailable (private browsing, etc.) — silently ignore
  }
}

/** Load all cached public config values from IndexedDB. */
export async function loadPublicConfig() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx     = db.transaction(STORE_NAME, 'readonly');
      const store  = tx.objectStore(STORE_NAME);
      const result = {};
      const req    = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          result[cursor.value.key] = cursor.value.value;
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return {};
  }
}

/** Wipe the IndexedDB cache (e.g. on reset). */
export async function clearConfig() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch (_) {
    // ignore
  }
}

/**
 * Hostname Configuration API — manages runtime BFF hostname
 */

/**
 * Hostname validation regex
 * Matches: https?://domain(:port)?
 */
const HOSTNAME_REGEX = /^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?$/;

/**
 * Validates hostname format on the client side
 * @param {string} hostname - hostname to validate
 * @throws {Error} if validation fails
 */
function validateHostnameFormat(hostname) {
  if (typeof hostname !== 'string' || !hostname.trim()) {
    throw new Error('Hostname cannot be empty');
  }

  if (!hostname.includes('://')) {
    throw new Error('Hostname must include protocol (https:// or http://)');
  }

  if (!HOSTNAME_REGEX.test(hostname)) {
    throw new Error(
      'Invalid hostname format. Expected: https://domain.com or https://localhost:4000'
    );
  }

  // Validate port if present
  const portMatch = hostname.match(/:(\d+)$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (port < 1 || port > 65535) {
      throw new Error(`Port must be between 1 and 65535, got ${port}`);
    }
  }
}

/**
 * Fetch currently configured hostname from backend
 * @returns {Promise<string>} hostname (e.g., 'https://demo-api-server:3001')
 * @throws {Error} if API request fails
 */
export const getHostname = async () => {
  try {
    const response = await bffAxios.get('/api/admin/config/hostname');
    return response.data.hostname;
  } catch (error) {
    const message = error.response?.data?.error || error.message;
    throw new Error(`Failed to fetch hostname: ${message}`);
  }
};

/**
 * Update configured hostname on backend
 * Validates hostname format locally before sending to server
 * @param {string} hostname - new hostname with protocol and optional port
 * @returns {Promise<string>} updated hostname
 * @throws {Error} if hostname validation fails or API error occurs
 */
export const setHostname = async (hostname) => {
  // Validate locally first
  validateHostnameFormat(hostname);

  try {
    const response = await bffAxios.put('/api/admin/config/hostname', { hostname });
    return response.data.hostname;
  } catch (error) {
    // Handle API validation errors (400 responses)
    if (error.response?.status === 400) {
      const apiError = error.response.data?.error || 'Invalid hostname format';
      throw new Error(apiError);
    }
    // Handle other API errors
    if (error.response?.status === 500) {
      throw new Error('Server error while updating hostname. Please try again.');
    }
    // Handle network errors
    throw new Error(`Failed to update hostname: ${error.message}`);
  }
};

export const validateHostname = validateHostnameFormat;
