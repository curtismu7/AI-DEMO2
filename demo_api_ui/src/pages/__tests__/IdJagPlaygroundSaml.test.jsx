import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put, delete: del } }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const SAML_OK = { available: true, reason: null, audience: "idJagDemoSamlAud", issuer: "https://app.test/saml", supportedModes: ["oauth-mcp", "pf-pf"], appSignedIn: true };
const config = (saml = SAML_OK, over = {}) => ({
  mode: "oauth-mcp", provider: "pingfederate", enabled: true, signedIn: true,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "https://pf.test/pf/JWKS", exchangeClientId: "ai-demo-pf-user" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "demo-bff-mcp-client" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
  saml,
  ...over,
});

const ASSERTION = {
  issuer: "https://app.test/saml", nameId: "alice@example.com", nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  audience: "idJagDemoSamlAud", issueInstant: "2026-10-19T10:00:00Z", notBefore: "2026-10-19T09:59:00Z", notOnOrAfter: "2026-10-19T10:05:00Z",
  signature: { algorithm: "rsa-sha256", canonicalization: "exc-c14n", certSha1: "AB:CD" },
  xml: "<Assertion><DigestValue>[…]</DigestValue><SignatureValue>[…]</SignatureValue><X509Certificate>[…]</X509Certificate></Assertion>",
};

const answerGet = (cfg) => (url) => {
  if (url.endsWith("/config")) return Promise.resolve({ data: cfg });
  if (url.endsWith("/preflight")) return Promise.resolve({ data: { ok: true, checks: [] } });
  return Promise.resolve({ data: [] });
};
function mount(cfg, mode = "oauth-mcp") {
  localStorage.setItem("idjag.playground.mode", mode);
  get.mockImplementation(answerGet(cfg));
  post.mockImplementation((url, body) => Promise.resolve({
    data: url.endsWith("/issue")
      ? { request: { endpoint: "POST https://pf.test/as/token.oauth2", body: { subject_token_type: body?.protocol === "saml" ? "urn:ietf:params:oauth:token-type:saml2" : "refresh_token" } }, response: { issued_token_type: "id-jag" }, token: { header: { typ: "oauth-id-jag+jwt" }, claims: { client_id: "c" } }, ...(body?.protocol === "saml" ? { assertion: ASSERTION } : {}) }
      : url.endsWith("/mode") ? config(SAML_OK, { mode: body.mode }) : { checks: [] },
  }));
  return render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
}
const issueBodies = () => post.mock.calls.filter(([u]) => u.endsWith("/issue")).map(([, b]) => b);
const samlButton = () => screen.getByRole("button", { name: "SAML" });

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset(); localStorage.clear(); });

describe("ID-JAG playground SAML toggle", () => {
  it("disables SAML with the server's reason when it is unavailable", async () => {
    mount(config({ ...SAML_OK, available: false, reason: "SAML signing key is not set (SAML_SIGNING_KEY_PEM_B64)." }));
    await screen.findByText(/SAML signing key is not set/);
    expect(samlButton()).toBeDisabled();
    expect(samlButton()).toHaveAttribute("title", expect.stringContaining("SAML_SIGNING_KEY_PEM_B64"));
    expect(screen.getByTestId("ijp-saml-reason")).toHaveTextContent("SAML signing key is not set");
  });

  it.each(["oauth-mcp", "pf-pf"])("enables SAML in %s and posts protocol saml", async (mode) => {
    mount(config(SAML_OK, { mode }), mode);
    await screen.findByRole("button", { name: "Request ID-JAG" });
    await waitFor(() => expect(samlButton()).toBeEnabled());
    fireEvent.click(samlButton());
    expect(samlButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    await screen.findByTestId("ijp-assertion");
    expect(issueBodies()).toEqual([{ protocol: "saml" }]);
  });

  it("posts an empty body for OIDC", async () => {
    mount(config());
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    await waitFor(() => expect(issueBodies()).toEqual([{}]));
    expect(screen.queryByTestId("ijp-assertion")).toBeNull();
  });

  it("shows the masked assertion and never a raw signature", async () => {
    mount(config());
    await screen.findByRole("button", { name: "Request ID-JAG" });
    await waitFor(() => expect(samlButton()).toBeEnabled());
    fireEvent.click(samlButton());
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    const panel = await screen.findByTestId("ijp-assertion");
    expect(panel).toHaveTextContent("alice@example.com");
    expect(panel).toHaveTextContent("idJagDemoSamlAud");
    const xml = screen.getByTestId("ijp-assertion-xml").textContent;
    expect(xml).toContain("<SignatureValue>[…]</SignatureValue>");
    expect(xml).toContain("<DigestValue>[…]</DigestValue>");
    expect(xml).toContain("<X509Certificate>[…]</X509Certificate>");
    expect(xml).not.toMatch(/>[A-Za-z0-9+/=]{40,}</);
  });

  it("remembers the choice in localStorage", async () => {
    const first = mount(config());
    await screen.findByRole("button", { name: "Request ID-JAG" });
    await waitFor(() => expect(samlButton()).toBeEnabled());
    fireEvent.click(samlButton());
    expect(localStorage.getItem("idjag.playground.protocol")).toBe("saml");
    first.unmount();
    mount(config());
    await screen.findByRole("button", { name: "Request ID-JAG" });
    expect(samlButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("still renders when storage is blocked", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      get.mockImplementation(answerGet(config()));
      render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
      await screen.findByRole("button", { name: "Request ID-JAG" });
      await waitFor(() => expect(samlButton()).toBeEnabled());
    } finally { spy.mockRestore(); }
  });

  it("disables SAML in byo mode even when a SAML choice was saved", async () => {
    localStorage.setItem("idjag.playground.protocol", "saml");
    mount(config(), "byo");
    await screen.findByText(/Your ID-JAG's aud must be/);
    expect(samlButton()).toBeDisabled();
    expect(samlButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("ijp-saml-reason")).toHaveTextContent(/PingFederate/);
  });

  it("enables SAML in mock mode and shows a sample masked assertion with no network call", async () => {
    mount(config(), "mock");
    await screen.findByRole("button", { name: "Request ID-JAG" });
    await waitFor(() => expect(samlButton()).toBeEnabled());
    fireEvent.click(samlButton());
    fireEvent.click(screen.getByRole("button", { name: "Request ID-JAG" }));
    const xml = (await screen.findByTestId("ijp-assertion-xml")).textContent;
    expect(xml).toContain("[…]");
    expect(post).not.toHaveBeenCalled();
  });
});
