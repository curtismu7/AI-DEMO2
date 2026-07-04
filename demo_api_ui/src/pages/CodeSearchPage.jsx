import React, { useState, useCallback, useEffect } from 'react';
import CodebaseUploader from '../components/CodebaseUploader';
import SearchResults from '../components/SearchResults';
import { indexCodebase, searchCode, listCodebases } from '../services/codeSearchAPI';
import './CodeSearchPage.css';

// Read the persisted codebase list once, synchronously, so the very first
// render already has it. A load-on-mount useEffect instead starts from [] and,
// under React StrictMode's double-effect invoke, the persist effect below fires
// with the empty initial value and clobbers localStorage before the load applies
// — wiping the user's saved codebases on every reload.
function loadStoredCodebases() {
  try {
    const stored = localStorage.getItem('codeSearchCodebases');
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load codebases:', err);
    return [];
  }
}

export function CodeSearchPage() {
  const [codebases, setCodebases] = useState(loadStoredCodebases);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState(
    () => codebases[0]?.id || ''
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [indexError, setIndexError] = useState('');

  // Persist codebases to localStorage. Safe now that state is seeded from
  // localStorage on the first render, so this never writes an empty array over
  // an existing list.
  useEffect(() => {
    localStorage.setItem('codeSearchCodebases', JSON.stringify(codebases));
  }, [codebases]);

  // Load the codebases actually indexed on the server and merge them in, so the
  // list shows what exists regardless of this browser's localStorage. Server
  // entries win on id collision (authoritative name + chunk count).
  useEffect(() => {
    let cancelled = false;
    listCodebases()
      .then((serverCodebases) => {
        if (cancelled || !Array.isArray(serverCodebases) || serverCodebases.length === 0) {
          return;
        }
        setCodebases((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]));
          for (const c of serverCodebases) {
            byId.set(c.id, { ...byId.get(c.id), id: c.id, name: c.name, chunks: c.chunks });
          }
          return Array.from(byId.values());
        });
        setSelectedCodebaseId((cur) => cur || serverCodebases[0].id);
      })
      .catch((err) => {
        // Non-fatal: fall back to whatever localStorage provided.
        console.error('Failed to load server codebases:', err);
      });
    return () => {
      cancelled = true;
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
                      {codebase.chunks != null
                        ? `${codebase.chunks.toLocaleString()} chunks`
                        : new Date(codebase.uploadedAt).toLocaleDateString()}
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
