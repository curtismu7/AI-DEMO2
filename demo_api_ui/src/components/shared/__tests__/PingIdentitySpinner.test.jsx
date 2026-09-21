import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PingIdentitySpinner from '../PingIdentitySpinner';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('PingIdentitySpinner', () => {
  it('renders the Ping identity mark with an accessible loading label', () => {
    render(<PingIdentitySpinner label="Checking authorization…" />);

    expect(screen.getByRole('status', { name: 'Checking authorization…' })).toBeInTheDocument();
    expect(document.querySelector('.ping-spinner__mark')).not.toBeNull();
    expect(document.querySelector('.ping-spinner__mark text')).toHaveTextContent('P');
  });

  it('uses the requested size and supports unlabeled decorative use', () => {
    render(<PingIdentitySpinner size={72} aria-hidden="true" />);

    const spinner = document.querySelector('.ping-spinner');
    expect(spinner.style.getPropertyValue('--ping-spinner-size')).toBe('72px');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });

  it('dances the identity mark inside a stable red circle', () => {
    render(<PingIdentitySpinner label="Loading account details…" />);

    const visual = document.querySelector('.ping-spinner__visual');
    const mark = document.querySelector('.ping-spinner__mark--dancing');
    const label = document.querySelector('.ping-spinner__label');

    expect(visual).toContainElement(mark);
    expect(visual).not.toContainElement(label);
  });

  it('keeps runtime loading surfaces to one branded mark plus a short note', () => {
    const violations = [];
    for (const file of sourceFiles(SRC)) {
      if (file.includes(`${path.sep}shared${path.sep}__tests__`)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<(?:PingIdentitySpinner|InlineSpinner)\b[\s\S]*?\/>/g)) {
        if (!/\blabel\s*=/.test(match[0])) violations.push(path.relative(SRC, file));
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });
});
