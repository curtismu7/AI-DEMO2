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
    expect(screen.getByRole("region", { name: "DaVinci lane" })).toHaveTextContent("DaVinci authorize request");
    expect(screen.getByRole("region", { name: "SDK and collectors lane" })).toHaveTextContent("SDK starts the flow");
    expect(screen.getByRole("region", { name: "SDK and collectors lane" })).toHaveTextContent(
      "DaVinci returns sign-on collectors",
    );
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
      const frame = screen.getByRole("button", { name: /frame 1: sdk starts the flow/i });
      fireEvent.click(frame);
      expect(screen.getByRole("region", { name: /selected frame: sdk starts the flow/i })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/concept preview/i);
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
