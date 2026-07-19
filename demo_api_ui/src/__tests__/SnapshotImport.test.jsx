import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

import SnapshotImport from "../pages/SnapshotImport";

/**
 * Snapshot parity failures BLOCK the import: demo_authz_server returns HTTP 409
 * with the full conflict report as the body (routes/import-snapshot.js). The page
 * must render that report. The obvious `if (!res.ok) throw new Error(...)` drops
 * it on the floor and the operator sees "HTTP 409" instead of which tools would
 * be un-gated — which is the whole point of the 409.
 *
 * A stale duplicate of this page (SnapshotImport.tsx) still carried that bug and
 * shadowed the fixed .jsx on any resolver-order change; it was deleted, and this
 * test is what keeps the behaviour from regressing in whichever file survives.
 */

// Mirrors a real 409 body: consent tools present in the SoT but missing from the
// snapshot, so importing it would silently un-gate them.
const CONFLICT_REPORT = {
  valid: false,
  summary: { policies: 2, conditions: 14, statements: 11, rules: 12 },
  conflicts: [
    {
      type: "consent_tool_mismatch",
      snapshot: ["create_transfer"],
      sot: ["create_transfer", "checkout", "sensitive_holdings"],
    },
  ],
};

const selectFileAndSubmit = async () => {
  const file = new File([JSON.stringify({ a: 1 })], "snap.json", {
    type: "application/json",
  });
  // act(): the click kicks off an async fetch whose resolution sets state after
  // the handler returns, which React flags unless the await happens inside act.
  await act(async () => {
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /validate snapshot/i }));
  });
};

describe("SnapshotImport — 409 conflict report", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("renders the conflict report body on 409 instead of collapsing to a status code", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => CONFLICT_REPORT,
    });

    render(<SnapshotImport />);
    await selectFileAndSubmit();

    // The report rendered: invalid verdict, conflict count, and the specific
    // tools that would be un-gated.
    await waitFor(() =>
      expect(screen.getByText(/Conflicts \(1\)/)).toBeInTheDocument(),
    );
    expect(screen.getByText("consent_tool_mismatch")).toBeInTheDocument();
    expect(screen.getByText(/Missing from snapshot:/)).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("sensitive_holdings")).toBeInTheDocument();

    // And it did NOT degrade into the bare-status error path.
    expect(screen.queryByText(/^HTTP 409$/)).not.toBeInTheDocument();
  });

  it("still surfaces an error for a non-409 failure", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    render(<SnapshotImport />);
    await selectFileAndSubmit();

    await waitFor(() =>
      expect(screen.getByText("HTTP 500")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Conflicts \(/)).not.toBeInTheDocument();
  });

  it("renders the success state when the snapshot is in sync", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        summary: { policies: 2, conditions: 14, statements: 11, rules: 12 },
        conflicts: [],
      }),
    });

    render(<SnapshotImport />);
    await selectFileAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/Snapshot is in sync/)).toBeInTheDocument(),
    );
  });

  it("requests a same-origin path — no hardcoded host (REGRESSION_PLAN §3)", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        summary: { policies: 0, conditions: 0, statements: 0, rules: 0 },
        conflicts: [],
      }),
    });

    render(<SnapshotImport />);
    await selectFileAndSubmit();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = global.fetch.mock.calls[0][0];
    expect(url).toBe("/admin/import-snapshot");
    expect(url).not.toMatch(/^https?:\/\//);
  });
});
