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
    expect(document.querySelector('.ping-spinner__default-mark')).toHaveAttribute('src', '/branding/ping-logo.svg');
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

  it('shows a rotating tip on a stand-alone spinner, hidden from screen readers', () => {
    render(<PingIdentitySpinner size={48} label="Loading accounts…" />);

    const tip = document.querySelector('.ping-spinner__tip');
    expect(tip).toHaveAttribute('aria-hidden', 'true');
    expect(tip).toHaveTextContent('Did you know');
    // The status name is the label alone, so the tip is never announced.
    expect(screen.getByRole('status', { name: 'Loading accounts…' })).toBeInTheDocument();
  });

  it('draws every stand-alone spinner at one size, so none looks like a different spinner', () => {
    const size = () => document.querySelector('.ping-spinner').style.getPropertyValue('--ping-spinner-size');
    const { rerender } = render(<PingIdentitySpinner size={88} label="Loading…" />);
    expect(size()).toBe('56px');
    rerender(<PingIdentitySpinner size={40} label="Loading…" />);
    expect(size()).toBe('56px');
    // Small and opted-out spinners keep the size their caller asked for.
    rerender(<PingIdentitySpinner size={20} label="Applying…" />);
    expect(size()).toBe('20px');
    rerender(<PingIdentitySpinner size={72} label="Loading…" tip={false} />);
    expect(size()).toBe('72px');
  });

  it('leaves the tip off small, decorative or opted-out spinners', () => {
    const { rerender } = render(<PingIdentitySpinner size={20} label="Applying…" />);
    expect(document.querySelector('.ping-spinner__tip')).toBeNull();
    rerender(<PingIdentitySpinner size={48} aria-hidden="true" />);
    expect(document.querySelector('.ping-spinner__tip')).toBeNull();
    rerender(<PingIdentitySpinner size={48} label="Loading…" tip={false} />);
    expect(document.querySelector('.ping-spinner__tip')).toBeNull();
    rerender(<PingIdentitySpinner size={20} label="Loading…" tip />);
    expect(document.querySelector('.ping-spinner__tip')).not.toBeNull();
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
