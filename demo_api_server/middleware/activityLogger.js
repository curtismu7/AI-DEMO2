const dataStore = require('../data/store');
const { emitHop } = require('../services/transactionHop');
const configStore = require('../services/configStore');
const { resolveActingIdentity } = require('./transactionTurn');
const { redactValue } = require('../utils/logRedact');

// Routes excluded from the backend.request ledger hop: high-frequency
// polling endpoints that would otherwise flood the ledger's 500-record cap
// with single-hop noise unrelated to any traced prompt flow. Mirrors
// server.js's POLL_ROUTES (morgan access-log skip-list, server.js ~line 437)
// — kept as a local copy since server.js doesn't export that set.
// '/health' and '/static/*' never reach here at all (see the early return
// below), so they don't need to be repeated in this list.
const HOP_SKIP_ROUTES = new Set([
  '/api/auth/oauth/user/status',
  '/api/auth/oauth/status',
  '/api/tokens/session-preview',
  '/api/auth/session',
  '/api/auth/ciba/status',
  '/api/config/vertical',
  '/api/admin/config',
]);

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
    // Hoisted so the hop-emission block below (its own try/catch) can reuse
    // the already-computed entry instead of re-deriving the same fields.
    let logEntry = null;

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

      // Capture response body (but limit size to avoid memory issues)
      let responseBody = null;
      try {
        if (data && res.statusCode < 400) {
          // Only capture successful responses and limit size
          const responseData = typeof data === 'string' ? data : JSON.stringify(data);
          if (responseData.length < 10000) { // Limit to 10KB
            responseBody = typeof data === 'string' ? JSON.parse(data) : data;
          } else {
            responseBody = { message: 'Response too large to display' };
          }
        }
      } catch (parseError) {
        // If we can't parse the response, store a truncated version
        const responseStr = typeof data === 'string' ? data : JSON.stringify(data);
        responseBody = { 
          message: 'Response parsing failed',
          preview: responseStr.substring(0, 500) + (responseStr.length > 500 ? '...' : '')
        };
      }

      // Capture authorization header for cURL generation (REDACTED for security)
      const authHeader = req.get('Authorization');
      
      // Create activity log entry
      logEntry = {
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

      // Store the activity log (async, but don't wait for it)
      dataStore.createActivityLog(logEntry).catch(error => {
        console.error('Error creating activity log:', error);
      });

    } catch (error) {
      console.error('Error logging activity:', error);
    }

    // Also chain this request into the shared transaction ledger as a
    // 'backend.request' hop. Emitted for every request (a correlationId is
    // minted for all of them — middleware/correlationId.js), except on
    // HOP_SKIP_ROUTES (polling noise) or when ff_transaction_ledger is off.
    // Isolated in its own try/catch, entirely independent of the activity
    // log write above: a failure in either block must never suppress the
    // other (activity logging vs. ledger hop are two unrelated concerns).
    try {
      if (
        logEntry &&
        configStore.getEffective('ff_transaction_ledger') !== 'false' &&
        !HOP_SKIP_ROUTES.has(req.path)
      ) {
        // op strips the query string — logEntry.endpoint is `${method}
        // ${req.originalUrl}` which includes it, and query params can carry
        // sensitive values (tokens, ids) that don't belong in the ledger.
        const opPath = logEntry.endpoint.split('?')[0];

        emitHop({
          phase: 'backend.request',
          op: opPath,
          // Uses the same identity space every other BFF ledger write uses
          // (middleware/transactionTurn.js resolveActingIdentity), not
          // req.user.id — appendHop pins the record's principal to the
          // first non-null identity.sub it sees, so stamping the wrong
          // identity space here would make the record invisible to its
          // owner (routes/transactionTrace.js _isOwnRecord).
          identity: { sub: resolveActingIdentity(req) },
          durationMs: logEntry.duration,
          status: res.statusCode >= 400 ? 'error' : 'ok',
          details: {
            username: logEntry.username,
            action: logEntry.action,
            ipAddress: logEntry.ipAddress,
            userAgent: logEntry.userAgent,
            authorization: logEntry.authorization,
            // Run this repo's general secret redaction on top of the
            // field-name-allowlist redaction already applied to
            // logEntry.requestBody, to catch anything the allowlist misses
            // (e.g. JWTs embedded in a value, other secret-shaped keys)
            // before it's persisted into the ledger.
            requestBody: redactValue(logEntry.requestBody),
            responseStatus: logEntry.responseStatus,
          },
        });
      }
    } catch (hopError) {
      console.warn('[activityLogger] hop emission failed:', hopError?.message);
    }

    // Call original send method
    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  logActivity
};
