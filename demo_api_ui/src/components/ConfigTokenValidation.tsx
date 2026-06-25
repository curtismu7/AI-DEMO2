/**
 * ConfigTokenValidation Component
 *
 * UI for configuring the token validation mode (introspection vs jwt).
 * Shows current mode, allows operators to toggle between modes,
 * and provides a "Test PingOne Connection" button using the health endpoint.
 *
 * Used in the demo Config page to make validation strategy transparent
 * and configurable without restarting the server.
 */

import React, { useState, useEffect, useCallback } from 'react';
import styles from './ConfigTokenValidation.module.css';

type ValidationMode = 'introspection' | 'jwt';

interface ModeMetadata {
  mode: ValidationMode;
  name: string;
  description: string;
  pros: string[];
  cons: string[];
}

interface ValidationModeResponse {
  mode: ValidationMode;
  description: string;
  metadata: ModeMetadata;
  supported: string[];
}

interface HealthCheckResult {
  status: 'connected' | 'failed' | 'not_configured' | 'auth_failed';
  endpoint: string | null;
  timestamp: string;
  details: {
    responseTime?: number;
    httpStatus?: number;
    mode?: string;
    error?: string;
    hint?: string;
    message?: string;
  };
}

export const ConfigTokenValidation: React.FC = () => {
  const [validationMode, setValidationMode] = useState<ValidationMode>('introspection');
  const [modeMetadata, setModeMetadata] = useState<ModeMetadata | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthCheckResult | null>(null);
  const [isLoadingMode, setIsLoadingMode] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Load current validation mode from server on mount
  const loadValidationMode = useCallback(async () => {
    setIsLoadingMode(true);
    setModeError(null);
    try {
      const response = await fetch('/api/config/validation-mode');
      if (response.ok) {
        const data: ValidationModeResponse = await response.json();
        setValidationMode(data.mode);
        setModeMetadata(data.metadata);
      } else {
        setModeError('Could not load current validation mode');
      }
    } catch (error) {
      setModeError('Network error loading validation mode');
    } finally {
      setIsLoadingMode(false);
    }
  }, []);

  useEffect(() => {
    loadValidationMode();
  }, [loadValidationMode]);

  // Handle mode toggle via server POST
  const handleModeChange = async (newMode: ValidationMode) => {
    if (newMode === validationMode || isChangingMode) return;

    setIsChangingMode(true);
    setModeError(null);
    setHealthStatus(null);

    try {
      const response = await fetch('/api/config/validation-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });

      if (response.ok) {
        const data = await response.json();
        setValidationMode(data.mode as ValidationMode);
        // Refresh metadata
        await loadValidationMode();
      } else {
        const err = await response.json();
        setModeError(err.message || 'Failed to update validation mode');
      }
    } catch (error) {
      setModeError('Error updating validation mode: ' + (error as Error).message);
    } finally {
      setIsChangingMode(false);
    }
  };

  // Test PingOne introspection endpoint connectivity
  const handleHealthCheck = async () => {
    setIsTestingConnection(true);
    setTestError(null);
    setHealthStatus(null);

    try {
      const response = await fetch('/api/health/introspection');
      const data: HealthCheckResult = await response.json();
      setHealthStatus(data);

      if (response.status !== 200) {
        setTestError(data.details?.error || data.details?.hint || 'Health check failed');
      }
    } catch (error) {
      setTestError('Failed to test connection: ' + (error as Error).message);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const modeInfo: Record<ValidationMode, { label: string; description: string }> = {
    introspection: {
      label: '🔍 Introspection (Recommended)',
      description:
        'Calls PingOne RFC 7662 endpoint to validate tokens in real-time. Detects revoked tokens. ~50ms with 30s cache.',
    },
    jwt: {
      label: '⚡ JWT Local Validation',
      description:
        'Validates token signature locally (RS256). Very fast (~1ms), offline-capable. Cannot detect revoked tokens.',
    },
  };

  return (
    <div className={styles.container} data-testid="config-token-validation">
      <div className={styles.header}>
        <h3 className={styles.title}>Token Validation Mode</h3>
        <p className={styles.subtitle}>
          Choose how the BFF validates OAuth tokens on each request.
        </p>
      </div>

      {/* Mode selector */}
      <div className={styles.modeSelector}>
        {(Object.keys(modeInfo) as ValidationMode[]).map((mode) => {
          const isSelected = validationMode === mode;
          return (
            <label
              key={mode}
              className={`${styles.modeOption} ${isSelected ? styles.selected : ''}`}
              data-mode={mode}
            >
              <div className={styles.modeHeader}>
                <input
                  type="radio"
                  name="validation-mode"
                  value={mode}
                  checked={isSelected}
                  onChange={() => handleModeChange(mode)}
                  disabled={isChangingMode || isLoadingMode}
                  className={styles.radio}
                  aria-label={`Select ${mode} validation mode`}
                />
                <span className={styles.modeLabel}>{modeInfo[mode].label}</span>
                {isSelected && (
                  <span className={styles.activeBadge}>Active</span>
                )}
              </div>
              <p className={styles.modeDescription}>{modeInfo[mode].description}</p>
            </label>
          );
        })}
      </div>

      {modeError && (
        <div className={styles.errorBanner} role="alert">
          <strong>Error: </strong>{modeError}
        </div>
      )}

      {isChangingMode && (
        <p className={styles.changingNote}>Updating validation mode…</p>
      )}

      {/* Current mode details */}
      {modeMetadata && (
        <div className={styles.modeDetails}>
          <h4 className={styles.detailsTitle}>About {modeMetadata.name}</h4>
          <div className={styles.prosConsGrid}>
            <div>
              <strong className={styles.prosTitle}>✓ Advantages</strong>
              <ul className={styles.prosList}>
                {modeMetadata.pros.map((pro, i) => (
                  <li key={i}>{pro}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong className={styles.consTitle}>⚠ Limitations</strong>
              <ul className={styles.consList}>
                {modeMetadata.cons.map((con, i) => (
                  <li key={i}>{con}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Proactive banner when introspection mode selected but not yet tested */}
      {validationMode === 'introspection' && !healthStatus && (
        <div className={styles.proactiveBanner}>
          ℹ️ Introspection mode is selected. Click <strong>Test PingOne Connection</strong> below to verify your configuration. If you haven't set up the env vars yet, the test will show a step-by-step setup guide.
        </div>
      )}

      {/* PingOne connectivity test */}
      <div className={styles.healthSection}>
        <h4 className={styles.healthTitle}>PingOne Connectivity</h4>
        <p className={styles.healthSubtitle}>
          Test whether the BFF can reach the PingOne introspection endpoint.
        </p>
        <button
          onClick={handleHealthCheck}
          disabled={isTestingConnection}
          className={styles.testButton}
          type="button"
        >
          {isTestingConnection ? '⏳ Testing…' : '🔗 Test PingOne Connection'}
        </button>

        {healthStatus && (
          <div
            className={`${styles.healthResult} ${
              healthStatus.status === 'connected' ? styles.healthOk : styles.healthFailed
            }`}
            role="status"
            aria-live="polite"
          >
            <strong>
              {healthStatus.status === 'connected'
                ? '✓ Connected'
                : healthStatus.status === 'auth_failed'
                ? '🔑 Auth Failed'
                : healthStatus.status === 'not_configured'
                ? '⚙ Not Configured'
                : '✗ Connection Failed'}
            </strong>
            {healthStatus.endpoint && (
              <p>
                <span className={styles.label}>Endpoint:</span>{' '}
                <code className={styles.code}>{healthStatus.endpoint}</code>
              </p>
            )}
            {healthStatus.details.responseTime !== undefined && (
              <p>
                <span className={styles.label}>Response time:</span>{' '}
                {healthStatus.details.responseTime}ms
              </p>
            )}
            {healthStatus.details.mode && (
              <p>
                <span className={styles.label}>Validation mode:</span>{' '}
                {healthStatus.details.mode}
              </p>
            )}
            {healthStatus.details.message && (
              <p className={styles.message}>{healthStatus.details.message}</p>
            )}
            {(healthStatus.details.error || healthStatus.details.hint) && (
              <p className={styles.errorDetail}>
                {healthStatus.details.error}
                {healthStatus.details.hint && (
                  <><br /><em>Hint: {healthStatus.details.hint}</em></>
                )}
              </p>
            )}
            <p className={styles.timestamp}>
              Tested: {new Date(healthStatus.timestamp).toLocaleTimeString()}
            </p>
          </div>
        )}

        {/* Inline setup guide — shown when health check confirms introspection is not configured */}
        {healthStatus?.status === 'not_configured' && (
          <div className={styles.setupGuide}>
            <p className={styles.setupGuideTitle}>⚙ How to enable token introspection</p>

            <div className={styles.setupStep}>
              <div className={styles.setupStepHeader}>
                <span className={styles.setupStepNum}>1</span>
                <span className={styles.setupStepTitle}>Find your introspection endpoint URL</span>
              </div>
              <div className={styles.setupStepBody}>
                PingOne provides the introspection endpoint at:<br />
                <code className={styles.code}>https://auth.pingone.com/&#123;environment-id&#125;/as/introspect</code><br /><br />
                Find your <strong>Environment ID</strong>: PingOne Admin → Environments → select your environment → the ID appears in the URL or on the Overview tab.
              </div>
            </div>

            <div className={styles.setupStep}>
              <div className={styles.setupStepHeader}>
                <span className={styles.setupStepNum}>2</span>
                <span className={styles.setupStepTitle}>Create a Worker Application in PingOne</span>
              </div>
              <div className={styles.setupStepBody}>
                <ol>
                  <li>In PingOne Admin, go to <strong>Applications → Applications</strong></li>
                  <li>Click <strong>+ Add Application</strong> and select <strong>Worker</strong></li>
                  <li>Name it (e.g. "Banking Demo Introspection Worker") and save</li>
                  <li>Open the app → <strong>Configuration</strong> tab → copy <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                  <li>Make sure the application is <strong>enabled</strong></li>
                </ol>
              </div>
            </div>

            <div className={styles.setupStep}>
              <div className={styles.setupStepHeader}>
                <span className={styles.setupStepNum}>3</span>
                <span className={styles.setupStepTitle}>Add to your .env file and restart</span>
              </div>
              <div className={styles.setupStepBody}>
                <pre className={styles.setupCode}>{`PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.com/{env-id}/as/introspect
PINGONE_WORKER_CLIENT_ID=your-worker-client-id
PINGONE_WORKER_CLIENT_SECRET=your-worker-client-secret`}</pre>
                <p className={styles.setupNote}>Replace <code>{'{env-id}'}</code> with your PingOne Environment ID. Restart the BFF server after saving.</p>
              </div>
            </div>
          </div>
        )}

        {testError && (
          <div className={styles.errorBanner} role="alert">
            <strong>Test Error: </strong>{testError}
          </div>
        )}
      </div>

      {/* Informational links */}
      <div className={styles.infoFooter}>
        <span>📖 </span>
        <button
          type="button"
          onClick={() => {}}
          title="See docs/INTROSPECTION_VALIDATION_GUIDE.md for full documentation"
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Introspection vs JWT validation guide
        </button>
        {' · '}
        <a href="/api/health" target="_blank" rel="noreferrer">
          Full health status
        </a>
      </div>
    </div>
  );
};

export default ConfigTokenValidation;
