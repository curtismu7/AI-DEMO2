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
  const [defaultStatus, setDefaultStatus] = useState('idle');
  const [rightTab, setRightTab] = useState('ask'); // 'ask' | 'search'

  // Persist codebases to localStorage. Safe now that state is seeded from
  // localStorage on the first render, so this never writes an empty array over
  // an existing list. localStorage is only the pre-fetch/offline fallback —
  // the server list below is authoritative once it loads.
  useEffect(() => {
    const persistable = codebases.filter((c) => !c.isDefault);
    localStorage.setItem('codeSearchCodebases', JSON.stringify(persistable));
  }, [codebases]);

  // Load the codebases actually indexed on the server. The server response is
  // the source of truth: entries deleted or re-indexed server-side disappear
  // here too (an additive merge would keep phantom localStorage entries whose
  // searches can only fail). Local-only decorations (uploadedAt, fileSize,
  // fileName) are carried over by id.
  useEffect(() => {
    let cancelled = false;
    listCodebases()
      .then((serverCodebases) => {
        if (cancelled || !Array.isArray(serverCodebases)) return;
        setCodebases((prev) => {
          const localById = new Map(prev.map((c) => [c.id, c]));
          return serverCodebases.map((c) => ({
            ...localById.get(c.id),
            id: c.id,
            name: c.name,
            chunks: c.chunks,
          }));
        });
        // Keep the current selection only if the server still has it.
        setSelectedCodebaseId((cur) =>
          serverCodebases.some((c) => c.id === cur)
            ? cur
            : (serverCodebases[0]?.id || '')
        );
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
        // Call the BFF API. Use the codebase_id the server generated — a
        // locally invented id would never match, so searching the fresh
        // upload would always miss.
        const result = await indexCodebase(file, codebaseName, 'simple');
        const codebaseId = result.codebase_id;

        // Add to local state
        const newCodebase = {
          id: codebaseId,
          name: codebaseName,
          chunks: result.chunks_created,
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

  const handleFolderIndexed = useCallback((cb) => {
    // Use the id the uploader stored under (matches Weaviate) so Search/Ask
    // actually query the indexed folder — do NOT mint a new unrelated id.
    const newCodebase = {
      id: cb.id,
      name: cb.name,
      uploadedAt: new Date().toISOString(),
    };
    setCodebases((prev) => [
      newCodebase,
      ...prev.filter((c) => c.id !== cb.id),
    ]);
    setSelectedCodebaseId(newCodebase.id);
  }, []);

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
          <CodebaseUploader
            onUpload={handleUpload}
            isLoading={isIndexing}
            onFolderIndexed={handleFolderIndexed}
          />

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
          <div className="cs-tabs">
            <button
              className={rightTab === 'ask' ? 'active' : ''}
              onClick={() => setRightTab('ask')}
            >
              Ask
            </button>
            <button
              className={rightTab === 'search' ? 'active' : ''}
              onClick={() => setRightTab('search')}
            >
              Search
            </button>
          </div>
          {rightTab === 'ask' ? (
            <CodeSearchAsk codebaseId={selectedCodebaseId} />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
