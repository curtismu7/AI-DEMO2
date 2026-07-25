/**
 * AdminToolsDropdown — small admin-only header popout replacing the old
 * Actions dropdown's "Admin Actions" + "PingOne Admin" sections. Same
 * trigger+FloatingPanel pattern as DemoStepsDropdown, flat list only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import FloatingPanel from './FloatingPanel';
import apiClient from '../services/apiClient';

/**
 * @param {object} props
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(tool: object) => void} props.onSelect
 */
export default function AdminToolsDropdown({ open = false, onOpenChange, onSelect }) {
  const triggerRef = useRef(null);
  const panelPosRef = useRef({ x: 0, y: 0 });
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadTools = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/admin-tools', { _silent: true })
      .then(({ data }) => setTools(data.tools || []))
      .catch((err) => {
        setError(err.message || 'Failed to load admin tools');
        setTools([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadTools();
  }, [open, loadTools]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 420;
      let x = rect.right - panelWidth;
      if (x < 8) x = 8;
      panelPosRef.current = { x, y: rect.bottom + 6 };
    }
    onOpenChange(!open);
  }

  function handleSelect(tool) {
    onOpenChange(false);
    onSelect(tool);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ba-actions-trigger${open ? ' active' : ''}`}
        title="Admin tools — customer lookups and PingOne platform ops"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="admin-tools-trigger"
      >
        Admin {open ? '▴' : '▾'}
      </button>
      {open && (
        <FloatingPanel
          title="Admin Tools"
          defaultX={panelPosRef.current.x}
          defaultY={panelPosRef.current.y}
          defaultWidth={420}
          defaultHeight={360}
          minWidth={280}
          minHeight={200}
          onClose={() => onOpenChange(false)}
          className="ba-admin-tools-float"
        >
          {loading && <p className="ba-demo-steps-popout__status">Loading…</p>}
          {error && (
            <p className="ba-demo-steps-popout__status ba-demo-steps-popout__status--error">
              {error}
            </p>
          )}
          {!loading && !error && tools.length === 0 && (
            <p className="ba-demo-steps-popout__status">No admin tools available.</p>
          )}
          <ul className="ba-demo-steps-popout__grid">
            {tools.map((tool) => (
              <li key={tool.id} className="ba-demo-steps-popout__card-item">
                <button
                  type="button"
                  className="banking-chips-dropdown__button banking-chips-dropdown__button--heuristic"
                  onClick={() => handleSelect(tool)}
                  title={tool.trigger.text}
                  data-testid={`admin-tool-${tool.id}`}
                >
                  {tool.title}
                </button>
              </li>
            ))}
          </ul>
        </FloatingPanel>
      )}
    </>
  );
}
