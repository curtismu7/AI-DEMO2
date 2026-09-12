import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import HistoryModal from '../HistoryModal';

function entry(stepNum) {
  return { stepNum, label: `Step ${stepNum}`, token: { type: 'Access Token', aud: 'mcp' } };
}

describe('HistoryModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('scrolls the log to the newest entry as history grows', () => {
    // HistoryModal renders via createPortal(document.body), so query the
    // document, not the RTL render container.
    const { rerender } = render(<HistoryModal history={[entry(1)]} onClear={vi.fn()} />);
    const log = document.querySelector('.hm-log');
    Object.defineProperty(log, 'scrollHeight', { value: 500, configurable: true });
    log.scrollTop = 0;

    rerender(<HistoryModal history={[entry(1), entry(2)]} onClear={vi.fn()} />);

    expect(log.scrollTop).toBe(500);
  });

  it('hides the in-page panel on pop-out and keeps it hidden as new steps arrive', () => {
    const fakeWindow = { document: { replaceChild: vi.fn(), documentElement: {} }, closed: false };
    vi.stubGlobal('open', vi.fn(() => fakeWindow));

    const { rerender } = render(<HistoryModal history={[entry(1)]} onClear={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Pop out to new window'));
    expect(screen.queryByText(/Token History/)).not.toBeInTheDocument();

    // Simulation keeps running after pop-out — the in-page panel must stay hidden,
    // not reappear alongside the popped-out window.
    rerender(<HistoryModal history={[entry(1), entry(2)]} onClear={vi.fn()} />);
    expect(screen.queryByText(/Token History/)).not.toBeInTheDocument();
  });

  it('restores the in-page panel once the popped-out window is closed', () => {
    vi.useFakeTimers();
    const fakeWindow = { document: { replaceChild: vi.fn(), documentElement: {} }, closed: false };
    vi.stubGlobal('open', vi.fn(() => fakeWindow));

    render(<HistoryModal history={[entry(1)]} onClear={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Pop out to new window'));
    expect(screen.queryByText(/Token History/)).not.toBeInTheDocument();

    fakeWindow.closed = true;
    act(() => { vi.advanceTimersByTime(600); });

    expect(screen.getByText(/Token History/)).toBeInTheDocument();
  });
});
