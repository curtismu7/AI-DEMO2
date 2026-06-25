// RunReportPage.test.jsx
// Regression: a persisted run record with a missing/non-string `prompt` must not
// crash the whole page. Before the fix, `run.prompt.substring(0, 60)` threw a
// TypeError during render -> React unmounted the tree -> blank page. Now that
// report records persist across pod restarts (PVC, commit f1af3fb3), the table
// actually renders real records, so a single malformed record blanked /reports.
import { TextEncoder, TextDecoder } from "util";

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import bffAxios from "../../services/bffAxios";
import RunReportPage from "../RunReportPage";

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

describe("RunReportPage with malformed records", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the table without crashing when a run has no prompt", async () => {
    bffAxios.get.mockResolvedValueOnce({
      data: {
        runs: [
          {
            runId: "run-without-prompt",
            vertical: "banking",
            startedAt: "2026-06-11T20:00:00.000Z",
            toolsCalled: ["get_balance"],
            // prompt intentionally omitted — legacy/malformed record
          },
        ],
      },
    });

    render(<RunReportPage user={{ role: "customer" }} />);

    // The row renders (vertical cell present) instead of a blank page.
    await waitFor(() => expect(screen.getByText("banking")).toBeInTheDocument());
    expect(screen.getByText("get_balance")).toBeInTheDocument();
  });
});
