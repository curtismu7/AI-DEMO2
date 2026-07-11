import React, { useRef, useState } from 'react';
import {
  filterFolderFiles,
  indexFolderFiles,
  FOLDER_MAX_FILE_BYTES,
  FOLDER_MAX_FILES,
} from '../services/codeSearchAPI';
import { spinner } from '../services/spinnerService';
import './CodebaseUploader.css';

// Mirrors the multer `limits.fileSize` on the BFF route
// (demo_api_server/routes/codeSearch.js) so oversized ZIPs are caught with a
// clear message before the upload starts.
const ZIP_MAX_BYTES = 50 * 1024 * 1024;

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

    // Native system modal when files were skipped for size/count, stating what
    // was skipped and the limits. The inline note below stays as the
    // persistent record.
    if (skipped > 0) {
      window.alert(
        `${skipped} of ${list.length} selected files will be skipped.\n\n` +
          `Limits: max ${FOLDER_MAX_FILES} files per folder and ` +
          `${Math.round(FOLDER_MAX_FILE_BYTES / 1024)} KB per file. ` +
          `Binary, vendored (node_modules, .git, dist, build) and unsupported ` +
          `file types are also excluded.`
      );
    }
    if (accepted.length === 0) {
      setFolderSkipped(skipped);
      setFolderIndexed(0);
      e.target.value = '';
      return;
    }

    const topFolder = (accepted[0]?.webkitRelativePath || 'folder').split('/')[0];
    // One id for the whole folder so all batches land in a single codebase and
    // the id we hand the page matches what is stored in Weaviate (queryable).
    const codebaseId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setFolderError('');
    setFolderSkipped(skipped);
    setFolderIndexed(0);
    setIsFolderIndexing(true);
    // Global spinner modal while the folder uploads and indexes (same service
    // CodeExplorerPage drives around its async work).
    spinner.show('Indexing folder…', 'POST /api/code-search/index');

    try {
      // Client-batched upload to stay under body limits.
      const BATCH = 300;
      let indexed = 0;
      for (let i = 0; i < accepted.length; i += BATCH) {
        const batch = accepted.slice(i, i + BATCH);
        const res = await indexFolderFiles(batch, topFolder, codebaseId);
        indexed += res?.files_indexed || batch.length;
        setFolderIndexed(indexed);
      }

      if (typeof onFolderIndexed === 'function') {
        onFolderIndexed({ id: codebaseId, name: topFolder });
      }
    } catch (err) {
      setFolderError(err.message || 'Folder indexing failed');
    } finally {
      spinner.hide();
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

    // Native system modal for the ZIP-too-large validation path, stating the
    // limit, before any upload starts.
    if (file.size > ZIP_MAX_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      window.alert(
        `"${file.name}" is ${sizeMb} MB, which exceeds the ` +
          `${ZIP_MAX_BYTES / (1024 * 1024)} MB upload limit for ZIP files. ` +
          `Please upload a smaller archive.`
      );
      setError(`ZIP file too large (limit ${ZIP_MAX_BYTES / (1024 * 1024)} MB)`);
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
          {isFolderIndexing ? 'Indexing folder...' : 'Index a folder from your computer'}
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
