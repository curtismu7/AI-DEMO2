/**
 * Test Results Processor for OAuth Integration Tests
 * 
 * This file processes test results and generates additional reports.
 */

const fs = require('fs');
const path = require('path');

module.exports = (results) => {
  // Generate requirements coverage report
  const requirementsCoverage = {
    '1.1': { description: 'OAuth access token validation instead of custom JWT tokens', covered: false },
    '1.2': { description: 'Invalid/expired OAuth token handling (401 responses)', covered: false },
    '1.3': { description: 'Missing OAuth token handling (401 responses)', covered: false },
    '2.4': { description: 'Read operations scope validation (403 for insufficient scopes)', covered: false },
    '3.3': { description: 'Write operations scope validation (403 for insufficient scopes)', covered: false },
    '4.3': { description: 'Admin operations scope validation (403 for insufficient scopes)', covered: false },
    '5.1': { description: 'UI OAuth authorization flow initiation', covered: false },
    '5.2': { description: 'UI OAuth token storage (session-based, not localStorage)', covered: false },
    '5.3': { description: 'UI API calls with OAuth tokens in Authorization header', covered: false },
    '5.4': { description: 'UI token refresh and re-authentication handling', covered: false },
    '5.5': { description: 'UI automatic token refresh on expiration', covered: false },
    '6.1': { description: 'Clear error messages for missing scopes', covered: false },
    '6.2': { description: 'Clear error messages for invalid tokens', covered: false },
    '6.3': { description: 'Clear error messages for expired tokens', covered: false }
  };

  // Analyze test results to determine requirement coverage
  results.testResults.forEach(testResult => {
    testResult.assertionResults.forEach(assertion => {
      const testName = assertion.fullName || assertion.title;
      
      // Map test names to requirements
      if (testName.includes('OAuth access token') || testName.includes('validate OAuth')) {
        requirementsCoverage['1.1'].covered = true;
      }
      if (testName.includes('invalid') && testName.includes('token')) {
        requirementsCoverage['1.2'].covered = true;
      }
      if (testName.includes('missing') && testName.includes('token')) {
        requirementsCoverage['1.3'].covered = true;
      }
      if (testName.includes('read') && testName.includes('scope')) {
        requirementsCoverage['2.4'].covered = true;
      }
      if (testName.includes('write') && testName.includes('scope')) {
        requirementsCoverage['3.3'].covered = true;
      }
      if (testName.includes('admin') && testName.includes('scope')) {
        requirementsCoverage['4.3'].covered = true;
      }
      if (testName.includes('UI') && testName.includes('OAuth')) {
        requirementsCoverage['5.1'].covered = true;
        requirementsCoverage['5.2'].covered = true;
        requirementsCoverage['5.3'].covered = true;
      }
      if (testName.includes('refresh') && testName.includes('token')) {
        requirementsCoverage['5.4'].covered = true;
        requirementsCoverage['5.5'].covered = true;
      }
      if (testName.includes('error') && testName.includes('scope')) {
        requirementsCoverage['6.1'].covered = true;
      }
      if (testName.includes('error') && testName.includes('invalid')) {
        requirementsCoverage['6.2'].covered = true;
      }
      if (testName.includes('error') && testName.includes('expired')) {
        requirementsCoverage['6.3'].covered = true;
      }
    });
  });

  // Generate coverage report
  const coverageReport = {
    timestamp: new Date().toISOString(),
    totalRequirements: Object.keys(requirementsCoverage).length,
    coveredRequirements: Object.values(requirementsCoverage).filter(req => req.covered).length,
    coveragePercentage: Math.round(
      (Object.values(requirementsCoverage).filter(req => req.covered).length / 
       Object.keys(requirementsCoverage).length) * 100
    ),
    requirements: requirementsCoverage,
    testSummary: {
      totalTests: results.numTotalTests,
      passedTests: results.numPassedTests,
      failedTests: results.numFailedTests,
      successRate: Math.round((results.numPassedTests / results.numTotalTests) * 100)
    }
  };

  // Write coverage report to file
  const reportPath = path.join(__dirname, '../../../coverage/integration/requirements-coverage.json');
  const reportDir = path.dirname(reportPath);
  
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(coverageReport, null, 2));

  // Generate HTML report
  const htmlReport = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Integration Test Requirements Coverage</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .requirement { margin: 10px 0; padding: 10px; border-left: 4px solid #ddd; }
        .covered { border-left-color: #4CAF50; background: #f9fff9; }
        .not-covered { border-left-color: #f44336; background: #fff9f9; }
        .summary { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .metric { display: inline-block; margin: 0 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>OAuth Integration Test Requirements Coverage</h1>
        <p>Generated: ${coverageReport.timestamp}</p>
    </div>
    
    <div class="summary">
        <h2>Summary</h2>
        <div class="metric"><strong>Coverage:</strong> ${coverageReport.coveragePercentage}%</div>
        <div class="metric"><strong>Requirements:</strong> ${coverageReport.coveredRequirements}/${coverageReport.totalRequirements}</div>
        <div class="metric"><strong>Tests:</strong> ${coverageReport.testSummary.passedTests}/${coverageReport.testSummary.totalTests} passed</div>
        <div class="metric"><strong>Success Rate:</strong> ${coverageReport.testSummary.successRate}%</div>
    </div>
    
    <h2>Requirements Coverage</h2>
    ${Object.entries(requirementsCoverage).map(([req, data]) => `
        <div class="requirement ${data.covered ? 'covered' : 'not-covered'}">
            <strong>${req}:</strong> ${data.description}
            <span style="float: right;">${data.covered ? '✅ Covered' : '❌ Not Covered'}</span>
        </div>
    `).join('')}
    
</body>
</html>
  `;

  const htmlReportPath = path.join(__dirname, '../../../coverage/integration/requirements-coverage.html');
  fs.writeFileSync(htmlReportPath, htmlReport);

  console.log(`\n📊 Requirements Coverage Report Generated:`);
  console.log(`   JSON: ${reportPath}`);
  console.log(`   HTML: ${htmlReportPath}`);
  console.log(`   Coverage: ${coverageReport.coveragePercentage}% (${coverageReport.coveredRequirements}/${coverageReport.totalRequirements} requirements)`);

  return results;
};