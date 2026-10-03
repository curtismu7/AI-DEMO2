// demo_api_ui/src/utils/__tests__/navigateWithOverlay.test.js
//
// Leaving the app for a sign-in redirect used to show whatever the browser had
// by default for the gap: a bare white page. The helper paints a themed card
// over the live page first, so the page stays visible behind it until the next
// document commits.
import { navigateWithOverlay, hideNavOverlay } from '../navigateWithOverlay';

const realLocation = window.location;

beforeEach(() => {
  delete window.location;
  window.location = { href: '', assign: vi.fn(), replace: vi.fn(), reload: vi.fn() };
});

afterEach(() => {
  hideNavOverlay();
  window.location = realLocation;
});

describe('navigateWithOverlay', () => {
  it('shows a status overlay with the message and navigates in the same call', () => {
    navigateWithOverlay('/api/auth/oauth/user/login', { message: 'Signing in...' });

    const overlay = document.getElementById('nav-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('role')).toBe('status');
    expect(overlay.textContent).toContain('Signing in...');
    // Synchronous on purpose: callers and their tests read location.href right after.
    expect(window.location.href).toBe('/api/auth/oauth/user/login');
  });

  it('uses location.assign when asked', () => {
    navigateWithOverlay('/next', { assign: true });

    expect(window.location.assign).toHaveBeenCalledWith('/next');
    expect(window.location.href).toBe('');
  });

  it('never stacks a second overlay', () => {
    navigateWithOverlay('/a');
    navigateWithOverlay('/b');

    expect(document.querySelectorAll('#nav-overlay')).toHaveLength(1);
  });

  it('still navigates when the overlay cannot be drawn', () => {
    const spy = vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('no DOM');
    });
    try {
      navigateWithOverlay('/still-goes');
    } finally {
      spy.mockRestore();
    }

    expect(window.location.href).toBe('/still-goes');
  });

  it('removes the overlay when the page is restored from the back/forward cache', () => {
    navigateWithOverlay('/away');
    expect(document.getElementById('nav-overlay')).not.toBeNull();

    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);

    expect(document.getElementById('nav-overlay')).toBeNull();
  });
});
