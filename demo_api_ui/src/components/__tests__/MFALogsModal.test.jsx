import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import MFALogsModal from '../MFALogsModal';
import apiClient from '../../services/apiClient';
import { flushEffects } from '../../test-utils/flushEffects';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}));

const DETAILS = { deviceId: 'dev-1', error: 'otp_expired', attempts: 3 };
const LOGS = [
  { type: 'info', operation: 'Start MFA', status: 'ok', timestamp: '2026-11-16T10:00:00Z', details: DETAILS },
  { type: 'debug', operation: 'No details here', status: 'ok', timestamp: '2026-11-16T10:00:01Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // The pane's JSON button saves a page-wide choice; keep one test from leaking it into the next.
  localStorage.clear();
  apiClient.get.mockResolvedValue({ data: { success: true, logs: LOGS } });
});

async function openFirstLog() {
  render(<MFALogsModal onClose={() => {}} />);
  fireEvent.click(await screen.findByText('Start MFA'));
}

describe('MFALogsModal details', () => {
  it('shows a selected log twice as named panes (in the row and in the side panel), Form view by default', async () => {
    await openFirstLog();

    const inRow = await screen.findByRole('group', { name: 'Log 1 details' });
    const inPanel = screen.getByRole('group', { name: 'Selected log details' });
    for (const pane of [inRow, inPanel]) {
      expect(pane).toHaveTextContent('dev-1');
      expect(pane).toHaveTextContent('otp_expired');
    }
    // An error value is a failure signal: its row is stood out in the alert colour.
    expect(inPanel.querySelector('.jp-row[data-alert="true"]')).not.toBeNull();
    // Still a DraggableModal.
    expect(document.querySelector('.dm-body')).not.toBeNull();
  });

  it('shows the exact JSON in both panes after choosing JSON, and the pane buttons do not collapse the row', async () => {
    await openFirstLog();
    await screen.findByRole('group', { name: 'Log 1 details' });

    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(screen.getByRole('group', { name: 'Log 1 details view' })).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(document.querySelectorAll('pre.jp-raw')).toHaveLength(2));
    for (const raw of document.querySelectorAll('pre.jp-raw')) {
      expect(raw.textContent).toBe(JSON.stringify(DETAILS, null, 2));
    }
    // The click did not reach the row (which would have collapsed it): both panes are still there.
    expect(document.querySelector('pre.jp-raw[aria-label="Log 1 details"]')).not.toBeNull();
    expect(document.querySelector('pre.jp-raw[aria-label="Selected log details"]')).not.toBeNull();
  });

  it('shows no pane for a log without details', async () => {
    render(<MFALogsModal onClose={() => {}} />);
    fireEvent.click(await screen.findByText('No details here'));
    await screen.findByText('Log Details');
    expect(screen.queryByRole('group', { name: /details$/ })).not.toBeInTheDocument();
    expect(document.querySelector('pre.jp-raw')).toBeNull();
  });
});
