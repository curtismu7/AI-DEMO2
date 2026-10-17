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

function mount(cfg) {
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? cfg : [] }));
  return render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
}

const slow = { timeout: 4000 };

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); localStorage.clear(); });

describe("ID-JAG playground page", () => {
  it("explains that ID-JAG needs PingFederate when the provider is PingOne", async () => {
    mount(config({ provider: "pingone", signedIn: false }));
    expect(await screen.findByText(/ID-JAG only exists on PingFederate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request ID-JAG" })).toBeDisabled();
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

    fireEvent.change(screen.getByLabelText(/narrower scope/), { target: { value: "mcp:read admin:all" } });
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

    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(screen.getAllByText(/refused/)).toHaveLength(4), { timeout: 4000 });
    expect(screen.getByText(/invalid_client/, { selector: ".ijp-result" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/narrower scope/), { target: { value: "admin:all" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem ID-JAG" }));
    expect(await screen.findByText("Response (HTTP 400)", {}, slow)).toBeInTheDocument();
    expect(screen.getByText("invalid_scope")).toBeInTheDocument();
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

  it("pf-pf sign-in navigates to the issuer login, not the shared sign-in", async () => {
    localStorage.setItem("idjag.playground.mode", "pf-pf");
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, assign } });
    try {
      mount(config({ mode: "pf-pf", signedIn: false }));
      const step1 = (await screen.findByRole("heading", { name: "Sign in at the issuer PingFederate" })).closest("section");
      await waitFor(() => expect(within(step1).getByRole("button")).toBeEnabled());
      fireEvent.click(within(step1).getByRole("button"));
      expect(assign).toHaveBeenCalledWith("/api/id-jag-playground/issuer/login?return_to=/pingfederate-id-jag/playground");
      expect(post).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  const IDP = { id: "partner", name: "Partner IdP", issuer: "https://idp.partner.test", jwksUrl: "https://idp.partner.test/jwks", idJagClientId: "partner-agent", clientId: "demo-bff-mcp-client", pfClientId: "ai-demo-pf-idjag-redeemer", scopes: "", targets: ["oauth-mcp"], enabled: true };
  const ENDPOINTS = { "oauth-mcp": { issuer: "https://as.test", tokenEndpoint: "https://as.test/token" }, pingfederate: { issuer: "https://pf.local", tokenEndpoint: "https://pf.local/as/token.oauth2" } };
  const mountWith = (cfg, registry) => {
    get.mockImplementation((url) => {
      if (url.endsWith("/config")) return Promise.resolve({ data: cfg });
      if (url.endsWith("/trusted-idps")) return typeof registry === "function" ? registry() : Promise.resolve({ data: registry });
      return Promise.resolve({ data: [] });
    });
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
