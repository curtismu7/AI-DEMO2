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

beforeEach(() => {
  _store = {};
  jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation((key) => _store[key] ?? null);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, val) => {
    _store[key] = val;
  });
  jest.spyOn(Storage.prototype, "removeItem").mockImplementation((key) => {
    delete _store[key];
  });
});

afterEach(() => {
  jest.restoreAllMocks();
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
