// Pins the verdict logic: a probe is a PASS (✅) only when the live status
// matches what the guardrail should return. The card is public (200), the two
// unauthorized calls must be 401. If the wire hop ever answered 200 to an
// unauthenticated inter-agent call, that row must read ❌ — that inversion is the
// whole point of the card, so it is the thing worth a test.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InterAgentAbuseTester from '../InterAgentAbuseTester';
import { flushEffects } from '../../test-utils/flushEffects';

afterEach(() => vi.unstubAllGlobals());
// The JSON button saves a page-wide choice; keep one test from leaking it into the next.
beforeEach(() => { localStorage.clear(); });

function stubFetch({ rpcStatus, rpcBody }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (String(url).includes('.well-known')) {
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ name: 'Membership Specialist' }) });
      }
      return Promise.resolve({
        status: rpcStatus,
        json: () => Promise.resolve(
          rpcBody
            || (rpcStatus === 401
              ? { error: 'unauthorized', message: 'A2A bearer failed PingOne signature verification' }
              : { ok: true }),
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
    const denied = (await screen.findAllByText(/HTTP 401/)).filter((element) => element.classList.contains('iaa-badge'));
    expect(denied).toHaveLength(2); // no-bearer + forged-bearer
    expect(screen.queryByText(/❌/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/✅/).length).toBe(3);
    expect(screen.getAllByText(/Specialist execution: not reached — wire gate returned HTTP 401/i)).toHaveLength(2);
    expect(screen.getAllByText(/Model\/provider: not involved/i)).toHaveLength(3);
    // Request and response details are shared panes (Form view by default), named per probe.
    const request = screen.getByRole('group', { name: 'Inter-agent call, NO bearer request', hidden: true });
    expect(request).toHaveTextContent('/a2a/specialists/sporting-goods');
    expect(request).toHaveTextContent('POST');
    expect(request).toHaveTextContent('message/send');
    const response = screen.getByRole('group', { name: 'Inter-agent call, NO bearer response', hidden: true });
    expect(response).toHaveTextContent('PingOne signature verification');
    expect(response).toHaveTextContent('401');
  });

  it('shows the exact request and response JSON when the JSON view is chosen', async () => {
    stubFetch({ rpcStatus: 401 });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));
    await waitFor(() => expect(screen.getAllByText(/✅/).length).toBe(3));

    const row = screen.getByText('Inter-agent call, FORGED bearer').closest('li');
    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(row).getAllByRole('button', { name: 'JSON', hidden: true })[0]);
    await waitFor(() => expect(row.querySelectorAll('pre.jp-raw')).toHaveLength(2));
    const [request, response] = [...row.querySelectorAll('pre.jp-raw')];
    expect(request).toHaveAttribute('aria-label', 'Inter-agent call, FORGED bearer request');
    expect(JSON.parse(request.textContent)).toMatchObject({ method: 'POST', path: '/a2a/specialists/sporting-goods', authorization: 'forged bearer supplied; value hidden' });
    expect(response).toHaveAttribute('aria-label', 'Inter-agent call, FORGED bearer response');
    expect(JSON.parse(response.textContent)).toEqual({
      httpStatus: 401,
      body: { error: 'unauthorized', message: 'A2A bearer failed PingOne signature verification' },
    });
  });

  it('paints no alert on a passed probe (the expected 401), in both views', async () => {
    stubFetch({ rpcStatus: 401 });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));
    await waitFor(() => expect(screen.getAllByText(/✅/).length).toBe(3));
    const row = screen.getByText('Inter-agent call, FORGED bearer').closest('li');
    // The response body carries error: 'unauthorized', which is the pass here: it must not read red beside the green check.
    const response = within(row).getByRole('group', { name: 'Inter-agent call, FORGED bearer response', hidden: true });
    expect(response).toHaveTextContent('unauthorized');
    expect(row.querySelector('[data-alert]')).toBeNull();
    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(row).getAllByRole('button', { name: 'JSON', hidden: true })[0]);
    await waitFor(() => expect(row.querySelectorAll('pre.jp-raw')).toHaveLength(2));
    expect(row.querySelector('.jp-tok--alert')).toBeNull();
    // No call-site override is left behind.
    expect(row.querySelector('.iaa-details--expected')).toBeNull();
  });

  it('keeps the default pane red when a probe fails (the wire hop errored instead of denying), in both views', async () => {
    stubFetch({ rpcStatus: 500, rpcBody: { error: 'server_error', message: 'specialist crashed' } });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));
    await waitFor(() => expect(screen.getAllByText(/❌/).length).toBe(2));
    const row = screen.getByText('Inter-agent call, FORGED bearer').closest('li');
    expect(row.querySelector('.jp-row[data-alert="true"]')).not.toBeNull();
    await flushEffects(); // let the pane's switch subscribe (an effect) before pressing JSON
    fireEvent.click(within(row).getAllByRole('button', { name: 'JSON', hidden: true })[0]);
    await waitFor(() => expect(row.querySelectorAll('pre.jp-raw')).toHaveLength(2));
    expect(row.querySelector('.jp-tok--alert')).not.toBeNull();
  });

  it('marks the unauthorized call ❌ if the wire hop wrongly allows it (200)', async () => {
    stubFetch({ rpcStatus: 200 });
    render(<InterAgentAbuseTester />);
    fireEvent.click(screen.getByRole('button', { name: /fire inter-agent abuse/i }));

    // The two RPC probes expected 401 but got 200 -> two failures.
    await waitFor(() => expect(screen.getAllByText(/❌/).length).toBe(2));
    expect(screen.getAllByText(/Specialist execution: unknown — endpoint returned HTTP 200; execution not reported/i)).toHaveLength(2);
  });
});
