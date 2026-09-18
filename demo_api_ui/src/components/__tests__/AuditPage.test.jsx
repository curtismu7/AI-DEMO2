// demo_api_ui/src/components/__tests__/AuditPage.test.jsx
// Guards the title-bar drag fix: mousedown on the action buttons (refresh /
// pop-out / close) must NOT start a window drag, otherwise a sub-pixel move
// swallows the button's click (PR #389).
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AuditPage from "../AuditPage";

const mockNavigate = vi.fn();
let searchParamsValue = "";

vi.mock("react-router-dom", () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(searchParamsValue)],
}));

// Render + flush the on-mount fetch so its state update settles inside act()
// (keeps the floating window mounted and the test output free of act warnings).
async function renderSettled(props) {
  const utils = render(<AuditPage {...props} />);
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsValue = "";
  // Floating window mode fetches the audit feed + summary on mount.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
  );
});

describe("AuditPage — agentId query-param seeding", () => {
  it("seeds the agent filter and includes it in the initial fetch", async () => {
    searchParamsValue = "agentId=demo-agent";

    await renderSettled({ onClose: vi.fn() });

    const calledWithAgentId = global.fetch.mock.calls.some(
      ([url]) => typeof url === "string" && url.includes("agentId=demo-agent"),
    );
    expect(calledWithAgentId).toBe(true);
  });
});

describe("AuditPage floating window — title-bar interaction", () => {
  it("does not drag the window when the mousedown lands on an action button", async () => {
    await renderSettled({ onClose: vi.fn() });
    const win = document.querySelector(".audit-float-window");
    const before = win.style.left;

    fireEvent.mouseDown(screen.getByLabelText("Close audit log"), {
      button: 0,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });

    expect(win.style.left).toBe(before); // no drag → position unchanged
  });

  it("drags the window when the mousedown lands on the bare title bar", async () => {
    await renderSettled({ onClose: vi.fn() });
    const win = document.querySelector(".audit-float-window");
    // Capture the origin rather than hardcoding it — the initial left depends
    // on DEFAULT_W vs the jsdom window width, not a fixed 0.
    const originLeft = parseFloat(win.style.left) || 0;

    fireEvent.mouseDown(document.querySelector(".audit-float-titlebar"), {
      button: 0,
      clientX: 100,
      clientY: 20,
    });
    fireEvent.mouseMove(window, { clientX: 320, clientY: 240 });

    expect(parseFloat(win.style.left) - originLeft).toBe(220); // dx = 320 - 100
  });

  it("keeps the close button clickable after a mousedown + move on it (the #389 symptom)", async () => {
    const onClose = vi.fn();
    await renderSettled({ onClose });
    const win = document.querySelector(".audit-float-window");
    const before = win.style.left;
    const closeBtn = screen.getByLabelText("Close audit log");

    // Full interaction: press on the button, twitch the pointer, release, click.
    // The bug was that the twitch started a drag and swallowed the click.
    fireEvent.mouseDown(closeBtn, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 140, clientY: 60 });
    fireEvent.mouseUp(window, { clientX: 140, clientY: 60 });
    fireEvent.click(closeBtn);

    expect(win.style.left).toBe(before); // no drag was started
    expect(onClose).toHaveBeenCalledTimes(1); // click still delivered
  });
});

describe("AuditPage standalone pop-out", () => {
  it("uses the shared pop-out icon and closes from the upper-right control", async () => {
    searchParamsValue = "popout=1";
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});

    await renderSettled({ onClose: vi.fn() });

    expect(screen.getByLabelText("Close audit window")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close audit window"));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });
});
