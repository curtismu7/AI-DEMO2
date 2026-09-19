import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = path.resolve(__dirname, '..');
const SRC = path.resolve(__dirname, '../..');

function readCss(file) {
  return fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
}

function cssFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...cssFiles(file));
    else if (entry.name.endsWith('.css')) files.push(file);
  }
  return files;
}

describe('dashboard modal contrast contract', () => {
  it('keeps the shared dark theme ink bright across legacy page aliases', () => {
    const css = readCss('../index.css');

    expect(css).toContain('--th-text: #ffffff;');
    expect(css).toContain('--th-text-body: #ffffff;');
    expect(css).toContain('--th-text-muted: #ffffff;');
    expect(css).toContain('--th-text-faint: #ffffff;');
    expect(css).toContain('--brand-dark-gray: var(--th-text-invert);');
    expect(css).toContain('--brand-light-gray: var(--th-bg-inset);');
    expect(css).toContain('--modal-body-text: #ffffff;');
    expect(css).toContain('--modal-body-text-secondary: #ffffff;');
  });

  it('keeps the login success identity modal on modal theme tokens', () => {
    const css = readCss('LoginSuccessModal.css');

    expect(css).toContain('color: var(--modal-body-text, var(--th-text));');
    expect(css).not.toMatch(/color:\s*#(?:0f172a|334155|475569)\b/);
  });

  it('does not leave legacy dark neutral color literals in CSS text rules', () => {
    const legacyNeutral =
      /(?:^|[;{}\n])\s*color\s*:\s*(?:#(?:111827|0f172a|1f2937|333333|374151|475569|4b5563|666666|6b7280|777777|888888|999999)|var\([^;{}]*#(?:111827|0f172a|1f2937|333333|374151|475569|4b5563|666666|6b7280|777777|888888|999999)\))/gi;
    const hits = [];
    for (const file of cssFiles(SRC)) {
      const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(legacyNeutral)) {
        hits.push(`${path.relative(SRC, file)}: ${match[0].trim()}`);
      }
    }
    expect(hits, hits.slice(0, 12).join('\n')).toEqual([]);
  });

  it('keeps the compliance checklist on theme-aware high-contrast tokens', () => {
    const css = readCss('ComplianceModal.css');

    expect(css).toContain('var(--modal-body-bg)');
    expect(css).toContain('var(--modal-body-text)');
    expect(css).toContain('var(--modal-body-text-secondary)');
    expect(css).toContain('.compliance-modal-popout-panel');
    expect(css).not.toMatch(/color:\s*#(?:64748b|94a3b8|6b7280|9ca3af)\b/);
  });

  it('keeps the MCP tools modal readable when the app is in dark mode', () => {
    const css = readCss('MCPToolsListModal.css');

    expect(css).toContain('var(--modal-body-bg)');
    expect(css).toContain('var(--modal-body-text)');
    expect(css).toContain('var(--modal-body-text-secondary)');
    expect(css).not.toMatch(/color:\s*#(?:6b7280|9ca3af|4b5563)\b/);
    expect(css).not.toMatch(/background(?:-color)?:\s*(?:white|#fff|#ffffff)\b/i);
  });

  it('keeps customer dashboard token modal and drawer text tied to theme tokens', () => {
    const css = readCss('UserDashboard.css');

    expect(css).toContain('.token-modal .modal-content');
    expect(css).toContain('.ud-action-drawer');
    expect(css).not.toMatch(/\.token-modal[^{}]*\{[^{}]*color:\s*#(?:666|777|888|999|6b7280|94a3b8)\b/i);
    expect(css).not.toMatch(/\.ud-drawer-close:hover[^{}]*\{[^{}]*color:\s*#666666\b/i);
  });
});
