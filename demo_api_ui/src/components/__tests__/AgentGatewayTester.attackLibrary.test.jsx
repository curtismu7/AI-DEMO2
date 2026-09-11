// The tool lane's attack library. The chat lane's equivalent is pinned in
// LlmGatewayPage.test.jsx; this pins the part that differs — a tool attack is a
// tool name plus args, so picking one has to select the tool AND fill the args
// box. A dropdown that named an attack without loading its payload would leave
// the SE staring at an empty form, which is the bug this file exists to catch.
import { fireEvent, render, screen } from '@testing-library/react';
import AgentGatewayTester from '../AgentGatewayTester';
import { TOOL_ATTACKS } from '../../config/toolAttackCatalog';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
    patch: vi.fn(() => new Promise(() => {})),
  },
}));

const POISONING = TOOL_ATTACKS.find((a) => a.id === 'tool_poisoning');

describe('Agent Gateway Tester attack library', () => {
  it('lists every tool attack in the catalog', async () => {
    render(<AgentGatewayTester />);
    const select = await screen.findByLabelText(/attack library/i);
    for (const attack of TOOL_ATTACKS) {
      expect(screen.getByRole('option', { name: attack.label })).toBeInTheDocument();
    }
    expect(select).toHaveValue('');
  });

  it('picking an attack selects its tool and loads its args', async () => {
    render(<AgentGatewayTester />);
    fireEvent.change(await screen.findByLabelText(/attack library/i), {
      target: { value: POISONING.id },
    });

    // The tool is selected, so the middle column (and its args box) renders.
    expect(screen.getByPlaceholderText('{}')).toHaveValue(
      JSON.stringify(POISONING.args, null, 2),
    );
  });

  // An attack's measured effect must be SHOWN, not left blank — a blank would
  // read as "the gateway allowed it", the exact misreading the effect field was
  // introduced to prevent. tool_poisoning was measured as 'none' (the injection
  // rides through), which renders as "No verdict fires …".
  it('shows the measured effect text for the selected attack', async () => {
    render(<AgentGatewayTester />);
    fireEvent.change(await screen.findByLabelText(/attack library/i), {
      target: { value: POISONING.id },
    });

    expect(screen.getByTestId('agw-attack-effect')).toHaveTextContent(/no verdict fires/i);
  });
});
