// demo_api_ui/src/components/shared/InspectorListItem.jsx
import React from 'react';
import './InspectorShell.css';

const BADGE_TEXT = { write: 'W', sensitive: 'S' };

/**
 * One left-column row: status dot (or token icon) + label + zero or more
 * badges. A tool can be both write and sensitive at once (both badges
 * render). `kind="token"` swaps the round status dot for a small square
 * token icon, colored with the same `dot` palette (default/write/sensitive).
 */
export default function InspectorListItem({
  label,
  active = false,
  dot = 'default',
  kind = 'step',
  badges = [],
  onClick,
}) {
  const dotClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__dot'
      : `inspector-shell-tree-item__dot inspector-shell-tree-item__dot--${dot}`;
  const tokenIconClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__token-icon'
      : `inspector-shell-tree-item__token-icon inspector-shell-tree-item__token-icon--${dot}`;
  const itemClass = active
    ? 'inspector-shell-tree-item inspector-shell-tree-item--active'
    : 'inspector-shell-tree-item';

  return (
    <button type="button" className={itemClass} onClick={onClick}>
      {kind === 'token' ? (
        <span className={tokenIconClass}>▮</span>
      ) : (
        <span className={dotClass} />
      )}
      <span>{label}</span>
      {badges.map((badge) => (
        <span
          key={badge}
          className={`inspector-shell-tree-item__badge inspector-shell-tree-item__badge--${badge}`}
        >
          {BADGE_TEXT[badge]}
        </span>
      ))}
    </button>
  );
}
