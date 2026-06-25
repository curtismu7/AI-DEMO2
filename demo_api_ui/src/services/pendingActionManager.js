/**
 * pendingActionManager.js
 * Safe pending action storage with validation.
 * Prevents duplicate sessionStorage calls scattered across BankingAgent.js
 */

import sessionStorageService from './sessionStorageService';

const KEY = '_agent_pending_auth_action';

const PendingActionManager = {
  /**
   * Validate action has required fields and safe values.
   * @param {object} action - { actionId, form }
   * @returns {boolean}
   */
  isValid(action) {
    if (!action || typeof action !== 'object') {
      return false;
    }

    const { actionId, form } = action;

    // Validate actionId
    if (typeof actionId !== 'string' || actionId.length === 0 || actionId.length > 100) {
      return false;
    }

    // Validate form object
    if (!form || typeof form !== 'object') {
      return false;
    }

    // Check form doesn't contain sensitive data
    if (form.password || form.token || form.secret) {
      console.warn('[PendingAction] Form contains sensitive fields');
      return false;
    }

    return true;
  },

  /**
   * Persist action for auto-retry after OAuth callback.
   * @param {object} action - { actionId, form }
   * @returns {boolean} - True if stored successfully
   */
  save(action) {
    if (!this.isValid(action)) {
      console.error('[PendingAction] Invalid action structure:', action);
      return false;
    }

    const success = sessionStorageService.setItem(KEY, action);
    if (success) {
      console.debug('[PendingAction] Saved action:', action.actionId);
    }
    return success;
  },

  /**
   * Retrieve and clear pending action.
   * @returns {object|null} - { actionId, form } or null
   */
  restore() {
    const action = sessionStorageService.getItem(KEY, null);

    if (!action) {
      return null;
    }

    if (!this.isValid(action)) {
      console.warn('[PendingAction] Found invalid stored action, clearing');
      sessionStorageService.removeItem(KEY);
      return null;
    }

    // Clear after restore (one-time use)
    sessionStorageService.removeItem(KEY);
    console.debug('[PendingAction] Restored action:', action.actionId);
    return action;
  },

  /**
   * Clear any pending action without restoring.
   */
  clear() {
    sessionStorageService.removeItem(KEY);
  },

  /**
   * Check if a pending action exists without restoring it.
   * @returns {boolean}
   */
  hasPending() {
    const action = sessionStorageService.getItem(KEY, null);
    return this.isValid(action);
  },
};

export default PendingActionManager;
