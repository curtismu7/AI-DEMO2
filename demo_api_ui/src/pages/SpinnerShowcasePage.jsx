import { useEffect, useRef, useState } from 'react';

import PingIdentitySpinner from '../components/shared/PingIdentitySpinner';
import './SpinnerShowcasePage.css';

export default function SpinnerShowcasePage() {
  const [isFullPagePreviewOpen, setIsFullPagePreviewOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState('');
  const [logoName, setLogoName] = useState('');
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef(null);

  useEffect(() => () => {
    if (logoSrc) URL.revokeObjectURL(logoSrc);
  }, [logoSrc]);

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('Choose an image file, such as PNG, JPEG, GIF, or WebP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Choose an image smaller than 2 MB.');
      return;
    }

    setLogoError('');
    setLogoName(file.name);
    setLogoSrc(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoSrc('');
    setLogoName('');
    setLogoError('');
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  return (
    <main className="spinner-showcase">
      <div className="spinner-showcase__shell">
        <header className="spinner-showcase__header">
          <p className="spinner-showcase__eyebrow">Loading states</p>
          <h1>Ping spinner in context</h1>
          <p className="spinner-showcase__intro">
            The same identity mark scales from a small embedded wait state to a full-page handoff.
          </p>
        </header>

        <section className="spinner-showcase__logo-tools" aria-labelledby="custom-logo-heading">
          <div>
            <p className="spinner-showcase__kicker">Personalize the mark</p>
            <h2 id="custom-logo-heading">Try your own logo</h2>
            <p className="spinner-showcase__logo-help">
              Upload an image to preview it in both loading states. It stays in this page only.
            </p>
          </div>
          <div className="spinner-showcase__logo-actions">
            <label className="spinner-showcase__upload-button" htmlFor="spinner-showcase-logo">
              Upload custom logo
              <input
                ref={logoInputRef}
                id="spinner-showcase-logo"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleLogoChange}
              />
            </label>
            {logoSrc && (
              <div className="spinner-showcase__logo-ready">
                <img src={logoSrc} alt="Uploaded logo preview" />
                <span>Custom logo ready: {logoName}</span>
                <button type="button" className="spinner-showcase__text-button" onClick={clearLogo}>
                  Use Ping logo
                </button>
              </div>
            )}
            {logoError && <p className="spinner-showcase__logo-error" role="alert">{logoError}</p>}
          </div>
        </section>

        <section className="spinner-showcase__grid" aria-label="Spinner examples">
          <article className="spinner-showcase__card">
            <div className="spinner-showcase__card-heading">
              <div>
                <p className="spinner-showcase__kicker">Embedded state</p>
                <h2>Keep the surrounding page in view</h2>
              </div>
              <span className="spinner-showcase__badge">Inline</span>
            </div>
            <div className="spinner-showcase__embedded-stage">
              <PingIdentitySpinner size={70} label="Loading account details…" logoSrc={logoSrc || undefined} />
            </div>
            <p className="spinner-showcase__note">
              Use this when the user can keep reading or interacting with the rest of the page.
            </p>
          </article>

          <article className="spinner-showcase__card">
            <div className="spinner-showcase__card-heading">
              <div>
                <p className="spinner-showcase__kicker">Full-page state</p>
                <h2>Center the handoff</h2>
              </div>
              <span className="spinner-showcase__badge">Overlay</span>
            </div>
            <div className="spinner-showcase__preview-stage">
              <PingIdentitySpinner size={58} label="Previewing full-page state…" aria-hidden="true" logoSrc={logoSrc || undefined} />
              <p>Preview the blocking state over the entire app.</p>
              <button type="button" className="spinner-showcase__button" onClick={() => setIsFullPagePreviewOpen(true)}>
                Preview full-page state
              </button>
            </div>
            <p className="spinner-showcase__note">
              Use this when a route change or secure handoff needs the user’s full attention.
            </p>
          </article>
        </section>
      </div>

      {isFullPagePreviewOpen && (
        <div
          className="spinner-showcase__overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Full-page loading preview"
        >
          <div className="spinner-showcase__overlay-content">
            <PingIdentitySpinner size={104} label="Preparing your workspace…" logoSrc={logoSrc || undefined} />
            <p className="spinner-showcase__overlay-note">
              Your secure workspace is getting ready.
            </p>
            <button type="button" className="spinner-showcase__button spinner-showcase__button--quiet" onClick={() => setIsFullPagePreviewOpen(false)}>
              Exit preview
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
