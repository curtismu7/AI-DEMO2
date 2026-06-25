import React, { useState } from "react";
import { useCustomChips } from "../hooks/useCustomChips";
import { useVertical } from '../vertical/useVertical';

const DEFAULT_GROUP_ID = "custom";
const DEFAULT_GROUP_LABEL = "Custom Actions";

function slugify(label) {
  return (
    "custom_" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40)
  );
}

const s = {
  section: { marginBottom: "2rem" },
  heading: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "var(--brand-navy)",
    marginBottom: "0.75rem",
  },
  row: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "flex-end",
    flexWrap: "wrap",
    marginBottom: "0.5rem",
  },
  input: {
    padding: "0.4rem 0.6rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: "0.875rem",
    flex: 1,
    minWidth: 120,
  },
  textarea: {
    padding: "0.4rem 0.6rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: "0.875rem",
    flex: 1,
    minWidth: 180,
    resize: "vertical",
    minHeight: 56,
  },
  select: {
    padding: "0.4rem 0.6rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: "0.875rem",
  },
  btn: {
    padding: "0.4rem 0.9rem",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  addBtn: { background: "var(--brand-navy)", color: "#fff" },
  removeBtn: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: "0.25rem 0.6rem",
    fontSize: "0.8rem",
  },
  pill: {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: 12,
    fontSize: "0.75rem",
    fontWeight: 600,
    marginRight: "0.4rem",
  },
  llmPill: { background: "#e0f2fe", color: "#0369a1" },
  heuristicPill: { background: "#f0fdf4", color: "#166534" },
  chipRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    background: "#f9fafb",
    borderRadius: 8,
    marginBottom: "0.4rem",
    flexWrap: "wrap",
  },
  chipLabel: {
    fontWeight: 600,
    fontSize: "0.875rem",
    color: "#111827",
    flex: "0 0 auto",
  },
  chipDesc: { fontSize: "0.8rem", color: "#6b7280", flex: 1, minWidth: 80 },
  chipPrompt: {
    fontSize: "0.78rem",
    color: "#374151",
    fontStyle: "italic",
    flex: 2,
    minWidth: 120,
  },
  typeToggle: { display: "flex", gap: "0.35rem" },
  typeBtn: (active, type) => ({
    padding: "0.3rem 0.7rem",
    borderRadius: 6,
    border: "1px solid",
    cursor: "pointer",
    fontSize: "0.78rem",
    fontWeight: active ? 700 : 400,
    background: active ? (type === "llm" ? "#0369a1" : "#166534") : "#f3f4f6",
    color: active ? "#fff" : "#374151",
    borderColor: active ? (type === "llm" ? "#0369a1" : "#166534") : "#d1d5db",
  }),
  groupRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.4rem 0.75rem",
    background: "#f3f4f6",
    borderRadius: 8,
    marginBottom: "0.4rem",
  },
  groupLabel: { fontWeight: 600, fontSize: "0.875rem", flex: 1 },
  error: { color: "#dc2626", fontSize: "0.8rem", marginTop: "0.25rem" },
  emptyNote: { color: "#6b7280", fontSize: "0.85rem", fontStyle: "italic" },
};

export default function CustomChipsTab() {
  const { chips, groups, addChip, removeChip, addGroup, removeGroup } =
    useCustomChips();
  const { pageManifest } = useVertical();
  const activeId = pageManifest?.id;

  const [newGroup, setNewGroup] = useState("");
  const [groupError, setGroupError] = useState("");

  // Best-effort server sync of chips to the overlay (non-blocking).
  // localStorage remains the authoritative source for UI state.
  function syncChipsToServer(chipsToSync) {
    if (!activeId) return;
    const formatted = chipsToSync.map((c) => ({
      id: c.id,
      label: c.label,
      message: c.prompt,
      mode: c.type === 'llm' ? 'llm' : 'both',
    }));
    fetch(`/api/verticals/${activeId}/user-chips`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ chips: formatted }),
    }).catch(() => {
      // Silently fail — server sync is best-effort; localStorage is authoritative
    });
  }

  const [form, setForm] = useState({
    label: "",
    desc: "",
    prompt: "",
    type: "llm",
    groupId: DEFAULT_GROUP_ID,
  });
  const [chipError, setChipError] = useState("");

  const allGroups = [
    { id: DEFAULT_GROUP_ID, label: DEFAULT_GROUP_LABEL },
    ...groups,
  ];

  function handleAddGroup() {
    const trimmed = newGroup.trim();
    if (!trimmed) {
      setGroupError("Group name is required.");
      return;
    }
    const id = slugify(trimmed);
    if (allGroups.some((g) => g.id === id)) {
      setGroupError("A group with that name already exists.");
      return;
    }
    addGroup({ id, label: trimmed });
    setNewGroup("");
    setGroupError("");
  }

  function handleRemoveGroup(id) {
    if (id === DEFAULT_GROUP_ID) return;
    removeGroup(id);
    if (form.groupId === id)
      setForm((f) => ({ ...f, groupId: DEFAULT_GROUP_ID }));
  }

  function handleAddChip() {
    const label = form.label.trim();
    const prompt = form.prompt.trim();
    if (!label) {
      setChipError("Label is required.");
      return;
    }
    if (!prompt) {
      setChipError("Prompt is required.");
      return;
    }
    const id = slugify(label) + "_" + Date.now().toString(36);
    const newChip = {
      id,
      label,
      desc: form.desc.trim(),
      prompt,
      type: form.type,
      groupId: form.groupId,
    };
    addChip(newChip);
    syncChipsToServer([...chips, newChip]);
    setForm({
      label: "",
      desc: "",
      prompt: "",
      type: "llm",
      groupId: form.groupId,
    });
    setChipError("");
  }

  const chipsByGroup = allGroups.map((g) => ({
    group: g,
    chips: chips.filter((c) => (c.groupId || DEFAULT_GROUP_ID) === g.id),
  }));

  return (
    <div style={{ padding: "1rem 0" }}>
      <p
        style={{ color: "#374151", marginBottom: "1.5rem", fontSize: "0.9rem" }}
      >
        Add custom action chips that appear in the agent sidebar and in Quick
        Actions. Choose <strong>LLM</strong> for free-form reasoning or{" "}
        <strong>Heuristic</strong> for a direct prompt that routes through NL
        intent classification.
      </p>

      {/* Groups */}
      <div style={s.section}>
        <div style={s.heading}>Custom Groups</div>
        {groups.length === 0 && (
          <div style={s.emptyNote}>
            No custom groups — chips go into "{DEFAULT_GROUP_LABEL}" by default.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} style={s.groupRow}>
            <span style={s.groupLabel}>{g.label}</span>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              id: {g.id}
            </span>
            <button
              type="button"
              style={{ ...s.btn, ...s.removeBtn }}
              onClick={() => handleRemoveGroup(g.id)}
            >
              Remove
            </button>
          </div>
        ))}
        <div style={s.row}>
          <input
            style={s.input}
            placeholder="New group name"
            value={newGroup}
            onChange={(e) => {
              setNewGroup(e.target.value);
              setGroupError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddGroup();
            }}
          />
          <button
            type="button"
            style={{ ...s.btn, ...s.addBtn }}
            onClick={handleAddGroup}
          >
            Add Group
          </button>
        </div>
        {groupError && <div style={s.error}>{groupError}</div>}
      </div>

      {/* Existing chips */}
      <div style={s.section}>
        <div style={s.heading}>Custom Chips</div>
        {chips.length === 0 && (
          <div style={s.emptyNote}>No custom chips yet.</div>
        )}
        {chipsByGroup.map(({ group, chips: groupChips }) =>
          groupChips.length === 0 ? null : (
            <div key={group.id} style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "#6b7280",
                  marginBottom: "0.3rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {group.label}
              </div>
              {groupChips.map((chip) => (
                <div key={chip.id} style={s.chipRow}>
                  <span
                    style={{
                      ...s.pill,
                      ...(chip.type === "llm" ? s.llmPill : s.heuristicPill),
                    }}
                  >
                    {chip.type === "llm" ? "LLM" : "Heuristic"}
                  </span>
                  <span style={s.chipLabel}>{chip.label}</span>
                  {chip.desc && <span style={s.chipDesc}>{chip.desc}</span>}
                  <span style={s.chipPrompt}>"{chip.prompt}"</span>
                  <button
                    type="button"
                    style={{ ...s.btn, ...s.removeBtn }}
                    onClick={() => {
                      removeChip(chip.id);
                      syncChipsToServer(chips.filter((c) => c.id !== chip.id));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ),
        )}
      </div>

      {/* Add chip form */}
      <div style={s.section}>
        <div style={s.heading}>Add a Chip</div>
        <div style={s.row}>
          <input
            style={s.input}
            placeholder="Label (e.g. Fraud Check)"
            value={form.label}
            onChange={(e) => {
              setForm((f) => ({ ...f, label: e.target.value }));
              setChipError("");
            }}
          />
          <input
            style={s.input}
            placeholder="Description (optional)"
            value={form.desc}
            onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
          />
        </div>
        <div style={s.row}>
          <textarea
            style={s.textarea}
            placeholder="Prompt — what the agent will be asked (e.g. 'Analyze recent transactions for suspicious patterns')"
            value={form.prompt}
            onChange={(e) => {
              setForm((f) => ({ ...f, prompt: e.target.value }));
              setChipError("");
            }}
          />
        </div>
        <div style={s.row}>
          <div style={s.typeToggle}>
            <button
              type="button"
              style={s.typeBtn(form.type === "llm", "llm")}
              onClick={() => setForm((f) => ({ ...f, type: "llm" }))}
            >
              LLM
            </button>
            <button
              type="button"
              style={s.typeBtn(form.type === "heuristic", "heuristic")}
              onClick={() => setForm((f) => ({ ...f, type: "heuristic" }))}
            >
              Heuristic
            </button>
          </div>
          <select
            style={s.select}
            value={form.groupId}
            onChange={(e) =>
              setForm((f) => ({ ...f, groupId: e.target.value }))
            }
          >
            {allGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={{ ...s.btn, ...s.addBtn }}
            onClick={handleAddChip}
          >
            Add Chip
          </button>
        </div>
        {chipError && <div style={s.error}>{chipError}</div>}
        <div
          style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.5rem" }}
        >
          <strong>LLM</strong> chips appear in "Advanced Analysis" (discovery
          popout) and route through the full token exchange pipeline in the
          agent sidebar. <strong>Heuristic</strong> chips appear in "Quick
          Actions" and route through NL intent classification.
        </div>
      </div>
    </div>
  );
}
