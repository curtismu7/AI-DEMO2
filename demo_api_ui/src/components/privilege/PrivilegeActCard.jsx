// demo_api_ui/src/components/privilege/PrivilegeActCard.jsx

const PERSONA_LABELS = {
  endUser: 'EndUser VM',
  admin: 'Admin VM',
  both: 'Both VMs',
};

/**
 * Single presenter act card for the Privilege demo script.
 * @param {{ act: object }} props
 */
export default function PrivilegeActCard({ act }) {
  const personaLabel = PERSONA_LABELS[act.persona] || act.vm;

  return (
    <article className="pd-act">
      <header className="pd-act__header">
        <div className="pd-act__meta">
          <span className="pd-act__number">Act {act.actNumber}</span>
          {act.optional && <span className="pd-act__optional">Optional</span>}
        </div>
        <h2 className="pd-act__title">{act.title}</h2>
        <div className="pd-act__badges">
          <span className="pd-act__badge pd-act__badge--machine">{act.vm || personaLabel}</span>
          <span className="pd-act__badge">{personaLabel}</span>
        </div>
      </header>

      <section className="pd-act__section">
        <h3>To do</h3>
        <ol>
          {act.todo.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section className="pd-act__section pd-act__section--talk">
        <h3>Talk track</h3>
        <p>{act.talkTrack}</p>
      </section>

      {act.pmNotes && (
        <details className="pd-act__pm">
          <summary>PM notes (do not read aloud)</summary>
          <p>{act.pmNotes}</p>
        </details>
      )}

      {act.watchFor?.length > 0 && (
        <section className="pd-act__section pd-act__section--watch">
          <h3>Watch for</h3>
          <ul>
            {act.watchFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
