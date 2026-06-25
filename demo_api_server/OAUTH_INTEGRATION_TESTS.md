# OAuth Scope-based Authorization Integration Tests

This document describes the comprehensive integration tests for the OAuth scope-based authorization system implemented in the banking API server and UI.

## Overview

The integration tests verify that the system correctly:
- Uses OAuth access tokens instead of custom JWT tokens
- Validates scopes for different operations (read, write, admin)
- Handles errors appropriately for invalid tokens and insufficient scopes
- Manages OAuth tokens in the UI without JWT generation
- Provides clear error messages for various failure scenarios

## Test Files

### 1. `oauth-scope-integration.test.js`
**Primary Integration Test Suite**

This is the main integration test file that covers all core OAuth scope-based authorization functionality:

#### Test Categories:
- **End-to-End OAuth Authentication Flow** (Requirements 1.1, 1.2, 1.3)
  - OAuth access token validation
  - Invalid/expired token handling
  - Missing token handling

- **Read Operations Scope Validation** (Requirement 2.4)
  - `banking:accounts:read` scope for account access
  - `banking:transactions:read` scope for transaction access
  - General `banking:read` scope for all read operations
  - Proper 403 responses for insufficient scopes

- **Write Operations Scope Validation** (Requirement 3.3)
  - `banking:transactions:write` scope for transaction creation
  - `banking:write` scope for general write operations
  - Transfer operations scope validation
  - Proper 403 responses for insufficient scopes

- **Admin Scope Authorization** (Requirement 4.3)
  - `banking:admin` scope for admin operations
  - Admin UI access validation
  - User management scope requirements
  - Proper 403 responses for non-admin users

- **Detailed Error Handling** (Requirements 6.1, 6.2, 6.3)
  - Clear error messages for missing scopes
  - Clear error messages for invalid tokens
  - Clear error messages for expired tokens
  - Request tracking information in error responses

- **Various Scope Combinations**
  - Multiple valid scopes
  - Granular scope permissions
  - Empty scopes handling
  - Single scope string vs array handling

- **OAuth Flow Integration (UI Testing)**
  - OAuth callback token storage without JWT generation
  - Status endpoints returning OAuth tokens instead of JWT

- **Health Check and Monitoring**
  - OAuth provider status in health checks
  - Graceful handling of OAuth provider unavailability

- **Edge Cases and Error Scenarios**
  - Malformed Authorization headers
  - Missing Bearer prefix
  - Very long scope lists
  - Case-sensitive scope matching
  - Special characters in scopes

### 2. `oauth-e2e-integration.test.js`
**End-to-End Flow Testing**

This test file focuses on complete OAuth flows from authentication to API access:

#### Test Categories:
- **Complete OAuth Authentication Flow**
  - Full end-user OAuth flow with scope validation
  - Admin OAuth flow with admin scope
  - Session management throughout the flow

- **Scope-based Access Control in E2E Flow**
  - Read scope enforcement throughout the flow
  - Write scope enforcement throughout the flow
  - Admin scope enforcement throughout the flow

- **Error Handling in E2E Flow**
  - OAuth provider errors
  - Invalid authorization codes
  - State mismatch handling
  - Missing authorization code handling

- **Token Refresh in E2E Flow**
  - Token refresh during API access
  - Refresh token expiration handling

- **Session Management in E2E Flow**
  - OAuth token persistence in sessions
  - Session expiration handling
  - Logout functionality

### 3. `oauth-ui-integration.test.js` (UI Tests)
**UI OAuth Integration Testing**

Located in `banking_api_ui/src/services/__tests__/`, this file tests the UI-side OAuth integration:

#### Test Categories:
- **OAuth Token Management** (Requirements 5.1, 5.2)
  - Token retrieval from session instead of localStorage
  - Fallback to admin session
  - Secure token storage without JWT generation

- **API Client OAuth Integration** (Requirements 5.3, 5.4)
  - OAuth Bearer token inclusion in requests
  - Automatic token refresh on expiration
  - Insufficient scope error handling

- **Token Refresh Handling** (Requirement 5.5)
  - User token refresh attempts
  - Admin token refresh fallback
  - Graceful handling of refresh failures

- **Authentication Failure Handling** (Requirements 6.1, 6.2, 6.3)
  - Redirect to login on auth failure
  - Token cache clearing
  - Logout event dispatching

## Running the Tests

### Individual Test Files

```bash
# Run main integration tests
npm test -- --testPathPattern=oauth-scope-integration.test.js --verbose

# Run end-to-end integration tests
npm test -- --testPathPattern=oauth-e2e-integration.test.js --verbose

# Run existing scope integration tests
npm test -- --testPathPattern=scope-integration.test.js --verbose

# Run OAuth callback tests
npm test -- --testPathPattern=oauth-callback.test.js --verbose

# Run OAuth error handling tests
npm test -- --testPathPattern=oauth-error-handling.test.js --verbose
```

### All Integration Tests

```bash
# Run the comprehensive test runner
./run-oauth-integration-tests.sh
```

### UI Tests

```bash
# From the banking_api_ui directory
cd ../banking_api_ui
npm test -- --testPathPattern=oauth-ui-integration.test.js
```

### Using Jest Configuration

```bash
# Run with integration test configuration
npm test -- --config=jest.integration.config.js
```

## Test Environment Setup

The tests use the following environment variables:

```bash
NODE_ENV=test
DEBUG_TOKENS=true
SKIP_TOKEN_SIGNATURE_VALIDATION=true
SESSION_SECRET=test-session-secret
OAUTH_CLIENT_ID=test-client-id
OAUTH_CLIENT_SECRET=test-client-secret
OAUTH_ISSUER=https://auth.pingone.com/test-env
```

## Test Utilities

### Global Test Helpers

The tests include several utility functions:

- `createMockOAuthToken(scopes, userInfo)` - Creates test OAuth tokens
- `testHelpers.createTestUser()` - Creates test user data
- `testHelpers.createOAuthResponse()` - Creates test OAuth responses
- `testHelpers.createTestSession()` - Creates test session data

### Mock Setup

Tests use comprehensive mocking for:
- OAuth service calls
- Data store operations
- Authentication middleware
- HTTP requests (axios)

## Requirements Coverage

The integration tests cover all specified requirements:

| Requirement | Description | Test Coverage |
|-------------|-------------|---------------|
| 1.1 | OAuth access token validation instead of custom JWT tokens | ✅ Complete |
| 1.2 | Invalid/expired OAuth token handling (401 responses) | ✅ Complete |
| 1.3 | Missing OAuth token handling (401 responses) | ✅ Complete |
| 2.4 | Read operations scope validation (403 for insufficient scopes) | ✅ Complete |
| 3.3 | Write operations scope validation (403 for insufficient scopes) | ✅ Complete |
| 4.3 | Admin operations scope validation (403 for insufficient scopes) | ✅ Complete |
| 5.1 | UI OAuth authorization flow initiation | ✅ Complete |
| 5.2 | UI OAuth token storage (session-based, not localStorage) | ✅ Complete |
| 5.3 | UI API calls with OAuth tokens in Authorization header | ✅ Complete |
| 5.4 | UI token refresh and re-authentication handling | ✅ Complete |
| 5.5 | UI automatic token refresh on expiration | ✅ Complete |
| 6.1 | Clear error messages for missing scopes | ✅ Complete |
| 6.2 | Clear error messages for invalid tokens | ✅ Complete |
| 6.3 | Clear error messages for expired tokens | ✅ Complete |

## Test Reports

The tests generate several types of reports:

### Coverage Reports
- HTML coverage report: `coverage/integration/html-report/`
- JSON coverage summary: `coverage/integration/coverage-summary.json`
- LCOV format: `coverage/integration/lcov.info`

### Requirements Coverage
- JSON report: `coverage/integration/requirements-coverage.json`
- HTML report: `coverage/integration/requirements-coverage.html`

### Test Results
- HTML test report: `coverage/integration/html-report/integration-test-report.html`
- Console output with detailed results

## Continuous Integration

The integration tests are designed to work in CI/CD environments:

```yaml
# Example GitHub Actions workflow
- name: Run OAuth Integration Tests
  run: |
    cd banking_api_server
    npm install
    ./run-oauth-integration-tests.sh
```

## Troubleshooting

### Common Issues

1. **Tests hanging**: Use `--forceExit` and `--detectOpenHandles` flags
2. **Mock issues**: Ensure mocks are cleared between tests
3. **Environment variables**: Verify test environment setup
4. **Port conflicts**: Ensure test server ports are available

### Debug Mode

Enable verbose logging:

```bash
VERBOSE_TESTS=true npm test -- --testPathPattern=oauth-scope-integration.test.js
```

### Test Data Cleanup

Tests automatically clean up test data, but manual cleanup can be done:

```bash
rm -rf src/__tests__/test-data/
rm -rf coverage/integration/
```

## Future Enhancements

Potential improvements to the test suite:

1. **Performance Testing**: Add load testing for OAuth endpoints
2. **Security Testing**: Add penetration testing scenarios
3. **Browser Testing**: Add Selenium-based UI tests
4. **API Contract Testing**: Add Pact-based contract tests
5. **Chaos Engineering**: Add failure injection tests

## Contributing

When adding new OAuth-related functionality:

1. Add corresponding integration tests
2. Update requirements coverage mapping
3. Ensure all test categories are covered
4. Update this documentation
5. Run the full test suite before submitting PRs

## Support

For issues with the integration tests:

1. Check the test output for specific error messages
2. Review the requirements coverage report
3. Verify environment setup
4. Check mock configurations
5. Review the OAuth implementation documentation