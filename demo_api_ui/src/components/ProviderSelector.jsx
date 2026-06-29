// demo_api_ui/src/components/ProviderSelector.jsx
import './LlmConfig.css';

/**
 * ProviderSelector — segmented pill control: Helix | LM Studio | llama.cpp | Anthropic
 *
 * Props:
 *   provider: 'helix' | 'anthropic-lmstudio' | 'llamacpp' | 'anthropic'
 *   onSelect: (provider: string) => void
 *   helixStatus:     'available' | 'unconfigured' | 'unreachable' | null
 *   lmstudioStatus:  'available' | 'unreachable' | null
 *   llamaCppStatus:  'available' | 'unconfigured' | 'unreachable' | null
 *   anthropicStatus: 'available' | 'unconfigured' | null
 */
export default function ProviderSelector({ provider, onSelect, helixStatus, lmstudioStatus, llamaCppStatus, anthropicStatus }) {
  const statusLabel = (s) => {
    if (s === 'available')    return '✅ Active';
    if (s === 'unconfigured') return '⚠️ Unconfigured';
    if (s === 'unreachable')  return '❌ Unreachable';
    return '';
  };

  const statusMod = (s) => {
    if (s === 'available')    return 'cfg-segment-status--active';
    if (s === 'unconfigured') return 'cfg-segment-status--warn';
    if (s === 'unreachable')  return 'cfg-segment-status--error';
    return 'cfg-segment-status--unknown';
  };

  const PROVIDERS = [
    { id: 'helix',              label: 'Helix',      status: helixStatus },
    { id: 'anthropic-lmstudio', label: 'LM Studio',  status: lmstudioStatus },
    { id: 'llamacpp',           label: 'llama.cpp',  status: llamaCppStatus },
    { id: 'anthropic',          label: 'Anthropic',  status: anthropicStatus },
  ];

  return (
    <div>
      <div className="cfg-segment-wrap">
        {PROVIDERS.map(({ id, label, status }) => (
          <button
            key={id}
            type="button"
            className={`cfg-segment-btn${provider === id ? ' cfg-segment-btn--active' : ''}`}
            onClick={() => onSelect(id)}
          >
            <span>{label}</span>
            {status && (
              <span className={`cfg-segment-status ${statusMod(status)}`}>
                {statusLabel(status)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
