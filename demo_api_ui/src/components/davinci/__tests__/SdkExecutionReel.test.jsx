import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SdkExecutionReel from "../SdkExecutionReel";

const LIVE_EVENTS = [
  {
    id: "live-1",
    sequence: 1,
    at: 1000,
    lane: "sdk",
    kind: "operation.begin",
    label: "SDK starts the flow",
    codeKey: "start",
    detail: { eventType: "start" },
  },
  {
    id: "live-2",
    sequence: 2,
    at: 1200,
    lane: "davinci",
    kind: "request",
    label: "DaVinci authorize request",
    codeKey: "start",
    detail: {
      method: "GET",
      host: "auth.example",
      path: "/as/authorize",
      paramNames: ["response_mode", "nonce"],
      responseMode: "pi.flow",
    },
  },
  {
    id: "live-3",
    sequence: 3,
    at: 1400,
    lane: "collector",
    kind: "collectors",
    label: "DaVinci returns sign-on collectors",
    codeKey: "start",
    detail: {
      status: "continue",
      collectors: [{ type: "TextCollector", category: "SingleValueCollector" }],
    },
  },
];

function renderReel(props = {}) {
  const onModeChange = vi.fn();
  return {
    onModeChange,
    ...render(
      <SdkExecutionReel
        events={[]}
        previewEvents={undefined}
        mode="movie"
        onModeChange={onModeChange}
        {...props}
      />,
    ),
  };
}

describe("SdkExecutionReel", () => {
  it("renders the preview concepts with Movie reel selected by default", () => {
    renderReel();

    expect(screen.getByText("Execution view concepts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Movie reel" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Debugger" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Storyboard" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent(/concept preview/i);
  });

  it("renders synchronized DaVinci and SDK collector lanes for live events", () => {
    renderReel({ events: LIVE_EVENTS });

    expect(screen.getByRole("status")).toHaveTextContent(/live execution/i);
    const rows = document.querySelectorAll(".sdk-reel-lane-row");
    expect(rows).toHaveLength(LIVE_EVENTS.length);
    expect(rows[1]).toHaveTextContent("DaVinci authorize request");
    expect(rows[2]).toHaveTextContent("DaVinci returns sign-on collectors");
    expect(rows[0].querySelectorAll(".sdk-reel-lane-card")).toHaveLength(2);
  });

  it("shows one selected frame with visible code and response in compact workbench mode", () => {
    renderReel({ events: LIVE_EVENTS, compact: true });

    expect(screen.queryByRole("button", { name: "Debugger" })).not.toBeInTheDocument();
    expect(document.querySelector(".sdk-reel-lanes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /frame 2: davinci authorize request/i }));
    const detail = screen.getByRole("region", { name: /selected frame: davinci authorize request/i });
    expect(within(detail).getByText("Code", { selector: "summary" }).closest("details")).toHaveAttribute("open");
    expect(within(detail).getByText("DaVinci response", { selector: "summary" }).closest("details")).toHaveAttribute("open");
  });

  it("keeps only the movie reel when compact mode is requested", () => {
    renderReel({ events: LIVE_EVENTS, compact: true, mode: "debugger" });

    expect(screen.queryByRole("region", { name: "Debugger event list" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Execution frames")).toBeInTheDocument();
  });

  it("shows the ACR policy selection in the start frame code", () => {
    renderReel({ events: LIVE_EVENTS, compact: true });
    fireEvent.click(screen.getByRole("button", { name: /frame 1: sdk starts the flow/i }));

    const detail = screen.getByRole("region", { name: /selected frame: sdk starts the flow/i });
    expect(detail).toHaveTextContent("acr_values: flowPolicyId");
  });

  it("selects a real focusable frame button and exposes the four detail disclosures", () => {
    renderReel({ events: LIVE_EVENTS });

    const frame = screen.getByRole("button", { name: /frame 2: davinci authorize request/i });
    frame.focus();
    expect(frame).toHaveFocus();
    fireEvent.click(frame);

    expect(frame).toHaveAttribute("aria-pressed", "true");
    const detail = screen.getByRole("region", { name: /selected frame: davinci authorize request/i });
    expect(within(detail).getByText("Code", { selector: "summary" })).toBeInTheDocument();
    expect(within(detail).getByText("Request", { selector: "summary" })).toBeInTheDocument();
    expect(within(detail).getByText("DaVinci response", { selector: "summary" })).toBeInTheDocument();
    expect(within(detail).getByText("Collectors", { selector: "summary" })).toBeInTheDocument();
    expect(detail).toHaveTextContent("/as/authorize");
  });

  it("closes the selected detail with Escape and returns focus to its frame", () => {
    renderReel({ events: LIVE_EVENTS });

    const frame = screen.getByRole("button", { name: /frame 2: davinci authorize request/i });
    fireEvent.click(frame);
    expect(screen.getByRole("region", { name: /selected frame: davinci authorize request/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("region", { name: /selected frame:/i })).not.toBeInTheDocument();
    expect(frame).toHaveFocus();
  });

  it("renders a debugger event list instead of the movie reel when debugger mode is selected", () => {
    renderReel({ mode: "debugger" });

    expect(screen.getByRole("region", { name: "Debugger event list" })).toHaveTextContent("SDK starts the flow");
    expect(document.querySelector(".sdk-reel-rail")).toBeNull();
  });

  it("renders storyboard nodes instead of the movie reel when storyboard mode is selected", () => {
    renderReel({ mode: "storyboard" });

    expect(screen.getByRole("region", { name: "Storyboard flow" })).toHaveTextContent("DaVinci authorize request");
    expect(document.querySelector(".sdk-reel-rail")).toBeNull();
  });

  it("explains that start creates the first live frame when no events exist", () => {
    renderReel({ events: [], previewEvents: [] });

    expect(screen.getByText(/first frame appears after start\(\)/i)).toBeInTheDocument();
  });

  it("keeps preview information and frame selection available with reduced motion", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      renderReel();
      expect(document.querySelector(".sdk-execution-reel")).toHaveAttribute("data-reduced-motion", "true");
      const frame = screen.getByRole("button", { name: /frame 1: sdk starts the flow/i });
      fireEvent.click(frame);
      expect(screen.getByRole("region", { name: /selected frame: sdk starts the flow/i })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/concept preview/i);
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
