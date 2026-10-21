import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, openSignIn } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), openSignIn: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock("../../utils/signInService", () => ({ openSignIn }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const config = {
  provider: "pingfederate", enabled: true, signedIn: false,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "", exchangeClientId: "c" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "d" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
};

it("sign-in goes through the app's sign-in service (pi.flow modal), never forcing the redirect page", async () => {
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? config : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  post.mockResolvedValue({ data: {} });
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with PingFederate" }));
  await vi.waitFor(() => expect(openSignIn).toHaveBeenCalled());
  const args = openSignIn.mock.calls[0][0];
  expect(args).toEqual({ returnTo: "/pingfederate-id-jag/playground", force: true, keepHint: true });
  expect(args.redirect).toBeUndefined();
});

it("pf-pf sign-in asks the sign-in service for the issuer role, not the app's own sign-in", async () => {
  localStorage.setItem("idjag.playground.mode", "pf-pf");
  openSignIn.mockClear();
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? { ...config, mode: "pf-pf" } : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in at the issuer PingFederate" }));
  await vi.waitFor(() => expect(openSignIn).toHaveBeenCalled());
  expect(openSignIn.mock.calls[0][0]).toEqual({ role: "issuer", returnTo: "/pingfederate-id-jag/playground", force: true });
  localStorage.removeItem("idjag.playground.mode");
});

it("oauth-mcp with a PingOne login provider signs in through the issuer role and is not greyed out", async () => {
  openSignIn.mockClear(); post.mockClear();
  const viaIssuer = { ...config, provider: "pingone", signIn: { via: "issuer", reason: null } };
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? viaIssuer : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  post.mockResolvedValue({ data: {} });
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  const btn = await screen.findByRole("button", { name: "Sign in with PingFederate" });
  expect(btn.disabled).toBe(false);
  expect(screen.queryByText(/login provider is PingOne/)).toBeNull();
  fireEvent.click(btn);
  await vi.waitFor(() => expect(openSignIn).toHaveBeenCalled());
  expect(openSignIn.mock.calls[0][0]).toEqual({ role: "issuer", returnTo: "/pingfederate-id-jag/playground", force: true });
  expect(post).not.toHaveBeenCalledWith("/api/auth/clear-session");
});

it("oauth-mcp via the issuer says plainly why it cannot sign in when the server reports a reason", async () => {
  const blocked = { ...config, provider: "pingone", signIn: { via: "issuer", reason: "Set PF_ISSUER to the PingFederate that issues the ID-JAG." } };
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? blocked : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  expect((await screen.findByRole("button", { name: "Sign in with PingFederate" })).disabled).toBe(true);
  expect(await screen.findByText(/Set PF_ISSUER/)).toBeTruthy();
});

it("pf-pf on a one-PingFederate deployment is explained and its sign-in is disabled", async () => {
  localStorage.setItem("idjag.playground.mode", "pf-pf");
  const reason = "PingFederate → PingFederate needs a second PingFederate as the redeemer; this deployment has only one.";
  const one = { ...config, mode: "pf-pf", modes: [{ id: "oauth-mcp", available: true }, { id: "pf-pf", available: false, reason }, { id: "byo", available: true }] };
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? one : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  expect(await screen.findByText(/needs a second PingFederate/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in at the issuer PingFederate" }).disabled).toBe(true);
  localStorage.removeItem("idjag.playground.mode");
});
