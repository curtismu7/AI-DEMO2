/**
 * transactionValidator.js
 * Validates transaction amounts and forms with proper bounds checking.
 * Prevents NaN and invalid transaction amounts.
 */

/**
 * Validate and parse transaction amounts with bounds checking.
 * @param {string|number} amount - Raw amount input
 * @param {number} maxAmount - Maximum allowed (default 1M)
 * @param {number} minAmount - Minimum allowed (default 0.01)
 * @returns {number|null} - Parsed amount or null if invalid
 */
export function parseTransactionAmount(amount, maxAmount = 1_000_000, minAmount = 0.01) {
  if (amount === null || amount === undefined || amount === '') {
    console.warn('[Transaction] Missing amount');
    return null;
  }

  const parsed = parseFloat(String(amount).trim());

  if (Number.isNaN(parsed)) {
    console.warn('[Transaction] Invalid amount (NaN):', amount);
    return null;
  }

  if (parsed < minAmount) {
    console.warn('[Transaction] Amount below minimum:', parsed, minAmount);
    return null;
  }

  if (parsed > maxAmount) {
    console.warn('[Transaction] Amount exceeds limit:', parsed, maxAmount);
    return null;
  }

  // Round to 2 decimal places (cents)
  const rounded = Math.round(parsed * 100) / 100;
  return rounded;
}

/**
 * Validate transaction form before submission.
 * @param {object} form - Form object with transaction details
 * @param {string} actionId - Action type (deposit, withdraw, transfer)
 * @returns {object} - { isValid: boolean, errors: string[] }
 */
export function validateTransactionForm(form, actionId) {
  const errors = [];

  if (!form || typeof form !== 'object') {
    errors.push('Form is required');
    return { isValid: false, errors };
  }

  // Validate amount
  const amount = parseTransactionAmount(form.amount);
  if (amount === null) {
    errors.push('Amount must be a valid number between $0.01 and $1,000,000');
  }

  // Validate from/to accounts based on action type
  if (actionId === 'deposit') {
    if (!form.accountId && !form.toId) {
      errors.push('Deposit account is required');
    }
  } else if (actionId === 'withdraw') {
    if (!form.accountId && !form.fromId) {
      errors.push('Withdrawal account is required');
    }
  } else if (actionId === 'transfer') {
    if (!form.fromId) {
      errors.push('Source account is required');
    }
    if (!form.toId) {
      errors.push('Destination account is required');
    }
    if (form.fromId === form.toId) {
      errors.push('Cannot transfer to the same account');
    }
  }

  // Validate note/description if present
  if (form.note && typeof form.note === 'string' && form.note.length > 500) {
    errors.push('Description must be under 500 characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if transaction amount exceeds a threshold.
 * @param {number} amount - Transaction amount in USD
 * @param {number} threshold - Threshold in USD
 * @returns {boolean}
 */
export function exceedsThreshold(amount, threshold) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return false;
  }
  if (typeof threshold !== 'number' || isNaN(threshold)) {
    return false;
  }
  return amount > threshold;
}

const transactionValidator = {
  parseTransactionAmount,
  validateTransactionForm,
  exceedsThreshold,
};

export default transactionValidator;
