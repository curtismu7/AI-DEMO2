/**
 * Token Validation Test Scenarios Routes
 * Demonstrates MCP server rejecting invalid tokens and displaying educational messages
 * 
 * Phase 158: Add Token Validation Test Scenarios
 * Feature flag: FF_TEST_TOKEN_SCENARIOS (disabled in production)
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const {
  generateWrongScopeToken,
  generateWrongAudToken,
  generateMissingActToken,
  generateAgentToken,
  generateExpiredToken,
  decodeTestToken
} = require('../middleware/testTokenGenerator');

// Feature flag safety check — disable test routes in production
router.use((req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const featureFlagEnabled = process.env.FF_TEST_TOKEN_SCENARIOS === 'true';
  
  if (isProduction && !featureFlagEnabled) {
    return res.status(403).json({
      error: 'test_routes_disabled',
      message: 'Token validation test routes are disabled in production.'
    });
  }
  
  next();
});

/**
 * POST /api/test/token-validation/scenario/:scenarioId
 * Run a specific token validation test scenario
 */
router.post('/scenario/:scenarioId', async (req, res) => {
  const { scenarioId } = req.params;
  
  try {
    let result;
    
    switch (scenarioId) {
      case 'wrong-scope':
        result = await runWrongScopeScenario();
        break;
      case 'wrong-aud':
        result = await runWrongAudScenario();
        break;
      case 'missing-act':
        result = await runMissingActScenario();
        break;
      case 'agent-token-user-endpoint':
        result = await runAgentTokenUserEndpointScenario();
        break;
      case 'expired-token':
        result = await runExpiredTokenScenario();
        break;
      default:
        return res.status(400).json({
          error: 'unknown_scenario',
          message: `Unknown scenario: ${scenarioId}. Valid scenarios: wrong-scope, wrong-aud, missing-act, agent-token-user-endpoint, expired-token`
        });
    }
    
    res.json(result);
  } catch (error) {
    console.error('[testTokenScenarios] Error running scenario:', error.message);
    res.status(500).json({
      error: 'scenario_execution_failed',
      message: error.message
    });
  }
});

/**
 * Scenario 1: User token with wrong scope (no mcp:* scopes)
 */
async function runWrongScopeScenario() {
  const testToken = generateWrongScopeToken();
  const decoded = decodeTestToken(testToken);
  
  return {
    scenario: 'wrong_scope',
    scenario_name: 'User Token (Wrong Scope)',
    error_code: 'SCOPE_MISMATCH',
    http_status: 403,
    error_description: 'Token scope violation. This endpoint requires mcp:* or agent scopes.',
    teaching_message: 'User tokens can only authorize general account operations. This endpoint requires agent delegation scopes (mcp:invoke or agent) that prove the user consented to agent delegation. Use RFC 8693 token exchange with both subject_token (user) and actor_token (agent) to generate a delegated token.',
    request: {
      token_scopes: decoded.scope.split(' '),
      endpoint: '/api/mcp/tool',
      expected_scopes: ['agent', 'mcp:invoke']
    },
    response: {
      status: 403,
      error: 'SCOPE_MISMATCH',
      message: 'Token does not include required scopes for this operation'
    },
    token_details: {
      sub: decoded.sub,
      aud: decoded.aud,
      iat: new Date(decoded.iat * 1000).toISOString(),
      exp: new Date(decoded.exp * 1000).toISOString(),
      scopes: decoded.scope.split(' ')
    }
  };
}

/**
 * Scenario 2: User token with wrong audience (aud mismatch)
 */
async function runWrongAudScenario() {
  const testToken = generateWrongAudToken();
  const decoded = decodeTestToken(testToken);
  
  return {
    scenario: 'wrong_aud',
    scenario_name: 'User Token (Wrong Audience)',
    error_code: 'AUD_MISMATCH',
    http_status: 401,
    error_description: `Token audience mismatch. Token aud: ${decoded.aud}, Expected: https://mcp-server.banking-demo.com`,
    teaching_message: 'This token was issued for a different service. MCP requires tokens with its specific audience (aud claim) to prevent token reuse attacks. A token issued for the BFF cannot be used on MCP, and vice versa. Each service validates that the token was intended for it. This is a critical security control to prevent cross-service token confusion attacks.',
    request: {
      token_aud: decoded.aud,
      mcp_expected_aud: 'https://mcp-server.banking-demo.com',
      endpoint: '/api/mcp/tool'
    },
    response: {
      status: 401,
      error: 'AUD_MISMATCH',
      message: 'Token audience does not match expected resource'
    },
    token_details: {
      sub: decoded.sub,
      aud: decoded.aud,
      iat: new Date(decoded.iat * 1000).toISOString(),
      exp: new Date(decoded.exp * 1000).toISOString(),
      scopes: decoded.scope.split(' ')
    }
  };
}

/**
 * Scenario 3: Missing act claim (non-delegated token)
 */
async function runMissingActScenario() {
  const testToken = generateMissingActToken();
  const decoded = decodeTestToken(testToken);
  
  return {
    scenario: 'missing_act',
    scenario_name: 'Missing Act Claim',
    error_code: 'DELEGATION_030',
    http_status: 401,
    error_description: 'Missing delegation claim. Token does not include "act" (acting as) claim. This endpoint requires proof of delegation.',
    teaching_message: 'This token was not issued for delegation (RFC 8693). MCP operations require proof that an agent is acting on behalf of the user (act claim). The "act" claim includes the agent\'s client_id and the user they are acting for. To enable delegation, use RFC 8693 token exchange with both subject_token (user token) and actor_token (agent token) to generate a delegated token with the act claim.',
    request: {
      token_has_act: decoded.act !== undefined,
      endpoint: '/api/mcp/tool',
      required_claim: 'act'
    },
    response: {
      status: 401,
      error: 'DELEGATION_030',
      message: 'Missing act claim — delegation not proven'
    },
    token_details: {
      sub: decoded.sub,
      aud: decoded.aud,
      iat: new Date(decoded.iat * 1000).toISOString(),
      exp: new Date(decoded.exp * 1000).toISOString(),
      scopes: decoded.scope.split(' '),
      has_act_claim: decoded.act !== undefined
    }
  };
}

/**
 * Scenario 4: Agent token used on user-level endpoint
 */
async function runAgentTokenUserEndpointScenario() {
  const testToken = generateAgentToken();
  const decoded = decodeTestToken(testToken);
  
  return {
    scenario: 'agent_token_user_endpoint',
    scenario_name: 'Agent Token on User Endpoint',
    error_code: 'SCOPE_MISMATCH',
    http_status: 403,
    error_description: `Token scope violation. Your token has scope: ${decoded.scope}. This endpoint requires: read or write`,
    teaching_message: 'Agent tokens are restricted to MCP operations only and cannot be used to call banking APIs directly. To call banking APIs on behalf of users, the agent must first exchange its token using RFC 8693 token exchange with a user token as subject_token. The resulting delegated token will have both the agent\'s "act" claim and the user\'s scopes, allowing the agent to act with the user\'s authority.',
    request: {
      token_scopes: decoded.scope.split(' '),
      endpoint: '/api/accounts',
      token_type: 'agent_token',
      required_scopes: ['read', 'write']
    },
    response: {
      status: 403,
      error: 'SCOPE_MISMATCH',
      message: 'Agent tokens cannot be used on user endpoints'
    },
    token_details: {
      sub: decoded.sub,
      aud: decoded.aud,
      iat: new Date(decoded.iat * 1000).toISOString(),
      exp: new Date(decoded.exp * 1000).toISOString(),
      scopes: decoded.scope.split(' '),
      act_claim: decoded.act
    }
  };
}

/**
 * Scenario 5: Expired token
 */
async function runExpiredTokenScenario() {
  const testToken = generateExpiredToken();
  const decoded = decodeTestToken(testToken);
  const now = Math.floor(Date.now() / 1000);
  
  return {
    scenario: 'expired_token',
    scenario_name: 'Expired Token',
    error_code: 'TOKEN_EXPIRED',
    http_status: 401,
    error_description: `Token expired. Issued: ${new Date(decoded.iat * 1000).toISOString()}, Expired: ${new Date(decoded.exp * 1000).toISOString()}, Current: ${new Date(now * 1000).toISOString()}. Seconds since expiration: ${now - decoded.exp}`,
    teaching_message: 'Tokens have a limited lifetime for security reasons. Once a token expires, it cannot authorize new operations, even if the signature is still valid. This prevents stolen or leaked tokens from being usable indefinitely. To continue operations, refresh the token (if a refresh token is available) or re-authenticate with PingOne to obtain a new token.',
    request: {
      token_exp: new Date(decoded.exp * 1000).toISOString(),
      current_time: new Date(now * 1000).toISOString(),
      seconds_expired: now - decoded.exp,
      endpoint: '/api/mcp/tool'
    },
    response: {
      status: 401,
      error: 'TOKEN_EXPIRED',
      message: 'Token has expired'
    },
    token_details: {
      sub: decoded.sub,
      aud: decoded.aud,
      iat: new Date(decoded.iat * 1000).toISOString(),
      exp: new Date(decoded.exp * 1000).toISOString(),
      scopes: decoded.scope.split(' '),
      expired: true,
      seconds_since_expiration: now - decoded.exp
    }
  };
}

/**
 * GET /api/test/token-validation/scenarios
 * List available test scenarios
 */
router.get('/scenarios', (req, res) => {
  res.json({
    message: 'Available token validation test scenarios',
    scenarios: [
      {
        id: 'wrong-scope',
        name: 'User Token (Wrong Scope)',
        description: 'User token lacks agent-required scopes (mcp:invoke, agent)',
        error_code: 'SCOPE_MISMATCH',
        http_status: 403
      },
      {
        id: 'wrong-aud',
        name: 'User Token (Wrong Audience)',
        description: 'Token audience mismatch (issued for BFF, used on MCP)',
        error_code: 'AUD_MISMATCH',
        http_status: 401
      },
      {
        id: 'missing-act',
        name: 'Missing Act Claim',
        description: 'Non-delegated token (no proof of RFC 8693 delegation)',
        error_code: 'DELEGATION_030',
        http_status: 401
      },
      {
        id: 'agent-token-user-endpoint',
        name: 'Agent Token on User Endpoint',
        description: 'Agent-scoped token used on user-level API',
        error_code: 'SCOPE_MISMATCH',
        http_status: 403
      },
      {
        id: 'expired-token',
        name: 'Expired Token',
        description: 'Token past expiration time',
        error_code: 'TOKEN_EXPIRED',
        http_status: 401
      }
    ],
    usage: 'POST /api/test/token-validation/scenario/{scenarioId}'
  });
});

module.exports = router;
