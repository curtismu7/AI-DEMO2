/**
 * OWASP ASI badge — threats/sections surface in the tooltip, not the label.
 * Shared by the use-case launcher and the live workbench proof header.
 * @param {{ owasp?: { threats?: string[], sections?: string[] } }} props
 */
export default function OWASPBadge({ owasp }) {
  if (!owasp || (!owasp.threats?.length && !owasp.sections?.length)) return null;
  const title = [
    owasp.threats?.length  ? `Threats: ${owasp.threats.join(', ')}`   : '',
    owasp.sections?.length ? `Sections: ${owasp.sections.join(', ')}` : '',
  ].filter(Boolean).join(' — ');
  return (
    <span className="uc-owasp-badge" title={title}>
      OWASP ASI
    </span>
  );
}
