import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put, delete: del } }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const config = (over = {}) => ({
  provider: "pingfederate", enabled: true, signedIn: true,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "https://pf.test/pf/JWKS", exchangeClientId: "ai-demo-pf-user" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "demo-bff-mcp-client" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
  ...over,
});

const PASS = { ok: true, checks: [] };
let preflightReply;
const answerGet = (cfg, registry = []) => (url, opts) => {
  if (url.endsWith("/config")) return Promise.resolve({ data: cfg });
  if (url.endsWith("/preflight")) return Promise.resolve({ data: typeof preflightReply === "function" ? preflightReply(opts?.params || {}) : preflightReply });
  if (url.endsWith("/trusted-idps")) return typeof registry === "function" ? registry() : Promise.resolve({ data: registry });
  return Promise.resolve({ data: [] });
};

function mount(cfg) {
  get.mockImplementation(answerGet(cfg));
  return render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
}

const slow = { timeout: 4000 };
const now = () => Math.floor(Date.now() / 1000);
const posted = (path) => post.mock.calls.some(([u]) => u === `/api/id-jag-playground${path}`);

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); localStorage.clear(); preflightReply = PASS; });

describe("ID-JAG playground page", () => {
  it("explains that ID-JAG needs PingFederate when the provider is PingOne", async () => {
    mount(config({ provider: "pingone", signedIn: false }));
    expect(await screen.findByText(/ID-JAG only exists on PingFederate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request ID-JAG" })).toBeDisabled();
  });

  it("links the current mode's diagram and each step on it, in a new tab", async () => {
    localStorage.setItem("idjag.playground.mode", "mock");
    mount(config());
    const mode = screen.getByRole("link", { name: "View Mock diagram ↗" });
    expect(mode).toHaveAttribute("href", "/pingfederate-id-jag/playground/diagram/mock");
    expect(mode).toHaveAttribute("target", "_blank");
    const step3 = screen.getByRole("link", { name: "see step 3 on the diagram ↗" });
    expect(step3).toHaveAttribute("href", "/pingfederate-id-jag/playground/diagram/mock?step=3");
    expect(step3).toHaveAttribute("target", "_blank");
    expect(step3).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link", { name: /^see step \d on the diagram/ })).toHaveLength(5);
  });

  it("shows a message instead of crashing when the BFF has no playground API", async () => {
    mount("<!doctype html><html></html>");
    expect(await screen.findByText(/does not have the ID-JAG playground API/)).toBeInTheDocument();
  });

  it("issues an ID-JAG and shows the spec check table", async () => {
    mount(config());
    post.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/issue")
        ? { request: { grant_type: "token-exchange" }, response: { issued_token_type: "id-jag" }, token: { header: { typ: "oauth-id-jag+jwt" }, claims: { client_id: "demo-bff-mcp-client" } } }
        : { checks: [
            { id: "typ", label: "Header typ", status: "pass", expected: "oauth-id-jag+jwt", actual: "oauth-id-jag+jwt", rule: "4.1" },
            { id: "lifetime", label: "Lifetime", status: "warn", expected: "<= 300s", actual: "3600s", rule: "4.1" },
          ] },
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    const table = await screen.findByTestId("ijp-checks");
    expect(table).toHaveTextContent("Spec check: 1 of 2 pass");
    expect(table).toHaveTextContent("Header typ");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/id-jag-playground/inspect", {}));
  });

  it("mock mode runs steps 2-5 from fixtures with no network calls", async () => {
    localStorage.setItem("idjag.playground.mode", "mock");
    mount(config());
    expect(screen.getByTestId("ijp-mock-badge")).toHaveTextContent("Mock: sample data, nothing is sent");
    expect(screen.getByTestId("ijp-signin-status")).toHaveTextContent("Mock: no sign-in needed");

    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    expect(await screen.findByTestId("ijp-checks", {}, slow)).toHaveTextContent("Spec check: 17 of 17 pass");

    const scope = screen.getByRole("combobox", { name: /Scope to request/ });
    expect([...scope.options].map((o) => o.value)).toEqual(["", "mcp:read", "mcp:write"]);
    fireEvent.change(scope, { target: { value: "mcp:read" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    expect(await screen.findByText("Response (HTTP 200)", {}, slow)).toBeInTheDocument();
    expect(screen.getAllByText("mcp:read").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "List tools this token can see" }));
    expect(await screen.findByTestId("ijp-tool-count", {}, slow)).toHaveTextContent("3 tools");
    expect(screen.getByText(/Hidden by the gateway's policy: delete_record/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /query/ }), { target: { value: "acme" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /limit/ }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Call tool" }));
    expect(await screen.findByText("Sample result from search_records", {}, slow)).toBeInTheDocument();
    expect(screen.getAllByText("acme").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Open the protected page" }));
    const page = await screen.findByTestId("ijp-resource-page", {}, slow);
    expect(page).toHaveTextContent("200");
    expect(page).toHaveTextContent("user.0042");
    fireEvent.click(screen.getByRole("button", { name: "Try with the raw ID-JAG" }));
    await waitFor(() => expect(screen.getByTestId("ijp-resource-page")).toHaveTextContent(/token type check failed/), slow);

    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(screen.getAllByText(/^✅ refused/)).toHaveLength(4), { timeout: 4000 });
    expect(screen.getByText(/invalid_client/, { selector: ".ijp-result" })).toBeInTheDocument();
    expect(screen.getByText("Partner Okta (sample)")).toBeInTheDocument();

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  }, 15000);

  it("Form | JSON toggle switches how data renders", async () => {
    localStorage.setItem("idjag.playground.mode", "mock");
    const { container } = mount(config());
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    await screen.findByTestId("ijp-checks", {}, slow);
    expect(container.querySelector(".ijp-json")).toBeNull();
    expect(container.querySelector(".ijp-kv dt")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(container.querySelector(".ijp-form")).toBeNull();
    expect(container.querySelector(".ijp-json").textContent).toContain('"grant_type"');
    expect(localStorage.getItem("idjag.playground.view")).toBe("json");
  });

  it("picking a real mode calls POST /mode and re-renders from the returned config", async () => {
    mount(config({ mode: "oauth-mcp", modes: [{ id: "oauth-mcp", available: true }, { id: "pf-pf", available: true }] }));
    post.mockResolvedValue({ data: config({ mode: "pf-pf", idp: { ...config().idp, name: "PingFederate (SE, issuer)" }, resourceAs: { ...config().resourceAs, name: "PingFederate (local, resource AS)" } }) });
    fireEvent.click(await screen.findByRole("button", { name: "PingFederate → PingFederate" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/id-jag-playground/mode", { mode: "pf-pf" }));
    expect(await screen.findByText("Resource AS: PingFederate (local, resource AS)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Redeem it at the local PingFederate" })).toBeInTheDocument();
    expect(localStorage.getItem("idjag.playground.mode")).toBe("pf-pf");
  });

  it("shows an unavailable mode disabled with its reason", async () => {
    mount(config({ mode: "oauth-mcp", modes: [{ id: "oauth-mcp", available: true }, { id: "pf-pf", available: false, reason: "Local PingFederate not configured" }] }));
    const btn = await screen.findByRole("button", { name: "PingFederate → PingFederate" });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("title", "Local PingFederate not configured");
  });

  it("pf-pf sign-in falls back to the issuer login redirect when the modal does not take it", async () => {
    localStorage.setItem("idjag.playground.mode", "pf-pf");
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, assign } });
    try {
      mount(config({ mode: "pf-pf", signedIn: false }));
      const step1 = (await screen.findByRole("heading", { name: "Sign in at the issuer PingFederate" })).closest("section");
      await waitFor(() => expect(within(step1).getByRole("button")).toBeEnabled());
      fireEvent.click(within(step1).getByRole("button"));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/api\/id-jag-playground\/issuer\/login\?return_to=%2Fpingfederate-id-jag%2Fplayground$/)));
      expect(get).toHaveBeenCalledWith("/api/id-jag-playground/preflight", { params: expect.objectContaining({ step: "signin", mode: "pf-pf" }) });
      expect(post).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  const IDP = { id: "partner", name: "Partner IdP", issuer: "https://idp.partner.test", jwksUrl: "https://idp.partner.test/jwks", idJagClientId: "partner-agent", clientId: "demo-bff-mcp-client", pfClientId: "ai-demo-pf-idjag-redeemer", scopes: "", targets: ["oauth-mcp"], enabled: true };
  const ENDPOINTS = { "oauth-mcp": { issuer: "https://as.test", tokenEndpoint: "https://as.test/token" }, pingfederate: { issuer: "https://pf.local", tokenEndpoint: "https://pf.local/as/token.oauth2" } };
  const mountWith = (cfg, registry) => {
    get.mockImplementation(answerGet(cfg, registry));
    return render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  };

  it("byo: paste an ID-JAG, inspect it against the trusted IdP, then redeem", async () => {
    localStorage.setItem("idjag.playground.mode", "byo");
    mountWith(config({ mode: "byo", signedIn: false, publicEndpoints: ENDPOINTS }), { idps: [IDP], canManage: false });
    post.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/byo/inspect")
      ? { trusted: true, header: { typ: "oauth-id-jag+jwt" }, claims: { iss: IDP.issuer, client_id: "partner-agent" }, checks: [{ id: "iss", label: "Issuer is Partner IdP", status: "pass", expected: IDP.issuer, actual: IDP.issuer }] }
      : { request: { client_id: "demo-bff-mcp-client" }, status: 200, response: { token_type: "Bearer" }, token: { header: {}, claims: { scope: "mcp:read" } } } }));
    const step1 = (await screen.findByRole("heading", { name: "Paste an ID-JAG from your IdP" })).closest("section");
    expect(within(step1).getByText("https://as.test")).toBeInTheDocument();
    fireEvent.click(within(step1).getByRole("button", { name: "PingFederate" }));
    expect(within(step1).getByText("https://pf.local")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request ID-JAG" })).toBeNull();
    expect(screen.getByRole("button", { name: "Redeem ID-JAG" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Your ID-JAG/), { target: { value: " a.b.c " } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect ID-JAG" }));
    expect(await screen.findByTestId("ijp-checks")).toHaveTextContent("Spec check: 1 of 1 pass");
    expect(post).toHaveBeenCalledWith("/api/id-jag-playground/byo/inspect", { idJag: "a.b.c", target: "pingfederate" });

    const redeem = screen.getByRole("button", { name: "Redeem ID-JAG" });
    await waitFor(() => expect(redeem).toBeEnabled());
    fireEvent.click(redeem);
    expect(await screen.findByText("Response (HTTP 200)")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/id-jag-playground/redeem", {}, expect.anything());
  });

  it("byo: an untrusted issuer shows the hint and keeps redeem disabled", async () => {
    localStorage.setItem("idjag.playground.mode", "byo");
    mountWith(config({ mode: "byo", publicEndpoints: ENDPOINTS }), { idps: [], canManage: false });
    post.mockResolvedValue({ data: { trusted: false, hint: "Add this issuer on the Trusted IdPs panel (admin).", header: {}, claims: {}, checks: [{ id: "trusted-idp", label: "Issuer is a trusted IdP", status: "fail" }] } });
    fireEvent.change(await screen.findByLabelText(/Your ID-JAG/), { target: { value: "a.b.c" } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect ID-JAG" }));
    expect(await screen.findByTestId("ijp-byo-hint")).toHaveTextContent("Trusted IdPs panel");
    expect(screen.getByRole("button", { name: "Redeem ID-JAG" })).toBeDisabled();
  });

  // ---- xaa.dev: IdenX (Okta's public XAA playground) as a real outside IdP ----

  const XAA_BUTTON = "Get an ID-JAG from xaa.dev (IdenX, a free third-party IdP)";
  const XAA_OK = { available: true, reason: null, signedIn: false, user: null };
  const XAA_INSPECTION = {
    trusted: true, idp: { id: "xaa-dev", name: "xaa.dev IdenX" }, header: { typ: "oauth-id-jag+jwt" },
    claims: { iss: "https://idp.xaa.dev", client_id: "xaa-at-oauth-mcp", scope: "read", exp: now() + 300 },
    checks: [{ id: "iss", label: "Issuer is xaa.dev IdenX", status: "pass", expected: "https://idp.xaa.dev", actual: "https://idp.xaa.dev" }],
    request: { endpoint: "POST https://idp.xaa.dev/token", body: { audience: "https://as.test", subject_token: "[your IdenX refresh token, kept server-side]" } },
  };
  const mountAt = (cfg, path) => {
    get.mockImplementation(answerGet(cfg, { idps: [], canManage: false }));
    return render(<MemoryRouter initialEntries={[path]}><IdJagPlaygroundPage /></MemoryRouter>);
  };

  it("byo: the xaa.dev button signs in at IdenX first (after its pre-flight) and links xaa.dev in a new tab", async () => {
    localStorage.setItem("idjag.playground.mode", "byo");
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, assign } });
    try {
      mountWith(config({ mode: "byo", publicEndpoints: ENDPOINTS, xaa: XAA_OK }), { idps: [], canManage: false });
      const link = within(await screen.findByTestId("ijp-xaa")).getByRole("link", { name: "xaa.dev" });
      expect(link).toHaveAttribute("href", "https://xaa.dev");
      expect(link).toHaveAttribute("target", "_blank");
      const btn = screen.getByRole("button", { name: XAA_BUTTON });
      await waitFor(() => expect(btn).toBeEnabled());
      fireEvent.click(btn);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/id-jag-playground/xaa/login?return_to=/pingfederate-id-jag/playground"));
      expect(get).toHaveBeenCalledWith("/api/id-jag-playground/preflight", { params: expect.objectContaining({ step: "xaa", mode: "byo" }) });
      expect(post).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  it("byo: back from IdenX (?xaa=signed_in) it gets the ID-JAG and shows the inspection, ready to redeem", async () => {
    localStorage.setItem("idjag.playground.mode", "byo");
    post.mockResolvedValue({ data: XAA_INSPECTION });
    mountAt(config({ mode: "byo", publicEndpoints: ENDPOINTS, xaa: { ...XAA_OK, signedIn: true, user: "alice@example.com" } }),
      "/pingfederate-id-jag/playground?xaa=signed_in");
    expect(await screen.findByTestId("ijp-checks")).toHaveTextContent("Spec check: 1 of 1 pass");
    expect(post).toHaveBeenCalledWith("/api/id-jag-playground/xaa/id-jag", {});
    expect(screen.getByText("Request to IdenX")).toBeInTheDocument();
    expect(screen.getByText(/Signed in at IdenX as alice@example.com/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Redeem ID-JAG" })).toBeEnabled());
  });

  it("byo: shows an IdenX sign-in error from the redirect, and a disabled button with the reason when unavailable", async () => {
    localStorage.setItem("idjag.playground.mode", "byo");
    mountAt(config({ mode: "byo", publicEndpoints: ENDPOINTS, xaa: { available: false, reason: "Available on the hosted demo: oauth-mcp's issuer here is http://pf-mcp-server:8080." } }),
      "/pingfederate-id-jag/playground?xaa_error=invalid_state");
    expect(await screen.findByText(/IdenX sign-in did not complete \(invalid_state\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: XAA_BUTTON })).toBeDisabled();
    expect(screen.getByTestId("ijp-xaa-reason")).toHaveTextContent("Available on the hosted demo");
    expect(post).not.toHaveBeenCalled();
  });

  it("mock: the xaa.dev button gives a sample IdenX ID-JAG that redeems, with no network calls", async () => {
    localStorage.setItem("idjag.playground.mode", "mock");
    mount(config());
    fireEvent.click(screen.getByRole("button", { name: XAA_BUTTON }));
    const table = await screen.findByTestId("ijp-checks", {}, slow);
    expect(table).toHaveTextContent("Spec check: 17 of 17 pass");
    expect(table).toHaveTextContent("https://idp.xaa.dev");
    const redeem = screen.getByRole("button", { name: "Redeem ID-JAG" });
    await waitFor(() => expect(redeem).toBeEnabled());
    fireEvent.click(redeem);
    expect(await screen.findByText("Response (HTTP 200)", {}, slow)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  }, 10000);

  it("Trusted IdPs: admin adds, edits and deletes (with an in-page confirm)", async () => {
    mountWith(config({ publicEndpoints: ENDPOINTS }), { idps: [IDP], canManage: true });
    post.mockResolvedValue({ data: {} }); put.mockResolvedValue({ data: {} }); del.mockResolvedValue({ data: null });
    const panel = await screen.findByTestId("ijp-trusted-idps");
    expect(await within(panel).findByText("Partner IdP")).toBeInTheDocument();
    expect(within(panel).getByText("partner-agent")).toBeInTheDocument();
    expect(within(panel).getByText("https://as.test/token")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Add trusted IdP" }));
    const add = within(panel).getByRole("form", { name: "Add trusted IdP" });
    fireEvent.change(within(add).getByLabelText("Id (slug)"), { target: { value: "acme" } });
    fireEvent.change(within(add).getByLabelText("Issuer (https)"), { target: { value: "https://acme.test" } });
    fireEvent.click(within(add).getByRole("checkbox", { name: "PingFederate" }));
    fireEvent.click(within(add).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/id-jag-playground/trusted-idps", expect.objectContaining({ id: "acme", issuer: "https://acme.test", targets: ["oauth-mcp", "pingfederate"], enabled: true })));

    fireEvent.click(await within(panel).findByRole("button", { name: "Edit" }));
    const edit = within(panel).getByRole("form", { name: "Edit trusted IdP" });
    expect(within(edit).getByLabelText("Id (slug)")).toBeDisabled();
    fireEvent.click(within(edit).getByRole("checkbox", { name: "Enabled" }));
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/id-jag-playground/trusted-idps/partner", expect.objectContaining({ enabled: false, name: "Partner IdP" })));
    expect(put.mock.calls[0][1]).not.toHaveProperty("editing");

    const confirmSpy = vi.spyOn(window, "confirm");
    fireEvent.click(await within(panel).findByRole("button", { name: "Delete" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/id-jag-playground/trusted-idps/partner"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // ---- foolproofing: preflight before every button, lifetimes, plain-language errors ----

  const issuedWith = (claims) => ({ request: {}, response: {}, token: { header: { typ: "oauth-id-jag+jwt" }, claims } });
  const replies = (map) => post.mockImplementation((url, body) => {
    const key = url.replace("/api/id-jag-playground", "");
    const v = typeof map[key] === "function" ? map[key](body) : map[key];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v ?? { checks: [] } });
  });
  const FIX = "Open https://local.ping-devops.com:4000/pingfederate-id-jag/playground. Sign-in returns to that host.";

  it("a failing preflight blocks the action (nothing is sent), shows the fix, and Re-check runs it again", async () => {
    mount(config());
    preflightReply = (p) => (p.step === "issue"
      ? { ok: false, checks: [{ id: "origin", label: "This page is on the app host", status: "fail", detail: "This page is on https://api.ping.demo:4000.", fix: FIX }] }
      : PASS);
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    const panel = await screen.findByTestId("ijp-preflight");
    expect(panel).toHaveTextContent(FIX);
    expect(panel).toHaveTextContent("nothing was sent");
    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith("/api/id-jag-playground/preflight", { params: expect.objectContaining({ step: "issue", mode: "oauth-mcp", origin: window.location.origin }) });

    preflightReply = PASS;
    fireEvent.click(within(panel).getByRole("button", { name: "Re-check" }));
    await waitFor(() => expect(screen.getByTestId("ijp-preflight")).toHaveTextContent("All checks pass"));
    expect(get).toHaveBeenLastCalledWith("/api/id-jag-playground/preflight", { params: expect.objectContaining({ step: "issue", fresh: "1" }) });
    expect(post).not.toHaveBeenCalled();
  });

  it("warnings show but do not block", async () => {
    mount(config());
    preflightReply = { ok: true, checks: [{ id: "jwks", label: "Signing keys", status: "warn", detail: "2 distinct RSA keys: the PingFederate redeemer may pick the wrong key", fix: "Publish a single-key JWKS." }] };
    replies({ "/issue": issuedWith({ iat: now(), exp: now() + 300 }) });
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    expect(await screen.findByTestId("ijp-preflight")).toHaveTextContent("may pick the wrong key");
    await waitFor(() => expect(posted("/issue")).toBe(true));
  });

  it("marks an expired ID-JAG stale, and its preflight failure blocks Redeem", async () => {
    mount(config());
    replies({ "/issue": issuedWith({ iat: now() - 400, exp: now() - 100, scope: "mcp:invoke" }) });
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    const life = await screen.findByTestId("ijp-life-idjag");
    expect(life).toHaveTextContent(/expired/);
    // Expired is a caution (amber), never the red of an error.
    expect(life).toHaveClass("is-expired");
    preflightReply = (p) => (p.step === "redeem"
      ? { ok: false, checks: [{ id: "id-jag", label: "An unused, unexpired ID-JAG", status: "fail", detail: "It expired 100 s ago.", fix: "Request a new ID-JAG (step 2)." }] }
      : PASS);
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    expect(await screen.findByTestId("ijp-preflight")).toHaveTextContent("Request a new ID-JAG (step 2).");
    expect(posted("/redeem")).toBe(false);
  });

  it("scope dropdown: disabled before an ID-JAG, defaults to all (no scope sent), sends exactly the picked scope, resets a stale pick", async () => {
    mount(config());
    const scope = await screen.findByRole("combobox", { name: /Scope to request/ });
    expect(scope).toBeDisabled();
    expect(screen.getByText("Request an ID-JAG first.")).toBeInTheDocument();
    let n = 0;
    replies({
      "/issue": () => issuedWith({ iat: now(), exp: now() + 300, scope: (n++ === 0) ? "openid mcp:invoke accounts:read" : "openid mcp:invoke" }),
      "/redeem": { request: {}, status: 200, response: {}, token: { header: {}, claims: { exp: now() + 600 } } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect(scope).toBeEnabled());
    expect([...scope.options].map((o) => [o.value, o.text])).toEqual([["", "All scopes in this ID-JAG (recommended)"], ["mcp:invoke", "mcp:invoke"], ["accounts:read", "accounts:read"]]);

    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    await waitFor(() => expect(posted("/redeem")).toBe(true));
    expect(post.mock.calls.find(([u]) => u.endsWith("/redeem"))[1]).toEqual({});

    fireEvent.change(scope, { target: { value: "accounts:read" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    await waitFor(() => expect(post.mock.calls.filter(([u]) => u.endsWith("/redeem"))).toHaveLength(2));
    expect(post.mock.calls.filter(([u]) => u.endsWith("/redeem"))[1][1]).toEqual({ scope: "accounts:read" });
    expect(get).toHaveBeenCalledWith("/api/id-jag-playground/preflight", { params: expect.objectContaining({ step: "redeem", scope: "accounts:read" }) });

    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect([...scope.options].map((o) => o.value)).toEqual(["", "mcp:invoke"]));
    expect(scope.value).toBe("");
  });

  it("translates PingFederate's \"Invalid JWT token\" and invalid_target into what to fix", async () => {
    mount(config());
    replies({
      "/issue": issuedWith({ iat: now(), exp: now() + 300 }),
      "/redeem": { request: {}, status: 400, response: { error: "invalid_grant", error_description: "Invalid JWT token" }, token: null },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect(posted("/issue")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    expect(await screen.findByText(/single-key JWKS/)).toBeInTheDocument();

    replies({ "/issue": Object.assign(new Error("502"), { response: { data: { error: "id_jag_issue_failed", message: "SE PingFederate refused the exchange (HTTP 400 invalid_target)", pfError: "invalid_target" } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    expect(await screen.findByText(/access token manager/)).toBeInTheDocument();
  });

  it("step 4 results: an explicit empty state, and a denied call shows the gateway's reason with guidance", async () => {
    mount(config());
    replies({
      "/issue": issuedWith({ iat: now(), exp: now() + 300 }),
      "/redeem": { request: {}, status: 200, response: {}, token: { header: {}, claims: { exp: now() + 600 } } },
      "/call": (body) => (body?.tool
        ? Object.assign(new Error("403"), { response: { data: { error: "gateway_policy_denied", message: "Tool transfer_funds does not match intent read_accounts", gatewayStatus: 403, gatewayErrorCode: "intent_mismatch", gatewayMessage: "Tool transfer_funds does not match intent read_accounts" } } })
        : { request: { endpoint: "POST https://node-gw.test/mcp" }, tools: [], deniedTools: ["transfer_funds"] }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect(posted("/issue")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "List tools this token can see" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "List tools this token can see" }));
    const results = await screen.findByTestId("ijp-results");
    expect(results).toHaveTextContent("0 tools");
    expect(results).toHaveTextContent("Hidden by the gateway's policy: transfer_funds");

    replies({ "/call": { request: {}, tools: [{ name: "transfer_funds", inputSchema: null }], deniedTools: [] } });
    fireEvent.click(screen.getByRole("button", { name: "List tools this token can see" }));
    await waitFor(() => expect(screen.getByTestId("ijp-results")).toHaveTextContent("1 tools"));
    replies({ "/call": Object.assign(new Error("403"), { response: { data: { error: "gateway_policy_denied", message: "Tool transfer_funds does not match intent read_accounts", gatewayStatus: 403, gatewayErrorCode: "intent_mismatch", gatewayMessage: "Tool transfer_funds does not match intent read_accounts" } } }) });
    fireEvent.click(screen.getByRole("button", { name: "Call tool" }));
    await waitFor(() => expect(screen.getByTestId("ijp-results")).toHaveTextContent("intent_mismatch"));
    expect(screen.getByTestId("ijp-results")).toHaveTextContent(/intent policy/);
  });

  it("protected resource: renders the resource server's page, and its refusal names the failed check", async () => {
    mount(config());
    const ok = { request: { method: "GET", url: "https://as.test/protected/profile", authorization: "Bearer [access token]" }, status: 200,
      body: { resource: "https://as.test/protected/profile", verified: [{ check: "bearer", ok: true, detail: "present" }, { check: "signature", ok: true, detail: "Verified." }],
        principal: { sub: "demouser", client_id: "demo-bff-mcp-client", scope: "mcp:invoke" }, data: { profileId: "prf-1234", subject: "demouser", plan: "Standard", status: "active" } } };
    const none = { request: { method: "GET", url: "https://as.test/protected/profile", authorization: "none" }, status: 401,
      body: { error: "unauthorized", verified: [{ check: "bearer", ok: false, detail: "No Authorization: Bearer header." }] } };
    replies({
      "/issue": issuedWith({ iat: now(), exp: now() + 300 }),
      "/redeem": { request: {}, status: 200, response: {}, token: { header: {}, claims: { exp: now() + 600 } } },
      "/resource": (body) => (body.variant === "token" ? ok : none),
    });
    const open = await screen.findByRole("button", { name: "Open the protected page" });
    expect(open).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect(posted("/issue")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const page = await screen.findByTestId("ijp-resource-page");
    expect(page).toHaveTextContent("https://as.test/protected/profile");
    expect(page).toHaveTextContent("Who the resource server says you are");
    expect(page).toHaveTextContent("demouser");
    expect(page).toHaveTextContent("How it verified the token");
    expect(page).toHaveTextContent("prf-1234");
    expect(post).toHaveBeenCalledWith("/api/id-jag-playground/resource", { variant: "token" }, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Try without a token" }));
    await waitFor(() => expect(screen.getByTestId("ijp-resource-page")).toHaveTextContent("bearer check failed"));
    expect(screen.getByTestId("ijp-resource-page")).toHaveTextContent("401");

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByTestId("ijp-resource")).toHaveTextContent('"authorization": "none"');
  });

  it("a mode switch is preflighted too: an unavailable mode is not posted", async () => {
    mount(config({ mode: "oauth-mcp", modes: [{ id: "oauth-mcp", available: true }, { id: "byo", available: true }] }));
    preflightReply = (p) => (p.step === "mode" ? { ok: false, checks: [{ id: "origin", label: "This page is on the app host", status: "fail", detail: "Wrong host.", fix: FIX }] } : PASS);
    fireEvent.click(await screen.findByRole("button", { name: "Your IdP → our resource AS" }));
    expect(await screen.findByTestId("ijp-preflight")).toHaveTextContent(FIX);
    expect(posted("/mode")).toBe(false);
  });

  it("Trusted IdPs: non-admins get a read-only list; signed-out visitors a sign-in note", async () => {
    const { unmount } = mountWith(config({ publicEndpoints: ENDPOINTS }), { idps: [IDP], canManage: false });
    const panel = await screen.findByTestId("ijp-trusted-idps");
    expect(await within(panel).findByText("Partner IdP")).toBeInTheDocument();
    expect(within(panel).getByTestId("ijp-trusted-readonly")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Add trusted IdP|Edit|Delete/ })).toBeNull();
    expect(get).toHaveBeenCalledWith("/api/id-jag-playground/trusted-idps", { _noAuthBanner: true });
    unmount();

    mountWith(config(), () => Promise.reject(Object.assign(new Error("401"), { response: { status: 401, data: {} } })));
    expect(await screen.findByTestId("ijp-trusted-signin")).toBeInTheDocument();
  });
});
