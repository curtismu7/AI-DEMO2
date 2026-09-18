import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = path.join(process.cwd(), 'src/components/ProofStrip.css');

describe('ProofStrip contrast contract', () => {
  it('uses dedicated dark ink for its light verification surface', () => {
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('--proof-strip-ink: #17212e');
    expect(css).toContain('color: var(--proof-strip-ink);');
    expect(css).not.toMatch(/\.proof-strip[\s\S]*?color:\s*var\(--th-text\)/);
  });
});
