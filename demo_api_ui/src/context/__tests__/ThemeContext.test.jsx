// demo_api_ui/src/context/__tests__/ThemeContext.test.jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  ThemeProvider,
  useTheme,
  useThemeOptional,
  THEME_STORAGE_KEY,
} from '../ThemeContext';

function Consumer() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <div>
      <span data-testid="mode">{darkMode ? 'dark' : 'light'}</span>
      <button type="button" onClick={toggleDarkMode}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider', () => {
  it('writes data-theme to the document root, not to its own subtree', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // The regression this context exists for: dark-capable CSS is keyed to
  // :root[data-theme="dark"], and the toggle used to live inside AIAgent — so on
  // the ~28 pages without that component nothing set the attribute. No agent is
  // rendered here at all.
  it('applies a stored dark preference with no AIAgent mounted', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'true');
    render(<ThemeProvider><Consumer /></ThemeProvider>);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('toggling updates both the root attribute and the stored preference', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('true');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('keeps the same storage key the agent-owned toggle used, so the preference survives', () => {
    expect(THEME_STORAGE_KEY).toBe('ba_dark_mode');
  });

  it('never seeds from the OS preference', () => {
    // Only some components carry dark styling, so following the OS would turn
    // those panels dark on load. An empty store must mean light.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('useThemeOptional outside a provider', () => {
  it('returns an inert value so consumers can destructure safely', () => {
    render(<Consumer />);
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    // Calling the inert setter must not throw.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'toggle' })); });
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });
});

describe('useTheme outside a provider', () => {
  it('throws, matching the house convention for required contexts', () => {
    function Strict() {
      useTheme();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Strict />)).toThrow(/must be used within ThemeProvider/);
    spy.mockRestore();
  });
});
