import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import PingFederateAiAgentPage from "../PingFederateAiAgentPage";
import { leadAction } from "../../components/pfAiAgent/leadAction";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../utils/appToast", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("../../components/FlowDiagram", () => ({ default: () => null }));

const base = { sessionProvider: "pingone", features: { cimd: true, crossDomain: true, rar: true }, nativeIdJagPath: "/pingfederate-id-jag/demo" };
const primaries = () => document.querySelectorAll(".pu-btn--primary");
const answer = (status) => apiClient.get.mockImplementation((url) => (
  String(url).includes("/ciba/status") ? Promise.resolve({ data: { state: "none" } }) : Promise.resolve({ data: status })
));

describe("PingFederate AI Agent page: Ping UI Standard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/pingfederate-ai-agent");
  });
  afterEach(() => window.history.pushState({}, "", "/"));

  describe("P2 banner", () => {
    it("is the first thing on the page and a note", async () => {
      answer(base);
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      const root = screen.getByTestId("pingfederate-ai-agent-page");
      expect(root.firstElementChild.querySelector('[role="note"]')).toBe(screen.getByTestId("pfai-banner"));
      expect(document.querySelectorAll("main")).toHaveLength(0);
    });

    it("says it is checking, then says nothing is ready if the status call fails", async () => {
      apiClient.get.mockReturnValue(new Promise(() => {}));
      const { unmount } = render(<PingFederateAiAgentPage />);
      expect(screen.getByTestId("pfai-banner")).toHaveTextContent(/Checking which PingFederate features/);
      expect(screen.getAllByText("Not checked").length).toBeGreaterThan(0);
      expect(screen.queryByText("Not configured")).toBeNull();
      unmount();

      apiClient.get.mockRejectedValue(new Error("down"));
      render(<PingFederateAiAgentPage />);
      await waitFor(() => expect(screen.getByTestId("pfai-banner")).toHaveTextContent(/status check failed/));
      expect(screen.getByTestId("pfai-banner")).not.toHaveTextContent(/Live against PingFederate/);
      expect(screen.queryByText("Ready")).toBeNull();
      // The session is not "signed out" when it could not be read.
      expect(screen.queryByText("Signed out")).toBeNull();
      expect(screen.getByText("Session unknown")).toBeInTheDocument();
    });

    it("names the approval channel the BFF reported, never a fixed one", async () => {
      answer({ ...base, features: { ...base.features, cibaMock: true } });
      const { unmount } = render(<PingFederateAiAgentPage />);
      await waitFor(() => expect(screen.getByTestId("pfai-banner")).toHaveTextContent(/mock phone on this page: no real device is contacted/));
      unmount();

      answer({ ...base, features: { ...base.features, cibaWebApprover: true } });
      const second = render(<PingFederateAiAgentPage />);
      await waitFor(() => expect(screen.getByTestId("pfai-banner")).toHaveTextContent(/stand-in web approver/));
      expect(screen.getByTestId("pfai-banner")).not.toHaveTextContent(/mock phone/);
      second.unmount();

      answer({ ...base, sessionProvider: "none" });
      render(<PingFederateAiAgentPage />);
      await waitFor(() => expect(screen.getByTestId("pfai-banner")).toHaveTextContent(/Human approval \(CIBA\) is not configured/));
      expect(screen.getByTestId("pfai-banner")).not.toHaveTextContent(/mock phone/);
    });
  });

  describe("P7 chips and readiness", () => {
    it("shows a word on every readiness chip, from the BFF's answer", async () => {
      answer(base);
      render(<PingFederateAiAgentPage />);
      await screen.findByText("Human approval (CIBA)");
      await waitFor(() => expect(screen.queryByText("Not checked")).toBeNull());
      document.querySelectorAll(".pu-chip").forEach((chip) => expect(chip.textContent.trim().length).toBeGreaterThan(0));
      expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
    });
  });

  describe("P9 one primary per view state", () => {
    it("leadAction picks the first runnable action in page order", () => {
      const none = { exchange: false, rar: false, ciba: false, dcr: false, delegation: false, dpop: false };
      expect(leadAction({ loading: true, phoneOpen: false, runnable: { ...none, dcr: true } })).toBeNull();
      expect(leadAction({ loading: false, phoneOpen: true, runnable: { ...none, dcr: true } })).toBeNull();
      expect(leadAction({ loading: false, phoneOpen: false, runnable: { ...none, dcr: true, rar: true } })).toBe("rar");
      expect(leadAction({ loading: false, phoneOpen: false, runnable: { ...none, exchange: true, rar: true } })).toBe("exchange");
      expect(leadAction({ loading: false, phoneOpen: false, runnable: none })).toBe("piflow");
    });

    it("has no primary while the status loads, then exactly one", async () => {
      apiClient.get.mockReturnValue(new Promise(() => {}));
      const { unmount } = render(<PingFederateAiAgentPage />);
      expect(primaries()).toHaveLength(0);
      unmount();
      answer({ ...base, features: { ...base.features, dcr: true, rarDpop: true } });
      render(<PingFederateAiAgentPage />);
      await waitFor(() => expect(primaries()).toHaveLength(1));
    });

    const states = [
      ["signed out, nothing configured", { sessionProvider: "none", features: {} }, /Open a pi\.flow/],
      ["signed out, DCR configured", { sessionProvider: "none", features: { dcr: true } }, /Register, use and delete/],
      ["PingOne session, RAR configured: the exchange would be refused, so RAR leads", base, /Run allowed RAR request/],
      ["PingOne session that signed in at PingFederate through CIMD", { ...base, pfSignedIn: true }, /Run third-party token exchange/],
      ["PingFederate session", { ...base, sessionProvider: "pingfederate" }, /Run third-party token exchange/],
    ];
    it.each(states)("%s: exactly one primary", async (_name, status, name) => {
      answer(status);
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      await waitFor(() => expect(primaries()).toHaveLength(1));
      expect(primaries()[0]).toHaveAccessibleName(name);
    });

    it("keeps the primary on the same button while its run is busy (aria-disabled, focus stays)", async () => {
      answer({ sessionProvider: "none", features: { dcr: true } });
      let release;
      apiClient.post.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: { trace: [] } }); }));
      render(<PingFederateAiAgentPage />);
      const run = await screen.findByRole("button", { name: /Register, use and delete/ });
      run.focus();
      fireEvent.click(run);
      await waitFor(() => expect(run).toHaveAttribute("aria-disabled", "true"));
      expect(document.activeElement).toBe(run);
      expect(primaries()).toHaveLength(1);
      expect(within(run.closest(".pu-card")).getByRole("status")).toHaveTextContent(/Running/);
      fireEvent.click(run);
      expect(apiClient.post).toHaveBeenCalledTimes(1);
      release();
    });
  });

  describe("mock phone dialog", () => {
    const cibaPage = { sessionProvider: "pingfederate", features: { ciba: true, cibaMock: true }, pfSignedIn: false };
    const pending = { state: "pending", interval: 60, loginHint: "demouser", bindingMessage: "Approve-125", expiresAt: new Date(Date.now() + 120000).toISOString() };

    it("moves focus into the phone, makes its Approve the only primary, and hands focus back on close", async () => {
      apiClient.get.mockImplementation((url) => Promise.resolve({ data: String(url).includes("/ciba/status") ? { state: "none" } : cibaPage }));
      apiClient.post.mockResolvedValue({ data: pending });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      const ask = await screen.findByRole("button", { name: /Ask for approval/i });
      expect(ask.className).toContain("pu-btn--primary");
      ask.focus();
      fireEvent.click(ask);

      const approve = await screen.findByRole("button", { name: /Approve on mock phone/i });
      await waitFor(() => expect(document.activeElement).toBe(approve));
      expect(primaries()).toHaveLength(0);
      expect(approve.className).toContain("pfai-phone__btn--approve");
      expect(screen.getByTestId("ciba-pending")).toHaveTextContent(/mock phone \(no real device is contacted\)/);

      expect(screen.getByRole("dialog", { name: "Mock phone" })).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("dialog", { name: "Mock phone" })).getAllByRole("button", { name: "Close" })[0]);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Open mock phone/i })));
      expect(primaries()).toHaveLength(1);
    });
  });

  describe("callback notice", () => {
    it("does not claim a PingFederate sign-in the BFF does not report", async () => {
      window.history.pushState({}, "", "/pingfederate-ai-agent?cimd=success");
      answer({ ...base, pfSignedIn: false });
      render(<PingFederateAiAgentPage />);
      const notice = await screen.findByText(/reports no PingFederate sign-in/);
      expect(notice.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByText(/You are signed in at PingFederate/)).toBeNull();
    });

    it("says it is signed in when the BFF reports a PingFederate sign-in", async () => {
      window.history.pushState({}, "", "/pingfederate-ai-agent?cimd=success");
      answer({ ...base, pfSignedIn: true });
      render(<PingFederateAiAgentPage />);
      expect(await screen.findByText(/You are signed in at PingFederate/)).toBeInTheDocument();
    });
  });

  it("uses no legacy class prefix (the old stylesheet now belongs to the AIC page only)", () => {
    answer(base);
    render(<PingFederateAiAgentPage />);
    expect(document.querySelector('[class*="pf-ai-agent"]')).toBeNull();
  });
});
