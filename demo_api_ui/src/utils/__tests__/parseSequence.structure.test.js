import { describe, expect, it } from "vitest";
import { parseSequence } from "../parseSequence";

const SRC = `sequenceDiagram
    participant A
    participant B
    rect rgb(230, 240, 255)
    Note over A,B: Phase 1
    A->>B: one
    loop every second
      alt approved
        B-->>A: yes
      else pending
        B-->>A: wait
      end
    end
    end`;

describe("parseSequence structure items", () => {
  it("emits nothing extra by default, so every other diagram parses as before", () => {
    expect(parseSequence(SRC).items.map((i) => i.type)).toEqual(["note", "message", "fragment", "fragment", "message", "fragment", "message"]);
  });
  it("with structure, marks where a rect band and each frame start and end", () => {
    const items = parseSequence(SRC, { structure: true }).items;
    expect(items.map((i) => i.type)).toEqual(["rect", "note", "message", "fragment", "fragment", "message", "fragment", "message", "fragmentEnd", "fragmentEnd", "rectEnd"]);
    expect(items[0]).toMatchObject({ type: "rect", colour: "rgb(230, 240, 255)" });
    expect(items[8]).toMatchObject({ type: "fragmentEnd", kind: "alt" });
    expect(items[9]).toMatchObject({ type: "fragmentEnd", kind: "loop" });
  });
});
