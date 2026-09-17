import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

let widgetProps;
vi.mock("../DavinciLoginWidget", () => ({
  default: (props) => {
    widgetProps = props;
    return <div data-testid="widget" />;
  },
}));

vi.mock("../../lib/davinciWidgetClient", () => ({
  refreshWidgetSessionIfNeeded: vi.fn().mockResolvedValue(false),
}));

import DavinciLoginGuidePage from "../DavinciLoginGuidePage";
import { WIDGET_LESSON_SECTIONS } from "../../components/davinci/WidgetLessonSections";
import { refreshWidgetSessionIfNeeded } from "../../lib/davinciWidgetClient";

describe("DavinciLoginGuidePage", () => {
  it("lays the lesson out with a nav entry and a section for every shared section id", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    const nav = [...container.querySelectorAll('nav[aria-label="Lesson sections"] button')].map((b) => b.textContent);
    expect(nav).toEqual(WIDGET_LESSON_SECTIONS.map((s) => s.label));
    const ids = [...container.querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(WIDGET_LESSON_SECTIONS.map((s) => s.id));
  });

  it("shows each recorded call in the Call Inspector as it happens", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    act(() => {
      widgetProps.onCall({ method: "POST", host: "auth.pingone.com", path: "/e/davinci/policy/p/start", status: 200, capabilityName: "customHTMLTemplate" });
    });
    expect(container.querySelectorAll(".dvl-live-calls .dvl-call")).toHaveLength(1);
  });

  it("offers the same widget flow in a pop-out window", () => {
    const popup = { focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const { getByRole } = render(<DavinciLoginGuidePage />);

    fireEvent.click(getByRole("button", { name: "Open pop-out" }));

    expect(open).toHaveBeenCalledWith(
      "/davinci-widget?popout=1",
      "davinci-widget-popup",
      expect.stringContaining("width=560"),
    );
    expect(popup.focus).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("explains how to continue when the browser blocks the pop-out", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { getByRole, getByText } = render(<DavinciLoginGuidePage />);

    fireEvent.click(getByRole("button", { name: "Open pop-out" }));

    expect(getByText("Your browser blocked the pop-out. Allow pop-ups for this site, or continue with the embedded widget.")).toBeTruthy();
    open.mockRestore();
  });

  it("opens the run summary after sign-in, and its links close it", () => {
    const { getByText, queryByText } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    expect(getByText("What just happened")).toBeTruthy();

    fireEvent.click(getByText("API Calls", { selector: ".dm-scroll a" }));
    expect(queryByText("Here is what the DaVinci widget did on this run.", { exact: false })).toBeNull();
  });

  // 2026-09-13 tech debt: a returning visitor with a near-expiry widget
  // session gets a silent, invisible re-run instead of just losing it.
  it("checks for a silent widget-session refresh on mount", async () => {
    refreshWidgetSessionIfNeeded.mockClear();
    render(<DavinciLoginGuidePage />);
    await waitFor(() => expect(refreshWidgetSessionIfNeeded).toHaveBeenCalledTimes(1));
  });
});
