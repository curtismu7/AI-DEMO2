import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlagGate from '../FlagGate';
import { enableUseCaseFlags } from '../../services/demoFlagsClient';

vi.mock('../../services/demoFlagsClient', () => ({ enableUseCaseFlags: vi.fn() }));

describe('FlagGate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders nothing when all required flags are already on', () => {
    const { container } = render(
      <FlagGate
        useCaseId="ciba-out-of-band-approval"
        flagIds={['ciba_enabled']}
        flagMap={{ ciba_enabled: 'true' }}
        loading={false}
        onEnabled={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when there are no required flags', () => {
    const { container } = render(
      <FlagGate useCaseId="x" flagIds={[]} flagMap={{}} loading={false} onEnabled={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('shows a chip per missing flag and an Enable button', () => {
    render(
      <FlagGate
        useCaseId="par-rar-intent-verified"
        flagIds={['ff_rar', 'ff_mcp_gateway_pinggateway']}
        flagMap={{ ff_rar: 'false', ff_mcp_gateway_pinggateway: 'false' }}
        loading={false}
        onEnabled={() => {}}
      />,
    );
    expect(screen.getByText('ff_rar')).toBeInTheDocument();
    expect(screen.getByText('ff_mcp_gateway_pinggateway')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
  });

  test('clicking Enable calls enableUseCaseFlags and reports the resolved flags', async () => {
    enableUseCaseFlags.mockResolvedValue({ success: true, flags: ['ff_rar', 'ff_mcp_gateway_pinggateway'] });
    const onEnabled = vi.fn();
    render(
      <FlagGate
        useCaseId="par-rar-intent-verified"
        flagIds={['ff_rar', 'ff_mcp_gateway_pinggateway']}
        flagMap={{ ff_rar: 'false', ff_mcp_gateway_pinggateway: 'false' }}
        loading={false}
        onEnabled={onEnabled}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    await waitFor(() => expect(enableUseCaseFlags).toHaveBeenCalledWith('par-rar-intent-verified'));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledWith(['ff_rar', 'ff_mcp_gateway_pinggateway']));
  });
});
