import React, { useRef, useState } from "react";
import { askCodeSearch } from "../services/codeSearchAPI";

const PROMPTS = [
  "Which Learning Hub lessons explain OAuth token exchange?",
  "What Learning Hub material explains protecting MCP tools?",
  "Summarize the Learning Hub guidance for RAG security.",
  "Explain RFC 8693 using the Learning Hub lessons.",
  "What does the Learning Hub teach about PingOne Authorize?",
  "Which lessons cover agent identity and delegation?",
  "How does the Learning Hub explain MCP gateway policy?",
  "Find the Learning Hub lesson about step-up MFA.",
  "What Learning Hub content explains human-in-the-loop approval?",
  "Summarize the Learning Hub introduction for a new developer.",
];

export default function LearningHubAgent() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const ask = async (prompt: string) => {
    const value = prompt.trim();
    if (!value || loading) return;
    historyRef.current.push(value);
    historyIndexRef.current = -1;
    setQuery("");
    setLoading(true);
    setError("");
    try {
      const response = await askCodeSearch(value, "ai-demo2-learning-hub", 8);
      setAnswer(response.answer || "");
      setSources(response.sources || []);
    } catch (err: any) {
      setAnswer("");
      setSources([]);
      setError(err?.message || "Learning Hub search is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(historyIndexRef.current + 1, historyRef.current.length - 1);
      if (next >= 0) {
        historyIndexRef.current = next;
        setQuery(historyRef.current[historyRef.current.length - 1 - next]);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      ask(query);
    }
  };

  const clear = () => {
    setQuery("");
    setAnswer("");
    setSources([]);
    setError("");
    historyIndexRef.current = -1;
  };

  return (
    <section className="learning-hub__rag" aria-labelledby="learning-hub-rag-title">
      <div>
        <span className="learning-hub__rag-eyebrow">Learning Hub agent</span>
        <h2 id="learning-hub-rag-title">Ask the Learning Hub</h2>
        <p>Search Learning Hub documentation with grounded retrieval and source citations.</p>
      </div>
      <form className="learning-hub__rag-form" onSubmit={(event) => { event.preventDefault(); ask(query); }}>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); historyIndexRef.current = -1; }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about OAuth, MCP, RAG, or agents..."
          aria-label="Ask the Learning Hub agent"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !query.trim()}>{loading ? "Searching..." : "Ask agent"}</button>
        {(answer || error) && <button type="button" className="learning-hub__rag-clear" onClick={clear}>Clear</button>}
      </form>
      <details className="learning-hub__rag-prompts">
        <summary>Prompt library <span>{PROMPTS.length} prompts</span></summary>
        <div className="learning-hub__rag-prompt-grid">
          {PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => ask(prompt)} disabled={loading}>{prompt}</button>)}
        </div>
      </details>
      {error && <p className="learning-hub__rag-error" role="alert">{error}</p>}
      {answer && <div className="learning-hub__rag-answer" aria-live="polite"><h3>Agent summary</h3><p>{answer}</p></div>}
      {sources.length > 0 && <div className="learning-hub__rag-results" aria-live="polite"><h3>Sources used</h3>{sources.map((result, index) => <article className="learning-hub__rag-result" key={`${result.file}-${result.line_start}-${index}`}><code>{result.file}:{result.line_start}-{result.line_end}</code><p>{result.snippet}</p></article>)}</div>}
    </section>
  );
}
