import { useMemo } from "react";
import FlowDiagram from "../FlowDiagram";
import { Section, StatusChip } from "../pingUi";
import { sequenceSource as pfSequenceSource } from "../../utils/pfTraceSequence";

// Ping UI Standard P9. The page picks ONE lead action per state (see leadAction in PingFederateAiAgentPage.jsx) and
// hands each section a `lead` flag: the lead is the view's one primary, every other action is a bordered secondary.
export const actionClass = (lead) => (lead ? "pu-btn pu-btn--primary" : "pu-btn");

// `checked` is false until the BFF status call has answered (and when it failed): then "Not configured" would be a
// claim nobody checked, so the chip says "Not checked" instead.
// `stand` names a stand-in that works although the real feature is not configured (the mock phone, the web
// approver): the chip then says so in words and is neutral, so "Not configured" is never shown beside a working stand-in.
export function FeatureStatus({ ready, checked = true, stand = "" }) {
  if (!checked) return <StatusChip tone="neutral">Not checked</StatusChip>;
  if (ready) return <StatusChip tone="ok">Ready</StatusChip>;
  if (stand) return <StatusChip tone="neutral">{stand}</StatusChip>;
  return <StatusChip tone="warn">Not configured</StatusChip>;
}

// A section of the page. `anchor` keeps the old deep-link id on a wrapper (Section puts its id on the heading).
export function FlowSection({ anchor, ...props }) {
  const section = <Section {...props} />;
  return anchor ? <div id={anchor} className="pfai-anchor">{section}</div> : section;
}

// The reason an action is not offered. When the status check did not answer, the reason is that, not "enable X".
export function Unavailable({ checked = true, children }) {
  return (
    <p className="pu-note pfai-unavailable">
      {checked ? children : "The status check did not complete, so this action cannot run."}
    </p>
  );
}

// One live region per section. It is mounted with the section, empty, so the text that arrives later is announced.
// `tone`/`word` give the chip its status word; failures speak through the role="alert" line instead.
export function RunStatus({ tone = "neutral", word, children, testId }) {
  return (
    <p className="pu-status-line pfai-run" role="status" data-testid={testId}>
      {word ? <><StatusChip tone={tone}>{word}</StatusChip><span>{children}</span></> : null}
    </p>
  );
}

// The shape of one captured flow, as a walkable sequence diagram above the
// raw traffic. Empty trace -> no diagram (ProtocolTrace stays the evidence).
export function TraceSequenceDiagram({ steps, selfCall, testId }) {
  const source = useMemo(() => pfSequenceSource(steps, { selfCall }), [steps, selfCall]);
  if (!source) return null;
  return (
    <div className="pfai-sequence" data-testid={testId}>
      <FlowDiagram source={source} label="Request sequence" />
    </div>
  );
}
