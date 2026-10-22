import { useMemo } from 'react';
import DiagramStepBar from './DiagramStepBar';
import StaticFlowDiagram from './StaticFlowDiagram';
import { edgeCaptions, useDiagramStepper } from '../hooks/useDiagramStepper';
import './EmbeddedFlowDiagram.css';

// Generic embed of a StaticFlowDiagram config {GROUPS, NODES, EDGES, STEPS} with the stepper, legend and step
// cards (same shape as HostileA2aDiagramSection). `testId` prefixes the inner test ids.
// `pingStyle` (opt-in, default false) turns on the Token Chain look and behaviour in the inner StaticFlowDiagram
// and feeds it STEPS[i].detail ({ form?, tokens?, refs? }); see StaticFlowDiagram.jsx for the details.
export default function EmbeddedFlowDiagram({ config, title, lede, ariaLabel = title, diagramLabel = ariaLabel, testId, pingStyle = false }) {
  const { GROUPS, NODES, EDGES, STEPS } = config;
  const stepper = useDiagramStepper(EDGES.length);
  const names = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n.label])), [NODES]);
  const captions = useMemo(() => edgeCaptions(EDGES, names), [EDGES, names]);
  const usedGroups = [...new Set(NODES.map((n) => n.group))];
  return (
    <section className={`efd${pingStyle ? " efd--ping" : ""}`} aria-label={ariaLabel} data-testid={testId}>
      <h3>{title}</h3>
      <p className="efd-lede">{lede}</p>
      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={`${testId}-steps`} />
      <figure className="efd-figure">
        <StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={GROUPS} stepper={stepper} testId={`${testId}-flow`} ariaLabel={diagramLabel} pingStyle={pingStyle} steps={STEPS} />
        <ul className="efd-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}><i className="efd-sw" style={{ borderTopColor: GROUPS[g].bg }} />{GROUPS[g].label}</li>
          ))}
        </ul>
      </figure>
      <ol className="efd-steps" aria-label={`${title}, step by step`}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={stepper.active && s.edges.includes(stepper.step) ? 'efd-step efd-step--active' : 'efd-step'} data-testid={`${testId}-step-${i + 1}`}>
            <h4><span className="efd-n">{i + 1}</span>{s.title}</h4>
            <p>{s.what}</p>
            {s.why && <p className="efd-why"><strong>Why it matters:</strong> {s.why}</p>}
            {s.evidence && <p className="efd-why"><strong>Observed:</strong> {s.evidence}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
