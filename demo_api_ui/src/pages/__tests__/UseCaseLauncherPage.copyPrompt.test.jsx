/**
 * PromptSection's Copy button calls `navigator.clipboard.writeText(prompt)`
 * with no `.catch`. `writeText()` rejects in ordinary conditions (document
 * not focused after a modal closes, clipboard permission denied, insecure
 * context) — an unhandled rejection every time. Finding #78.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PromptSection } from '../UseCaseLauncherPage';

describe('PromptSection.handleCopy', () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
  });

  it('does not throw or leave an unhandled rejection when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError: Document is not focused.'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    render(<PromptSection prompt="show my balance" />);
    fireEvent.click(screen.getByRole('button', { name: /copy prompt to clipboard/i }));

    expect(writeText).toHaveBeenCalledWith('show my balance');
    // If the rejection went unhandled, this await (a real microtask flush)
    // is where a global unhandledrejection listener would have already fired.
    await waitFor(() => expect(screen.getByRole('button', { name: /copy prompt to clipboard/i })).toHaveTextContent('Copy failed'));
  });

  it('shows the Copied state when writeText resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    render(<PromptSection prompt="show my balance" />);
    fireEvent.click(screen.getByRole('button', { name: /copy prompt to clipboard/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /copy prompt to clipboard/i })).toHaveTextContent('Copied'));
  });
});
