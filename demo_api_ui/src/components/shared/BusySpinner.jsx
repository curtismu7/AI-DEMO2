import PingIdentitySpinner from './PingIdentitySpinner';

/**
 * Compatibility wrapper for older callers.
 * The app has one loading visual: the dancing Ping identity spinner.
 */
export default function BusySpinner({
  size = 96,
  label = null,
  messages = [],
  fullscreen = false,
  className = '',
}) {
  const text = Array.isArray(messages) && messages.length > 0 ? messages[0] : label;
  const spinner = (
    <PingIdentitySpinner
      size={size}
      label={text || 'Loading'}
      className={className}
    />
  );

  if (!fullscreen) return spinner;

  return (
    <div className="lo-backdrop" role="status" aria-live="polite">
      {spinner}
    </div>
  );
}
