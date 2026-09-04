import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import { ThemeProvider } from '../../context/ThemeContext';
import UseCaseLauncherPage from '../UseCaseLauncherPage';

vi.mock('../../services/apiClient');

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));

vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn(), panel: null, tab: null }),
}));

vi.mock('../../components/VerticalSwitcher', () => ({
  default: function VerticalSwitcherStub() {
    return null;
  },
}));

describe('UseCaseLauncherPage — theme toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/use-cases') {
        return Promise.resolve({
          data: { useCases: [] },
        });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({
          data: { flags: [] },
        });
      }
      return Promise.resolve({ data: {} });
    });
    document.documentElement.removeAttribute('data-theme');
  });

  test('renders a Dark mode toggle and flips data-theme on click', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <UseCaseLauncherPage />
        </MemoryRouter>
      </ThemeProvider>
    );
    // Wait for the page to load use cases
    const btn = await screen.findByRole('button', { name: /dark mode/i });
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
