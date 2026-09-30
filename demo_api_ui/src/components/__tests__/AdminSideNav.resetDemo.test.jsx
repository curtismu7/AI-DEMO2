import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: false, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ activeId: "banking" }),
}));
vi.mock("../../services/demoScenarioService", () => ({ persistAgentUi: vi.fn() }));
const performLogoutMock = vi.fn();
vi.mock("../../services/logout", () => ({ performLogout: (...a) => performLogoutMock(...a) }));
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
const notifyErrorMock = vi.fn();
vi.mock("../../utils/appToast", () => ({ notifyError: (...a) => notifyErrorMock(...a) }));
vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));
vi.mock("../DraggableModal", () => ({
  default: ({ isOpen, title, children, footer, onClose }) =>
    isOpen ? (
      <section aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer}
        <button type="button" onClick={onClose}>{`close:${title}`}</button>
      </section>
    ) : null,
}));
vi.mock("../ConfirmModal", () => ({
  default: ({ isOpen, title, message, confirmLabel, onConfirm, onCancel }) =>
    isOpen ? (
      <div>
        <p>{title}</p>
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>{`confirm:${title}`}</button>
        <button type="button" onClick={onCancel}>{`cancel:${title}`}</button>
        {confirmLabel ? <span>{confirmLabel}</span> : null}
      </div>
    ) : null,
}));

import apiClient from "../../services/apiClient";
import AdminSideNav from "../AdminSideNav";

const adminUser = { id: "4", username: "admin", role: "admin" };
const jobId = "readiness-job-1";
const digest = "digest-46-steps";

beforeEach(() => {
  performLogoutMock.mockClear();
  notifyErrorMock.mockClear();
  apiClient.get.mockReset();
  apiClient.post.mockReset();
  try { window.localStorage.setItem("adminSideNav.collapsed", "false"); } catch { /* jsdom always has it */ }
  localStorage.setItem("tokenChainHistory", "x");
  localStorage.setItem("api-traffic-store", "y");
});

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminSideNav user={adminUser} />
    </MemoryRouter>,
  );
}

function jobSnapshot({ status = "running", progress = null, preview = null, report = null, error = null } = {}) {
  return { jobId, status, createdAt: 1, expiresAt: 2, progress, preview, report, error };
}

async function triggerReset() {
  fireEvent.click(screen.getByText("Reset Demo"));
  await clickAndFlush(await screen.findByText("confirm:Reset Demo"));
}

async function clickAndFlush(button) {
  await act(async () => {
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function setupStart() {
  apiClient.post.mockImplementation(async (path) => {
    if (path === "/api/admin/demo-readiness/jobs") {
      return { data: { jobId, status: "running" } };
    }
    if (path === "/api/admin/reset-demo") return { data: {} };
    throw new Error(`Unexpected POST ${path}`);
  });
}

const failingReports = [
  ["failed audit", { id: "pingone:authorize:readback", status: "blocked", evidence: "Authorize policy readback unavailable" }],
  ["missing Authorize readback", { id: "authorize:policy-tree", status: "blocked", evidence: "Complete policy readback is unavailable" }],
  ["scenario failure", { id: "UC40:local:pingfederate", status: "fail", evidence: "ID-JAG assertion failed" }],
  ["deadline expiry", { id: "run:deadline", status: "not-run", evidence: "15-minute readiness deadline exceeded" }],
];

describe("AdminSideNav — Reset Demo readiness gate", () => {
  it("polls audit progress and preview, confirms the exact digest once, then resets and signs out only when fully ready", async () => {
    setupStart();
    apiClient.get
      .mockResolvedValueOnce({ data: jobSnapshot({
        status: "running",
        progress: { phase: "audit", target: "local" },
      }) })
      .mockResolvedValueOnce({ data: jobSnapshot({
        status: "awaiting-confirmation",
        progress: { phase: "repair-preview-ready" },
        preview: {
          digest,
          changes: [{ target: "local", object: "agent-gateway/scopes", operation: "grant", sourceRef: "config/agent-scopes.json" }],
          blocked: [],
        },
      }) })
      .mockResolvedValueOnce({ data: jobSnapshot({
        status: "ready",
        report: {
          status: "ready",
          ready: true,
          targets: ["local", "se"],
          checks: [{ id: "authorize:readback", status: "pass", evidence: "Verified" }],
          rows: [{ id: "UC40:local:pingfederate", status: "pass", evidence: "ID-JAG verified" }],
        },
      }) });
    apiClient.post.mockImplementation(async (path, body) => {
      if (path === "/api/admin/demo-readiness/jobs") return { data: { jobId, status: "running" } };
      if (path === `/api/admin/demo-readiness/jobs/${jobId}/confirm`) return { data: { status: "running" } };
      if (path === "/api/admin/reset-demo") return { data: {} };
      throw new Error(`Unexpected POST ${path}: ${JSON.stringify(body)}`);
    });
    renderNav();

    await triggerReset();
    expect(await screen.findByText(/Current phase: audit/)).toBeTruthy();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(await screen.findByText(/agent-gateway\/scopes/)).toBeTruthy();
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/admin/reset-demo");

    await clickAndFlush(screen.getByText("Review repairs and confirm"));
    expect(screen.getAllByText(new RegExp(digest)).length).toBeGreaterThanOrEqual(2);
    await clickAndFlush(screen.getByText("confirm:Apply readiness repairs"));

    await waitFor(() => expect(performLogoutMock).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(`/api/admin/demo-readiness/jobs/${jobId}/confirm`, { digest });
    expect(apiClient.post.mock.calls.map(([path]) => path)).toEqual([
      "/api/admin/demo-readiness/jobs",
      `/api/admin/demo-readiness/jobs/${jobId}/confirm`,
      "/api/admin/reset-demo",
    ]);
    expect(localStorage.getItem("tokenChainHistory")).toBeNull();
    expect(localStorage.getItem("api-traffic-store")).toBeNull();
  });

  it("labels the approved Authorize policy-tree waiver as unverified while allowing a READY reset", async () => {
    setupStart();
    apiClient.get.mockResolvedValueOnce({ data: jobSnapshot({
      status: "ready",
      report: {
        status: "ready",
        ready: true,
        targets: ["local", "se"],
        checks: [
          {
            id: "pingone:policyReadback",
            status: "blocked",
            required: false,
            waiver: "Temporary waiver: live Authorize policy-tree parity is unverified.",
            evidence: "Endpoint references and runtime Authorize decisions remain required.",
          },
          { id: "other:optional", status: "blocked", required: false, waiver: "Unrelated metadata" },
        ],
      },
    }) });
    renderNav();

    await triggerReset();

    expect(await screen.findByText("pingone:policyReadback — waived (not verified)")).toBeTruthy();
    expect(screen.getByText(/live Authorize policy-tree parity is unverified/i)).toBeTruthy();
    expect(screen.getByText("other:optional — blocked")).toBeTruthy();
    expect(screen.queryByText("other:optional — waived (not verified)")).toBeNull();
    const readyStatus = screen.getByText(/All readiness checks passed\. Resetting demo state/);
    expect(readyStatus.className).toContain("admin-side-nav__readiness-status--ready");
    expect(readyStatus.className).not.toContain("admin-side-nav__readiness-status--blocked");
    expect(apiClient.post).toHaveBeenCalledWith("/api/admin/reset-demo");
  });

  it("does not apply repairs, reset, or sign out when the administrator declines the digest confirmation", async () => {
    setupStart();
    apiClient.get.mockResolvedValue({ data: jobSnapshot({
      status: "awaiting-confirmation",
      preview: { digest, changes: [{ target: "local", object: "scope", operation: "grant" }], blocked: [] },
    }) });
    renderNav();

    await triggerReset();
    await clickAndFlush(await screen.findByText("Review repairs and confirm"));
    fireEvent.click(screen.getByText("cancel:Apply readiness repairs"));

    expect(await screen.findByText(/Repair confirmation declined/)).toBeTruthy();
    expect(apiClient.post.mock.calls.map(([path]) => path)).toEqual(["/api/admin/demo-readiness/jobs"]);
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBe("x");
  });

  it("shows audit findings and blocked object details before repair confirmation", async () => {
    setupStart();
    apiClient.get.mockResolvedValue({ data: jobSnapshot({
      status: "awaiting-confirmation",
      progress: {
        phase: "repair-preview-ready",
        checks: [{ id: "authorize:policy-readback", status: "blocked", phase: "audit-initial", evidence: "Authorize policy readback unavailable" }],
      },
      preview: {
        digest,
        changes: [],
        blocked: [{ target: "local", object: { id: "authorize-policy-1", label: "Agent Gateway" }, reason: "Policy source could not be reconciled" }],
      },
    }) });
    renderNav();

    await triggerReset();

    expect(await screen.findByText("authorize:policy-readback — blocked")).toBeTruthy();
    expect(screen.getByText("Authorize policy readback unavailable")).toBeTruthy();
    expect(screen.getByText(/authorize-policy-1/)).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/admin/reset-demo");
    expect(performLogoutMock).not.toHaveBeenCalled();
  });

  it("keeps reset and sign-out blocked when the preview digest is stale", async () => {
    setupStart();
    apiClient.get.mockResolvedValue({ data: jobSnapshot({
      status: "awaiting-confirmation",
      preview: { digest, changes: [{ target: "local", object: "scope", operation: "grant" }], blocked: [] },
    }) });
    apiClient.post.mockImplementation(async (path) => {
      if (path === "/api/admin/demo-readiness/jobs") return { data: { jobId, status: "running" } };
      if (path.endsWith("/confirm")) throw { response: { status: 409 } };
      throw new Error(`Unexpected POST ${path}`);
    });
    renderNav();

    await triggerReset();
    await clickAndFlush(await screen.findByText("Review repairs and confirm"));
    await clickAndFlush(screen.getByText("confirm:Apply readiness repairs"));

    expect(await screen.findByText(/repair preview could not be confirmed/i)).toBeTruthy();
    expect(apiClient.post).toHaveBeenCalledWith(`/api/admin/demo-readiness/jobs/${jobId}/confirm`, { digest });
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/admin/reset-demo");
    expect(performLogoutMock).not.toHaveBeenCalled();
  });

  it.each(failingReports)("does not reset or sign out after %s", async (_name, failedRow) => {
    setupStart();
    apiClient.get.mockResolvedValue({ data: jobSnapshot({
      status: failedRow.id === "run:deadline" ? "deadline-exceeded" : "not-ready",
      report: { status: failedRow.id === "run:deadline" ? "deadline-exceeded" : "not-ready", ready: false, targets: ["local", "se"], checks: [failedRow], rows: [] },
    }) });
    renderNav();

    await triggerReset();

    expect(await screen.findByText(new RegExp(failedRow.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    expect(screen.getByText(new RegExp(failedRow.evidence))).toBeTruthy();
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/admin/reset-demo");
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBe("x");
  });

  it("keeps cleanup and sign-out blocked when status polling fails", async () => {
    setupStart();
    apiClient.get.mockRejectedValue(new Error("network unavailable"));
    renderNav();

    await triggerReset();

    expect(await screen.findByText(/Readiness status could not be loaded/)).toBeTruthy();
    expect(screen.getByText("Retry status check")).toBeTruthy();
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/admin/reset-demo");
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBe("x");
  });

  it("does not sign out or clear localStorage when cleanup fails after readiness is green", async () => {
    setupStart();
    apiClient.get.mockResolvedValue({ data: jobSnapshot({
      status: "ready",
      report: { status: "ready", ready: true, targets: ["local", "se"], checks: [], rows: [] },
    }) });
    apiClient.post.mockImplementation(async (path) => {
      if (path === "/api/admin/demo-readiness/jobs") return { data: { jobId, status: "running" } };
      if (path === "/api/admin/reset-demo") throw new Error("cleanup failed");
      throw new Error(`Unexpected POST ${path}`);
    });
    renderNav();

    await triggerReset();

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalled());
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBe("x");
    expect(document.querySelector(".admin-side-nav__readiness-status").className).toContain("--blocked");
  });
});
