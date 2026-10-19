import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put, delete: del } }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";
import IdJagLearnPage from "../IdJagLearnPage";

const config = {
  provider: "pingfederate", enabled: true, signedIn: true,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "https://pf.test/pf/JWKS", exchangeClientId: "ai-demo-pf-user" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "demo-bff-mcp-client" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
};
const ISSUE_REQUEST = {
  endpoint: "POST https://pf.test/as/token.oauth2",
  body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: "[your session token, never sent to the browser]", audience: "https://as.test", client_id: "ai-demo-pf-user" },
};

// Answers by URL; the test sets the backends and the revoke reply it needs.
let backends = [];
let revokeReply;
beforeEach(() => {
  get.mockReset(); post.mockReset();
  backends = [{ id: "idp", label: "PingFederate", url: "https://pf.test/.well-known/openid-configuration", state: "up", ms: 12, detail: "12 ms" },
    { id: "resource-as", label: "oauth-mcp", url: "https://as.test/.well-known/oauth-authorization-server", state: "slow", ms: 1900, detail: "1900 ms" }];
  get.mockImplementation((url) => {
    if (url.endsWith("/config")) return Promise.resolve({ data: config });
    if (url.endsWith("/backends")) return Promise.resolve({ data: { backends } });
    if (url.endsWith("/preflight")) return Promise.resolve({ data: { ok: true, checks: [] } });
    if (url.endsWith("/trusted-idps")) return Promise.resolve({ data: { idps: [], canManage: false } });
    return Promise.resolve({ data: [] });
  });
  post.mockImplementation((url) => {
    if (url.endsWith("/issue")) return Promise.resolve({ data: { request: ISSUE_REQUEST, response: { issued_token_type: "urn:ietf:params:oauth:token-type:id-jag" }, token: { header: {}, claims: {} } } });
    if (url.endsWith("/inspect")) return Promise.resolve({ data: { checks: [], header: {}, claims: {} } });
    if (url.endsWith("/revoke")) return Promise.resolve({ data: revokeReply });
    return Promise.resolve({ data: {} });
  });
});

const renderPage = () => render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);

describe("ID-JAG playground: kit port", () => {
  it("shows each backend's state as text, not only colour", async () => {
    renderPage();
    const strip = await screen.findByTestId("ijp-backends");
    expect(await within(strip).findByText("PingFederate")).toBeInTheDocument();
    expect(within(strip).getByText("up")).toBeInTheDocument();
    expect(within(strip).getByText("slow: 1900 ms")).toBeInTheDocument();
  });

  it("Code view turns a request into fetch() with placeholders, never a token", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    await screen.findByText("Decoded ID-JAG");
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    const code = screen.getAllByTestId("ijp-code")[0];
    expect(code).toHaveTextContent('fetch("https://pf.test/as/token.oauth2"');
    expect(code).toHaveTextContent("subject_token: SUBJECT_TOKEN");
    expect(code).not.toHaveTextContent("never sent to the browser");
  });

  it("revoke and prove: a refused retry is reported as proved", async () => {
    revokeReply = {
      control: { ok: true, status: 200, error: null, request: ISSUE_REQUEST },
      revoke: { request: { endpoint: "POST https://pf.test/as/revoke_token.oauth2", body: {} }, status: 200, error: null },
      retry: { ok: false, status: 400, error: "invalid_request", request: ISSUE_REQUEST },
      proved: true,
    };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke and retry" }));
    expect(await screen.findByTestId("ijp-revoke-verdict")).toHaveTextContent("Proved: the issuer refused a new ID-JAG (invalid_request).");
    expect(post).toHaveBeenCalledWith("/api/id-jag-playground/revoke", {});
  });

  it("revoke and prove: a failed control says nothing was revoked", async () => {
    revokeReply = { control: { ok: false, status: 400, error: "invalid_client", request: ISSUE_REQUEST }, proved: false };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke and retry" }));
    expect(await screen.findByTestId("ijp-revoke-verdict")).toHaveTextContent("so nothing was revoked");
  });

  it("Start over clears every result and the server's copy, and keeps the sign-in", async () => {
    renderPage();
    const toolbarBtn = await screen.findByTestId("ijp-start-over");
    expect(toolbarBtn).toBeDisabled(); // nothing to clear yet
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    await screen.findByText("Decoded ID-JAG");
    expect(screen.getByTestId("ijp-start-over-step3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ijp-start-over"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/id-jag-playground/restart", {}));
    await waitFor(() => expect(screen.queryByText("Decoded ID-JAG")).toBeNull());
    expect(screen.getByTestId("ijp-start-over")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Request ID-JAG" })).toBeEnabled(); // still signed in: a new ID-JAG is one click away
  });

  it("step 1 says it is done when already signed in, names who, and offers only a quiet 'Sign in as someone else'", async () => {
    const base = get.getMockImplementation();
    get.mockImplementation((url) => (String(url).endsWith("/config") ? Promise.resolve({ data: { ...config, signedInAs: "cmuir@pingone.com" } }) : base(url)));
    renderPage();
    const status = await screen.findByTestId("ijp-signin-status");
    expect(status).toHaveTextContent("Signed in with PingFederate as cmuir@pingone.com. Nothing more to do in this step: continue to step 2.");
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in as someone else" })).not.toHaveClass("ijp-btn--primary");
    const step1 = screen.getByRole("heading", { name: "Sign in with PingFederate" }).closest("section");
    expect(step1.querySelector(".ijp-step__n")).toHaveClass("is-done");
    expect(within(step1).getByText("1 (done)")).toBeInTheDocument();
  });

  it("step 1 is the red sign-in call to action only while not signed in", async () => {
    const base = get.getMockImplementation();
    get.mockImplementation((url) => (String(url).endsWith("/config") ? Promise.resolve({ data: { ...config, signedIn: false } }) : base(url)));
    renderPage();
    const status = await screen.findByTestId("ijp-signin-status");
    expect(status).toHaveTextContent("Not signed in");
    expect(status).not.toHaveClass("ijp-status--ok");
    expect(screen.getByRole("button", { name: "Sign in with PingFederate" })).toHaveClass("ijp-btn--primary");
    const step1 = screen.getByRole("heading", { name: "Sign in with PingFederate" }).closest("section");
    expect(step1.querySelector(".ijp-step__n")).not.toHaveClass("is-done");
  });

  it("offers real MCP clients on localhost, pointed at the kit's sample server", async () => {
    renderPage();
    const panel = await screen.findByTestId("ijp-real-clients");
    expect(within(panel).getAllByText(/http:\/\/localhost:19090\/mcp/, { selector: "pre" }).length).toBeGreaterThan(0);
  });
});

describe("ID-JAG Learn page", () => {
  const renderLearn = () => render(<MemoryRouter><IdJagLearnPage /></MemoryRouter>);

  it("searches the glossary by term", async () => {
    renderLearn();
    fireEvent.click(screen.getByRole("tab", { name: "Glossary" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Cross App Access" } });
    expect(screen.getByText("Cross App Access (XAA)")).toBeInTheDocument();
    expect(screen.queryByText("Identity assertion")).toBeNull();
  });

  it("filters the source library by kind", async () => {
    renderLearn();
    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    const specs = screen.getByRole("button", { name: "Spec" });
    fireEvent.click(specs);
    expect(specs).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/draft-ietf-oauth-identity-assertion-authz-grant/)).toBeInTheDocument();
  });
});
