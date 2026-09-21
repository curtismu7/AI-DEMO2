import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SpinnerShowcasePage from '../SpinnerShowcasePage';

describe('SpinnerShowcasePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the embedded spinner with a short status note', () => {
    render(<SpinnerShowcasePage />);

    expect(screen.getByRole('heading', { name: /ping spinner in context/i })).toBeInTheDocument();
    expect(screen.getByText(/embedded wait state/i)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading account details/i })).toBeInTheDocument();
  });

  it('opens and closes the full-page spinner preview', () => {
    render(<SpinnerShowcasePage />);

    fireEvent.click(screen.getByRole('button', { name: /preview full-page state/i }));

    expect(screen.getByRole('dialog', { name: /full-page loading preview/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /preparing your workspace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit preview/i }));

    expect(screen.queryByRole('dialog', { name: /full-page loading preview/i })).not.toBeInTheDocument();
  });

  it('uses an uploaded image in both spinner examples and lets the user restore Ping', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:custom-logo'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    render(<SpinnerShowcasePage />);

    const logo = new File(['logo'], 'my-logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/upload custom logo/i), { target: { files: [logo] } });

    expect(screen.getByText(/custom logo ready/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.ping-spinner__custom-mark')).toHaveLength(2);
    expect(document.querySelector('.ping-spinner__custom-mark')).toHaveAttribute('src', 'blob:custom-logo');

    fireEvent.click(screen.getByRole('button', { name: /use ping logo/i }));

    expect(screen.queryByText(/custom logo ready/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('.ping-spinner__custom-mark')).toHaveLength(0);
  });

  it('restores the Ping logo after a custom logo is selected', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:custom-logo'),
    });
    render(<SpinnerShowcasePage />);

    const logo = new File(['logo'], 'my-logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/upload custom logo/i), { target: { files: [logo] } });
    fireEvent.click(screen.getByRole('button', { name: /use ping logo/i }));

    expect(screen.queryByText(/custom logo ready/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('.ping-spinner__custom-mark')).toHaveLength(0);
    expect(document.querySelectorAll('.ping-spinner__default-mark')).toHaveLength(2);
  });

  it('rejects non-image uploads with a helpful message', () => {
    render(<SpinnerShowcasePage />);

    const textFile = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/upload custom logo/i), { target: { files: [textFile] } });

    expect(screen.getByText(/choose an image file/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.ping-spinner__custom-mark')).toHaveLength(0);
  });
});
