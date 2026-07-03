import React, { useRef, useState } from 'react';
import { filterFolderFiles, indexFolderFiles } from '../services/codeSearchAPI';
import './CodebaseUploader.css';

export default function CodebaseUploader({ onUpload, isLoading, onFolderIndexed }) {
  const [file, setFile] = useState(null);
  const [codebaseName, setCodebaseName] = useState('');
  const [error, setError] = useState('');

  const folderInputRef = useRef(null);
  const [isFolderIndexing, setIsFolderIndexing] = useState(false);
  const [folderIndexed, setFolderIndexed] = useState(0);
  const [folderSkipped, setFolderSkipped] = useState(null);
  const [folderError, setFolderError] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
    }
  };

  const handleNameChange = (e) => {
    setCodebaseName(e.target.value);
  };

  const handleFolderPicked = async (e) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;

    const { accepted, skipped } = filterFolderFiles(list);
    const topFolder = (accepted[0]?.webkitRelativePath || 'folder').split('/')[0];
    setFolderError('');
    setFolderSkipped(skipped);
    setFolderIndexed(0);
    setIsFolderIndexing(true);

    try {
      // Client-batched upload to stay under body limits.
      const BATCH = 300;
      let indexed = 0;
      for (let i = 0; i < accepted.length; i += BATCH) {
        const batch = accepted.slice(i, i + BATCH);
        const res = await indexFolderFiles(batch, topFolder);
        indexed += res?.files_indexed || batch.length;
        setFolderIndexed(indexed);
      }

      if (typeof onFolderIndexed === 'function') {
        onFolderIndexed({ name: topFolder });
      }
    } catch (err) {
      setFolderError(err.message || 'Folder indexing failed');
    } finally {
      setIsFolderIndexing(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!codebaseName.trim()) {
      setError('Please enter a codebase name');
      return;
    }

    try {
      await onUpload(file, codebaseName);
      setFile(null);
      setCodebaseName('');
      setError('');
    } catch (err) {
      setError(err.message || 'Upload failed');
    }
  };

  return (
    <div className="codebase-uploader">
      <h2>Upload Codebase</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="codebase-name">Codebase Name</label>
          <input
            id="codebase-name"
            type="text"
            placeholder="e.g., my-project"
            value={codebaseName}
            onChange={handleNameChange}
            disabled={isLoading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="file-input">ZIP File</label>
          <input
            id="file-input"
            type="file"
            accept=".zip"
            onChange={handleFileChange}
            disabled={isLoading}
          />
          {file && <span className="file-name">{file.name}</span>}
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" disabled={isLoading || !file || !codebaseName}>
          {isLoading ? 'Uploading...' : 'Upload & Index'}
        </button>
      </form>

      <div className="folder-upload">
        <input
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          ref={folderInputRef}
          onChange={handleFolderPicked}
        />
        <button
          type="button"
          className="upload-folder-btn"
          onClick={() => folderInputRef.current?.click()}
          disabled={isFolderIndexing}
        >
          {isFolderIndexing ? 'Indexing folder...' : '📁 Index a folder from your computer'}
        </button>
        {folderError && <div className="error-message">{folderError}</div>}
        {folderSkipped != null && (
          <div className="folder-skip-note">
            Indexed {folderIndexed} files, skipped {folderSkipped} (binary / too large / vendored).
          </div>
        )}
      </div>
    </div>
  );
}
