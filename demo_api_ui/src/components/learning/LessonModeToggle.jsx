export default function LessonModeToggle({ mode, onChange }) {
  return (
    <div className="lesson-shell__mode-toggle" aria-label="Lesson presentation mode">
      <button
        type="button"
        className={mode === "guided" ? "is-active" : ""}
        aria-pressed={mode === "guided"}
        onClick={() => onChange("guided")}
      >
        Guided Journey
      </button>
      <button
        type="button"
        className={mode === "standalone" ? "is-active" : ""}
        aria-pressed={mode === "standalone"}
        onClick={() => onChange("standalone")}
      >
        Demo mode
      </button>
    </div>
  );
}
