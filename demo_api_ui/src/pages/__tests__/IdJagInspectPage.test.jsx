import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import terms from "../../data/idJagTerms.json";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post } }));

import IdJagInspectPage, { CHECK_TERMS } from "../IdJagInspectPage";

const DECODED = {
  type: "id-jag", header: { typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pf.test", jti: "j1" }, idp: { id: "pingfederate", name: "PingFederate" },
  checks: [
    { id: "typ", label: "Header typ", status: "pass", expected: "oauth-id-jag+jwt", actual: "oauth-id-jag+jwt", cite: "draft §3.1" },
    { id: "lifetime", label: "Short-lived", status: "warn", expected: "<= 300 s", actual: "600 s", cite: "vendors" },
    { id: "trusted-idp", label: "Issuer is trusted", status: "fail", expected: "a trusted IdP", actual: "https://x.test", cite: "RFC 7523" },
  ],
};
const DISCOVERY = { backends: [
  { id: "resource-as", label: "Resource AS", url: "https://as.test/.well-known/oauth-authorization-server", data: { issuer: "https://as.test" },
    profileFields: { authorization_grant_profiles_supported: true, scopes_supported: false } },
  { id: "mcp", label: "MCP gateway", url: "https://gw.test/.well-known/oauth-protected-resource", error: "HTTP 404" },
] };

const renderPage = () => render(<MemoryRouter><IdJagInspectPage /></MemoryRouter>);

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockResolvedValue({ data: DISCOVERY });
  post.mockResolvedValue({ data: DECODED });
});

describe("ID-JAG Inspector page", () => {
  it("links every check to a glossary term that exists", () => {
    for (const t of Object.values(CHECK_TERMS)) expect(terms.map((x) => x.id)).toContain(t);
  });

  it("decodes a pasted token and shows each check with its status and glossary link", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: " a.b.c " } });
    fireEvent.click(screen.getByRole("button", { name: "Decode and check" }));
    await waitFor(() => expect(screen.getByText(/Detected: ID-JAG/)).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith("/api/id-jag-inspect/decode", { token: "a.b.c" });
    expect(screen.getByText("Header typ")).toBeInTheDocument();
    expect(screen.getByText(/Warning/)).toBeInTheDocument();
    expect(screen.getByText(/Fail/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ID-JAG" })).toHaveAttribute("href", "/pingfederate-id-jag/learn#term-id-jag");
  });

  it("shows the server's message when it refuses a token", async () => {
    post.mockRejectedValue({ response: { status: 400, data: { message: "Paste a token" } }, message: "HTTP 400" });
    renderPage();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Decode and check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paste a token");
  });

  it("asks a signed-out visitor to sign in instead of showing an error code", async () => {
    post.mockRejectedValue({ response: { status: 401, data: { error: "unauthorized" } }, message: "HTTP 401" });
    renderPage();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Decode and check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Sign in/);
  });

  it("shows discovery JSON per backend, the profile-fields note and a failing backend", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Discovery" }));
    expect(await screen.findByText(/"issuer": "https:\/\/as.test"/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el.tagName === "LI" && /scopes_supported.*not published/.test(el.textContent))).toBeInTheDocument();
  });

  it("says the live log is not available in the demo, without calling the server", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Live log" }));
    expect(screen.getByText(/not available in the demo/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
