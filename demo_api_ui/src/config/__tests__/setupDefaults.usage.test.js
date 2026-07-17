import fs from 'fs';
import path from 'path';

const FILES_MUST_NOT_HARDCODE = [
  '../../components/SetupPage.js',
  '../../components/SetupWizard.js',
  '../../components/SetupWizardTab.js',
];

// SetupWizardTab.js:398 has one legitimate prose mention ("e.g., Multi_Factor")
// inside a help-text sentence -- not a code default. Everything else must import
// the shared constant instead of hardcoding the literal.
const ALLOWED_PROSE_LINE_SUBSTRING = 'Find your policies in PingOne Admin Console';

describe('setup-wizard family uses the shared DEFAULT_STEP_UP_ACR_VALUE constant', () => {
  it.each(FILES_MUST_NOT_HARDCODE)('%s imports DEFAULT_STEP_UP_ACR_VALUE', (relPath) => {
    const filePath = path.join(__dirname, relPath);
    const source = fs.readFileSync(filePath, 'utf8');
    expect(source).toMatch(/DEFAULT_STEP_UP_ACR_VALUE/);
  });

  it.each(FILES_MUST_NOT_HARDCODE)('%s has no hardcoded Multi_Factor code default', (relPath) => {
    const filePath = path.join(__dirname, relPath);
    const source = fs.readFileSync(filePath, 'utf8');
    const offendingLines = source
      .split('\n')
      .filter((line) => line.includes("'Multi_Factor'") || line.includes('"Multi_Factor"'))
      .filter((line) => !line.includes(ALLOWED_PROSE_LINE_SUBSTRING));
    expect(offendingLines).toEqual([]);
  });
});
