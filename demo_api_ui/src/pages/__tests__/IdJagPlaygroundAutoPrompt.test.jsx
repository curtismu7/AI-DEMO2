import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, openSignIn } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), openSignIn: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock("../../utils/signInService", () => ({ openSignIn }));

import { PI_FLOW_SIGNIN_EVENT } from "../../utils/authUi";
import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const RETURN_TO = "/pingfederate-id-jag/playground";
const modes = [{ id: "oauth-mcp", available: true }, { id: "pf-pf", available: true }, { id: "byo", available: true }];
const config = {
  provider: "pingone", enabled: true, signedIn: false, signIn: { via: "issuer", reason: null }, modes,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "", exchangeClientId: "c" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "d" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
};
const signedOut = () => Promise.reject({ response: { status: 401, data: { error: "hosted_access_required", message: "Sign in to continue." } } });

function serve(cfg) {
  get.mockImplementation((url) => (url.endsWith("/config") ? (typeof cfg === "function" ? cfg() : Promise.resolve({ data: cfg }))
    : Promise.resolve({ data: url.endsWith("/preflight") ? { ok: true, checks: [] } : [] })));
  // POST /mode answers with the config for the lane that was asked for.
  post.mockImplementation((url, body) => Promise.resolve({ data: url.endsWith("/mode") ? { ...(typeof cfg === "function" ? config : cfg), mode: body.mode } : {} }));
}
const mount = () => render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { openSignIn.mockClear(); get.mockReset(); post.mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

// Stands in for PiFlowSignInModal: records each sign-in event and claims it once it is "ready".
const events = [];
let modalReadyAfter = 0;
const onSignIn = (e) => { events.push({ ...e.detail }); if (events.length > modalReadyAfter) e.detail.handled = true; };
beforeEach(() => { events.length = 0; modalReadyAfter = 0; window.addEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn); });
afterEach(() => window.removeEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn));

describe("signed out of the app", () => {
  it("opens the app sign-in modal once, and not again after a dismiss, a re-render or a lane click", async () => {
    serve(signedOut);
    const { rerender } = mount();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ role: "customer", returnTo: RETURN_TO });
    expect(await screen.findByText("Sign in to use the playground")).toBeTruthy();
    rerender(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "PingFederate → PingFederate" }));
    await flush();
    expect(events).toHaveLength(1);
    expect(openSignIn).not.toHaveBeenCalled(); // never an issuer prompt while the app itself is signed out
  });

  it("keeps trying until the modal is ready to take it, then stops", async () => {
    modalReadyAfter = 2; // the modal ignores the first two events (still loading its config)
    serve(signedOut);
    mount();
    await vi.waitFor(() => expect(events).toHaveLength(3), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(events).toHaveLength(3);
  });

  it("the visible Sign in button reopens it", async () => {
    serve(signedOut);
    mount();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(openSignIn).toHaveBeenCalledTimes(1);
    expect(openSignIn).toHaveBeenCalledWith({ role: "customer", returnTo: RETURN_TO });
  });

  it("ignores closed (aria-hidden) drawers the app keeps in the page", async () => {
    const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.setAttribute("aria-hidden", "true"); document.body.appendChild(d);
    serve(signedOut);
    mount();
    await vi.waitFor(() => expect(events).toHaveLength(1));
  });

  it("does not open over another dialog", async () => {
    const d = document.createElement("div"); d.setAttribute("role", "dialog"); document.body.appendChild(d);
    serve(signedOut);
    mount();
    await screen.findByText("Sign in to use the playground");
    await flush();
    expect(events).toHaveLength(0);
  });
});

describe("signed in to the app, not at PingFederate", () => {
  it("a lane click opens the issuer sign-in once", async () => {
    serve(config);
    mount();
    await screen.findByRole("button", { name: "Sign in with PingFederate" });
    await flush();
    expect(openSignIn).not.toHaveBeenCalled(); // initial load never prompts
    fireEvent.click(screen.getByRole("button", { name: "PingFederate → PingFederate" }));
    await vi.waitFor(() => expect(openSignIn).toHaveBeenCalledTimes(1));
    expect(openSignIn).toHaveBeenCalledWith({ role: "issuer", returnTo: RETURN_TO, force: true });
    await flush();
    expect(openSignIn).toHaveBeenCalledTimes(1); // re-renders do not reopen it
  });

  it("a restored stored lane does not prompt on load", async () => {
    localStorage.setItem("idjag.playground.mode", "pf-pf");
    serve({ ...config, mode: "pf-pf" });
    mount();
    await screen.findByRole("button", { name: "Sign in at the issuer PingFederate" });
    await flush();
    expect(openSignIn).not.toHaveBeenCalled();
  });

  it("no prompt when already signed in at PingFederate", async () => {
    serve({ ...config, signedIn: true });
    mount();
    await screen.findByText(/Signed in with PingFederate/);
    fireEvent.click(screen.getByRole("button", { name: "PingFederate → PingFederate" }));
    await flush();
    expect(openSignIn).not.toHaveBeenCalled();
  });

  it("no prompt for mock or byo", async () => {
    serve(config);
    mount();
    await screen.findByRole("button", { name: "Sign in with PingFederate" });
    for (const name of [/^Mock/, /^Your IdP/]) {
      fireEvent.click(screen.getByRole("button", { name }));
      await flush();
    }
    expect(openSignIn).not.toHaveBeenCalled();
  });
});
