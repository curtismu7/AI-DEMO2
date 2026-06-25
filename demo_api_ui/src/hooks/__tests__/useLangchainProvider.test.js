// banking_api_ui/src/hooks/__tests__/useLangchainProvider.test.js
import { renderHook, act, waitFor } from "@testing-library/react";
import useLangchainProvider from "../useLangchainProvider";

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes("/status")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            provider: "helix",
            agent_mode: "heuristics_helix",
            external_wiring: "bff",
            agent_modes: [
              { id: "chatgpt", label: "Just ChatGPT", external: true },
            ],
            key_set: { helix: true },
            default_models: {},
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          agent_mode: "chatgpt",
          external_wiring: "platform",
          provider: "openai",
        }),
    });
  });
});

test("hydrates mode + wiring; setMode posts and updates", async () => {
  const { result } = renderHook(() => useLangchainProvider());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.mode).toBe("heuristics_helix");
  expect(result.current.externalWiring).toBe("bff");
  await act(async () => {
    await result.current.setMode("chatgpt");
  });
  expect(result.current.mode).toBe("chatgpt");
});

test('non-external mode hydrates externalWiring as null (honest, not "bff")', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    provider: 'helix', agent_mode: 'heuristics', external_wiring: null,
    agent_modes: [], key_set: { helix: true }, default_models: {},
  }) }));
  const { result } = renderHook(() => useLangchainProvider());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.mode).toBe('heuristics');
  expect(result.current.externalWiring).toBeNull();
});

test('setExternalWiring delegates to setMode with current mode', async () => {
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('/status')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        provider: 'openai', agent_mode: 'chatgpt', external_wiring: 'bff',
        agent_modes: [{ id: 'chatgpt', label: 'Just ChatGPT', external: true }],
        key_set: { openai: true }, default_models: {},
      }) });
    }
    const body = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      agent_mode: body.agent_mode, external_wiring: body.external_wiring, provider: 'openai' }) });
  });
  const { result } = renderHook(() => useLangchainProvider());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.mode).toBe('chatgpt');
  await act(async () => { await result.current.setExternalWiring('platform'); });
  expect(result.current.externalWiring).toBe('platform');
  expect(result.current.mode).toBe('chatgpt');
});
