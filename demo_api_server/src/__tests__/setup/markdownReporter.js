'use strict';
/**
 * Custom Jest reporter that writes a datetime-named markdown results file
 * to banking_api_server/test-results/ after each test run.
 */
const fs = require('fs');
const path = require('path');

class MarkdownReporter {
  constructor(_globalConfig, _options) {}

  onRunComplete(_contexts, results) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('-');

    const outDir = path.resolve(__dirname, '../../../../test-results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const passed = results.numPassedTests;
    const failed = results.numFailedTests;
    const skipped = results.numPendingTests;
    const total = results.numTotalTests;
    const suites = results.numTotalTestSuites;
    const duration = ((results.testResults || []).reduce(
      (s, r) => s + (r.perfStats ? r.perfStats.end - r.perfStats.start : 0), 0) / 1000).toFixed(2);
    const status = failed > 0 ? '❌ FAILED' : '✅ PASSED';

    const lines = [
      `# Test Results — ${stamp.replace(/-/g, ' ').replace(/(\d{4}) (\d{2}) (\d{2}) /, '$1-$2-$3 ').replace(/ (\d{2}) (\d{2}) (\d{2})$/, ' $1:$2:$3')}`,
      '',
      `**Project:** banking_api_server`,
      `**Status:** ${status}`,
      `**Suites:** ${suites}  |  **Tests:** ${total}  |  **Passed:** ${passed}  |  **Failed:** ${failed}  |  **Skipped:** ${skipped}`,
      `**Duration:** ${duration}s`,
      '',
      '## Suite Breakdown',
      '',
    ];

    for (const suite of results.testResults || []) {
      const rel = path.relative(path.resolve(__dirname, '../../../..'), suite.testFilePath);
      const sStatus = suite.numFailingTests > 0 ? '❌' : '✅';
      lines.push(`### ${sStatus} \`${rel}\``);
      for (const t of suite.testResults || []) {
        const icon = t.status === 'passed' ? '✅' : t.status === 'pending' ? '⏭' : '❌';
        const ancestors = t.ancestorTitles.join(' › ');
        const name = ancestors ? `${ancestors} › ${t.title}` : t.title;
        lines.push(`- ${icon} ${name}`);
      }
      lines.push('');
    }

    if (failed > 0) {
      lines.push('## Failures', '');
      for (const suite of results.testResults || []) {
        for (const t of suite.testResults || []) {
          if (t.status === 'failed') {
            const rel = path.relative(path.resolve(__dirname, '../../../..'), suite.testFilePath);
            lines.push(`### ❌ \`${rel}\` — ${t.title}`);
            for (const msg of t.failureMessages || []) {
              lines.push('```', msg.split('\n').slice(0, 20).join('\n'), '```', '');
            }
          }
        }
      }
    }

    const filename = path.join(outDir, `${stamp}-test-results.md`);
    fs.writeFileSync(filename, lines.join('\n'), 'utf8');
    process.stdout.write(`\n📄 Test results written to test-results/${stamp}-test-results.md\n`);
  }
}

module.exports = MarkdownReporter;
