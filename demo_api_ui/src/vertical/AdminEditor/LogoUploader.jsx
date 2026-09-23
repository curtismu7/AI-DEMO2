// demo_api_ui/src/vertical/AdminEditor/LogoUploader.jsx
//
// Admin logo upload for a vertical — targets the T3 logo endpoints:
//   GET    /api/verticals/:id/logo   (public, serves uploaded bytes)
//   POST   /api/verticals/:id/logo   (admin, multipart field "logo")
//   DELETE /api/verticals/:id/logo   (admin, falls back to identity.logoPath)
// Upload success refetches /me so identity.logoUrl reaches BrandLogo.
import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../services/apiClient';
import { notifySuccess, notifyError } from '../../utils/appToast';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export default function LogoUploader({ verticalId, onLogoChanged }) {
  const [hasLogo, setHasLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0); // cache-busts the <img> after upload/delete

  useEffect(() => {
    let cancelled = false;
    // HEAD-equivalent probe: a 200 means an uploaded logo exists.
    apiClient.get(`/api/verticals/${verticalId}/logo`, { responseType: 'blob' })
      .then(() => { if (!cancelled) setHasLogo(true); })
      .catch(() => { if (!cancelled) setHasLogo(false); });
    return () => { cancelled = true; };
  }, [verticalId, nonce]);

  const upload = useCallback(async (file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      notifyError('Logo must be PNG, JPEG, SVG, or WebP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notifyError('Logo must be 2 MB or smaller');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('logo', file, file.name);
      await apiClient.post(`/api/verticals/${verticalId}/logo`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setNonce((n) => n + 1);
      notifySuccess('Logo uploaded');
      if (onLogoChanged) onLogoChanged();
    } catch (err) {
      notifyError(err?.response?.data?.error || 'Logo upload failed');
    } finally {
      setBusy(false);
    }
  }, [verticalId, onLogoChanged]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await apiClient.delete(`/api/verticals/${verticalId}/logo`);
      setNonce((n) => n + 1);
      notifySuccess('Uploaded logo removed — falls back to configured logoPath');
      if (onLogoChanged) onLogoChanged();
    } catch (err) {
      notifyError(err?.response?.data?.error || 'Logo removal failed');
    } finally {
      setBusy(false);
    }
  }, [verticalId, onLogoChanged]);

  return (
    <div className="logo-uploader">
      <div className="logo-uploader__preview">
        <img
          src={`/api/verticals/${verticalId}/logo?v=${nonce}`}
          alt={`${verticalId} uploaded logo`}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          onLoad={(e) => { e.currentTarget.style.display = ''; }}
        />
        {!hasLogo && <span className="logo-uploader__none">No uploaded logo</span>}
      </div>
      <div className="logo-uploader__controls">
        <label className="logo-uploader__button">
          <input
            type="file"
            accept={ACCEPTED.join(',')}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              e.target.value = ''; // allow re-selecting the same file
              upload(f);
            }}
          />
          {busy ? 'Working…' : 'Upload logo'}
        </label>
        {hasLogo && (
          <button
            type="button"
            className="logo-uploader__button logo-uploader__button--danger"
            disabled={busy}
            onClick={remove}
          >
            Remove uploaded logo
          </button>
        )}
        <span className="logo-uploader__hint">
          PNG, JPEG, SVG, or WebP · max 2 MB. The uploaded logo overrides the
          configured logoPath.
        </span>
      </div>
    </div>
  );
}
