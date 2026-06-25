import { splitGridClass } from "../dashboardLayout";

describe("splitGridClass", () => {
  test("returns base split3 class when banking column is shown", () => {
    expect(splitGridClass(true)).toBe("ud-body--dashboard-split3");
  });

  test("appends the no-banking modifier when banking column is hidden", () => {
    expect(splitGridClass(false)).toBe(
      "ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking",
    );
  });

  test("treats falsy non-boolean input as hidden", () => {
    expect(splitGridClass(undefined)).toBe(
      "ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking",
    );
  });
});
