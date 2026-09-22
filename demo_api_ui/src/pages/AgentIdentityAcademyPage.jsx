import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
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

  useEffect(() => {
    syncTheme();
  }, [syncTheme]);

  return (
    <section className="agent-identity-academy-page" aria-label="Agent Identity Academy">
      <iframe
        ref={frameRef}
        className="agent-identity-academy-page__frame"
        src="/academy-identity-preview.html?embedded=1"
        title="Agent Identity Academy lessons"
        onLoad={syncTheme}
      />
    </section>
  );
}
