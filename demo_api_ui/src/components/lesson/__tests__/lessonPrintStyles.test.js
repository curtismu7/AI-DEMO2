import fs from 'node:fs';
import path from 'node:path';

// Export PDF prints a lesson through lesson.css's @media print block. Two things
// in it are easy to break and invisible in review:
//   - SCOPE. The app is a single-page app, so this stylesheet stays loaded after
//     navigating away from a lesson. A print rule that hides app chrome without
//     :has(.lesson-page) would blank out the printout of every other page.
//   - CONTENTS. The customer handout must drop the section nav, the Export
//     button, Copy buttons and the sections marked lesson-no-print, and must
//     show the Ping Identity branding and legal notice that screen hides.
//
// A stylesheet read rather than a render: jsdom applies no print media.
const css = fs.readFileSync(path.resolve(__dirname, '../lesson.css'), 'utf8');
const printBlock = css.slice(css.indexOf('@media print'));

describe('lesson print styles', () => {
  it('has a print block', () => {
    expect(css).toContain('@media print');
  });

  it('scopes every rule that reaches outside the lesson to pages that contain one', () => {
    const outside = printBlock.match(/body[^{]*\{/g) || [];
    expect(outside.length).toBeGreaterThan(0);
    for (const selector of outside) {
      expect(selector).toContain(':has(.lesson-page)');
    }
  });

  it('hides screen-only controls and the excluded sections on paper', () => {
    // .lesson-run ("On this run") is always this browser's trace, not customer material.
    for (const cls of ['.lesson-sidebar', '.lesson-export', '.lesson-code-copy', '.lesson-run', '.lesson-no-print']) {
      expect(printBlock).toContain(cls);
    }
  });

  it('shows the Ping Identity branding and legal notice only on paper', () => {
    const screenRule = css.slice(0, css.indexOf('@media print'));
    expect(screenRule).toMatch(/\.lesson-print-brand,\s*\.lesson-print-legal\s*\{\s*display:\s*none;/);
    expect(printBlock).toMatch(/\.lesson-print-brand\s*\{[^}]*display:\s*flex/);
    expect(printBlock).toMatch(/\.lesson-print-legal\s*\{[^}]*display:\s*block/);
  });
});
