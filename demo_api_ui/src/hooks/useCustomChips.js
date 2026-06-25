import { useCallback, useState } from "react";

const CHIPS_KEY = "bx_custom_chips";
const GROUPS_KEY = "bx_custom_groups";

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

/**
 * Shared hook for reading and writing user-defined custom chips and groups.
 * Backed by localStorage — synchronous, no flash on first render.
 *
 * Chip shape: { id, label, desc, prompt, type: 'llm'|'heuristic', groupId }
 * Group shape: { id, label }
 */
export function useCustomChips() {
  const [chips, setChips] = useState(() => readStorage(CHIPS_KEY));
  const [groups, setGroups] = useState(() => readStorage(GROUPS_KEY));

  const persistChips = useCallback((next) => {
    setChips(next);
    localStorage.setItem(CHIPS_KEY, JSON.stringify(next));
  }, []);

  const persistGroups = useCallback((next) => {
    setGroups(next);
    localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
  }, []);

  const addChip = useCallback(
    (chip) => persistChips([...chips, chip]),
    [chips, persistChips],
  );

  const removeChip = useCallback(
    (id) => persistChips(chips.filter((c) => c.id !== id)),
    [chips, persistChips],
  );

  const addGroup = useCallback(
    (group) => persistGroups([...groups, group]),
    [groups, persistGroups],
  );

  const removeGroup = useCallback(
    (id) => {
      persistGroups(groups.filter((g) => g.id !== id));
      persistChips(chips.filter((c) => c.groupId !== id));
    },
    [groups, chips, persistGroups, persistChips],
  );

  return { chips, groups, addChip, removeChip, addGroup, removeGroup };
}
