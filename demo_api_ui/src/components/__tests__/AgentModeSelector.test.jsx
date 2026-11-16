// banking_api_ui/src/components/__tests__/AgentModeSelector.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AgentModeSelector from "../AgentModeSelector";

const mockHook = {
  mode: "heuristics",
  provider: undefined,
  externalWiring: null,
  saving: false,
  loading: false,
  // Honest provider-configured flags drive the mode grey-out. All configured
  // here so the four modes render enabled unless a test overrides it.
  keySet: { helix: true, anthropic: true, "anthropic-lmstudio": true, google: true, groq: true },
  modeOptions: [
    { id: "heuristics", label: "Heuristics", external: false },
    { id: "llamacpp", label: "llama.cpp", external: true },
    { id: "claude", label: "Anthropic", external: true },
    { id: "helix_google", label: "Helix", external: true },
    { id: "gemini", label: "Google Gemini", external: true },
  ],
  setMode: vi.fn(),
  setExternalWiring: vi.fn(),
};
vi.mock("../../hooks/useLangchainProvider", () => ({
  __esModule: true,
  default: () => mockHook,
}));

beforeEach(() => {
  // The selector probes llama.cpp reachability on mount; default it to available.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "available" }) }),
  );
});

afterEach(() => {
  mockHook.mode = "heuristics";
  mockHook.provider = undefined;
  mockHook.externalWiring = null;
  mockHook.loading = false;
  mockHook.keySet = { helix: true, anthropic: true, "anthropic-lmstudio": true, google: true, groq: true };
  vi.clearAllMocks();
});

test("renders the four modes and calls setMode on change", () => {
  render(<AgentModeSelector />);
  fireEvent.change(screen.getByLabelText(/agent mode/i), {
    target: { value: "claude" },
  });
  expect(mockHook.setMode).toHaveBeenCalledWith("claude", null);
});

test("greys out a mode whose provider is not configured", async () => {
  mockHook.keySet = { helix: false, anthropic: false, "anthropic-lmstudio": true };
  render(<AgentModeSelector />);
  // Anthropic + Helix options are disabled and labelled "not configured".
  const anthropicOpt = screen.getByRole("option", { name: /^Anthropic( — not configured)?$/i });
  const helixOpt = screen.getByRole("option", { name: /^Helix( — not configured)?$/i });
  await waitFor(() => expect(anthropicOpt).toBeDisabled());
  expect(helixOpt).toBeDisabled();
  // Heuristics is always available.
  expect(screen.getByRole("option", { name: /^Heuristics$/i })).not.toBeDisabled();
});

test("greys out llama.cpp when the server is unreachable", async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "unreachable" }) }),
  );
  render(<AgentModeSelector />);
  // The "— unavailable" suffix only appears after the async reachability probe
  // settles (un-probed defaults to available to avoid flicker) — must findBy.
  const llamaCppOpt = await screen.findByRole("option", { name: /llama\.cpp — unavailable/i });
  await waitFor(() => expect(llamaCppOpt).toBeDisabled());
});

test("auto-switches an unavailable selected mode to Heuristics with a notice", async () => {
  // Persisted mode is llama.cpp but the backend is unreachable → the user must
  // not be stranded on a dead mode. Selector auto-switches to Heuristics.
  mockHook.mode = "llamacpp";
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "unreachable" }) }),
  );
  render(<AgentModeSelector />);
  await waitFor(() => expect(mockHook.setMode).toHaveBeenCalledWith("heuristics", null));
  expect(screen.getByRole("status")).toHaveTextContent(/unavailable — switched to Heuristics/i);
});

test("does NOT auto-switch when the selected mode's provider is available", async () => {
  mockHook.mode = "claude"; // anthropic configured in the default keySet
  render(<AgentModeSelector />);
  // Give effects a tick; setMode must not be called for an available mode.
  await waitFor(() => expect(screen.getByLabelText(/agent mode/i)).toBeInTheDocument());
  expect(mockHook.setMode).not.toHaveBeenCalled();
});

test("no degraded banner for a non-external mode", () => {
  render(<AgentModeSelector />);
  const wiringSelect = screen.queryByLabelText(/external wiring/i);
  if (wiringSelect) expect(wiringSelect).toBeDisabled();
  expect(screen.queryByText(/delegation lost/i)).not.toBeInTheDocument();
});

test("external mode shows wiring sub-toggle; platform shows degraded banner", () => {
  mockHook.mode = "helix_google";
  mockHook.externalWiring = "platform";
  render(<AgentModeSelector />);
  expect(screen.getByLabelText(/external wiring/i)).toBeInTheDocument();
  expect(screen.getByText(/delegation lost/i)).toBeInTheDocument();
});

test("external mode with bff wiring shows sub-toggle but NO degraded banner", () => {
  mockHook.mode = "helix_google";
  mockHook.externalWiring = "bff";
  render(<AgentModeSelector />);
  expect(screen.getByLabelText(/external wiring/i)).toBeInTheDocument();
  expect(screen.queryByText(/delegation lost/i)).not.toBeInTheDocument();
});

test("changing wiring select calls setExternalWiring", () => {
  mockHook.mode = "helix_google"; mockHook.externalWiring = "bff";
  render(<AgentModeSelector />);
  fireEvent.change(screen.getByLabelText(/external wiring/i), { target: { value: "platform" } });
  expect(mockHook.setExternalWiring).toHaveBeenCalledWith("platform");
});

test("compact mode: platform shows chip not full banner", () => {
  mockHook.mode = "helix_google"; mockHook.externalWiring = "platform";
  render(<AgentModeSelector compact />);
  expect(screen.getByText(/delegation lost/i)).toBeInTheDocument();
  expect(screen.queryByText(/per-tool RFC 8693/i)).not.toBeInTheDocument();
});

test("onChange not called on initial settled render (hydration suppression)", () => {
  const onChange = vi.fn();
  render(<AgentModeSelector onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
});

test("Heuristics mode shows Routing locked to Fallback", () => {
  mockHook.mode = "heuristics";
  render(<AgentModeSelector heuristicFallback />);
  const routing = screen.getByLabelText(/heuristic routing/i);
  expect(routing).toBeInTheDocument();
  expect(routing).toBeDisabled();
  expect(routing).toHaveValue("fallback");
});

test("LLM mode shows Fallback / LLM-only toggle and notifies on change", async () => {
  mockHook.mode = "gemini";
  const onRouting = vi.fn();
  render(
    <AgentModeSelector heuristicFallback onHeuristicFallbackChange={onRouting} />,
  );
  const routing = screen.getByLabelText(/heuristic routing/i);
  expect(routing).toHaveValue("fallback");
  expect(routing).not.toBeDisabled();
  fireEvent.change(routing, { target: { value: "llm-only" } });
  expect(onRouting).toHaveBeenCalledWith(false);
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/feature-flags",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

// ── Route LLM through Privilege (ff_privilege_llm_first) ──────────────────
// GET /api/admin/feature-flags drives the switch; a PATCH writes only this
// flag, and the switch moves only to what the server confirms.
function mockFlagsFetch({ value = false, pinned = false, patch } = {}) {
  global.fetch = vi.fn((url, opts = {}) => {
    if (url === "/api/admin/feature-flags" && opts.method === "PATCH") {
      return Promise.resolve(patch());
    }
    if (url === "/api/admin/feature-flags") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          flags: [{
            id: "ff_privilege_llm_first",
            value,
            ...(pinned ? { pinned: true, pinnedBy: "FF_PRIVILEGE_LLM_FIRST" } : {}),
          }],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "available" }) });
  });
}

test("Privilege LLM switch reflects the current flag value and says it is stack-wide", async () => {
  mockFlagsFetch({ value: true });
  render(<AgentModeSelector />);
  const sw = await screen.findByRole("checkbox", { name: /route llm through privilege/i });
  expect(sw).toBeChecked();
  expect(sw).not.toBeDisabled();
  expect(sw).toHaveAccessibleDescription(/applies to everyone on this demo stack/i);
});

test("Privilege LLM switch PATCHes only ff_privilege_llm_first and shows the saved value", async () => {
  mockFlagsFetch({
    value: false,
    patch: () => ({
      ok: true,
      json: () => Promise.resolve({ updated: true, flags: [{ id: "ff_privilege_llm_first", value: true }] }),
    }),
  });
  render(<AgentModeSelector />);
  const sw = await screen.findByRole("checkbox", { name: /route llm through privilege/i });
  expect(sw).not.toBeChecked();
  fireEvent.click(sw);
  await waitFor(() => expect(sw).toBeChecked());
  const patchCall = global.fetch.mock.calls.find(([, o]) => o && o.method === "PATCH");
  expect(JSON.parse(patchCall[1].body)).toEqual({ updates: { ff_privilege_llm_first: true } });
});

test("Privilege LLM switch shows the error and does not flip when the PATCH fails", async () => {
  mockFlagsFetch({ value: false, patch: () => ({ ok: false, status: 401, json: () => Promise.resolve({}) }) });
  render(<AgentModeSelector />);
  const sw = await screen.findByRole("checkbox", { name: /route llm through privilege/i });
  fireEvent.click(sw);
  expect(await screen.findByRole("alert")).toHaveTextContent(/sign in to change llm routing/i);
  expect(sw).not.toBeChecked();
});

test("Privilege LLM switch is locked when the flag is env-pinned", async () => {
  mockFlagsFetch({ value: true, pinned: true });
  render(<AgentModeSelector compact />);
  const sw = await screen.findByRole("checkbox", { name: /route llm through privilege/i });
  expect(sw).toBeDisabled();
  expect(sw).toHaveAccessibleDescription(/pinned by FF_PRIVILEGE_LLM_FIRST/i);
});
