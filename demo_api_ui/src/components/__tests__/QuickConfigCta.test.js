// Quick Config is the control presenters use most, so it is a filled CTA with a gear
// rather than an outlined chip like Approval / Flow Detail. Source-level guard: the
// AIAgent render tree is too heavy to mount just to read a class name.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const js = readFileSync(resolve(__dirname, '../AIAgent.js'), 'utf8');
const css = readFileSync(resolve(__dirname, '../AIAgent.css'), 'utf8');
const dockCss = readFileSync(resolve(__dirname, '../CommandDock.css'), 'utf8');

describe('Quick Config call-to-action', () => {
  it('both Quick Config triggers use the filled CTA class, not the outlined chip', () => {
    const triggers = js.match(/className=\{`ba-cta-config\$\{headerMoreOpen/g) || [];
    expect(triggers).toHaveLength(2);
    expect(js).not.toMatch(/ba-actions-trigger\$\{headerMoreOpen/);
  });

  it('shows the settings gear (an allowlisted glyph) before the label', () => {
    const withGear = js.match(/<span aria-hidden="true">⚙<\/span><span>Quick Config<\/span>/g) || [];
    expect(withGear).toHaveLength(2);
  });

  it('styles it as a filled button, first and full width in the Tools row', () => {
    expect(css).toMatch(/\.ba-cta-config\s*\{[^}]*background:\s*linear-gradient/);
    expect(dockCss).toMatch(/\.cmd-dock-sec__body > \.ba-header-more\s*\{[^}]*order:\s*-1/);
  });
});
