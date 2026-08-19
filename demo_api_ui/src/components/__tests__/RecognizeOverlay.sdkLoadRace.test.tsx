// Regression guard for the orphaned-component fix (TECH_DEBT 2026-08-18
// honourable mentions): loadSdkScript() used to attach fresh 'load'/'error'
// listeners to an EXISTING <script id="recognize-sdk-script"> tag on every
// call. Those are one-shot DOM events — a listener attached after the event
// already fired never runs. A retry after a failed load (script tag survives
// in the DOM; a fresh mount re-attaches listeners to it) hung on
// "Loading face ID…" forever. The fix marks the element's settled state in
// its dataset so a later caller reads it instead of racing a dead event.

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import RecognizeOverlay from "../RecognizeOverlay";

function scriptTag() {
  return document.getElementById("recognize-sdk-script") as HTMLScriptElement | null;
}

describe("RecognizeOverlay — SDK script load race", () => {
  afterEach(() => {
    cleanup();
    scriptTag()?.remove();
    // @ts-expect-error test-only global reset between cases
    delete window.PingOneRecognize;
  });

  it("a retry after a failed load does not hang — the settled tag is read, not re-listened", async () => {
    const onCancel = vi.fn();

    // First mount: script tag created, fails to load (CDN unreachable, ad
    // blocker, etc). jsdom never actually fetches the src, so the failure is
    // simulated by firing the element's own error event.
    const first = render(
      <RecognizeOverlay sessionToken="tok-1" onSuccess={vi.fn()} onFallback={vi.fn()} onCancel={onCancel} />,
    );
    expect(screen.getByText(/Loading face ID/i)).toBeInTheDocument();
    const script = scriptTag();
    expect(script).not.toBeNull();
    await act(async () => { script!.dispatchEvent(new Event("error")); });
    expect(script!.dataset.recognizeSdkState).toBe("error");
    first.unmount();

    // Retry: a fresh mount. The <script> tag is still in the DOM (nothing
    // removes it) and its 'error' event already fired — the pre-fix code
    // would attach new listeners to it here and never hear from them again.
    const onFallback2 = vi.fn();
    render(
      <RecognizeOverlay sessionToken="tok-2" onSuccess={vi.fn()} onFallback={onFallback2} onCancel={vi.fn()} />,
    );

    // No NEW error event is fired this time — the fix must resolve this from
    // the tag's already-settled state alone.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/Face ID unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Loading face ID…$/)).not.toBeInTheDocument();
  });

  it("a second mount after a SUCCESSFUL load resolves immediately via window.PingOneRecognize", async () => {
    const onSuccess1 = vi.fn();
    const first = render(
      <RecognizeOverlay sessionToken="tok-1" onSuccess={onSuccess1} onFallback={vi.fn()} onCancel={vi.fn()} />,
    );
    // @ts-expect-error minimal SDK stub for the test
    window.PingOneRecognize = { init: () => ({ destroy: vi.fn() }) };
    const script = scriptTag();
    await act(async () => { script!.dispatchEvent(new Event("load")); });
    expect(script!.dataset.recognizeSdkState).toBe("loaded");
    first.unmount();

    render(
      <RecognizeOverlay sessionToken="tok-2" onSuccess={vi.fn()} onFallback={vi.fn()} onCancel={vi.fn()} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Look at the camera/i)).toBeInTheDocument();
  });
});
