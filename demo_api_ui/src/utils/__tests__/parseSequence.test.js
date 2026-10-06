import { describe, expect, it } from "vitest";
import { parseSequence } from "../parseSequence";

describe("parseSequence", () => {
  it("reads participants, boxes, messages, notes and fragments in order", () => {
    const m = parseSequence(`sequenceDiagram
    autonumber
    box rgb(240,240,255) Normal Flow (MCP RS)
    participant A as Agent
    participant R as Invest Service<br/>:8081
    end
    A->>R: call<br/>(Bearer)
    R-->>A: result
    R->>R: verify
    Note over A,R: same service
    alt permitted
      A->>R: again
    else denied
      R-->>A: 403
    end`);
    expect(m.autonumber).toBe(true);
    expect(m.participants).toEqual([
      { id: "A", label: "Agent", box: "Normal Flow (MCP RS)" },
      { id: "R", label: "Invest Service\n:8081", box: "Normal Flow (MCP RS)" },
    ]);
    expect(m.boxes).toEqual([{ label: "Normal Flow (MCP RS)", ids: ["A", "R"] }]);
    const kinds = m.items.map((i) => i.type + (i.dashed ? "-" : ""));
    expect(kinds).toEqual(["message", "message-", "message", "note", "fragment", "message", "fragment", "message-"]);
    expect(m.items[0]).toMatchObject({ from: "A", to: "R", text: "call\n(Bearer)" });
    expect(m.items[3]).toMatchObject({ over: ["A", "R"], text: "same service" });
  });
});
