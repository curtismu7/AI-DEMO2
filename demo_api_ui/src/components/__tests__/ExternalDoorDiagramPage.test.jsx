import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ExternalDoorDiagramPage from '../ExternalDoorDiagramPage';

global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

describe('ExternalDoorDiagramPage diagram controls', () => {
  it('the sequence diagram has Simulate, Reset and a speed selector', () => {
    render(<ExternalDoorDiagramPage />);
    const seq = screen.getByRole('group', { name: 'External door dual credential path sequence diagram' });
    expect(within(seq).getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(within(seq).getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(within(seq).getByTitle('Time each step takes during Simulate')).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Simulate' }));
    expect(within(seq).getByText(/Step 1 of \d+/)).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Reset' }));
    expect(within(seq).getByRole('button', { name: 'Simulate' })).toBeTruthy();
  });
});
