#!/usr/bin/env node

/**
 * MFA Test Script
 * Tests OTP and FIDO2 MFA flows for Super Banking demo
 * 
 * Usage:
 *   node scripts/test-mfa.js
 *   node scripts/test-mfa.js --test otp
 *   node scripts/test-mfa.js --test fido2
 *   node scripts/test-mfa.js --test all
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  baseUrl: process.env.API_URL || 'http://localhost:3001',
  testUser: process.env.MFA_TEST_USER || 'mfa-test-user',
  testPassword: process.env.MFA_TEST_PASSWORD || 'TestPassword123!',
  testEmail: process.env.MFA_TEST_EMAIL || 'test@example.com',
  mfaThreshold: 500.00,
  testAmount: 600.00,
  lowAmount: 200.00,
  timeout: 30000 // 30 seconds
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, status, details = '') {
  const color = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'yellow';
  const symbol = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  log(`${symbol} ${name}`, color);
  if (details) {
    log(`  ${details}`, 'reset');
  }
  
  results.tests.push({ name, status, details });
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
}

// HTTP request helper
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url || options.path, CONFIG.baseUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      timeout: CONFIG.timeout
    };
    
    const req = httpModule.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Test helper
async function runTest(testName, testFn) {
  log(`\nRunning: ${testName}`, 'cyan');
  try {
    await testFn();
  } catch (error) {
    logTest(testName, 'FAIL', error.message);
  }
}

// Test 1: Check MFA configuration
async function testMfaConfiguration() {
  const response = await makeRequest({
    url: '/api/config/pingone',
    method: 'GET'
  });
  
  if (response.status === 200) {
    const config = response.data;
    if (config.mfaEnabled) {
      logTest('MFA Configuration Check', 'PASS', 'MFA is enabled');
    } else {
      logTest('MFA Configuration Check', 'FAIL', 'MFA is not enabled');
    }
  } else {
    logTest('MFA Configuration Check', 'FAIL', `Failed to check config: ${response.status}`);
  }
}

// Test 2: Login and get session
async function testLogin() {
  const response = await makeRequest({
    url: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    username: CONFIG.testUser,
    password: CONFIG.testPassword
  });
  
  if (response.status === 200) {
    logTest('User Login', 'PASS', 'Login successful');
    return response.data.token || response.data.sessionId;
  } else {
    logTest('User Login', 'FAIL', `Login failed: ${response.status}`);
    return null;
  }
}

// Test 3: High-value transaction triggers MFA
async function testMfaTrigger(authToken) {
  const response = await makeRequest({
    url: '/api/transactions/transfer',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  }, {
    fromAccount: 'checking',
    toAccount: 'savings',
    amount: CONFIG.testAmount,
    note: 'MFA test transfer'
  });
  
  if (response.status === 428 || response.status === 403) {
    if (response.data.stepUpRequired || response.data.mfaRequired) {
      logTest('MFA Trigger on High-Value Transaction', 'PASS', 'MFA triggered correctly');
      return response.data;
    } else {
      logTest('MFA Trigger on High-Value Transaction', 'FAIL', 'MFA not indicated in response');
    }
  } else if (response.status === 200) {
    logTest('MFA Trigger on High-Value Transaction', 'FAIL', 'Transaction completed without MFA');
  } else {
    logTest('MFA Trigger on High-Value Transaction', 'FAIL', `Unexpected status: ${response.status}`);
  }
  
  return null;
}

// Test 4: Low-value transaction does NOT trigger MFA
async function testNoMfaTrigger(authToken) {
  const response = await makeRequest({
    url: '/api/transactions/transfer',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  }, {
    fromAccount: 'checking',
    toAccount: 'savings',
    amount: CONFIG.lowAmount,
    note: 'Low-value test transfer'
  });
  
  if (response.status === 200) {
    logTest('No MFA on Low-Value Transaction', 'PASS', 'Transaction completed without MFA');
  } else if (response.status === 428 || response.status === 403) {
    logTest('No MFA on Low-Value Transaction', 'FAIL', 'MFA triggered for low-value transaction');
  } else {
    logTest('No MFA on Low-Value Transaction', 'FAIL', `Transaction failed: ${response.status}`);
  }
}

// Test 5: OTP MFA flow
async function testOtpFlow(_authToken, mfaResponse) {
  if (!mfaResponse) {
    logTest('OTP MFA Flow', 'SKIP', 'No MFA response from previous test');
    return;
  }
  
  // In a real scenario, we would:
  // 1. Wait for OTP email
  // 2. Extract OTP code from email
  // 3. Submit OTP to complete MFA
  
  logTest('OTP MFA Flow', 'SKIP', 'Manual verification required - check email for OTP');
  log('  Manual steps:', 'yellow');
  log('  1. Check email for OTP code', 'yellow');
  log('  2. Enter OTP in the UI', 'yellow');
  log('  3. Verify transaction completes', 'yellow');
}

// Test 6: FIDO2 MFA availability
async function testFido2Availability(authToken) {
  const response = await makeRequest({
    url: '/api/mfa/methods',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  
  if (response.status === 200) {
    const methods = response.data.methods || [];
    if (methods.includes('fido2')) {
      logTest('FIDO2 MFA Availability', 'PASS', 'FIDO2 is available');
    } else {
      logTest('FIDO2 MFA Availability', 'FAIL', 'FIDO2 not available');
    }
  } else {
    logTest('FIDO2 MFA Availability', 'SKIP', 'Could not check MFA methods');
  }
}

// Test 7: Device registration check
async function testDeviceRegistration(authToken) {
  const response = await makeRequest({
    url: '/api/mfa/devices',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  
  if (response.status === 200) {
    const devices = response.data.devices || [];
    logTest('Device Registration Check', 'PASS', `Found ${devices.length} registered devices`);
  } else {
    logTest('Device Registration Check', 'FAIL', `Failed to check devices: ${response.status}`);
  }
}

// Main test runner
async function runAllTests() {
  log('╔══════════════════════════════════════════════════════════╗', 'cyan');
  log('║        MFA Test Script — OTP and FIDO2 Testing         ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════╝', 'cyan');
  log(`\nConfiguration:`, 'blue');
  log(`  Base URL: ${CONFIG.baseUrl}`, 'blue');
  log(`  Test User: ${CONFIG.testUser}`, 'blue');
  log(`  MFA Threshold: $${CONFIG.mfaThreshold}`, 'blue');
  log(`  Test Amount: $${CONFIG.testAmount}`, 'blue');
  
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('Running Tests...', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  
  // Run tests
  await runTest('MFA Configuration Check', testMfaConfiguration);
  
  const authToken = await runTest('User Login', testLogin);
  
  if (authToken) {
    const mfaResponse = await runTest('MFA Trigger on High-Value Transaction', () => testMfaTrigger(authToken));
    
    await runTest('OTP MFA Flow', () => testOtpFlow(authToken, mfaResponse));
    await runTest('FIDO2 MFA Availability', () => testFido2Availability(authToken));
    await runTest('Device Registration Check', () => testDeviceRegistration(authToken));
    
    await runTest('No MFA on Low-Value Transaction', () => testNoMfaTrigger(authToken));
  }
  
  // Print summary
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('Test Summary', 'cyan');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log(`Total Tests: ${results.tests.length}`, 'blue');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'blue');
  log(`Skipped: ${results.skipped}`, 'yellow');
  
  if (results.failed > 0) {
    log('\nFailed Tests:', 'red');
    results.tests.filter(t => t.status === 'FAIL').forEach(test => {
      log(`  - ${test.name}`, 'red');
      log(`    ${test.details}`, 'reset');
    });
  }
  
  // Save results to file
  const reportPath = path.join(__dirname, '../test-results/mfa-test-results.json');
  const reportDir = path.dirname(reportPath);
  
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: CONFIG,
    results
  }, null, 2));
  
  log(`\nTest results saved to: ${reportPath}`, 'cyan');
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Parse command line arguments
const args = process.argv.slice(2);
const testType = args.find(arg => arg.startsWith('--test='))?.split('=')[1] || 'all';

// Run tests
if (testType === 'otp' || testType === 'all') {
  runAllTests().catch(error => {
    log(`Error running tests: ${error.message}`, 'red');
    process.exit(1);
  });
} else if (testType === 'fido2') {
  log('FIDO2-only testing requires manual browser interaction', 'yellow');
  log('Please use the UI to test FIDO2 flows', 'yellow');
  process.exit(0);
} else {
  log(`Unknown test type: ${testType}`, 'red');
  log('Usage: node scripts/test-mfa.js [--test=otp|fido2|all]', 'yellow');
  process.exit(1);
}
