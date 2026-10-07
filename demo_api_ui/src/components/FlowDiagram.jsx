import React from "react";
import FlowchartFlowDiagram from "./FlowchartFlowDiagram";
import SequenceFlowDiagram from "./SequenceFlowDiagram";

const isSequence = (source) => /^\s*(?:---[\s\S]*?\n---\s*)?(?:%%[^\n]*\n\s*)*sequenceDiagram\b/.test(source || "");

/**
 * FlowDiagram — draws Mermaid-format diagram text with React Flow. Picks the sequence or
 * flowchart renderer from the text, so a page keeps its .mmd source (export, upload, edit)
 * and never loads the Mermaid renderer. Props pass straight through: `label`, `height`,
 * and `step` / `active` when the page drives the highlight itself.
 */
export default function FlowDiagram({ source, ...rest }) {
  return isSequence(source) ? <SequenceFlowDiagram source={source} {...rest} /> : <FlowchartFlowDiagram source={source} {...rest} />;
}
