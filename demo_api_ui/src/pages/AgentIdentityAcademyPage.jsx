import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { buildLiveTokenChainSteps } from "../components/TokenChainTraceRail";
import "./AgentIdentityAcademyPage.css";

export default function AgentIdentityAcademyPage() {
  const frameRef = useRef(null);
  const { darkMode } = useTheme();

  const syncTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "academy-theme", theme: darkMode ? "dark" : "light" },
      window.location.origin,
    );
  }, [darkMode]);

  // Real mode in the Academy mirrors the last run the agent made: the same steps the
  // dashboard reel draws, sent as plain data so the static lesson page can render them.
  const syncTrace = useCallback(() => {
    const { steps, trace } = tokenChainTraceStore.getState();
    let plain = [];
    try {
      plain = JSON.parse(JSON.stringify(buildLiveTokenChainSteps(steps, trace)));
    } catch {
      plain = [];
    }
    frameRef.current?.contentWindow?.postMessage(
      { type: "academy-trace", steps: plain },
      window.location.origin,
    );
  }, []);

  useEffect(() => {
    syncTheme();
  }, [syncTheme]);

  useEffect(() => tokenChainTraceStore.subscribe(syncTrace), [syncTrace]);

  return (
    <section className="agent-identity-academy-page" aria-label="Agent Identity Academy">
      <iframe
        ref={frameRef}
        className="agent-identity-academy-page__frame"
        src="/academy-identity-preview.html?embedded=1"
        title="Agent Identity Academy lessons"
        onLoad={() => {
          syncTheme();
          syncTrace();
        }}
      />
    </section>
  );
}
