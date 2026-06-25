/**
 * Global Teardown for OAuth Integration Tests
 * 
 * This file runs once after all tests complete.
 */

module.exports = async () => {
  console.log('🧹 Cleaning up OAuth Integration Test Suite...');
  
  // Clean up test data
  const fs = require('fs');
  const path = require('path');
  
  const testDataPath = path.join(__dirname, 'test-data');
  if (fs.existsSync(testDataPath)) {
    fs.rmSync(testDataPath, { recursive: true, force: true });
    console.log('✅ Test data cleaned up');
  }
  
  // Reset environment variables
  delete process.env.DEBUG_TOKENS;
  delete process.env.SKIP_TOKEN_SIGNATURE_VALIDATION;
  delete process.env.DISABLE_RATE_LIMITING;
  delete process.env.DATA_PATH;
  
  console.log('✅ OAuth Integration Test Suite cleanup complete');
};