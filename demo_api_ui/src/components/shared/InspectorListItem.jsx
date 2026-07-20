// demo_api_ui/src/components/shared/InspectorListItem.jsx
import React from 'react';
import './InspectorShell.css';

const BADGE_TEXT = { write: 'W', sensitive: 'S' };

/**
 * One left-column row: status dot + label + zero or more badges.
 * A tool can be both write and sensitive at once (both badges render).
 */
export default function InspectorListItem({
  label,
  active = false,
  dot = 'default',
  badges = [],
  onClick,
}) {
  const dotClass =
    dot === 'default'
      ? 'inspector-shell-tree-item__dot'
      : `inspector-shell-tree-item__dot inspector-shell-tree-item__dot--${dot}`;
  const itemClass = active
    ? 'inspector-shell-tree-item inspector-shell-tree-item--active'
    : 'inspector-shell-tree-item';

  return (
    <button type="button" className={itemClass} onClick={onClick}>
      <span className={dotClass} />
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
