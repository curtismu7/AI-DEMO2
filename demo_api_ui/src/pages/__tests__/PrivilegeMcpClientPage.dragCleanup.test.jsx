// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.dragCleanup.test.jsx
// finding #59: startSidebarDrag/startTerminalDrag attached document-level
// pointermove/pointerup listeners on pointerdown with no unmount cleanup and
// no pointer capture, so an unmount mid-drag (or a mouseup that never reaches
// document) left them attached forever. Proves an unmount mid-drag now
// removes both listeners, and that pointer capture is engaged on drag start.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "", clientId: "", scopes: "openid" },
            oauth: { authenticated: false },
            mainAppAuthenticated: false,
            tools: [],
            presets: [],
          }),
      });
    }
    return new Promise(() => {});
  });

  // jsdom does not implement the Pointer Capture API at all.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  } else {
    vi.spyOn(Element.prototype, "setPointerCapture");
    vi.spyOn(Element.prototype, "releasePointerCapture");
  }
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("finding #59: sidebar/terminal drag listener cleanup", () => {
  it("engages pointer capture and removes document listeners on unmount mid-drag", async () => {
    const { container, unmount } = renderPage();
    await screen.findByTitle(/clear chat, events/i); // wait for initial render to settle

    const handle = container.querySelector(".cur-resize-handle--v");
    expect(handle).toBeTruthy();

    const removeSpy = vi.spyOn(document, "removeEventListener");

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });

    expect(Element.prototype.setPointerCapture).toHaveBeenCalled();

    // Mouseup/pointerup never fires (e.g. released outside the document) —
    // the component unmounts (route change) while the drag is still active.
    unmount();

    const removedTypes = removeSpy.mock.calls.map(([type]) => type);
    expect(removedTypes).toContain("pointermove");
    expect(removedTypes).toContain("pointerup");

    removeSpy.mockRestore();
  });
});
