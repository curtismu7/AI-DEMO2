import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = path.resolve(__dirname, '..');

function readCss(file) {
  return fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
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

    expect(css).toContain('color: var(--modal-body-text, #111827);');
    expect(css).not.toMatch(/color:\s*#(?:0f172a|334155|475569)\b/);
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
