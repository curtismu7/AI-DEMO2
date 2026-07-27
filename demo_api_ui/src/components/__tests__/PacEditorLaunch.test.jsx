import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import PacEditorLaunch from '../PacEditorLaunch';

const originalLocation = window.location;

function stubHostname(hostname) {
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, hostname },
    configurable: true,
    writable: true,
  });
}

describe('PacEditorLaunch', () => {
  afterEach(() => {
    // jsdom defaults window.location.hostname to 'localhost'; restore it in
    // case a test overrode it.
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  it('renders nothing on a non-local hostname, so a shared cluster never probes or advertises the local editor', () => {
    stubHostname('ai-demo.ping-devops.com');
    const { container } = render(<PacEditorLaunch probe={() => Promise.resolve('running')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Running when the editor answers', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('running')} />);
    expect(await screen.findByText('Policy editor: Running')).toBeTruthy();
  });

  it('links to the editor on loopback, in a new tab, without opener access', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('running')} />);
    const link = await screen.findByRole('link', { name: /open editor/i });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:9099');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the start command when the editor is not detected', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('unknown')} />);
    expect(await screen.findByText('Policy editor: Not detected')).toBeTruthy();
    expect(screen.getByText('./scripts/pac-edit.sh')).toBeTruthy();
  });

  it('keeps the link usable when not detected, because a blocked probe looks identical to a refused one', async () => {
    render(<PacEditorLaunch probe={() => Promise.resolve('unknown')} />);
    const link = await screen.findByRole('link', { name: /open editor/i });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:9099');
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('re-probes when the window regains focus', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('running');
    render(<PacEditorLaunch probe={probe} />);
    expect(await screen.findByText('Policy editor: Not detected')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByText('Policy editor: Running')).toBeTruthy();
    });
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
