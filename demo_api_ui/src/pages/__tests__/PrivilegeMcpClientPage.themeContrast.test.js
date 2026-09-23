import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/components/privilege/HostileMcpDenialPanel.css'),
  'utf8',
);

describe('Hostile MCP denial panel theme contrast', () => {
  it('uses theme-aware foreground and background tokens for its evidence panel', () => {
    expect(stylesheet).toMatch(
      /\.hmd-panel__evidence article\s*\{[^}]*background:\s*var\(--th-bg-inset\);[^}]*color:\s*var\(--th-text\);/s,
    );
    expect(stylesheet).toMatch(/\.hmd-panel__error,\s*\.hmd-panel__decision--denied strong \{ color:\s*var\(--th-status-error-text\); \}/s);
    expect(stylesheet).toMatch(/\.hmd-panel__decision--denied \{ border-color:\s*var\(--th-status-error-border\)/s);
  });
});
