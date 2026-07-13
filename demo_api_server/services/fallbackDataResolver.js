const nlIntentParser = require('./nlIntentParser');

let fallbackChipsLoader;
try {
  fallbackChipsLoader = require('../config/fallback-chips/loader');
} catch (e) {
  // fallbackChipsLoader not yet available; will be provided by tests via mock
  fallbackChipsLoader = null;
}

/**
 * Resolve which vertical's fallback chips to use based on user prompt intent
 * @param {string} userPrompt - User's most recent message
 * @param {object} verticalCtx - Current vertical context (may be undefined/invalid)
 * @returns {object} { chips: Chip[], verticalId: string, isFallback: true }
 */
async function resolveFallbackChips(userPrompt, verticalCtx = {}) {
  try {
    // Try to parse intent from the prompt to detect vertical
    const intent = nlIntentParser.parseForFallback(userPrompt, verticalCtx);

    // Extract vertical from intent result
    const detectedVertical = intent.vertical || inferVerticalFromIntent(intent);

    // Load fallback chips for detected vertical
    const verticalToUse = detectedVertical || 'banking';
    if (!fallbackChipsLoader) {
      console.warn('[fallback] fallbackChipsLoader not available; using mock fallback');
      return {
        chips: createMockChips(verticalToUse, userPrompt),
        verticalId: verticalToUse,
        isFallback: true,
        detectionMethod: intent.vertical ? 'parsed' : 'inferred',
      };
    }

    const chips = await fallbackChipsLoader.loadFallbackChips(verticalToUse);

    return {
      chips,
      verticalId: verticalToUse,
      isFallback: true,
      detectionMethod: intent.vertical ? 'parsed' : 'inferred',
    };
  } catch (error) {
    // Fallback to banking if anything fails
    console.warn('[fallback] Error detecting vertical, using banking default:', error.message);

    if (!fallbackChipsLoader) {
      return {
        chips: createMockChips('banking', userPrompt),
        verticalId: 'banking',
        isFallback: true,
        detectionMethod: 'default',
      };
    }

    const chips = await fallbackChipsLoader.loadFallbackChips('banking');
    return {
      chips,
      verticalId: 'banking',
      isFallback: true,
      detectionMethod: 'default',
    };
  }
}

/**
 * Create mock chips for testing when fallbackChipsLoader is not available
 */
function createMockChips(verticalId, userPrompt) {
  const verticalChips = {
    banking: [
      { tool: 'create_transfer', message: 'Transfer funds between accounts', label: 'Transfer' },
      { tool: 'get_balance', message: 'Check your account balance', label: 'Balance' },
      { tool: 'get_transactions', message: 'View recent transactions', label: 'Transactions' },
    ],
    retail: [
      { tool: 'view_orders', message: 'View my orders', label: 'My Orders' },
      { tool: 'track_order', message: 'Track an order', label: 'Track Order' },
      { tool: 'cancel_order', message: 'Cancel an order', label: 'Cancel' },
    ],
    'sporting-goods': [
      { tool: 'redeem_points', message: 'Redeem reward points', label: 'Redeem Points' },
      { tool: 'view_orders', message: 'View my gear orders', label: 'My Orders' },
      { tool: 'check_membership', message: 'Check membership status', label: 'Membership' },
    ],
    government: [
      { tool: 'apply_benefit', message: 'Apply for a benefit', label: 'Apply Benefit' },
      { tool: 'document_request', message: 'Request documents', label: 'Documents' },
      { tool: 'permit_status', message: 'Check permit status', label: 'Permits' },
    ],
    workforce: [
      { tool: 'submit_timesheet', message: 'Submit timesheet', label: 'Timesheet' },
      { tool: 'request_leave', message: 'Request time off', label: 'Time Off' },
      { tool: 'view_pay_stub', message: 'View pay stub', label: 'Pay Stub' },
    ],
    university: [
      { tool: 'view_grades', message: 'View my grades', label: 'Grades' },
      { tool: 'enroll_course', message: 'Enroll in a course', label: 'Enroll' },
      { tool: 'view_transcript', message: 'View transcript', label: 'Transcript' },
    ],
    manufacturing: [
      { tool: 'order_status', message: 'Check order status', label: 'Order Status' },
      { tool: 'schedule_maintenance', message: 'Schedule maintenance', label: 'Maintenance' },
      { tool: 'view_inventory', message: 'View inventory', label: 'Inventory' },
    ],
  };

  return verticalChips[verticalId] || verticalChips.banking;
}

/**
 * Infer vertical from parsed intent when direct vertical detection fails
 */
function inferVerticalFromIntent(intent) {
  // Map parsed intent kinds/actions to vertical IDs
  if (!intent || intent.kind === 'none') return null;

  const intentToVerticalMap = {
    'banking': 'banking',
    'education': 'banking', // education intents use banking vertical for now
    'retail-cancel-order': 'retail',
    'retail-view-orders': 'retail',
    'retail-apply-coupon': 'retail',
    'retail-list-payments': 'retail',
    'sg-redeem-points': 'sporting-goods',
    'sg-cancel-order': 'sporting-goods',
    'sg-list-payments': 'sporting-goods',
    'gov-apply-benefit': 'government',
    'gov-document-request': 'government',
    'workforce-directory': 'workforce',
    'workforce-timesheet': 'workforce',
    'university-grades': 'university',
    'university-courses': 'university',
    'manufacturing-order-status': 'manufacturing',
  };

  // Use intent.action or intent.kind as key
  const intentKey = intent.action || intent.kind;
  return intentToVerticalMap[intentKey] || null;
}

module.exports = {
  resolveFallbackChips,
  inferVerticalFromIntent,
};
