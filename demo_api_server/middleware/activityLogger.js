const dataStore = require('../data/store');

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

      // Capture authorization header for cURL generation
      const authHeader = req.get('Authorization');
      
      // Create activity log entry
      const logEntry = {
        userId,
        username,
        action,
        endpoint: `${method} ${fullPath}`,
        ipAddress: (req.ip || req.connection.remoteAddress) === '::1' ? '127.0.0.1' : (req.ip || req.connection.remoteAddress),
        userAgent: req.get('User-Agent'),
        authorization: authHeader,
        requestBody: method === 'POST' || method === 'PUT' ? req.body : null,
        responseBody,
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

    // Call original send method
    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  logActivity
};
