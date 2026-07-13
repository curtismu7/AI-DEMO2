// EditableSticky.jsx — a yellow sticky-note callout, click-to-edit, that
// persists its text to localStorage per `id` so edits survive a reload.
// Starts from `defaultText` (the source diagram's original wording) until
// edited. Used by AgentOnboardingFlowDiagram.jsx to match the reference
// image's yellow annotation notes.
import React, { useState, useCallback, useRef } from "react";
import "./EditableSticky.css";

const STORAGE_PREFIX = "aiDemo.agentOnboardingSticky.";

function loadText(id, defaultText) {
  try {
    const saved = window.localStorage.getItem(STORAGE_PREFIX + id);
    return saved !== null ? saved : defaultText;
  } catch (_) {
    return defaultText;
  }
}

export default function EditableSticky({ id, defaultText, rotate = -1, className = "" }) {
  const [text, setText] = useState(() => loadText(id, defaultText));
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);

  const startEdit = useCallback(() => {
    setEditing(true);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    const next = ref.current ? ref.current.textContent.trim() : text;
    setText(next || defaultText);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, next || defaultText);
    } catch (_) {
      // ignore quota/blocked storage
    }
  }, [id, defaultText, text]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        if (ref.current) ref.current.textContent = text;
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ref.current.blur();
      }
    },
    [text],
  );

  return (
    <div
      className={`sticky${editing ? " sticky--editing" : ""} ${className}`}
      style={{ "--sticky-rotate": `${rotate}deg` }}
    >
      <div
        ref={ref}
        className="sticky-text"
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={!editing ? startEdit : undefined}
        onBlur={commit}
        onKeyDown={onKeyDown}
      >
        {text}
      </div>
      {!editing && (
        <button type="button" className="sticky-edit-btn" onClick={startEdit} title="Edit note" aria-label="Edit note">
          Edit
        </button>
      )}
    </div>
  );
}
