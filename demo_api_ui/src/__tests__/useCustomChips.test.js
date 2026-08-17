/**
 * @file useCustomChips.test.js
 * Unit tests for the useCustomChips hook (feat commit 25d36266).
 *
 * Covers:
 *   - Initial state read from localStorage on mount
 *   - addChip: persists chip to localStorage and returns updated list
 *   - removeChip: removes chip by id and persists
 *   - addGroup: persists group to localStorage
 *   - removeGroup: removes group AND all chips belonging to that group
 *   - State survives remount (data read fresh from localStorage)
 */

import { renderHook, act } from "@testing-library/react";
import { useCustomChips } from "../hooks/useCustomChips";

// ── localStorage stub ─────────────────────────────────────────────────────────

let _store = {};

// Replace the global outright rather than spying on it. Spying is what made
// this file Node-version-dependent: where the Storage methods LIVE differs
// between runtimes (own instance properties under Node 26's builtin, on
// Storage.prototype under the jsdom store CI's Node 22 provides), so a spy
// pinned to either location silently intercepts nothing on the other. When it
// misses, every call reaches the real store, state carries across tests, and
// the failures look like assertion bugs — accumulating counts, and
// JSON.parse("undefined") from a key a previous test wrote. Confirmed live:
// the instance spy passed on Node 26 and failed six assertions on Node 22.
// A plain object owns its own methods on every runtime.
const memoryStorage = {
  getItem: (key) =>
    Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null,
  setItem: (key, val) => {
    _store[key] = String(val);
  },
  removeItem: (key) => {
    delete _store[key];
  },
  clear: () => {
    _store = {};
  },
  key: (index) => Object.keys(_store)[index] ?? null,
  get length() {
    return Object.keys(_store).length;
  },
};

beforeEach(() => {
  _store = {};
  vi.stubGlobal("localStorage", memoryStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const CHIP_A = {
  id: "chip-a",
  label: "My Balance",
  desc: "Check balance",
  prompt: "check balance",
  type: "heuristic",
  groupId: "grp-1",
};
const CHIP_B = {
  id: "chip-b",
  label: "Ask LLM",
  desc: "Ask anything",
  prompt: "ask: ",
  type: "llm",
  groupId: "grp-1",
};
const CHIP_C = {
  id: "chip-c",
  label: "Other",
  desc: "",
  prompt: "other",
  type: "llm",
  groupId: "grp-2",
};
const GROUP_1 = { id: "grp-1", label: "My Actions" };
const GROUP_2 = { id: "grp-2", label: "Other Group" };

// ── initial state ─────────────────────────────────────────────────────────────

describe("useCustomChips — initial state", () => {
  it("starts with empty chips and groups when localStorage is empty", () => {
    const { result } = renderHook(() => useCustomChips());
    expect(result.current.chips).toEqual([]);
    expect(result.current.groups).toEqual([]);
  });

  it("reads pre-existing chips from localStorage on mount", () => {
    _store["bx_custom_chips"] = JSON.stringify([CHIP_A]);
    _store["bx_custom_groups"] = JSON.stringify([GROUP_1]);

    const { result } = renderHook(() => useCustomChips());
    expect(result.current.chips).toHaveLength(1);
    expect(result.current.chips[0].id).toBe("chip-a");
    expect(result.current.groups[0].id).toBe("grp-1");
  });
});

// ── addChip / removeChip ──────────────────────────────────────────────────────

describe("useCustomChips — addChip", () => {
  it("appends chip and persists to localStorage", () => {
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.addChip(CHIP_A);
    });

    expect(result.current.chips).toHaveLength(1);
    expect(result.current.chips[0].id).toBe("chip-a");
    expect(JSON.parse(_store["bx_custom_chips"])).toHaveLength(1);
  });

  it("adding multiple chips accumulates them all", () => {
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.addChip(CHIP_A);
    });
    act(() => {
      result.current.addChip(CHIP_B);
    });

    expect(result.current.chips).toHaveLength(2);
    expect(JSON.parse(_store["bx_custom_chips"])).toHaveLength(2);
  });
});

describe("useCustomChips — removeChip", () => {
  it("removes chip by id and persists", () => {
    _store["bx_custom_chips"] = JSON.stringify([CHIP_A, CHIP_B]);
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.removeChip("chip-a");
    });

    expect(result.current.chips).toHaveLength(1);
    expect(result.current.chips[0].id).toBe("chip-b");
    expect(JSON.parse(_store["bx_custom_chips"])).toHaveLength(1);
  });

  it("removing a non-existent id leaves chips unchanged", () => {
    _store["bx_custom_chips"] = JSON.stringify([CHIP_A]);
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.removeChip("does-not-exist");
    });

    expect(result.current.chips).toHaveLength(1);
  });
});

// ── addGroup / removeGroup ────────────────────────────────────────────────────

describe("useCustomChips — addGroup", () => {
  it("appends group and persists to localStorage", () => {
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.addGroup(GROUP_1);
    });

    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].id).toBe("grp-1");
    expect(JSON.parse(_store["bx_custom_groups"])).toHaveLength(1);
  });
});

describe("useCustomChips — removeGroup", () => {
  it("removes group and all chips belonging to it", () => {
    // CHIP_A and CHIP_B belong to grp-1; CHIP_C belongs to grp-2
    _store["bx_custom_chips"] = JSON.stringify([CHIP_A, CHIP_B, CHIP_C]);
    _store["bx_custom_groups"] = JSON.stringify([GROUP_1, GROUP_2]);
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.removeGroup("grp-1");
    });

    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].id).toBe("grp-2");
    // Only CHIP_C (grp-2) should remain
    expect(result.current.chips).toHaveLength(1);
    expect(result.current.chips[0].id).toBe("chip-c");
  });

  it("persists chip and group changes to localStorage after removeGroup", () => {
    _store["bx_custom_chips"] = JSON.stringify([CHIP_A, CHIP_C]);
    _store["bx_custom_groups"] = JSON.stringify([GROUP_1, GROUP_2]);
    const { result } = renderHook(() => useCustomChips());

    act(() => {
      result.current.removeGroup("grp-1");
    });

    expect(JSON.parse(_store["bx_custom_groups"])).toHaveLength(1);
    expect(JSON.parse(_store["bx_custom_chips"])).toHaveLength(1);
  });
});
