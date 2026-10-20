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

const PG = "/api/id-jag-playground";
let config;
const ISSUED = { token: { header: { typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pf.test" } }, response: { access_token: "[the ID-JAG, kept server-side]" } };

beforeEach(() => {
  get.mockReset(); post.mockReset();
  try { localStorage.clear(); } catch { /* none */ }
  config = { signedIn: true, mode: "oauth-mcp" };
  get.mockImplementation(async (url) => (url === `${PG}/config` ? { data: config } : { data: DISCOVERY }));
  post.mockImplementation(async (url) => {
    if (url === `${PG}/issue`) return { data: ISSUED };
    if (url === `${PG}/inspect`) return { data: { header: DECODED.header, claims: DECODED.claims, checks: DECODED.checks } };
    return { data: DECODED };
  });
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

  it("keeps discovery out of the tab row, in a section that starts collapsed", () => {
    renderPage();
    expect(screen.queryByRole("tab", { name: "Discovery" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Live log" })).toBeInTheDocument();
    const section = screen.getByText("Backends (discovery metadata)").closest("details");
    expect(section.open).toBe(false);
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/discovery"));
  });

  it("shows discovery JSON per backend, the profile-fields note and a failing backend once opened", async () => {
    renderPage();
    const section = screen.getByText("Backends (discovery metadata)").closest("details");
    section.open = true;
    fireEvent(section, new Event("toggle"));
    expect(await screen.findByText(/"issuer": "https:\/\/as.test"/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.getAllByText(/authorization_grant_profiles_supported/, { selector: "code" })[0]).toBeInTheDocument();
    expect(screen.getByText((_, el) => el.tagName === "LI" && /scopes_supported.*not published/.test(el.textContent))).toBeInTheDocument();
  });

  it("gets an ID-JAG from the playground issue route and checks it, with no pasted token", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Get an ID-JAG" }));
    await waitFor(() => expect(screen.getByText(/Detected: ID-JAG/)).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith(`${PG}/issue`, {});
    expect(post).toHaveBeenCalledWith(`${PG}/inspect`, {});
    expect(post).not.toHaveBeenCalledWith("/api/id-jag-inspect/decode", expect.anything());
    expect(screen.getByText("Header typ")).toBeInTheDocument();
    expect(screen.getByText(/kept on the server/i)).toBeInTheDocument();
    expect(screen.getByText("or paste a token from another tool")).toBeInTheDocument();
  });

  it("uses the mode the playground remembers", async () => {
    localStorage.setItem("idjag.playground.mode", "pf-pf");
    renderPage();
    await waitFor(() => expect(post).toHaveBeenCalledWith(`${PG}/mode`, { mode: "pf-pf" }));
  });

  it("says to sign in at PingFederate, with a link, when the playground is not signed in", async () => {
    config = { signedIn: false, mode: "oauth-mcp" };
    renderPage();
    expect(await screen.findByText(/Sign in at PingFederate first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /playground/i })).toHaveAttribute("href", "/pingfederate-id-jag/playground#ijp-step-1");
    expect(screen.getByRole("button", { name: "Get an ID-JAG" })).toBeDisabled();
  });

  it("shows the same plain message, not raw JSON, when issue answers 401", async () => {
    post.mockImplementation(async (url) => {
      if (url === `${PG}/issue`) throw { response: { status: 401, data: { error: "pf_sign_in_required", message: "Sign in with PingFederate first; the ID-JAG is minted from your session." } }, message: "HTTP 401" };
      return { data: DECODED };
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Get an ID-JAG" }));
    expect(await screen.findByText(/Sign in at PingFederate first/)).toBeInTheDocument();
    expect(screen.queryByText(/pf_sign_in_required/)).not.toBeInTheDocument();
  });

  it("says the live log is not available in the demo, without calling the server", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Live log" }));
    expect(screen.getByText(/not available in the demo/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/discovery"));
  });
});
