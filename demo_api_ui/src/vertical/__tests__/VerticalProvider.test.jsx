import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VerticalProvider } from '../VerticalProvider';
import { useVertical } from '../useVertical';

const BANKING = {
  id: 'banking', schemaVersion: 3,
  identity: { displayName: 'Bank' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
};
const HEALTHCARE = { ...BANKING, id: 'healthcare', identity: { displayName: 'Health' } };

function setupMocks({ user, manifest }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      activeId: manifest.id,
      pageManifest: manifest,
      pageMockData: {},
      adminManifest: user?.role === 'admin' ? BANKING : null,
      isAdmin: user?.role === 'admin',
    }),
  });

  const handlers = {};
  class FakeES {
    constructor(url) { this.url = url; FakeES.last = this; }
    addEventListener(evt, cb) { handlers[evt] = cb; }
    close() {}
    fire(evt, data) {
      const cb = handlers[evt];
      if (cb) cb({ data: JSON.stringify(data) });
    }
  }
  global.EventSource = FakeES;
  return { FakeES, handlers };
}

// /api/verticals/stream and /me both require a session, so the provider waits
// for the `userAuthenticated` event useAuth dispatches before connecting.
function signIn() {
  act(() => { window.dispatchEvent(new CustomEvent('userAuthenticated')); });
}

// The provider does not fetch on mount — it waits for the server's initial
// `vertical-switched` SSE event (sent on stream connect) to drive the first
// /me hydration. Tests must simulate that event after render, or the provider
// stays in its pre-hydration (null) state and never renders children.
function hydrate(FakeES) {
  signIn();
  act(() => FakeES.last.fire('vertical-switched', {}));
}

function Probe() {
  const v = useVertical();
  return <div data-testid="probe">{v.pageManifest?.id}</div>;
}

describe('VerticalProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not render children until hydrated', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    const { queryByTestId, findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    // Pre-hydration: no SSE event has driven a /me fetch yet.
    expect(queryByTestId('probe')).toBeNull();
    hydrate(FakeES);
    expect((await findByTestId('probe')).textContent).toBe('banking');
  });

  test('makes no /api/verticals request before a session exists', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    // Signed out, both endpoints only 401 — so neither is touched.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(FakeES.last).toBeUndefined();

    signIn();
    await waitFor(() => expect(FakeES.last).toBeDefined());
    expect(FakeES.last.url).toBe('/api/verticals/stream');
  });

  test('SSE vertical-switched triggers refetch', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    hydrate(FakeES);
    await findByTestId('probe');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        activeId: 'healthcare',
        pageManifest: HEALTHCARE,
        pageMockData: {},
        adminManifest: null,
        isAdmin: false,
      }),
    });
    act(() => FakeES.last.fire('vertical-switched', { activeId: 'healthcare' }));

    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  test('SSE vertical-edited triggers refetch', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    hydrate(FakeES);
    await findByTestId('probe');

    act(() => FakeES.last.fire('vertical-edited', { id: 'banking' }));
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  test('SSE vertical-list-changed dispatches window event', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    hydrate(FakeES);
    await findByTestId('probe');

    let received = null;
    window.addEventListener('vertical-list-changed', () => { received = true; });
    act(() => FakeES.last.fire('vertical-list-changed', { ids: ['a', 'b'] }));
    expect(received).toBe(true);
  });

  // Fireable EventSource for the empty-state tests so they can drive the
  // initial hydration event (the /me fetch then 401s / errors), exercising the
  // "render children with empty manifest" path without waiting on the timer.
  function fireableES() {
    const handlers = {};
    class FakeES {
      constructor() { FakeES.last = this; }
      addEventListener(evt, cb) { handlers[evt] = cb; }
      close() {}
      fire(evt, data) { if (handlers[evt]) handlers[evt]({ data: JSON.stringify(data) }); }
    }
    global.EventSource = FakeES;
    return FakeES;
  }

  test('401 from /me still renders children (with empty manifest)', async () => {
    // Unauthenticated users see the landing/login pages — the provider must
    // NOT block first paint when /api/verticals/me returns 401.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const FakeES = fireableES();

    function NullProbe() {
      const v = useVertical();
      return <div data-testid="null-probe">{String(v.pageManifest === null)}</div>;
    }

    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><NullProbe /></VerticalProvider></MemoryRouter>
    );
    hydrate(FakeES);
    const probe = await findByTestId('null-probe');
    expect(probe.textContent).toBe('true');
  });

  test('fetch network error still renders children (with empty manifest)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const FakeES = fireableES();

    function NullProbe() {
      const v = useVertical();
      return <div data-testid="null-probe">{String(v.pageManifest === null)}</div>;
    }

    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><NullProbe /></VerticalProvider></MemoryRouter>
    );
    hydrate(FakeES);
    const probe = await findByTestId('null-probe');
    expect(probe.textContent).toBe('true');
  });

  // verticalStatus lets consumers (the queued-question resume) tell "still
  // loading" from "concluded with no vertical" instead of racing a wall-clock
  // deadline (TECH_DEBT "held together by two tuned timeouts").
  describe('verticalStatus', () => {
    function StatusProbe() {
      const v = useVertical();
      return <div data-testid="status-probe">{`${v.verticalStatus}:${v.activeId ?? 'none'}`}</div>;
    }

    test('successful /me concludes as resolved', async () => {
      const { FakeES } = setupMocks({ manifest: BANKING });
      const { findByTestId } = render(
        <MemoryRouter><VerticalProvider><StatusProbe /></VerticalProvider></MemoryRouter>
      );
      hydrate(FakeES);
      await waitFor(async () => {
        expect((await findByTestId('status-probe')).textContent).toBe('resolved:banking');
      });
    });

    test('network error concludes as failed', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
      const FakeES = fireableES();
      const { findByTestId } = render(
        <MemoryRouter><VerticalProvider><StatusProbe /></VerticalProvider></MemoryRouter>
      );
      hydrate(FakeES);
      await waitFor(async () => {
        expect((await findByTestId('status-probe')).textContent).toBe('failed:none');
      });
    });

    test('401 stays loading until the /active follow-up answers, then resolves with its id', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'retail' }) });
      const FakeES = fireableES();
      const { findByTestId } = render(
        <MemoryRouter><VerticalProvider><StatusProbe /></VerticalProvider></MemoryRouter>
      );
      hydrate(FakeES);
      await waitFor(async () => {
        expect((await findByTestId('status-probe')).textContent).toBe('resolved:retail');
      });
    });

    test('401 with a failing /active follow-up still concludes (resolved, no vertical)', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockRejectedValueOnce(new Error('offline'));
      const FakeES = fireableES();
      const { findByTestId } = render(
        <MemoryRouter><VerticalProvider><StatusProbe /></VerticalProvider></MemoryRouter>
      );
      hydrate(FakeES);
      await waitFor(async () => {
        expect((await findByTestId('status-probe')).textContent).toBe('resolved:none');
      });
    });
  });
});
