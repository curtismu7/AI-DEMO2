/**
 * Compliance Agent Service
 * HTTP bridge to Python Pydantic AI compliance checker on port 3007
 */

const http = require('http');

const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3007';

/**
 * Make HTTP request to Compliance Agent service
 */
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, COMPLIANCE_SERVICE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      // Fail fast if the Python compliance service accepts the socket but never
      // responds; without this the promise (and the Express handler) hangs forever.
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('compliance service request timed out'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Initialize compliance checking session
 */
async function initializeComplianceSession(userId) {
  try {
    const result = await makeRequest('POST', '/init', { user_id: userId });
    return result.data;
  } catch (error) {
    console.error('Compliance session init error:', error);
    throw error;
  }
}

/**
 * Process compliance check request
 * @param {Object} message - User message (unused, for consistency)
 * @param {Object} transaction - Transaction details
 * @param {string} userId - User ID
 * @param {Object} tokenEvents - Token chain events
 * @returns {Object} Compliance assessment with structured output
 */
async function processComplianceMessage(message, transaction, userId, tokenEvents = []) {
  // Get actual model from proxy configuration
  let llmModel = 'Claude 3.5 Sonnet';
  try {
    const { resolveLlmProvider } = require('./llmProviderResolver');
    const resolved = resolveLlmProvider({});
    if (resolved.model) llmModel = resolved.model;
  } catch {
    // Use default if resolution fails
  }

  try {
    // Build compliance request
    const request = {
      transaction: {
        amount: transaction.amount || 0,
        recipient: transaction.recipient || 'Unknown',
        recipient_account_type: transaction.recipientType || 'unknown',
        user_account_age_days: transaction.accountAgeDays || 0,
        user_recent_activity_score: transaction.activityScore || 50,
        is_recurring: transaction.isRecurring || false,
        time_of_day_utc: transaction.timeUtc || '12:00'
      },
      user_id: userId
    };

    // Call compliance service
    const result = await makeRequest('POST', '/assess', request);

    if (!result.data.success) {
      return {
        success: false,
        reply: `Compliance check failed: ${result.data.error}`,
        assessment: null,
        toolsCalled: [],
        tokenEvents,
        agentConfigured: true
      };
    }

    const assessment = result.data.data;

    // Build narrative reply based on assessment
    const reply = buildComplianceReply(assessment);

    return {
      success: true,
      reply,
      assessment,
      toolsCalled: ['compliance_rules_check'],
      tokenEvents,
      agentConfigured: true,
      agentHeader: `🤖 [COMPLIANCE CHECKER - Pydantic AI - ${llmModel}]`,
      metadata: {
        framework: 'Pydantic AI',
        model: llmModel,
        agentType: 'compliance-checker',
        service: 'Python/FastAPI'
      }
    };
  } catch (error) {
    console.error('Compliance check error:', error);
    return {
      success: false,
      reply: `Compliance service error: ${error.message}`,
      assessment: null,
      toolsCalled: [],
      tokenEvents,
      agentConfigured: true,
      agentHeader: `🤖 [COMPLIANCE CHECKER - Pydantic AI - ${llmModel}]`,
      metadata: {
        framework: 'Pydantic AI',
        model: llmModel,
        agentType: 'compliance-checker',
        service: 'Python/FastAPI'
      }
    };
  }
}

/**
 * Build a narrative response from compliance assessment
 */
function buildComplianceReply(assessment) {
  const { risk_level, aml_score, recommended_action, flags, requires_review } = assessment;

  let reply = `**Compliance Assessment**\n\n`;
  reply += `Risk Level: **${risk_level.toUpperCase()}**\n`;
  reply += `AML Score: ${aml_score.toFixed(1)}/100\n`;
  reply += `Recommended Action: **${recommended_action}**\n\n`;

  if (flags && flags.length > 0) {
    reply += `**Flags Raised:**\n`;
    flags.forEach(flag => {
      const severityEmoji = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
      }[flag.severity] || '⚪';

      reply += `${severityEmoji} ${flag.code}: ${flag.description}\n`;
    });
  } else {
    reply += `No compliance flags detected.\n`;
  }

  if (requires_review) {
    reply += `\n⚠️ **This transaction requires manual review.**`;
  }

  return reply;
}

module.exports = {
  initializeComplianceSession,
  processComplianceMessage
};
