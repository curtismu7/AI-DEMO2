import React, { useState, useCallback, useEffect } from 'react';
import CodebaseUploader from '../components/CodebaseUploader';
import SignInPrompt from '../components/SignInPrompt';
import useDividerDrag from '../hooks/useDividerDrag';
import CodeSearchAsk from '../components/CodeSearchAsk';
import SearchResults from '../components/SearchResults';
import { indexCodebase, searchCode, listCodebases } from '../services/codeSearchAPI';
import { spinner } from '../services/spinnerService';
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
  const [defaultStatus, setDefaultStatus] = useState({ state: 'idle', filesIndexed: 0, chunksCreated: 0, error: null });
  const [rightTab, setRightTab] = useState('ask'); // 'ask' | 'search'
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const { size: leftPanelWidth, handleProps: leftPanelHandleProps } = useDividerDrag({
    min: 320,
    max: 720,
    initial: 440,
    storageKey: 'code-search-left-width',
  });

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

  // Poll default-index status. When ready, refresh the server codebase list
  // (pieces appear as separate rows) and auto-select a demo piece if needed.
  useEffect(() => {
    let cancelled = false;
    let pollTimeout;

    const pickDefaultPiece = (status, list) => {
      const pieceIds = Array.isArray(status.pieceIds) ? status.pieceIds : [];
      const preferred = ['ai-demo2-ui', 'ai-demo2-server', ...pieceIds];
      for (const id of preferred) {
        if (list.some((c) => c.id === id)) return id;
      }
      // Legacy monolith id, or first listed codebase.
      if (list.some((c) => c.id === 'ai-demo2-default')) return 'ai-demo2-default';
      return list[0]?.id || '';
    };

    const pollStatus = async () => {
      try {
        const res = await fetch('/api/code-search/default-status');
        if (res.status === 401 && !cancelled) {
          // Guest visitor: the whole /api/code-search surface needs a session —
          // surface a sign-in ask instead of polling into silence forever.
          setNeedsSignIn(true);
          return;
        }
        if (!res.ok || cancelled) return;
        const status = await res.json();
        setDefaultStatus(status);

        if (status.state === 'ready') {
          // Pieces finish indexing after the initial listCodebases fetch —
          // re-load so the left rail shows UI / Server / Gateway / …
          try {
            const serverCodebases = await listCodebases();
            if (!cancelled && Array.isArray(serverCodebases)) {
              setCodebases((prev) => {
                const localById = new Map(prev.map((c) => [c.id, c]));
                return serverCodebases.map((c) => ({
                  ...localById.get(c.id),
                  id: c.id,
                  name: c.name,
                  chunks: c.chunks,
                }));
              });
              setSelectedCodebaseId((cur) => {
                if (cur && serverCodebases.some((c) => c.id === cur)) return cur;
                return pickDefaultPiece(status, serverCodebases);
              });
            }
          } catch (err) {
            console.error('Failed to refresh codebases after default index:', err);
          }
          return; // Stop polling
        }

        if (status.state === 'indexing' || status.state === 'idle') {
          pollTimeout = setTimeout(pollStatus, 2000);
        }
      } catch (err) {
        if (!cancelled) {
          pollTimeout = setTimeout(pollStatus, 5000);
        }
      }
    };

    pollStatus();
    return () => {
      cancelled = true;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, []);

  const handleUpload = useCallback(
    async (file, codebaseName) => {
      setIsIndexing(true);
      setIndexError('');
      // Global spinner modal while the ZIP uploads and indexes (same service
      // CodeExplorerPage drives around its async work).
      spinner.show('Uploading and indexing codebase…', 'POST /api/code-search/index');

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
        spinner.hide();
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

  if (needsSignIn) {
    return (
      <div className="code-search-page">
        <SignInPrompt message="Code search needs a signed-in session to query the index." />
      </div>
    );
  }

  return (
    <div className="code-search-page">
      <div className="search-container" style={{ '--cs-left-w': `${leftPanelWidth}px` }}>
        <div className="search-panel-left">
          <CodebaseUploader
            onUpload={handleUpload}
            isLoading={isIndexing}
            onFolderIndexed={handleFolderIndexed}
          />

          {indexError && <div className="panel-error">{indexError}</div>}

          {(defaultStatus.state === 'indexing' || defaultStatus.state === 'idle') && (
            <div className="default-index-status" role="status">
              Indexing demo packages
              {defaultStatus.state === 'indexing' ? '…' : ' (waiting)'}
              {defaultStatus.filesIndexed
                ? ` — ${defaultStatus.filesIndexed.toLocaleString()} files so far`
                : ''}
            </div>
          )}

          {codebases.length > 0 && (
            <div className="codebases-list">
              <h3>Indexed Codebases</h3>
              <p className="codebases-hint">
                Large demos are split into packages — pick one to search or ask.
              </p>
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
                        : codebase.uploadedAt
                          ? new Date(codebase.uploadedAt).toLocaleDateString()
                          : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="divider-drag-handle" aria-label="Resize codebase panel" {...leftPanelHandleProps} />

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
