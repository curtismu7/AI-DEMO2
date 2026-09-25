import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/components/privilege/HostileMcpDenialPanel.css'),
  'utf8',
);
const privilegeClientStylesheet = readFileSync(
  resolve(process.cwd(), 'src/pages/PrivilegeMcpClientPage.css'),
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

describe('Privilege MCP trace light theme contrast', () => {
  it('pairs a dark trace ink with its white surface and bold text in light mode', () => {
    let lightTraceSurfaceRule;
    let lightTraceTextRule;
    postcss.parse(privilegeClientStylesheet).walkRules((rule) => {
      const selectors = rule.selectors || [];
      if (selectors.includes('.cur-ide[data-cur-theme="light"] .cur-trace-log')) lightTraceSurfaceRule = rule;
      if (selectors.includes('.cur-ide[data-cur-theme="light"] .cur-trace-summary')) lightTraceTextRule = rule;
    });

    expect(lightTraceSurfaceRule?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prop: 'background', value: '#ffffff' }),
        expect.objectContaining({ prop: 'color', value: '#1e1e1e' }),
      ]),
    );
    expect(lightTraceTextRule?.selectors).toEqual([
      '.cur-ide[data-cur-theme="light"] .cur-trace-summary',
      '.cur-ide[data-cur-theme="light"] .cur-trace-ts',
      '.cur-ide[data-cur-theme="light"] .cur-trace-label',
      '.cur-ide[data-cur-theme="light"] .cur-trace-error',
      '.cur-ide[data-cur-theme="light"] .cur-trace-json',
    ]);
    expect(lightTraceTextRule?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prop: 'color', value: 'inherit' }),
        expect.objectContaining({ prop: 'font-weight', value: '700' }),
      ]),
    );
  });
});
