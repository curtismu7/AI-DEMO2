import React, { useState, useCallback, useEffect } from 'react';
import CodebaseUploader from '../components/CodebaseUploader';
import SearchResults from '../components/SearchResults';
import { indexCodebase, searchCode } from '../services/codeSearchAPI';
import './CodeSearchPage.css';

const DEFAULT_CODEBASE = {
  id: 'ai-demo2-default',
  name: 'This demo (AI-DEMO2)',
  isDefault: true,
  uploadedAt: new Date(0).toISOString(),
};

export function CodeSearchPage() {
  const [codebases, setCodebases] = useState([]);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [indexError, setIndexError] = useState('');
  const [defaultStatus, setDefaultStatus] = useState('idle');

  // Load codebases from localStorage on mount, always seeding the default codebase
  useEffect(() => {
    let stored = [];
    const raw = localStorage.getItem('codeSearchCodebases');
    if (raw) {
      try {
        stored = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to load codebases:', err);
      }
    }
    const withDefault = [
      DEFAULT_CODEBASE,
      ...stored.filter((c) => c.id !== DEFAULT_CODEBASE.id),
    ];
    setCodebases(withDefault);
    setSelectedCodebaseId((prev) => prev || DEFAULT_CODEBASE.id);
  }, []);

  // Persist codebases to localStorage, excluding the default (non-persistable) entry
  useEffect(() => {
    const persistable = codebases.filter((c) => !c.isDefault);
    localStorage.setItem('codeSearchCodebases', JSON.stringify(persistable));
  }, [codebases]);

  // Poll the default codebase's index status
  useEffect(() => {
    let alive = true;
    let timeoutId;
    const poll = async () => {
      try {
        const r = await fetch('/api/code-search/default-status');
        if (!alive) return;
        const s = await r.json();
        setDefaultStatus(s.state);
        if (s.state === 'indexing') {
          timeoutId = setTimeout(poll, 4000);
        }
      } catch {
        if (alive) {
          timeoutId = setTimeout(poll, 8000);
        }
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, []);

  const handleUpload = useCallback(
    async (file, codebaseName) => {
      setIsIndexing(true);
      setIndexError('');

      try {
        // Generate a simple ID
        const codebaseId = `codebase-${Date.now()}`;

        // Call the BFF API
        await indexCodebase(file, codebaseName, 'simple');

        // Add to local state
        const newCodebase = {
          id: codebaseId,
          name: codebaseName,
          uploadedAt: new Date().toISOString(),
          fileSize: file.size,
          fileName: file.name,
        };

        setCodebases((prev) => [newCodebase, ...prev]);
        setSelectedCodebaseId(codebaseId);
        setQuery('');
        setResults([]);
      } catch (err) {
        setIndexError(
          err.message || 'Failed to index codebase. Make sure the server is running.'
        );
      } finally {
        setIsIndexing(false);
      }
    },
    []
  );

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchError('Please enter a search query');
      return;
    }

    if (!selectedCodebaseId) {
      setSearchError('Please select or upload a codebase first');
      return;
    }

    setIsSearching(true);
    setSearchError('');

    try {
      const searchResults = await searchCode(query, selectedCodebaseId, 10);
      setResults(searchResults || []);
    } catch (err) {
      setSearchError(
        err.message || 'Search failed. Make sure the server is running.'
      );
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, selectedCodebaseId]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSearch();
    }
  };

  return (
    <div className="code-search-page">
      <div className="search-container">
        <div className="search-panel-left">
          <CodebaseUploader onUpload={handleUpload} isLoading={isIndexing} />

          {indexError && <div className="panel-error">{indexError}</div>}

          {codebases.length > 0 && (
            <div className="codebases-list">
              <h3>Indexed Codebases</h3>
              <div className="codebase-items">
                {codebases.map((codebase) => (
                  <div
                    key={codebase.id}
                    className={`codebase-item ${
                      selectedCodebaseId === codebase.id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedCodebaseId(codebase.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedCodebaseId(codebase.id);
                      }
                    }}
                  >
                    <div className="codebase-name">{codebase.name}</div>
                    <div className="codebase-meta">
                      {new Date(codebase.uploadedAt).toLocaleDateString()}
                      {codebase.isDefault && defaultStatus === 'indexing' && (
                        <span className="codebase-chip"> indexing…</span>
                      )}
                      {codebase.isDefault && defaultStatus === 'error' && (
                        <span className="codebase-chip codebase-chip--error"> index failed</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="search-panel-right">
          <div className="search-form">
            <h2>Search Code</h2>
            <div className="search-input-group">
              <input
                type="text"
                placeholder="e.g., find authentication logic..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isSearching}
                className="search-input"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || !selectedCodebaseId}
                className="search-button"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {searchError && <div className="search-error">{searchError}</div>}
          </div>

          <SearchResults
            results={results}
            isLoading={isSearching}
            error={searchError}
          />
        </div>
      </div>
    </div>
  );
}
