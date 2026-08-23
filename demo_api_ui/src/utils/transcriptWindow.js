/**
 * Long-running sessions render the full transcript with no cap -- every
 * message bubble stays mounted for the life of the conversation. This caps
 * the default render to the most recent N, with a manual "show earlier"
 * escape hatch rather than a virtualization dependency.
 */
export function windowTranscript(filteredMsgs, cap, showAll) {
  const hiddenCount = showAll ? 0 : Math.max(0, filteredMsgs.length - cap);
  const visible = hiddenCount > 0 ? filteredMsgs.slice(hiddenCount) : filteredMsgs;
  return { hiddenCount, visible };
}
