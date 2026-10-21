import { describe, expect, it } from "vitest";
import { protectedActionLabel } from "../protectedActionLabel";

describe("protectedActionLabel", () => {
  it("names the action for the vertical's tool", () => {
    expect(protectedActionLabel({ primaryTool: "create_transfer" })).toBe("transfer");
    expect(protectedActionLabel({ primaryTool: "pay_bill" })).toBe("bill payment");
    expect(protectedActionLabel({ primaryTool: "pay_airline_fee" })).toBe("airline fee payment");
  });
  it("humanises an unmapped tool and falls back when there is none", () => {
    expect(protectedActionLabel({ primaryTool: "do_new_thing" })).toBe("do new thing");
    expect(protectedActionLabel(null)).toBe("protected action");
  });
});
