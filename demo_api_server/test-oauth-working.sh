#!/bin/bash

# Test script for working OAuth integration tests

echo "🚀 Running Working OAuth Integration Tests"
echo "=========================================="

# Set test environment
export NODE_ENV=test
export DEBUG_TOKENS=true
export SKIP_TOKEN_SIGNATURE_VALIDATION=true

echo "🔧 Running oauth-scope-integration.test.js..."
npm test -- --testPathPattern=oauth-scope-integration.test.js --verbose --forceExit

echo ""
echo "🔧 Running scope-integration.test.js..."
npm test -- --testPathPattern=scope-integration.test.js --verbose --forceExit

echo ""
echo "🔧 Running oauth-callback.test.js..."
npm test -- --testPathPattern=oauth-callback.test.js --verbose --forceExit

echo ""
echo "✅ Working OAuth Integration Tests Complete"