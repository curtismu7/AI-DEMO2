// demo_api_ui/src/pages/__tests__/ServersPage.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import ServersPage, { serverCounts } from '../ServersPage';

const SERVICES = [
  { key: 'bff', name: 'API Server', category: 'core', up: true, optional: false },
  { key: 'ui', name: 'UI', category: 'core', up: true, optional: false },
  { key: 'gw', name: 'MCP Gateway', category: 'mcp', up: false, optional: false },
  // Compose-profile agent runtimes — off by default, expected absent.
  { key: 'openai', name: 'OpenAI Agent', category: 'agents', up: false, optional: true },
  { key: 'mastra', name: 'Mastra Agent', category: 'agents', up: false, optional: true },
  { key: 'pydantic', name: 'Pydantic Agent', category: 'agents', up: false, optional: true },
  // Never probed — outside both counts.
  { key: 'prop', name: 'Demo Prop', category: 'demo-prop', up: null, optional: false },
];

describe('serverCounts', () => {
  test('an optional service being down does not reduce the required count', () => {
    expect(serverCounts(SERVICES)).toEqual({
      requiredUp: 2,
      requiredProbed: 3,
      optionalUp: 0,
      optionalProbed: 3,
    });
  });

  test('bringing an optional service up moves only the optional count', () => {
    const withOptionalUp = SERVICES.map((s) => (s.key === 'mastra' ? { ...s, up: true } : s));
    const counts = serverCounts(withOptionalUp);
    expect(counts.requiredUp).toBe(2);
    expect(counts.requiredProbed).toBe(3);
    expect(counts.optionalUp).toBe(1);
  });

  test('no optional services means no optional half', () => {
    const required = SERVICES.filter((s) => !s.optional);
    expect(serverCounts(required).optionalProbed).toBe(0);
  });
});

test('header reports required up with optional beside it, not folded into it', async () => {
  globalThis.fetch = vi.fn((url) => {
    if (String(url).includes('/sizes')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ sizes: {} }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ services: SERVICES, timestamp: '2026-08-10T10:00:00.000Z' }),
    });
  });

  render(<ServersPage />);
  await waitFor(() => expect(screen.getByText(/required up/)).toBeInTheDocument());
  const meta = screen.getByText(/required up/).textContent;
  expect(meta).toContain('2/3 required up');
  expect(meta).toContain('(optional 0/3)');
  // The old headline folded the three expected-absent agents into the denominator.
  expect(meta).not.toContain('2/6');
});
