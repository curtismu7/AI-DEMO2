/**
 * @file FeatureFlagsPageUi.test.js
 * The Ping UI Standard behaviour added to /feature-flags (Wave 6):
 *   - P2 banner first, role=note, honest wording
 *   - one primary button (the webhook Save / Clear), inactive with a visible reason instead of disabled
 *   - switches and selects take aria-disabled while saving: focus stays, a second press is ignored
 *   - status wording comes from what was read (loading / unavailable / signed-out 401), never fixed text
 *   - the webhook card never says "Not configured" about a value it could not read
 * FeatureFlagsPage.test.js and featureFlagsManagedOn.test.jsx keep the original behaviour.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import FeatureFlagsPage from "../components/FeatureFlagsPage";

vi.mock("../components/FeatureFlagsPage.css", () => ({}), { virtual: true });

const FLAGS = [
  { id: "ff_one", name: "Flag One", value: false, description: "First flag", category: "Security", impact: "Does one thing" },
  { id: "ff_two", name: "Flag Two", value: true, description: "Second flag", category: "Security", warnIfEnabled: true },
  { id: "ff_mode", name: "Mode Flag", value: "a", options: ["a", "b"], type: "enum", description: "A mode", category: "Security" },
];
const REGISTRY = { flags: FLAGS, categories: ["Security"] };

/** fetch stub: flags GET ok, config GET per `config`, PATCH held until `releasePatch()`. */
function stubFetch({ flagsStatus = 200, config = { ok: true, body: { config: {} } } } = {}) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  global.fetch = vi.fn((url, init = {}) => {
    calls.push([url, init]);
    if (url === "/api/admin/config" && init.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (url === "/api/admin/config") {
      return Promise.resolve({ ok: config.ok, status: config.ok ? 200 : 500, json: async () => config.body });
    }
    if (url === "/api/admin/feature-flags" && init.method === "PATCH") {
      const { updates } = JSON.parse(init.body);
      return gate.then(() => ({ ok: true, json: async () => ({ flags: Object.entries(updates).map(([id, value]) => ({ id, value })) }) }));
    }
    if (url === "/api/admin/feature-flags") {
      return Promise.resolve({
        ok: flagsStatus === 200,
        status: flagsStatus,
        json: async () => (flagsStatus === 200 ? REGISTRY : { error: flagsStatus === 401 ? "unauthorized" : "boom" }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  return { release: () => release(), calls };
}

beforeEach(() => vi.clearAllMocks());

describe("FeatureFlagsPage — Ping UI Standard", () => {
  it("renders the banner first, as a note, and says nothing is simulated", async () => {
    stubFetch();
    const { container } = render(<FeatureFlagsPage />);
    await screen.findByText("Flag One");
    const page = container.querySelector(".feature-flags-page");
    expect(page.firstElementChild).toHaveClass("pu-banner-wrap");
    const banner = screen.getByTestId("ff-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner).toHaveTextContent(/nothing on this page is simulated/i);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });

  it("has exactly one primary button and every chip carries a word", async () => {
    stubFetch();
    const { container } = render(<FeatureFlagsPage />);
    await screen.findByText("Flag One");
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
    const chips = [...container.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(3);
    for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
  });

  it("a switch takes aria-disabled (not disabled) while saving, keeps focus and ignores a second press", async () => {
    const { release, calls } = stubFetch();
    render(<FeatureFlagsPage />);
    const toggle = await screen.findByRole("button", { name: /enable flag one/i });
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-disabled", "true"));
    expect(toggle).not.toBeDisabled();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    release();
    await screen.findByText(/ff_one/, { selector: "strong" });
    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(document.activeElement).toBe(toggle);
    expect(calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
  });

  it("a choice dropdown takes aria-disabled while saving and ignores a change", async () => {
    const { release, calls } = stubFetch();
    render(<FeatureFlagsPage />);
    const select = await screen.findByRole("combobox", { name: /select mode for mode flag/i });
    fireEvent.change(select, { target: { value: "b" } });
    await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "true"));
    expect(select).not.toBeDisabled();
    fireEvent.change(select, { target: { value: "a" } });
    release();
    await waitFor(() => expect(select).not.toHaveAttribute("aria-disabled"));
    expect(calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
  });

  it("the toast lives in a live region that is mounted before it has text", async () => {
    stubFetch();
    const { container } = render(<FeatureFlagsPage />);
    await screen.findByText("Flag One");
    const region = container.querySelector(".ff-saved-region");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();
  });

  it("a signed-out 401 shows an unavailable state and a sign-in message, not a blank page", async () => {
    stubFetch({ flagsStatus: 401 });
    render(<FeatureFlagsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unauthorized/);
    expect(alert).toHaveTextContent(/sign in as an admin/i);
    const status = screen.getByTestId("ff-status");
    expect(status).toHaveTextContent("Unavailable");
    expect(status).toHaveTextContent(/nothing was changed/i);
    expect(screen.getByText(/no flags are shown/i)).toBeInTheDocument();
    expect(screen.queryByText(/enabled$/)).toBeNull();
  });

  it("the status line says Loaded only after the registry was read", async () => {
    stubFetch();
    render(<FeatureFlagsPage />);
    expect(screen.getByTestId("ff-status")).toHaveTextContent("Loading");
    await waitFor(() => expect(screen.getByTestId("ff-status")).toHaveTextContent("Loaded"));
    expect(screen.getByTestId("ff-status")).toHaveTextContent("3 flags read");
  });

  it("the refresh button is aria-disabled while loading and stays focusable", async () => {
    stubFetch();
    render(<FeatureFlagsPage />);
    const btn = screen.getByTitle(/refresh flags from server/i);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    await waitFor(() => expect(btn).not.toHaveAttribute("aria-disabled"));
  });
});

describe("FeatureFlagsPage — webhook card", () => {
  it("Save is inactive with a visible reason until a URL is typed, and a submit then does nothing", async () => {
    const { calls } = stubFetch();
    render(<FeatureFlagsPage />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toHaveClass("pu-btn--primary");
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(screen.getByText(/enter a url to enable save/i)).toBeInTheDocument();
    fireEvent.submit(save.closest("form"));
    expect(calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);

    fireEvent.change(document.getElementById("egw-url"), { target: { value: " https://hook.test/x " } });
    expect(save).not.toHaveAttribute("aria-disabled");
    save.focus();
    fireEvent.click(save);
    await screen.findByText(/webhook url saved/i);
    const posts = calls.filter(([, init]) => init.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toEqual({ EXTERNAL_GUARDRAIL_WEBHOOK_URL: "https://hook.test/x" });
    expect(document.activeElement).toBe(save);
    // Now stored: the same button reads Clear and the card says Configured.
    expect(save).toHaveTextContent("Clear");
    expect(screen.getByTestId("ff-webhook")).toHaveTextContent("Configured");
  });

  it("never claims Not configured about a value it could not read", async () => {
    stubFetch({ config: { ok: false, body: { error: "nope" } } });
    render(<FeatureFlagsPage />);
    const card = await screen.findByTestId("ff-webhook");
    await waitFor(() => expect(within(card).getAllByText(/unknown/i).length).toBeGreaterThan(0));
    expect(card).not.toHaveTextContent(/not configured/i);
    expect(card).not.toHaveTextContent(/not set/i);
  });

  it("shows the stored URL and offers Clear when the field is empty", async () => {
    stubFetch({ config: { ok: true, body: { config: { EXTERNAL_GUARDRAIL_WEBHOOK_URL: "https://hook.test/stored" } } } });
    render(<FeatureFlagsPage />);
    const card = await screen.findByTestId("ff-webhook");
    await waitFor(() => expect(card).toHaveTextContent("https://hook.test/stored"));
    const btn = within(card).getByRole("button", { name: "Clear" });
    expect(btn).not.toHaveAttribute("aria-disabled");
  });
});
