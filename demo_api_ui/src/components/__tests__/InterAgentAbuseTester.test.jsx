// Pins the verdict logic: a probe is a PASS (✅) only when the live status
// matches what the guardrail should return. The card is public (200), the two
// unauthorized calls must be 401. If the wire hop ever answered 200 to an
// unauthenticated inter-agent call, that row must read ❌ — that inversion is the
// whole point of the card, so it is the thing worth a test.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InterAgentAbuseTester from '../InterAgentAbuseTester';

afterEach(() => vi.unstubAllGlobals());

function stubFetch({ rpcStatus }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('.well-known')) {
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ name: 'Membership Specialist' }) });
      }
      return Promise.resolve({
        status: rpcStatus,
        json: () => Promise.resolve(
          rpcStatus === 401
            ? { error: 'unauthorized', message: 'A2A bearer failed PingOne signature verification' }
            : { ok: true },
        ),
      });
    }),
  );
}

describe('InterAgentAbuseTester', () => {
  it('marks every probe ✅ when the wire hop denies the unauthorized calls (401)', async () => {
    stubFetch({ rpcStatus: 401 });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));

    await waitFor(() => expect(screen.getByText(/HTTP 200/)).toBeInTheDocument()); // discovery
    const denied = await screen.findAllByText(/HTTP 401/);
    expect(denied).toHaveLength(2); // no-bearer + forged-bearer
    expect(screen.queryByText(/❌/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/✅/).length).toBe(3);
  });

  it('marks the unauthorized call ❌ if the wire hop wrongly allows it (200)', async () => {
    stubFetch({ rpcStatus: 200 });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));

    // The two RPC probes expected 401 but got 200 -> two failures.
    await waitFor(() => expect(screen.getAllByText(/❌/).length).toBe(2));
  });
});
