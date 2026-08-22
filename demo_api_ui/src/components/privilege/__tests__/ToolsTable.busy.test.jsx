import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ToolsTable from '../ToolsTable';

const TOOLS = [
  { name: 'slow_tool', description: 'slow', inputSchema: { properties: {} } },
  { name: 'fast_tool', description: 'fast', inputSchema: { properties: {} } },
];

function runButtonFor(name) {
  const row = document.querySelector(`[data-tool-row="${name}"]`);
  return row.querySelector('.ptt-run');
}

describe('ToolsTable — per-tool busy state', () => {
  it('keeps a still-running tool disabled when another tool starts', async () => {
    let resolveSlow;
    const onExecute = vi.fn((name) => {
      if (name === 'slow_tool') return new Promise((r) => { resolveSlow = r; });
      return Promise.resolve({ ok: true });
    });

    render(<ToolsTable tools={TOOLS} onExecute={onExecute} />);

    fireEvent.click(runButtonFor('slow_tool'));
    await waitFor(() => expect(runButtonFor('slow_tool')).toBeDisabled());

    // Start the second tool while the first is still in flight.
    fireEvent.click(runButtonFor('fast_tool'));
    await waitFor(() => expect(runButtonFor('fast_tool')).not.toBeDisabled());

    // The slow tool must STILL be disabled — this is the regression.
    expect(runButtonFor('slow_tool')).toBeDisabled();

    resolveSlow({ ok: true });
    await waitFor(() => expect(runButtonFor('slow_tool')).not.toBeDisabled());
  });

  it('clears busy state when the execute call rejects', async () => {
    const onExecute = vi.fn(() => Promise.reject(new Error('boom')));
    render(<ToolsTable tools={TOOLS} onExecute={onExecute} />);

    fireEvent.click(runButtonFor('slow_tool'));
    await waitFor(() => expect(runButtonFor('slow_tool')).not.toBeDisabled());
  });
});
