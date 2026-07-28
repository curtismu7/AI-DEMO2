import OWASPBadge from './OWASPBadge';
import './UseCaseProofHeader.css';

/**
 * The claim on trial for the selected use case, shown above the agent so an
 * audience knows what is being proved before anything runs. Every string comes
 * from the use-case catalog or the demo script — nothing is authored here.
 *
 * @param {{
 *   uc: object|null,
 *   beat: { say?: string }|null,
 * }} props
 */
export default function UseCaseProofHeader({ uc, beat }) {
  if (!uc) return null;
  const phrase = uc.whatToSay || uc.trigger?.text || '';
  return (
    <div className="ucph" data-testid="uc-proof-header">
      <div className="ucph__top">
        <span className="ucph__id">{uc.id}</span>
        <p className="ucph__title">{uc.title}</p>
        <OWASPBadge owasp={uc.owasp} />
      </div>
      {uc.buyerStory && <p className="ucph__claim">{uc.buyerStory}</p>}
      {phrase && (
        <p className="ucph__say">
          <span className="ucph__k">Say this</span>
          {phrase}
        </p>
      )}
      {beat?.say && (
        <p className="ucph__presenter">
          <span className="ucph__k">Presenter line</span>
          {beat.say}
        </p>
      )}
    </div>
  );
}
