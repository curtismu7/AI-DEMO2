import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PromptFooPage from '../PromptFooPage';

describe('PromptFooPage error copy', () => {
  const originalClipboard = navigator.clipboard;
  const originalFetch = global.fetch;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    global.fetch = originalFetch;
  });

  it('copies the exit code, command error, and stderr from the error box', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suites: [{ key: 'agent-eval', label: 'Agent correctness', description: 'Agent test', config: 'promptfoo/agent-eval.yaml' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suite: 'agent-eval', exitCode: 1, error: 'Command failed: npx promptfoo eval', stderr: 'Promptfoo assertion failed: expected non-empty reply' }),
      });

    render(<PromptFooPage user={{ name: 'Admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run eval' }));
    await screen.findByText(/Promptfoo assertion failed/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy error details to clipboard' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Exit 1: Command failed: npx promptfoo eval\nPromptfoo assertion failed: expected non-empty reply');
      expect(screen.getByRole('button', { name: 'Copy error details to clipboard' })).toHaveTextContent('Copied');
    });
  });
});
