// Small pieces shared by the three parts of /gateway-claims (GatewayClaimsPage, GatewayAgentcoreLab, GatewayLatest),
// built on the Ping UI primitives. Styles: pages/GatewayClaimsPage.css (the page imports it).
import { Card, StatusChip } from '../pingUi';
import { EVIDENCE } from '../../config/gatewayClaims';

// Evidence label -> chip tone. The word (VERIFIED, INFERRED, UNVERIFIED) is the status; the tone never carries it alone.
const EVIDENCE_TONE = { verified: 'ok', inferred: 'info', unverified: 'warn' };

/** P7: how well a statement is known. The tooltip repeats the legend note. */
export function EvidenceTag({ kind }) {
  const e = EVIDENCE[kind];
  return (
    <span title={e.note}>
      <StatusChip tone={EVIDENCE_TONE[kind]}>{e.label}</StatusChip>
    </span>
  );
}

/**
 * A group of native radio buttons that look like chips. Native radios give arrow-key movement inside the group and a
 * checked state that is not colour alone (the dot). options: [{ id, label, testId }].
 */
export function ChoiceGroup({ name, label, options, value, onChange }) {
  return (
    <fieldset className="gwc-choices">
      <legend className="pu-label">{label}</legend>
      <div className="gwc-choices__row">
        {options.map((o) => (
          <label key={o.id} className={`gwc-choice${o.id === value ? ' gwc-choice--on' : ''}`}>
            <input
              type="radio"
              className="gwc-choice__input"
              name={name}
              value={o.id}
              checked={o.id === value}
              data-testid={o.testId}
              onChange={() => onChange(o.id)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The result of a simulated or replayed run. Never titled as a gateway answer: the title says what it is and the chip
 * carries the outcome as words. `ok` picks the card edge and chip tone.
 */
export function SimVerdict({ ok, title, headline, tag, children, ...rest }) {
  return (
    <Card tone={ok ? 'ok' : 'danger'} title={title} role="status" {...rest}>
      <p className="pu-status-line">
        <StatusChip tone={ok ? 'ok' : 'danger'}>{headline}</StatusChip>
        {tag}
      </p>
      {children}
    </Card>
  );
}

/** A caution about how far to trust what follows: warn card, a word chip, and a note. */
export function Caveat({ children, ...rest }) {
  return (
    <Card tone="warn" {...rest}>
      <p className="pu-status-line"><StatusChip tone="warn">Read first</StatusChip></p>
      <p className="pu-note" role="note">{children}</p>
    </Card>
  );
}
