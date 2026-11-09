import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";

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

  it("puts the honest banner first inside the Ping UI page, as a note", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    const page = container.querySelector(".pu-page.dvlg");
    expect(page.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
    const banner = page.querySelector('[data-testid="dvlg-banner"]');
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toContain("NOTHING SIMULATED");
    expect(banner.textContent).toContain("Call Inspector");
  });

  it("shows the status the widget reports as a chip with a word, in a live region that is mounted from the start", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    const live = container.querySelector(".dvlg-live-app [role=status]");
    expect(live.textContent).toBe("Starting");
    act(() => widgetProps.onStatus("flow"));
    expect(container.querySelector(".dvlg-live-app [role=status]")).toBe(live);
    expect(live.textContent).toBe("Flow running");
    expect(live.querySelector(".pu-chip--info")).toBeTruthy();
    act(() => widgetProps.onStatus("error"));
    expect(live.textContent).toBe("Failed");
    expect(live.querySelector(".pu-chip--danger")).toBeTruthy();
    expect(container.querySelector(".dvlg-live-app").classList.contains("pu-card--danger")).toBe(true);
  });

  it("has no primary button while the flow runs, and gives the widget the Retry primary", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    expect(widgetProps.ping).toBe(true);
    expect(container.querySelector(".pu-btn").textContent).toBe("Open pop-out");
  });

  it("counts the recorded calls in a live chip", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    const calls = container.querySelector(".dvlg-calls [role=status], [data-testid=dvlg-calls] [role=status]");
    expect(calls.textContent).toBe("0 calls recorded");
    act(() => widgetProps.onCall({ method: "POST", host: "h", path: "/e/davinci/policy/p/start", status: 200 }));
    expect(calls.textContent).toBe("1 call recorded");
  });

  it("after sign-in, 'What just happened?' is the one primary and the key-value list names who signed in", () => {
    const { container, getByRole } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onStatus("signedIn"));
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    const primaries = [...container.querySelectorAll(".pu-btn--primary")];
    expect(primaries.map((b) => b.textContent)).toEqual(["What just happened?"]);
    const kv = [...container.querySelectorAll('[data-testid="dvlg-signed-in"] .pu-kv dd')].map((e) => e.textContent);
    expect(kv[0]).toBe("demouser");
    expect(kv[2]).toBe("0");
    expect(container.querySelector(".dvlg-live-app [role=status]").textContent).toBe("Signed in");
    expect(getByRole("button", { name: "What just happened?" })).toBeTruthy();
  });

  it("shows a name the BFF did not return as such, not as an empty value", () => {
    const { container } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: null }));
    expect(container.querySelector('[data-testid="dvlg-signed-in"] .pu-kv dd').textContent).toBe("Not returned by the BFF");
  });

  it("gives focus back to the summary button when the dialog closes", async () => {
    const { container, getByRole } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    const dialog = getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getAllByRole("button", { name: /close/i })[0]);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[data-testid="dvlg-signed-in"] .pu-btn--primary')));
  });

  it("moves focus to the section heading when a summary link closes the dialog", async () => {
    const { getByText } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    fireEvent.click(getByText("Tokens to Session", { selector: ".dm-scroll a" }));
    await waitFor(() => {
      expect(document.activeElement.tagName).toBe("H2");
      expect(document.activeElement.textContent).toBe("Tokens to Session");
    });
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

  describe("pop-out window", () => {
    const original = window.location;
    beforeEach(() => {
      delete window.location;
      window.location = { ...original, search: "?popout=1" };
    });
    afterEach(() => {
      window.location = original;
    });

    it("keeps the banner first, adds no second main landmark, and offers Close window as a secondary", () => {
      const { container, getByRole } = render(<DavinciLoginGuidePage />);
      expect(container.querySelector("main")).toBeNull();
      const page = container.querySelector(".pu-page.dvlg-popout-page");
      expect(page.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
      expect(page.querySelector('[data-testid="dvlg-banner"]').textContent).not.toContain("Call Inspector lists");
      expect(getByRole("button", { name: "Close window" }).className).toBe("pu-btn");
      expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
      expect(widgetProps.ping).toBe(true);
    });
  });
});
