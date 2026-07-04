import React, { useState } from 'react';
import './SearchResults.css';

export default function SearchResults({ results, isLoading, error }) {
  const [expandedId, setExpandedId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (isLoading) {
    return (
      <div className="search-results">
        <div className="loading">Searching...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="search-results">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="search-results">
        <div className="empty-state">No results. Try searching for something.</div>
      </div>
    );
  }

  return (
    <div className="search-results">
      <div className="results-header">
        <h3>{results.length} results found</h3>
      </div>
      <div className="results-list">
        {results.map((result, idx) => (
          <div
            key={result.id || idx}
            className={`result-item ${expandedId === (result.id || idx) ? 'expanded' : ''}`}
          >
            <div
              className="result-header"
              onClick={() => toggleExpand(result.id || idx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  toggleExpand(result.id || idx);
                }
              }}
            >
              <div className="result-title">
                <span className="file-path">{result.file}</span>
                <span className="score">
                  {result.relevance
                    ? `${(result.relevance * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </div>
              <div className="result-meta">
                <span className="line-info">
                  Lines {result.line_start}-{result.line_end}
                </span>
              </div>
            </div>

            {expandedId === (result.id || idx) && (
              <div className="result-body">
                <pre className="code-snippet">{result.snippet}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
