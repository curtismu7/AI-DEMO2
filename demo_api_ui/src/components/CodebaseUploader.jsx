import React, { useState } from 'react';
import './CodebaseUploader.css';

export default function CodebaseUploader({ onUpload, isLoading }) {
  const [file, setFile] = useState(null);
  const [codebaseName, setCodebaseName] = useState('');
  const [error, setError] = useState('');

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
    </div>
  );
}
