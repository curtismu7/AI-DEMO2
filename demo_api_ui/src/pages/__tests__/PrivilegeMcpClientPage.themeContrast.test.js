import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/pages/PrivilegeMcpClientPage.css'),
  'utf8',
);

describe('Privilege MCP client page-local theme contrast', () => {
  it('keeps the hostile-content evidence panel on the page theme tokens', () => {
    expect(stylesheet).toMatch(
      /\.cur-ide\[data-cur-theme="dark"\] \{[^}]*--cur-panel-ground:\s*#16181d;[^}]*--cur-panel-ink:\s*#f8fafc;/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-ide\[data-cur-theme="light"\] \{[^}]*--cur-panel-ground:\s*#ffffff;[^}]*--cur-panel-ink:\s*#1e1e1e;/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-hostile-panel__evidence article\s*\{[^}]*background:\s*var\(--cur-panel-emphasis\);[^}]*color:\s*var\(--cur-panel-ink\);/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-ide\[data-cur-theme="dark"\] \{[^}]*--cur-panel-error:\s*#fca5a5;/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-ide\[data-cur-theme="light"\] \{[^}]*--cur-panel-error:\s*#b91c1c;/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-hostile-panel__decision--denied \{\s*border-color:\s*var\(--cur-panel-error\)/s,
    );
    expect(stylesheet).toMatch(
      /\.cur-hostile-panel__error \{ color:\s*var\(--cur-panel-error\); \}/s,
    );
  });
});
