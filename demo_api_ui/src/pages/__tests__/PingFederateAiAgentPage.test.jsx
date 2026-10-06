import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import { notifyError } from "../../utils/appToast";
import PingFederateAiAgentPage from "../PingFederateAiAgentPage";
import pageCss from "../PingFederateAiAgentPage.css?raw";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const readyStatus = {
  sessionProvider: "pingone",
  features: { cimd: true, crossDomain: true, rar: true },
  nativeIdJagPath: "/pingfederate-id-jag/demo",
};

describe("PingFederate AI Agent page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: readyStatus });
  });

  it("shows the separate CIMD, cross-domain, and RAR paths", async () => {
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    expect(screen.getByRole("heading", { name: /PingFederate AI Agent/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Start CIMD authorization/i }))
      .toHaveAttribute("href", "/api/pf-ai-agent/cimd/start");
    expect(screen.getByRole("button", { name: /Run third-party token exchange/i })).toBeInTheDocument();
    const allowedRarButton = screen.getByRole("button", { name: /Run allowed RAR request/i });
    expect(allowedRarButton.closest("form")).toHaveAttribute("method", "post");
    expect(allowedRarButton.closest("form")).toHaveAttribute("action", "/api/pf-ai-agent/rar/start");
    expect(allowedRarButton.closest("form").querySelector('[name="userKey"]')).toHaveValue("demouser");
    expect(screen.queryByText(/mocked.*PingOne/i)).not.toBeInTheDocument();
  });

  // The page can mount before the session check resolves, so `user` is null on the first
  // render. The key box used to capture that empty value once, which kept both RAR buttons
  // hidden after a reload until someone typed a key.
  it("follows the signed-in user when it arrives later, without overwriting what was typed", async () => {
    const { rerender } = render(<PingFederateAiAgentPage user={null} />);
    const input = await screen.findByLabelText(/PF user key for this request/i);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Run allowed RAR request/i })).not.toBeInTheDocument();

    rerender(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
    expect(input).toHaveValue("demouser");
    expect(await screen.findByRole("button", { name: /Run allowed RAR request/i })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "someone-else" } });
    rerender(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
    expect(input).toHaveValue("someone-else");
  });

  describe("DPoP binding for the RAR token", () => {
    const withDpop = (extra = {}) => ({
      ...readyStatus, features: { ...readyStatus.features, rarDpop: true }, ...extra,
    });
    const rarForms = () => [
      screen.getByRole("button", { name: /Run allowed RAR request/i }).closest("form"),
      screen.getByRole("button", { name: /Run out-of-policy RAR request/i }).closest("form"),
    ];

    it("offers no DPoP option unless a DPoP client is configured", async () => {
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      await screen.findByRole("button", { name: /Run allowed RAR request/i });
      expect(screen.queryByLabelText(/DPoP/i)).not.toBeInTheDocument();
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());
    });

    it("adds dpop to both RAR forms only once the box is ticked", async () => {
      apiClient.get.mockResolvedValue({ data: withDpop() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      const box = await screen.findByLabelText(/Bind the access token .* DPoP/i);
      expect(box).not.toBeChecked();
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());

      fireEvent.click(box);
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toHaveValue("1"));

      fireEvent.click(box);
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());
    });

    describe("after a successful run", () => {
      afterEach(() => window.history.pushState({}, "", "/"));

      it("shows the token type and the key it is bound to, never a token", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=success");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "accepted", tokenType: "DPoP", dpopThumbprint: "thumb-abc123" },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        const line = await screen.findByTestId("rar-token-line");
        expect(line).toHaveTextContent("DPoP");
        expect(line).toHaveTextContent("thumb-abc123");
        expect(line).toHaveTextContent(/bound to this app/i);
      });

      it("says plainly when the token is only a bearer token", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=success");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "accepted", tokenType: "Bearer", dpopThumbprint: null },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        const line = await screen.findByTestId("rar-token-line");
        expect(line).toHaveTextContent("Bearer");
        expect(line).toHaveTextContent(/not bound to a key/i);
      });

      it("shows nothing after a denied run", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=denied");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "denied", tokenType: null, dpopThumbprint: null },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        await screen.findByText(/PF denied the RAR request/i);
        expect(screen.queryByTestId("rar-token-line")).not.toBeInTheDocument();
      });
    });
  });

  describe("CIBA human approval", () => {
    const cibaStatus = { ...readyStatus, sessionProvider: "pingfederate", features: { ...readyStatus.features, ciba: true } };
    const pendingView = (extra = {}) => ({
      state: "pending", interval: 1, loginHint: "demouser", bindingMessage: null,
      expiresAt: new Date(Date.now() + 120_000).toISOString(), ...extra,
    });
    // The page status first, then whatever the CIBA status endpoint should say, in order.
    const routeGets = ({ page = cibaStatus, ciba = [{ state: "none" }] } = {}) => {
      const answers = [...ciba];
      apiClient.get.mockImplementation((url) => {
        if (String(url).includes("/ciba/status")) {
          return Promise.resolve({ data: answers.length > 1 ? answers.shift() : answers[0] });
        }
        return Promise.resolve({ data: page });
      });
    };
    const cibaCalls = () => apiClient.get.mock.calls.filter(([url]) => String(url).includes("/ciba/status")).length;
    const ask = () => screen.findByRole("button", { name: /Ask for approval/i });

    it("offers no button until CIBA is configured (a PingFederate session, with no PF CIBA)", async () => {
      apiClient.get.mockResolvedValue({ data: { ...readyStatus, sessionProvider: "pingfederate" } });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      expect(await screen.findByText(/Configure CIBA and sign in/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Ask for approval/i })).not.toBeInTheDocument();
    });

    it("asks the named user, shows that it is waiting, and does not allow a second request meanwhile", async () => {
      routeGets();
      apiClient.post.mockResolvedValue({ data: pendingView() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      fireEvent.change(screen.getByLabelText(/Message shown on their device/i), { target: { value: "Approve-125" } });

      fireEvent.click(await ask());

      expect(await screen.findByTestId("ciba-pending")).toHaveTextContent(/Waiting for demouser to approve/i);
      expect(apiClient.post).toHaveBeenCalledWith("/api/pf-ai-agent/ciba/start", {
        loginHint: "demouser", bindingMessage: "Approve-125",
      });
      expect(screen.getByRole("button", { name: /Ask for approval/i })).toBeDisabled();
    });

    it("shows the mock phone only when it is on, and answers through it", async () => {
      routeGets({ page: { ...cibaStatus, features: { ...cibaStatus.features, ciba: false, cibaMock: true } } });
      apiClient.post.mockImplementation((url) => Promise.resolve({
        data: String(url).endsWith("/mock-decision")
          ? { state: "approved", subject: "demouser", loginHint: "demouser" }
          : pendingView(),
      }));
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

      fireEvent.click(await ask());
      fireEvent.click(await screen.findByRole("button", { name: /Approve on mock phone/i }));

      expect(await screen.findByTestId("ciba-outcome")).toHaveTextContent("Approved by demouser through PingFederate CIBA.");
      expect(apiClient.post).toHaveBeenCalledWith("/api/pf-ai-agent/ciba/mock-decision", { decision: "approve" });
    });

    it("shows the web approver buttons only when it is on, and posts the decision", async () => {
      routeGets({ page: { ...cibaStatus, features: { ...cibaStatus.features, ciba: true, cibaWebApprover: true } } });
      apiClient.post.mockResolvedValue({ data: pendingView() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

      fireEvent.click(await ask());
      fireEvent.click(await screen.findByRole("button", { name: /Deny \(web approver\)/i }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/pf-ai-agent/ciba/web-approver/decision", { decision: "deny" }));
      expect(screen.queryByTestId("ciba-mock-phone")).not.toBeInTheDocument();
    });

    it("pops the mock phone up on a pending request, showing who is asked and the message", async () => {
      routeGets({ page: { ...cibaStatus, features: { ...cibaStatus.features, ciba: false, cibaMock: true } } });
      apiClient.post.mockResolvedValue({ data: pendingView({ bindingMessage: "Approve-125" }) });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

      expect(screen.queryByText("Approve this request?")).not.toBeInTheDocument();
      fireEvent.click(await ask());

      expect(await screen.findByText("Approve this request?")).toBeInTheDocument();
      expect(screen.getByText(/asking demouser to approve it/i)).toBeInTheDocument();
      expect(screen.getByText("Approve-125")).toBeInTheDocument();
    });

    it("the popup defines its own accent: it renders outside the page root, where the page's variable does not reach", () => {
      // Without this the Approve button had white text on no background, so only Deny was visible.
      expect(pageCss).toMatch(/\.pf-ai-agent__phone\s*\{[^}]*--pf-ai-accent:/);
    });

    it("a PingOne session uses PingOne CIBA: no mock phone, and the answer says PingOne", async () => {
      // The mock phone and web approver are on, to prove a PingOne session ignores them.
      routeGets({
        page: { ...cibaStatus, sessionProvider: "pingone", features: { ...cibaStatus.features, ciba: false, cibaMock: true } },
        ciba: [{ state: "none" }, pendingView({ provider: "pingone" }), { state: "approved", provider: "pingone", subject: "demouser", loginHint: "demouser" }],
      });
      apiClient.post.mockResolvedValue({ data: pendingView({ provider: "pingone" }) });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

      fireEvent.click(await ask());

      expect(await screen.findByTestId("ciba-pending")).toHaveTextContent(/PingOne CIBA/);
      expect(screen.queryByText("Approve this request?")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /mock phone/i })).not.toBeInTheDocument();
      expect(await screen.findByTestId("ciba-outcome", {}, { timeout: 4000 })).toHaveTextContent("Approved by demouser through PingOne CIBA.");
    });

    it("has no mock phone buttons when it is off", async () => {
      routeGets();
      apiClient.post.mockResolvedValue({ data: pendingView() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      fireEvent.click(await ask());
      await screen.findByTestId("ciba-pending");
      expect(screen.queryByTestId("ciba-mock-phone")).not.toBeInTheDocument();
    });

    it("polls until approved and then stops asking", async () => {
      routeGets({ ciba: [{ state: "none" }, pendingView(), { state: "approved", subject: "demouser", loginHint: "demouser" }] });
      apiClient.post.mockResolvedValue({ data: pendingView() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

      fireEvent.click(await ask());

      const outcome = await screen.findByTestId("ciba-outcome", {}, { timeout: 4000 });
      expect(outcome).toHaveTextContent("Approved by demouser through PingFederate CIBA.");
      expect(screen.queryByTestId("ciba-pending")).not.toBeInTheDocument();
      const callsWhenDone = cibaCalls();
      await new Promise((resolve) => { setTimeout(resolve, 1300); });
      expect(cibaCalls()).toBe(callsWhenDone);
    });

    it.each([
      ["denied", /user denied the request/i],
      ["expired", /expired before anyone answered/i],
    ])("reports a %s answer", async (state, text) => {
      routeGets({ ciba: [{ state: "none" }, { state, loginHint: "demouser" }] });
      apiClient.post.mockResolvedValue({ data: pendingView() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      fireEvent.click(await ask());
      expect(await screen.findByTestId("ciba-outcome", {}, { timeout: 4000 })).toHaveTextContent(text);
    });

    it("explains a refused start in plain words", async () => {
      routeGets();
      apiClient.post.mockRejectedValue({ response: { data: { error: "PF_AI_CIBA_USER_UNKNOWN" } } });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      fireEvent.click(await ask());
      expect(await screen.findByRole("alert")).toHaveTextContent("PingFederate does not know that user.");
      expect(screen.queryByTestId("ciba-pending")).not.toBeInTheDocument();
    });

    it("picks up a request that is already in flight after a reload", async () => {
      routeGets({ ciba: [pendingView({ loginHint: "demouser" })] });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      expect(await screen.findByTestId("ciba-pending")).toHaveTextContent(/Waiting for demouser/i);
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it("needs a user to ask", async () => {
      routeGets();
      render(<PingFederateAiAgentPage user={null} />);
      expect(await ask()).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/User to ask/i), { target: { value: "someone" } });
      expect(screen.getByRole("button", { name: /Ask for approval/i })).toBeEnabled();
    });
  });

  it("sends only the active session provider to the isolated cross-domain endpoint", async () => {
    apiClient.post.mockResolvedValue({ data: {
      subjectProvider: "pingone",
      pfIssuer: "https://pf.example.test",
      assertionAudience: "https://third.example.test",
      downstreamIssuer: "https://third.example.test",
      downstreamAudience: "https://third.example.test/accounts",
      subject: "user-100",
      scope: ["accounts:read"],
      expiresAt: "2026-09-27T12:00:00.000Z",
      hops: [],
    } });
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run third-party token exchange/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      "/api/pf-ai-agent/cross-domain/exchange", { subjectProvider: "pingone" },
    ));
    expect(await screen.findByText("user-100")).toBeInTheDocument();
  });

  it("shows the reason the BFF gives when the third-party exchange fails", async () => {
    apiClient.post.mockRejectedValue({ response: { data: { error: "PF_AI_ID_JAG_AUDIENCE_INVALID" } } });
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run third-party token exchange/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/The exchange failed/);
    expect(alert).toHaveTextContent("PF_AI_ID_JAG_AUDIENCE_INVALID");
  });

  it("tells a PingOne session to sign in through PingFederate when PingFederate rejects its token", async () => {
    apiClient.post.mockRejectedValue({ response: { data: { error: "PF_AI_SUBJECT_ISSUER_NOT_RECOGNIZED" } } });
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run third-party token exchange/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PF_AI_SUBJECT_ISSUER_NOT_RECOGNIZED");
    expect(alert).toHaveTextContent(/Sign in through PingFederate, not PingOne/);
  });

  it("does not submit a different provider when the BFF reports another active session", async () => {
    apiClient.get.mockResolvedValue({ data: { ...readyStatus, sessionProvider: "none" } });
    render(<PingFederateAiAgentPage />);

    const exchange = await screen.findByRole("button", { name: /Run third-party token exchange/i });
    expect(exchange).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
