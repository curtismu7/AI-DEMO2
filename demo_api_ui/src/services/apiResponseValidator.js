/**
 * apiResponseValidator.js
 * Safely validates API responses before accessing properties.
 * Prevents crashes from malformed or unexpected API data.
 */

/**
 * Safely extract and validate accounts list from API response.
 * @param {any} data - Raw API response data
 * @param {number} maxAccounts - Maximum accounts to accept (safety limit)
 * @returns {array|null} - Validated accounts array or null
 */
export function extractAccounts(data, maxAccounts = 100) {
  try {
    if (!data || typeof data !== 'object') {
      console.warn('[ApiValidation] Invalid response structure');
      return null;
    }

    const accounts = data.accounts;
    if (!Array.isArray(accounts)) {
      console.warn('[ApiValidation] Accounts is not an array:', typeof accounts);
      return null;
    }

    if (accounts.length > maxAccounts) {
      console.warn(`[ApiValidation] Account count exceeds limit: ${accounts.length} > ${maxAccounts}`);
      return accounts.slice(0, maxAccounts);
    }

    // Validate each account has required fields
    const validated = accounts.filter((acc) => {
      if (!acc || typeof acc !== 'object') {
        console.warn('[ApiValidation] Invalid account entry:', acc);
        return false;
      }
      if (!acc.id) {
        console.warn('[ApiValidation] Account missing id:', acc);
        return false;
      }
      return true;
    });

    return validated;
  } catch (err) {
    console.error('[ApiValidation] Error extracting accounts:', err.message);
    return null;
  }
}

/**
 * Safely normalize an account object with defaults.
 * @param {object} account - Raw account object from API
 * @returns {object} - Normalized account with safe defaults
 */
export function normalizeAccount(account) {
  if (!account || typeof account !== 'object') {
    return null;
  }

  try {
    return {
      id: String(account.id || '').trim() || `account-${Date.now()}`,
      name: String(account.name || account.accountType || 'Account')
        .trim()
        .substring(0, 100),
      type: String(account.accountType || account.account_type || 'checking')
        .toLowerCase()
        .trim(),
      balance: Number(account.balance) || 0,
      accountNumber: String(
        account.accountNumber || account.account_number || account.id || ''
      )
        .substring(0, 20)
        .trim(),
    };
  } catch (err) {
    console.error('[ApiValidation] Error normalizing account:', err.message);
    return null;
  }
}

/**
 * Safely extract and validate transactions list from API response.
 * @param {any} data - Raw API response data
 * @param {number} maxTransactions - Maximum transactions to accept
 * @returns {array|null} - Validated transactions array or null
 */
export function extractTransactions(data, maxTransactions = 500) {
  try {
    if (!data || typeof data !== 'object') {
      console.warn('[ApiValidation] Invalid response structure for transactions');
      return null;
    }

    const transactions = data.transactions;
    if (!Array.isArray(transactions)) {
      console.warn('[ApiValidation] Transactions is not an array:', typeof transactions);
      return null;
    }

    if (transactions.length > maxTransactions) {
      console.warn(
        `[ApiValidation] Transaction count exceeds limit: ${transactions.length} > ${maxTransactions}`
      );
      return transactions.slice(0, maxTransactions);
    }

    return transactions;
  } catch (err) {
    console.error('[ApiValidation] Error extracting transactions:', err.message);
    return null;
  }
}

/**
 * Validate HTTP response before processing.
 * @param {Response} response - Fetch Response object
 * @param {string} endpoint - Endpoint name (for logging)
 * @returns {object} - { isValid: boolean, error?: string, status: number }
 */
export function validateHttpResponse(response, endpoint = 'unknown') {
  if (!response) {
    return {
      isValid: false,
      error: 'No response',
      status: 0,
    };
  }

  if (!(response instanceof Response)) {
    return {
      isValid: false,
      error: 'Invalid response object',
      status: 0,
    };
  }

  if (!response.ok) {
    return {
      isValid: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
    };
  }

  return {
    isValid: true,
    status: response.status,
  };
}

/**
 * Safe JSON parsing of response body.
 * @param {Response} response - Fetch Response object
 * @param {string} endpoint - Endpoint name (for logging)
 * @returns {Promise<object|null>} - Parsed JSON or null on error
 */
export async function safeResponseJson(response, endpoint = 'unknown') {
  try {
    const text = await response.text();
    if (!text) {
      console.warn(`[ApiValidation] Empty response from ${endpoint}`);
      return null;
    }
    return JSON.parse(text);
  } catch (err) {
    console.error(`[ApiValidation] Failed to parse ${endpoint} response:`, err.message);
    return null;
  }
}

const apiResponseValidator = {
  extractAccounts,
  normalizeAccount,
  extractTransactions,
  validateHttpResponse,
  safeResponseJson,
};

export default apiResponseValidator;
