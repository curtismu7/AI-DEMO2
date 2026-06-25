/**
 * Client-side Service for LangChain Banking Agent
 * Handles HTTP calls to agent API + HITL consent flow
 */

/**
 * Initialize agent executor on app load
 * Called once per authenticated session
 */
export async function initAgent() {
  try {
    const response = await fetch('/api/demo-agent/init', {
      method: 'POST',
      credentials: 'include', // Send cookies (session)
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to init agent: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[initAgent] Error:', error);
    throw error;
  }
}

/**
 * Send user message to agent
 * Returns agent response or HITL consent request
 *
 * @param {string} message - User message
 * @param {string} consentId - Optional consent ID for resuming after approval
 * @returns {Promise<{success, message?, hitlRequired?, consentId?, reason?, operation?, error?}>}
 */
export async function sendMessage(message, consentId = null, { signal } = {}) {
  try {
    const body = { message };
    if (consentId) {
      body.consentId = consentId;
    }

    const response = await fetch('/api/demo-agent/message', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    // 428 = HITL consent required
    if (response.status === 428) {
      const data = await response.json();
      return {
        success: false,
        hitlRequired: true,
        consentId: data.consentId,
        reason: data.reason,
        operation: data.operation,
        message: data.message,
      };
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: data.success,
      message: data.message,
      error: data.error,
      tokenEvents: data.tokenEvents || [],
    };
  } catch (error) {
    console.error('[sendMessage] Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Record user consent decision (approve or reject)
 *
 * @param {string} consentId - Consent request ID
 * @param {string} decision - 'approve' or 'reject'
 * @returns {Promise<{success, decision, message?}>}
 */
export async function recordConsent(consentId, decision) {
  try {
    if (!['approve', 'reject'].includes(decision)) {
      throw new Error(`Invalid decision: ${decision}. Must be 'approve' or 'reject'.`);
    }

    const response = await fetch('/api/demo-agent/consent', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consentId, decision }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Consent failed');
    }

    return await response.json();
  } catch (error) {
    console.error('[recordConsent] Error:', error);
    throw error;
  }
}

/**
 * Helper: Format token events for display
 */
export function formatTokenEvents(events) {
  if (!events || !Array.isArray(events)) {
    return [];
  }

  return events.map((evt) => ({
    type: evt.type,
    timestamp: new Date(evt.timestamp).toLocaleTimeString(),
    tool: evt.tool || null,
    actor: evt.actor || null,
    status: evt.status || evt.statusCode || null,
  }));
}

/**
 * Helper: Format consent operation for display
 */
export function formatOperation(operation) {
  if (!operation) return {};

  const { tool, params } = operation;
  return {
    tool,
    amount: params?.amount ? `$${params.amount.toFixed(2)}` : 'N/A',
    description: params?.description || '(No description)',
    fromAccount: params?.from_account_id || 'N/A',
    toAccount: params?.to_account_id || params?.account_id || 'N/A',
  };
}
