import React, { FC, useEffect, useRef, useState } from 'react';
import './RecognizeOverlay.css';

declare global {
  interface Window {
    PingOneRecognize?: {
      init: (container: HTMLElement, options: RecognizeInitOptions) => RecognizeInstance;
    };
  }
}

interface RecognizeInitOptions {
  sessionToken: string;
  capability: 'WEB_AUTHENTICATION' | 'WEB_ENROLLMENT';
  finishEventDelay?: number;
  errorEventDelay?: number;
  onFinish?: (result: unknown) => void;
  onError?: (err: unknown) => void;
}

interface RecognizeInstance {
  destroy?: () => void;
}

interface RecognizeOverlayProps {
  sessionToken: string;
  onSuccess: (sdkResult: unknown) => void;
  onFallback: () => void;
  onCancel: () => void;
}

const SDK_CDN = 'https://cdn.keyless.technology/web-sdk/latest/pingone-recognize.js';

// Memoized at module scope so every caller within the SAME successful load
// shares one promise, resolved exactly once — the fast path for the common
// case. A FAILED load resets this (below) so the next mount tries fresh
// rather than replaying the same rejection forever; that reset is what makes
// the DOM-level guard below load-bearing, not redundant.
let sdkLoadPromise: Promise<void> | null = null;

/** Record on the element itself once its 'load'/'error' has fired. */
function markScriptSettled(script: HTMLScriptElement, state: 'loaded' | 'error') {
  script.dataset.recognizeSdkState = state;
}

function loadSdkScript(): Promise<void> {
  if (window.PingOneRecognize) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('recognize-sdk-script') as HTMLScriptElement | null;
    if (existing) {
      // The tag can outlive the promise cache above — a failed load resets
      // sdkLoadPromise to null (so a retry can try again) but leaves the
      // <script> tag in the DOM. 'load'/'error' are one-shot DOM events that
      // never replay to a listener attached after they already fired, so a
      // retry that just re-attached listeners here hung on
      // "Loading face ID…" forever — the exact bug this dataset check closes:
      // read the settled state off the element instead of racing a dead event.
      const state = existing.dataset.recognizeSdkState;
      if (state === 'loaded') { resolve(); return; }
      if (state === 'error') { reject(new Error('SDK script failed to load')); return; }
      existing.addEventListener('load', () => { markScriptSettled(existing, 'loaded'); resolve(); });
      existing.addEventListener('error', () => { markScriptSettled(existing, 'error'); reject(new Error('SDK script failed to load')); });
      return;
    }
    const script = document.createElement('script');
    script.id = 'recognize-sdk-script';
    script.src = SDK_CDN;
    script.onload = () => { markScriptSettled(script, 'loaded'); resolve(); };
    script.onerror = () => { markScriptSettled(script, 'error'); reject(new Error('SDK script failed to load')); };
    document.head.appendChild(script);
  });
  sdkLoadPromise.catch(() => { sdkLoadPromise = null; });
  return sdkLoadPromise;
}

const RecognizeOverlay: FC<RecognizeOverlayProps> = ({
  sessionToken,
  onSuccess,
  onFallback,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<RecognizeInstance | null>(null);
  const [status, setStatus] = useState<string>('Loading face ID…');
  const [isError, setIsError] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let autoFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        await loadSdkScript();
        if (cancelled || !containerRef.current || !window.PingOneRecognize) return;
        setStatus('Look at the camera to verify your identity.');
        instanceRef.current = window.PingOneRecognize.init(containerRef.current, {
          sessionToken,
          capability: 'WEB_AUTHENTICATION',
          finishEventDelay: 500,
          errorEventDelay: 3000,
          onFinish: (result) => {
            if (cancelled) return;
            setStatus('Verifying…');
            onSuccess(result);
          },
          onError: (err) => {
            if (cancelled) return;
            console.warn('[RecognizeOverlay] SDK error:', err);
            setIsError(true);
            setIsFallback(true);
            setStatus('Face ID unavailable — sending a one-time code instead.');
            autoFallbackTimer = setTimeout(() => {
              if (!cancelled) onFallback();
            }, 3000);
          },
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[RecognizeOverlay] Failed to load SDK:', err);
        setIsError(true);
        setIsFallback(true);
        setStatus('Face ID unavailable — sending a one-time code instead.');
        autoFallbackTimer = setTimeout(() => {
          if (!cancelled) onFallback();
        }, 3000);
      }
    })();

    return () => {
      cancelled = true;
      if (autoFallbackTimer) clearTimeout(autoFallbackTimer);
      instanceRef.current?.destroy?.();
    };
  }, [sessionToken, onSuccess, onFallback]);

  return (
    <div className="recognize-overlay" role="dialog" aria-modal="true" aria-label="Face verification">
      <div className="recognize-overlay__inner">
        <h2 className="recognize-overlay__title">Face Verification</h2>
        <p
          className={[
            'recognize-overlay__status',
            isError ? 'recognize-overlay__status--error' : '',
            isFallback ? 'recognize-overlay__status--fallback' : '',
          ].join(' ').trim()}
        >
          {status}
        </p>
        <div ref={containerRef} className="recognize-overlay__sdk-container" />
        {!isFallback && (
          <button type="button" className="recognize-overlay__cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default RecognizeOverlay;
