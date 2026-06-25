/**
 * resourceValidation.js
 *
 * Resource validation middleware for RFC 9728 Resource Indicators
 * Provides resource-based authorization and validation for API requests.
 */

const resourceIndicatorService = require('../services/resourceIndicatorService');
const { decodeJwtClaims } = require('../services/agentMcpTokenService');

/**
 * Resource validation middleware
 * Validates resource binding in tokens and prevents cross-resource access
 */
function resourceValidationMiddleware(req, res, next) {
  try {
    // Get token from request (assuming authentication middleware already ran)
    const token = req.user || req.session?.oauthTokens;
    
    if (!token) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'No token provided'
      });
    }

    // Get requested resource from request
    const requestResource = resourceIndicatorService.getResourceFromRequest(req);
    
    if (!requestResource) {
      return res.status(400).json({
        error: 'missing_resource',
        message: 'Resource indicator required'
      });
    }

    // Validate resource format
    if (!resourceIndicatorService.validateResourceFormat(requestResource)) {
      return res.status(400).json({
        error: 'invalid_resource_format',
        message: 'Invalid resource URI format'
      });
    }

    // Decode token if it's a JWT string
    let decodedToken;
    if (typeof token === 'string') {
      decodedToken = decodeJwtClaims(token);
    } else {
      decodedToken = token;
    }

    // Validate resource binding
    if (!resourceIndicatorService.validateResourceBinding(decodedToken, requestResource)) {
      return res.status(403).json({
        error: 'invalid_resource_binding',
        message: 'Token not bound to requested resource'
      });
    }

    // Prevent cross-resource usage
    if (!resourceIndicatorService.validateCrossResourceUsage(decodedToken, requestResource)) {
      return res.status(403).json({
        error: 'cross_resource_access_denied',
        message: 'Cross-resource access not allowed'
      });
    }

    // Add resource context to request
    req.resource = requestResource;
    req.resourceBinding = decodedToken.resource_binding;

    next();
  } catch (error) {
    console.error('Resource validation error:', error);
    return res.status(500).json({
      error: 'resource_validation_failed',
      message: 'Resource validation failed'
    });
  }
}

/**
 * Optional resource validation middleware
 * Validates resource binding if resource indicators are enabled, but doesn't fail if not
 */
function optionalResourceValidationMiddleware(req, res, next) {
  // Check if resource indicators are enabled
  if (!resourceIndicatorService.isResourceIndicatorsEnabled()) {
    return next();
  }

  // Apply full resource validation
  return resourceValidationMiddleware(req, res, next);
}

/**
 * Resource scope validation middleware
 * Validates that requested scopes are compatible with token resources
 */
function resourceScopeValidationMiddleware(req, res, next) {
  try {
    const token = req.user || req.session?.oauthTokens;
    
    if (!token) {
      return res.status(401).json({
        error: 'invalid_token',
        message: 'No token provided'
      });
    }

    // Get requested scopes from request
    const requestedScopes = req.query.scope ? req.query.scope.split(' ') : [];
    const resource = req.resource || resourceIndicatorService.getResourceFromRequest(req);

    if (!resource) {
      return next(); // Skip validation if no resource specified
    }

    // Decode token if needed
    let decodedToken;
    if (typeof token === 'string') {
      decodedToken = decodeJwtClaims(token);
    } else {
      decodedToken = token;
    }

    // Get token resources
    const tokenResources = decodedToken.resource || decodedToken.aud || [];
    
    // Validate scope-resource compatibility
    const compatibility = resourceIndicatorService.validateScopeResourceCompatibility(
      requestedScopes, 
      Array.isArray(tokenResources) ? tokenResources : [tokenResources]
    );

    if (!compatibility.compatible) {
      return res.status(400).json({
        error: 'incompatible_scopes',
        message: 'Requested scopes are not compatible with token resources',
        invalid_scopes: compatibility.invalidScopes
      });
    }

    // Add validated scopes to request
    req.validatedScopes = compatibility.validScopes;

    next();
  } catch (error) {
    console.error('Resource scope validation error:', error);
    return res.status(500).json({
      error: 'resource_scope_validation_failed',
      message: 'Resource scope validation failed'
    });
  }
}

/**
 * Resource audit middleware
 * Logs resource access for audit purposes
 */
function resourceAuditMiddleware(req, res, next) {
  const startTime = Date.now();
  const resource = req.resource || resourceIndicatorService.getResourceFromRequest(req);
  const token = req.user || req.session?.oauthTokens;

  // Continue with request
  res.on('finish', () => {
    try {
      const duration = Date.now() - startTime;
      const auditEntry = {
        timestamp: new Date().toISOString(),
        resource: resource,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        userId: token?.sub || 'anonymous',
        clientId: token?.client_id || 'unknown'
      };

      // Log resource access
      console.log('[RESOURCE_AUDIT]', JSON.stringify(auditEntry));

      // Store in audit service if available
      if (req.auditService) {
        req.auditService.logResourceAccess(auditEntry);
      }
    } catch (error) {
      console.error('Resource audit logging error:', error);
    }
  });

  next();
}

/**
 * Resource rate limiting middleware
 * Implements rate limiting per resource
 */
function createResourceRateLimitMiddleware(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 100,
    keyGenerator = (req) => `${req.resource}:${req.ip}`
  } = options;

  const requests = new Map();

  return (req, res, next) => {
    const resource = req.resource || resourceIndicatorService.getResourceFromRequest(req);
    const key = keyGenerator(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [k, v] of requests.entries()) {
      if (v.timestamp < windowStart) {
        requests.delete(k);
      }
    }

    // Get current requests for this key
    const current = requests.get(key) || { count: 0, timestamp: now };
    
    if (current.timestamp < windowStart) {
      current.count = 0;
      current.timestamp = now;
    }

    // Check rate limit
    if (current.count >= maxRequests) {
      return res.status(429).json({
        error: 'too_many_requests',
        message: 'Rate limit exceeded for this resource',
        retryAfter: Math.ceil((windowMs - (now - current.timestamp)) / 1000)
      });
    }

    // Increment counter
    current.count++;
    requests.set(key, current);

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - current.count),
      'X-RateLimit-Reset': new Date(current.timestamp + windowMs).toISOString()
    });

    next();
  };
}

/**
 * Resource security headers middleware
 * Adds security headers specific to resource access
 */
function resourceSecurityHeadersMiddleware(req, res, next) {
  const resource = req.resource || resourceIndicatorService.getResourceFromRequest(req);
  
  // Add resource-specific security headers
  res.set({
    'X-Resource-URI': resource || 'unknown',
    'X-Resource-Binding': req.resourceBinding || 'none',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });

  // Add resource-specific CORS headers if needed
  if (resource) {
    const resourceConfig = resourceIndicatorService.RESOURCE_DEFINITIONS[resource];
    if (resourceConfig && resourceConfig.cors) {
      res.set('Access-Control-Allow-Origin', resourceConfig.cors.allowedOrigins.join(', '));
      res.set('Access-Control-Allow-Methods', resourceConfig.cors.allowedMethods.join(', '));
      res.set('Access-Control-Allow-Headers', resourceConfig.cors.allowedHeaders.join(', '));
    }
  }

  next();
}

/**
 * Resource error handling middleware
 * Handles resource-specific errors consistently
 */
function resourceErrorHandler(error, req, res, next) {
  if (error.name === 'ResourceValidationError') {
    return res.status(400).json({
      error: 'resource_validation_error',
      message: error.message,
      resource: req.resource
    });
  }

  if (error.name === 'ResourceBindingError') {
    return res.status(403).json({
      error: 'resource_binding_error',
      message: error.message,
      resource: req.resource
    });
  }

  // Pass to next error handler
  next(error);
}

module.exports = {
  // Core validation middleware
  resourceValidationMiddleware,
  optionalResourceValidationMiddleware,
  resourceScopeValidationMiddleware,
  
  // Security and monitoring middleware
  resourceAuditMiddleware,
  createResourceRateLimitMiddleware,
  resourceSecurityHeadersMiddleware,
  
  // Error handling
  resourceErrorHandler
};
