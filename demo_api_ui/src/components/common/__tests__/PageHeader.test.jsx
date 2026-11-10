import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PageHeader from '../PageHeader';

describe('PageHeader', () => {
  it('renders eyebrow, title, summary, badge and a back link', () => {
    render(
      <MemoryRouter>
        <PageHeader
          back={{ to: '/learning', label: 'Back to Learning Hub' }}
          eyebrow="Lab"
          title="Token Exchange"
          summary="Summary text"
          badge="SIMULATED"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Token Exchange' })).toBeTruthy();
    expect(screen.getByText('Summary text')).toBeTruthy();
    expect(screen.getByText('SIMULATED')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to Learning Hub/ }).getAttribute('href')).toBe('/learning');
  });

  it('omits optional parts when not given', () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader title="Only title" />
      </MemoryRouter>,
    );
    expect(container.querySelector('.ping-back-link')).toBeNull();
    expect(container.querySelector('.ping-page-header__eyebrow')).toBeNull();
    expect(container.querySelector('.ping-page-header__side')).toBeNull();
  });

  it('phone: the copy is sized to its content, not a 360px flex-basis that becomes a height in the column layout', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/common/PageHeader.css'), 'utf8');
    const phone = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(phone).toContain('flex-direction: column');
    expect(phone).toMatch(/\.ping-page-header__copy \{[^}]*flex: 0 1 auto;/);
  });
});
