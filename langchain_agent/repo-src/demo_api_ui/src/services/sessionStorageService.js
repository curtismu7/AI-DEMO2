/**
 * sessionStorageService.js
 * Safe sessionStorage operations with error logging and validation.
 * Prevents silent failures in auth/pending action persistence.
 */

const sessionStorageService = {
  /**
   * Set a value in sessionStorage with error handling.
   * @param {string} key - Storage key
   * @param {any} value - Value to store (auto-serialized if object)
   * @returns {boolean} - True if successful, false if failed
   */
  setItem(key, value) {
    if (!key || typeof key !== 'string') {
      console.error('[SessionStorage] Invalid key:', key);
      return false;
    }

    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);

      if (serialized.length > 5 * 1024 * 1024) {
        console.warn(`[SessionStorage] Value for key "${key}" exceeds 5MB limit (${serialized.length} bytes)`);
        return false;
      }

      sessionStorage.setItem(key, serialized);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.code === 22) {
        console.error(`[SessionStorage] Quota exceeded for key "${key}": ${err.message}`);
      } else if (err instanceof DOMException && err.code === 18) {
        console.error(`[SessionStorage] Private browsing mode or cookies disabled: ${err.message}`);
      } else {
        console.error(`[SessionStorage] Failed to set "${key}": ${err.message}`);
      }
      return false;
    }
  },

  /**
   * Get and parse a value from sessionStorage.
   * @param {string} key - Storage key
   * @param {any} fallback - Default if not found or parse fails
   * @returns {any} - Parsed value, raw string, or fallback
   */
  getItem(key, fallback = null) {
    if (!key || typeof key !== 'string') {
      console.error('[SessionStorage] Invalid key for getItem:', key);
      return fallback;
    }

    try {
      const item = sessionStorage.getItem(key);
      if (item === null) {
        return fallback;
      }

      // Try to parse as JSON first
      try {
        return JSON.parse(item);
      } catch {
        // Return raw string if JSON parse fails
        return item;
      }
    } catch (err) {
      console.error(`[SessionStorage] Failed to get "${key}": ${err.message}`);
      return fallback;
    }
  },

  /**
   * Remove a key from sessionStorage with error handling.
   * @param {string} key - Storage key
   * @returns {boolean} - True if successful or key didn't exist
   */
  removeItem(key) {
    if (!key || typeof key !== 'string') {
      console.error('[SessionStorage] Invalid key for removeItem:', key);
      return false;
    }

    try {
      sessionStorage.removeItem(key);
      return true;
    } catch (err) {
      console.error(`[SessionStorage] Failed to remove "${key}": ${err.message}`);
      return false;
    }
  },

  /**
   * Clear all keys with a specific prefix.
   * @param {string} prefix - Key prefix to clear (e.g., "_agent", "bx_")
   * @returns {number} - Number of keys cleared
   */
  clearNamespace(prefix) {
    if (!prefix || typeof prefix !== 'string') {
      console.error('[SessionStorage] Invalid prefix for clearNamespace:', prefix);
      return 0;
    }

    let clearedCount = 0;
    try {
      const keysToRemove = [];

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        try {
          sessionStorage.removeItem(key);
          clearedCount++;
        } catch (err) {
          console.warn(`[SessionStorage] Failed to clear key "${key}": ${err.message}`);
        }
      });

      return clearedCount;
    } catch (err) {
      console.error(`[SessionStorage] Failed to clear namespace "${prefix}": ${err.message}`);
      return clearedCount;
    }
  },

  /**
   * Check if sessionStorage is available and functional.
   * @returns {boolean} - True if sessionStorage is available
   */
  isAvailable() {
    try {
      const testKey = '__ss_test__';
      sessionStorage.setItem(testKey, 'test');
      sessionStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  },
};

export default sessionStorageService;
