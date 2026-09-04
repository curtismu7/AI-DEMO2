import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlagGate from '../FlagGate';
import { enableUseCaseFlags, disableUseCaseFlags } from '../../services/demoFlagsClient';

vi.mock('../../services/demoFlagsClient', () => ({
  enableUseCaseFlags: vi.fn(),
  disableUseCaseFlags: vi.fn(),
}));

describe('FlagGate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows a Disable control when all required flags are already on', () => {
    render(
      <FlagGate
        useCaseId="ciba-out-of-band-approval"
        flagIds={['ciba_enabled']}
        flagMap={{ ciba_enabled: 'true' }}
        loading={false}
        onEnabled={() => {}}
        onDisabled={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable/i })).not.toBeInTheDocument();
  });

  test('clicking Disable calls disableUseCaseFlags and reports the resolved flags', async () => {
    disableUseCaseFlags.mockResolvedValue({ success: true, flags: ['ciba_enabled'] });
    const onDisabled = vi.fn();
    render(
      <FlagGate
        useCaseId="ciba-out-of-band-approval"
        flagIds={['ciba_enabled']}
        flagMap={{ ciba_enabled: 'true' }}
        loading={false}
        onEnabled={() => {}}
        onDisabled={onDisabled}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /disable/i }));
    await waitFor(() => expect(disableUseCaseFlags).toHaveBeenCalledWith('ciba-out-of-band-approval'));
    await waitFor(() => expect(onDisabled).toHaveBeenCalledWith(['ciba_enabled']));
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
