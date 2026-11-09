import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import PrivilegeCodingAgentsPage from '../PrivilegeCodingAgentsPage';
import PrivilegePiiDetectionPage from '../PrivilegePiiDetectionPage';
import PrivilegeIntentTriagePage from '../PrivilegeIntentTriagePage';

/**
 * Three pages on scripts/ui-pattern-converted.txt had no test that named them. The static check
 * (check-ui-patterns.mjs) reads their source but never mounts them, so a page that threw on render stayed green.
 * Each one now mounts, puts the banner first inside its root, has a title, and shows exactly one primary button.
 */
const PAGES = [
  ['/privilege-coding-agents', PrivilegeCodingAgentsPage],
  ['/privilege-pii-detection', PrivilegePiiDetectionPage],
  ['/privilege-intent-triage', PrivilegeIntentTriagePage],
];

describe.each(PAGES)('enforced page %s renders', (_route, Page) => {
  afterEach(cleanup);

  const mount = () =>
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

  it('mounts without throwing and puts the banner first inside the page root', () => {
    const { container } = mount();
    const root = container.querySelector('.pu-page');
    expect(root, 'the page is not inside a PingPage (.pu-page)').not.toBeNull();
    const banner = screen.getByRole('note');
    expect(root.firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent.trim().length).toBeGreaterThan(0);
  });

  it('has a title and exactly one primary button', () => {
    const { container } = mount();
    // At least one: InspectorShell renders its own <h1> under the PageHeader one on the coding-agents and intent-triage pages.
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThanOrEqual(1);
    const primaries = container.querySelectorAll('button.pu-btn--primary, button.btn-primary, button.btn.btn-primary');
    expect(primaries).toHaveLength(1);
  });
});
