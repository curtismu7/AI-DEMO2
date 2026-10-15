import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import A2aDocsLinks, { A2A_DOCS } from '../A2aDocsLinks';

const repoRoot = resolve(__dirname, '../../../../..');

describe('A2aDocsLinks', () => {
  it('links every listed doc, and every listed doc exists in the repo', () => {
    render(<A2aDocsLinks />);
    for (const [, docs] of A2A_DOCS) {
      for (const [label, path] of docs) {
        expect(existsSync(resolve(repoRoot, path)), path).toBe(true);
        expect(screen.getByRole('link', { name: label }).getAttribute('href')).toMatch(new RegExp(`/blob/main/${path}$`));
      }
    }
  });
});
