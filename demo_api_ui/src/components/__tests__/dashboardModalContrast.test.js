import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = path.resolve(__dirname, '..');

function readCss(file) {
  return fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
}

describe('dashboard modal contrast contract', () => {
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
