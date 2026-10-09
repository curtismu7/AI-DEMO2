/**
 * Deep links like /use-cases#UC-LEARN15 (Learning Hub "Demo step N" chips)
 * target a card that only exists after the async catalog fetch. The launcher
 * scrolls to the hash target once cards render; without that effect a cold
 * load lands at the top of the page and the presenter must hunt for the card.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const scrollIntoView = vi.fn();

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        useCases: [
          { id: 'UC1', track: 'demo', title: 'Delegated access', trigger: { type: 'chip', text: 'show my balance' }, maturity: 'works' },
          { id: 'UC-LEARN15', track: 'learn', title: 'Jev decision model', trigger: { type: 'link', path: '/jev-learning' }, maturity: 'works' },
        ],
      },
    }),
  },
}));
vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));
vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock('../../hooks/useLiveFlags', () => ({
  default: () => ({ flagMap: {}, flagsLoading: false, refreshFlags: vi.fn() }),
}));
vi.mock('../../utils/appToast', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock('../../services/agentPrewarm', () => ({
  opportunisticPrewarm: vi.fn(),
}));

import UseCaseLauncherPage from '../UseCaseLauncherPage';

describe('UseCaseLauncherPage hash deep link', () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    // setupTests.js installs a global scrollIntoView stub on HTMLElement's
    // prototype; shadow it on Element's (higher up the chain doesn't win —
    // HTMLElement's own property does) by replacing it there directly.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  it('scrolls to the hashed card once the catalog renders', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ mode: 'helix', key_set: true }) });
    render(
      <MemoryRouter initialEntries={['/use-cases#UC-LEARN15']}>
        <UseCaseLauncherPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Jev decision model')).toBeInTheDocument());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' })));
    fetchSpy.mockRestore();
  });

  it('does not scroll without a hash', async () => {
    render(
      <MemoryRouter initialEntries={['/use-cases']}>
        <UseCaseLauncherPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Jev decision model')).toBeInTheDocument());
    // Give any misplaced effect a tick to misfire.
    await new Promise((r) => setTimeout(r, 20));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
