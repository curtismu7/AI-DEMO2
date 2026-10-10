import React, { useEffect, useState } from "react";
import { answerDocuments, indexDocuments, listDocuments, searchDocuments } from "../services/documentRagAPI";
import { useSessionToken } from "../context/SessionTokenContext";

export default function LearningHubDocuments() {
  // Signed-in feature: disable for guests instead of letting the BFF 401
  // through as a raw error. Browsing the Hub itself stays open.
  const { sessionType, tokenLoading } = useSessionToken();
  const guest = !tokenLoading && !sessionType;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<any>(null);

  useEffect(() => { listDocuments().then(setDocuments).catch(() => setDocuments([])); }, []);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim() || loading || guest) return;
    setLoading(true); setError(""); setStatus("");
    try { setResults(await searchDocuments(query.trim())); }
    catch (err: any) { setError(err.message || "Document search is unavailable."); }
    finally { setLoading(false); }
  };

  const answerQuestion = async () => {
    if (!query.trim() || loading || guest) return;
    setLoading(true); setError(""); setAnswer(null);
    try { setAnswer(await answerDocuments(query.trim())); }
    catch (err: any) { setError(err.message || "Grounded answer is unavailable."); }
    finally { setLoading(false); }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || guest) return;
    try {
      const result = await indexDocuments(files);
      setStatus(`${result.documents_indexed || 0} document(s) indexed.`);
      setDocuments(await listDocuments());
    } catch (err: any) { setError(err.message || "Document indexing is unavailable."); }
    finally { setLoading(false); event.target.value = ""; }
  };

  return <section className="learning-hub__documents" aria-labelledby="learning-hub-documents-title">
    <div className="learning-hub__documents-heading">
      <div><span className="learning-hub__rag-eyebrow">📄 Document grounding</span><h2 id="learning-hub-documents-title">Search source documents</h2><p>Retrieve extracted passages from the Learning Hub corpus with section and page citations.</p></div>
      <label className="learning-hub__documents-upload">Index documents<input type="file" multiple accept=".html,.md,.txt,.pdf,.docx" onChange={upload} disabled={loading || guest} /></label>
    </div>
    <form className="learning-hub__documents-search" onSubmit={search}><label htmlFor="learning-hub-document-query">Question</label><div><input id="learning-hub-document-query" aria-label="Search Learning Hub documents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={guest ? "Sign in to search indexed documents" : "Search extracted Learning Hub content"} disabled={guest} /><button type="submit" disabled={loading || guest || !query.trim()}>Search documents</button><button type="button" onClick={answerQuestion} disabled={loading || guest || !query.trim()}>Answer with sources</button></div></form>
    {guest && <p className="learning-hub__rag-guest">Sign in to search and index documents — browsing is open to everyone.</p>}
    {status && <p className="learning-hub__documents-status" role="status">{status}</p>}
    {error && <p className="learning-hub__rag-error" role="alert">{error}</p>}
    <p className="learning-hub__documents-count">{documents.length} indexed document{documents.length === 1 ? "" : "s"}</p>
    {answer && <article className="learning-hub__documents-answer" aria-live="polite"><h3>Grounded answer</h3><p>{answer.answer}</p>{answer.citations?.length > 0 && <p className="learning-hub__documents-citation">Sources: {answer.citations.map((citation: any) => `[${citation.index}] ${citation.title}`).join(" · ")}</p>}</article>}
    {results.length > 0 && <div className="learning-hub__documents-results" aria-live="polite">{results.map((result, index) => <article key={`${result.chunk_id || result.document_id}-${index}`}><h3>{result.source_url ? <a href={result.source_url} target="_blank" rel="noopener noreferrer">{result.title || result.document_id}</a> : (result.title || result.document_id)}</h3><p className="learning-hub__documents-citation">{result.section || "Document passage"}{result.page_number ? ` · page ${result.page_number}` : ""}</p><p>{result.text}</p></article>)}</div>}
  </section>;
}
