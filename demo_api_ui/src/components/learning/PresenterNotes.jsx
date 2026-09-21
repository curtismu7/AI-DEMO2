export default function PresenterNotes({ durationMinutes, steps }) {
  return (
    <section aria-label="Presenter script">
      <details className="presenter-notes">
        <summary>{durationMinutes}-minute script</summary>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
