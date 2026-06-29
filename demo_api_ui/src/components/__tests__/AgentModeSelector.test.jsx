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
  keySet: { helix: true, anthropic: true, "anthropic-lmstudio": true },
  modeOptions: [
    { id: "heuristics", label: "Heuristics only", external: false },
    { id: "llamacpp", label: "llama.cpp only", external: true },
    { id: "claude", label: "Anthropic only", external: true },
    { id: "helix_google", label: "Helix only", external: true },
  ],
  setMode: jest.fn(),
  setExternalWiring: jest.fn(),
};
vi.mock("../../hooks/useLangchainProvider", () => ({
  __esModule: true,
  default: () => mockHook,
}));

beforeEach(() => {
  // The selector probes llama.cpp reachability on mount; default it to available.
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "available" }) }),
  );
});

afterEach(() => {
  mockHook.mode = "heuristics";
  mockHook.provider = undefined;
  mockHook.externalWiring = null;
  mockHook.loading = false;
  mockHook.keySet = { helix: true, anthropic: true, "anthropic-lmstudio": true };
  jest.clearAllMocks();
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
  const anthropicOpt = screen.getByRole("option", { name: /Anthropic only/i });
  const helixOpt = screen.getByRole("option", { name: /Helix only/i });
  await waitFor(() => expect(anthropicOpt).toBeDisabled());
  expect(helixOpt).toBeDisabled();
  // Heuristics is always available.
  expect(screen.getByRole("option", { name: /Heuristics only/i })).not.toBeDisabled();
});

test("greys out llama.cpp when the server is unreachable", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "unreachable" }) }),
  );
  render(<AgentModeSelector />);
  const llamaCppOpt = screen.getByRole("option", { name: /llama\.cpp only/i });
  await waitFor(() => expect(llamaCppOpt).toBeDisabled());
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
  const onChange = jest.fn();
  render(<AgentModeSelector onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
});
