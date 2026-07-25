import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CustomChipsTab from '../CustomChipsTab';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../hooks/useCustomChips', () => ({
  useCustomChips: () => ({
    chips: [{ id: 'custom_fraud_check_1', label: 'Fraud Check', prompt: 'Analyze recent transactions for suspicious patterns', type: 'llm', groupId: 'custom' }],
    groups: [],
    addChip: vi.fn(),
    removeChip: vi.fn(),
    addGroup: vi.fn(),
    removeGroup: vi.fn(),
  }),
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ pageManifest: { id: 'banking' } }),
}));

describe('CustomChipsTab — Run button', () => {
  it('navigates to /dashboard with the chip prompt as triggerText', () => {
    render(<MemoryRouter><CustomChipsTab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('run-chip-custom_fraud_check_1'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { triggerText: 'Analyze recent transactions for suspicious patterns' },
    });
  });
});
