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

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PingOneRecognize) { resolve(); return; }
    const existing = document.getElementById('recognize-sdk-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('SDK script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'recognize-sdk-script';
    script.src = SDK_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SDK script failed to load'));
    document.head.appendChild(script);
  });
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
