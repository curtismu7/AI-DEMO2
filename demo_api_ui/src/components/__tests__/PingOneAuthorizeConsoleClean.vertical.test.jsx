// The Transaction preset follows the vertical's catalog entry. Every vertical the
// catalog covers sends its amount-gated write as a 'transfer' decision, so a
// vertical without one is stubbed here to exercise the hidden branch.
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PingOneAuthorizeConsoleClean from '../PingOneAuthorizeConsoleClean';

vi.mock('../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn() } }));
vi.mock('../../config/inspectorVerticals', async (importOriginal) => {
  const real = await importOriginal();
  const noTx = { ...real.INSPECTOR_VERTICALS.healthcare, authorize: { toolName: 'view_records', txTypes: [] } };
  return { ...real, INSPECTOR_VERTICALS: { banking: real.INSPECTOR_VERTICALS.banking, notx: noTx } };
});

function Harness({ url }) {
  const [records, setRecords] = useState([]);
  return (
    <MemoryRouter initialEntries={[url]}>
      <PingOneAuthorizeConsoleClean endpointId="ep-1" endpoints={[{ id: 'ep-1', name: 'EP' }]} policiesState={{ policies: [], error: null }} records={records} setRecords={setRecords} />
    </MemoryRouter>
  );
}

describe('Authorize presets per vertical', () => {
  it('hides the Transaction preset for a vertical without a transaction decision and opens on MCP tool', () => {
    render(<Harness url="/?vertical=notx" />);
    expect(screen.queryByRole('button', { name: 'Transaction' })).toBeNull();
    expect(screen.getByRole('button', { name: 'MCP tool' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Tool name').value).toBe('view_records');
  });

  it('shows it for banking', () => {
    render(<Harness url="/" />);
    expect(screen.getByRole('button', { name: 'Transaction' })).toHaveAttribute('aria-pressed', 'true');
  });
});
