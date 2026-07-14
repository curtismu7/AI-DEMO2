import React, { useEffect, useState, useCallback } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import node_fs from "node:fs";
import node_path from "node:path";

/**
 * Regression: the agent went invisible under the clinical-split dashboard.
 *
 * The dashboards published their middle-column host UNCONDITIONALLY:
 *
 *   useEffect(() => {
 *     setSurfaceHostEl(middleHostEl);        // <-- also wrote null
 *     return () => setSurfaceHostEl(cur => cur === middleHostEl ? null : cur);
 *   }, [middleHostEl, setSurfaceHostEl]);
 *
 * When ff_agent_clinical_split resolves ASYNCHRONOUSLY, the dashboard swaps to
 * the clinical layout: TalkPane mounts and registers its host, and the middle
 * column unmounts (middleHostEl -> null), re-running the parent effect — which
 * then wrote that null over TalkPane's registration. Net: clinicalSplit=true but
 * surfaceHostEl=null, so AIAgent had nowhere to portal and rendered below the
 * fold.
 *
 * This models the ordering (child effect first, then parent re-run) and asserts
 * the host still belongs to TalkPane. The fix: bail on a null host; only the
 * guarded cleanup may clear, and it clears only its OWN element.
 */

/** The dashboard's middle-column host effect — post-fix shape. */
function useMiddleHost(middleHostEl, setSurfaceHostEl) {
  useEffect(() => {
    if (!middleHostEl) return undefined; // <-- the fix
    setSurfaceHostEl(middleHostEl);
    return () => {
      setSurfaceHostEl((cur) => (cur === middleHostEl ? null : cur));
    };
  }, [middleHostEl, setSurfaceHostEl]);
}

/** TalkPane's host effect (already ownership-guarded on cleanup). */
function useTalkPaneHost(hostEl, setSurfaceHostEl) {
  useEffect(() => {
    setSurfaceHostEl(hostEl);
    return () => setSurfaceHostEl((cur) => (cur === hostEl ? null : cur));
  }, [hostEl, setSurfaceHostEl]);
}

function TalkPane({ setSurfaceHostEl }) {
  const [hostEl, setHostEl] = useState(null);
  const refCb = useCallback((el) => setHostEl(el), []);
  useTalkPaneHost(hostEl, setSurfaceHostEl);
  return <div data-testid="talk-host" className="ac-chat-host" ref={refCb} />;
}

/** Dashboard that flips to the clinical layout when the async flag lands. */
function Dashboard({ clinicalSplit, setSurfaceHostEl }) {
  const [middleHostEl, setMiddleHostEl] = useState(null);
  const middleHostRefCb = useCallback((el) => setMiddleHostEl(el), []);
  useMiddleHost(middleHostEl, setSurfaceHostEl);

  if (clinicalSplit) return <TalkPane setSurfaceHostEl={setSurfaceHostEl} />;
  return <div data-testid="middle-host" ref={middleHostRefCb} />;
}

function Harness({ flagResolvesTo }) {
  const [surfaceHostEl, setSurfaceHostEl] = useState(null);
  const [clinicalSplit, setClinicalSplit] = useState(false); // flag not yet loaded
  useEffect(() => {
    // Async feature-flag fetch resolving after first paint.
    const t = setTimeout(() => setClinicalSplit(flagResolvesTo), 0);
    return () => clearTimeout(t);
  }, [flagResolvesTo]);

  return (
    <>
      <Dashboard clinicalSplit={clinicalSplit} setSurfaceHostEl={setSurfaceHostEl} />
      <div
        data-testid="surface"
        data-host={
          surfaceHostEl ? surfaceHostEl.className || "unnamed" : "NULL"
        }
      />
    </>
  );
}

describe("agent surface host survives an async clinical-split flag flip", () => {
  test("host ends up as TalkPane's, not null (agent has somewhere to portal)", async () => {
    const { getByTestId } = render(<Harness flagResolvesTo />);

    await waitFor(() => {
      expect(getByTestId("talk-host")).toBeTruthy(); // clinical layout mounted
    });

    await waitFor(() => {
      // The bug: this read "NULL" — the dashboard stomped TalkPane's host.
      expect(getByTestId("surface").getAttribute("data-host")).toBe("ac-chat-host");
    });
  });

  test("flag OFF: the middle column still owns the host (legacy unchanged)", async () => {
    const { getByTestId } = render(<Harness flagResolvesTo={false} />);

    await waitFor(() => {
      expect(getByTestId("middle-host")).toBeTruthy();
    });
    // Registered (not null) — the fix must not stop the legacy path publishing.
    await waitFor(() => {
      expect(getByTestId("surface").getAttribute("data-host")).not.toBe("NULL");
    });
  });

  // The tests above model the effect ordering. These pin the REAL components,
  // so reverting the guard in either dashboard fails the suite.
  test.each([
    ["UserDashboard.js"],
    ["UserDashboardPing2026.js"],
  ])("%s does not publish a null surface host", (file) => {
    const src = node_fs.readFileSync(
      node_path.resolve(__dirname, "..", file),
      "utf8",
    );
    // The middle-column effect must bail before setSurfaceHostEl when the host
    // is null; only its guarded cleanup may clear.
    expect(src).toMatch(/if \(!middleHostEl\) return undefined;\s*\n\s*setSurfaceHostEl\(middleHostEl\);/);
  });
});
