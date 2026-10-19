// /group-policy opts into the shared Ping-style diagram (reel, numbered arrows, key).
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GroupPolicyBoardPage from '../GroupPolicyBoardPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

vi.mock('../../components/GroupMembershipToggle', () => ({ default: () => <div /> }));
vi.mock('../../services/apiClient', () => ({
  default: { patch: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: { flags: [] } })) },
}));

it('renders the group-policy diagram with pingStyle', () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: [] }) }));
  render(
    <MemoryRouter>
      <VerticalContext.Provider value={{ verticalId: 'banking' }}>
        <GroupPolicyBoardPage />
      </VerticalContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('gpb-diagram').querySelector('.sfd--ping')).not.toBeNull();
});
