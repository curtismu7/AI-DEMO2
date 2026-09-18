import { CodeBlock } from "../lesson";

/** A native disclosure that keeps a lesson's copyable source block intact. */
export default function CollapsibleCodeBlock({ title, code, language = "js", defaultOpen = false }) {
  return (
    <details className="sdk-lesson-code" open={defaultOpen}>
      <summary>Show code: {title}</summary>
      <CodeBlock title={title} code={code} language={language} />
    </details>
  );
}
