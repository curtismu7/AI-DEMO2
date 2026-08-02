// Builds Mermaid sequenceDiagram source for a Protocol Playground flow.
// Pure string construction — the component only renders what comes back.

/** Mermaid participant ids must be short and alphanumeric. */
function participantId(actor, index) {
  const initials = String(actor || `actor${index}`)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return `${initials || 'A'}${index}`;
}

const ACTOR_LABELS = {
  'client-app': 'Client App',
  'auth-server': 'PingOne',
  'human-approver': 'Person',
  gateway: 'Gateway',
  'token-exchanger': 'Token Exchanger',
};

function actorLabel(actor) {
  if (ACTOR_LABELS[actor]) return ACTOR_LABELS[actor];
  return String(actor || 'Actor')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Mermaid takes everything after the FIRST colon as the message label, so
 * colons inside an endpoint (`/poll/:authReqId`) are safe and must be left
 * alone. What is not safe: `#` opens an entity code, `<`/`>` open a tag, and
 * `;` ends the statement.
 */
function escapeLabel(text) {
  return String(text || '')
    .replace(/[#<>]/g, ' ')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ordered, de-duplicated actors — flow order, not the declared actors array. */
function collectParticipants(steps) {
  const seen = new Map();
  steps.forEach((step) => {
    [step.fromActor || step.actor, step.toActor].forEach((actor) => {
      if (actor && !seen.has(actor)) {
        seen.set(actor, participantId(actor, seen.size));
      }
    });
  });
  return seen;
}

/**
 * Status suffix for an executed step. Uses the response the engine recorded so
 * the diagram and the activity log cannot disagree.
 */
function statusSuffix(result) {
  if (!result) return '';
  if (result.error) return ' ✕ failed';
  const status = result.response?.status;
  if (typeof status !== 'number') return '';
  return status >= 400 ? ` ✕ ${status}` : ` ✓ ${status}`;
}

/**
 * @param {object} flowSpec  protocol flow with steps[]
 * @param {Array}  results   execution results, index-aligned with steps
 * @param {string} currentStep  id of the step being executed
 * @returns {string} mermaid sequenceDiagram source
 */
export function buildSequenceSource(flowSpec, results = [], currentStep = null) {
  const steps = flowSpec?.steps || [];
  if (!steps.length) return '';

  const participants = collectParticipants(steps);
  const lines = ['sequenceDiagram', '    autonumber'];

  participants.forEach((id, actor) => {
    lines.push(`    participant ${id} as ${escapeLabel(actorLabel(actor))}`);
  });

  steps.forEach((step, index) => {
    const from = participants.get(step.fromActor || step.actor);
    const to = participants.get(step.toActor || step.actor);
    if (!from || !to) return;

    const result = results?.[index];
    const label = escapeLabel(step.label || step.action || step.endpoint);
    const arrow = result?.error || (result?.response?.status >= 400) ? '-x' : '->>';

    lines.push(`    ${from}${arrow}${to}: ${label}${statusSuffix(result)}`);

    if (!result && step.id === currentStep) {
      lines.push(`    Note over ${from},${to}: running…`);
    }
  });

  return lines.join('\n');
}

export default buildSequenceSource;
