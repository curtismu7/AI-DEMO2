import PingIdentitySpinner from './PingIdentitySpinner';

/**
 * Compatibility wrapper for older configuration references.
 * All loading visuals now use the shared dancing Ping identity mark.
 */
export default function NeuralSpinner({ size = 96, className = '' }) {
  return (
    <PingIdentitySpinner
      size={size}
      label="Loading"
      className={`ns ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
