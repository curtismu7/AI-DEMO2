const dataStore = require('../data/store');
const { emitHop } = require('../services/transactionHop');

// Known sensitive field names (case-insensitive) redacted from requestBody
// before it's persisted — mirrors the Authorization header redaction below.
const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'clientsecret',
  'client_secret',
  'workerclientsecret',
]);

const redactSensitiveFields = (body) => {
  if (!body || typeof body !== 'object') {
    return body;
  }
  const redacted = { ...body };
  for (const key of Object.keys(redacted)) {
    if (SENSITIVE_BODY_FIELDS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
};

const logActivity = (req, res, next) => {
  // Skip logging for static files and health checks
  if (req.path.startsWith('/static/') || req.path === '/health') {
    return next();
  }

  // Capture request details
  const originalSend = res.send;
  const startTime = Date.now();

  // Override res.send to capture response
  res.send = function(data) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Extract user information from token if available
    let userId = null;
    let username = null;
    let action = 'UNKNOWN';

    try {
      // For login requests, extract user info from response
      if ((req.originalUrl.includes('/auth/login') || req.originalUrl === '/login') && req.method === 'POST' && res.statusCode === 200) {
        try {
          const responseData = typeof data === 'string' ? JSON.parse(data) : data;
          if (responseData.user) {
            userId = responseData.user.id;
            username = responseData.user.username;
          }
        } catch (parseError) {
          console.error('Error parsing login response:', parseError);
        }
      } else if (req.user) {
        // For authenticated requests, use req.user
        userId = req.user.id;
        username = req.user.username;
      }

      // Determine action based on HTTP method and endpoint
      const method = req.method;
      const fullPath = req.originalUrl;

      if ((fullPath.includes('/auth/login') || fullPath === '/login') && method === 'POST') {
        action = 'LOGIN';
      } else if (fullPath.includes('/auth/register') && method === 'POST') {
        action = 'REGISTER';
      } else if (fullPath.includes('/me') && method === 'GET') {
        action = 'GET_CURRENT_USER';
      } else if (fullPath === '/' && method === 'GET') {
        action = 'API_ROOT';
      } else if (fullPath.includes('/users') && method === 'GET') {
        action = 'GET_USERS';
      } else if (fullPath.includes('/users') && method === 'POST') {
        action = 'CREATE_USER';
      } else if (fullPath.includes('/users') && method === 'PUT') {
        action = 'UPDATE_USER';
      } else if (fullPath.includes('/users') && method === 'DELETE') {
        action = 'DELETE_USER';
      } else if (fullPath.includes('/balance') && method === 'GET') {
        action = 'CHECK_BALANCE';
      } else if (fullPath.includes('/accounts') && method === 'GET') {
        action = 'GET_ACCOUNTS';
      } else if (fullPath.includes('/accounts') && method === 'POST') {
        action = 'CREATE_ACCOUNT';
      } else if (fullPath.includes('/transactions') && method === 'GET') {
        action = 'GET_TRANSACTIONS';
      } else if (fullPath.includes('/transactions') && method === 'POST') {
        action = 'CREATE_TRANSACTION';
      } else if (fullPath.includes('/transfer') && method === 'POST') {
        action = 'TRANSFER_MONEY';
      } else if (fullPath.includes('/admin') && method === 'GET') {
        action = 'ADMIN_ACCESS';
      } else if (fullPath.includes('/activity') && method === 'GET') {
        action = 'VIEW_ACTIVITY_LOGS';
      }

      // Capture authorization header for cURL generation (REDACTED for security)
      const authHeader = req.get('Authorization');
      
      // Create activity log entry
      const logEntry = {
        userId,
        username,
        action,
        endpoint: `${method} ${fullPath}`,
        ipAddress: (req.ip || req.connection.remoteAddress) === '::1' ? '127.0.0.1' : (req.ip || req.connection.remoteAddress),
        userAgent: req.get('User-Agent'),
        authorization: authHeader ? `${authHeader.split(' ')[0]} [REDACTED]` : null,
        requestBody: method === 'POST' || method === 'PUT' ? redactSensitiveFields(req.body) : null,
        responseBody: null, // Response body capture disabled — may contain PII/sensitive data
        responseStatus: res.statusCode,
        duration,
        timestamp: new Date()
      };

      // Also chain this request into the shared transaction ledger as a
      // 'backend.request' hop — but only when the request arrived carrying an
      // upstream correlation id (agent/gateway/P1AZ already tagged it), not
      // for ordinary UI-direct calls where middleware/correlationId.js had to
      // mint a fresh id locally. Every BFF request gets *some* correlationId,
      // so gating on presence alone would write a ledger record for every
      // GET/POST the API serves and flood the 500-record cap
      // (services/lmdb/transactionLedger.lmdb.js MAX_TRANSACTIONS) with
      // single-hop noise unrelated to any traced prompt flow.
      const inboundHeaders = req.headers || {};
      const hadInboundCorrelationId = Boolean(
        inboundHeaders['x-request-id'] || inboundHeaders['x-correlation-id']
      );
      if (hadInboundCorrelationId) {
        emitHop({
          phase: 'backend.request',
          op: logEntry.endpoint,
          identity: { sub: userId ? String(userId) : null },
          durationMs: duration,
          status: res.statusCode >= 400 ? 'error' : 'ok',
          details: {
            username: logEntry.username,
            action: logEntry.action,
            ipAddress: logEntry.ipAddress,
            userAgent: logEntry.userAgent,
            authorization: logEntry.authorization,
            requestBody: logEntry.requestBody,
            responseStatus: logEntry.responseStatus,
          },
        });
      }

      // Store the activity log (async, but don't wait for it)
      dataStore.createActivityLog(logEntry).catch(error => {
        console.error('Error creating activity log:', error);
      });

    } catch (error) {
      console.error('Error logging activity:', error);
    }

    // Call original send method
    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  logActivity
};
