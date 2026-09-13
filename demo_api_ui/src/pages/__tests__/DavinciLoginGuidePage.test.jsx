import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

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

import DavinciLoginGuidePage from "../DavinciLoginGuidePage";
import { WIDGET_LESSON_SECTIONS } from "../../components/davinci/WidgetLessonSections";

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

  it("opens the run summary after sign-in, and its links close it", () => {
    const { getByText, queryByText } = render(<DavinciLoginGuidePage />);
    act(() => widgetProps.onSignedIn({ username: "demouser" }));
    expect(getByText("What just happened")).toBeTruthy();

    fireEvent.click(getByText("API Calls", { selector: ".dm-scroll a" }));
    expect(queryByText("Here is what the DaVinci widget did on this run.", { exact: false })).toBeNull();
  });
});
