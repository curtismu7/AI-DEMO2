const { A2A_SPECIALISTS, A2A_DEMO_PROFILES, a2aDemoProfile, verticalsWithSpecialist } = require("../config/a2aSpecialists");

describe("a2aDemoProfile", () => {
  test("every vertical with a specialist has a demo profile with 3 questions", () => {
    for (const vertical of Object.keys(A2A_SPECIALISTS)) {
      const demo = A2A_DEMO_PROFILES[vertical];
      expect(demo).toBeDefined();
      expect(demo.agentName).toMatch(/ agent$/);
      expect(demo.questions).toHaveLength(3);
      for (const q of demo.questions) expect(q.length).toBeGreaterThan(10);
    }
    // No demo profile for a vertical the registry does not know.
    expect(Object.keys(A2A_DEMO_PROFILES).sort()).toEqual(Object.keys(A2A_SPECIALISTS).sort());
  });

  test("resolves the specialist, its first tool and its subtask hint from the registry", () => {
    for (const vertical of Object.keys(A2A_SPECIALISTS)) {
      const profile = a2aDemoProfile(vertical);
      const specialist = A2A_SPECIALISTS[vertical];
      expect(profile).toMatchObject({
        vertical,
        specialistName: specialist.specialistName,
        tool: specialist.tools[0],
        subtaskHint: specialist.subtaskHint,
      });
    }
  });

  test("a white-label vertical keeps its own brand name over the shared domain specialist", () => {
    const aandf = a2aDemoProfile("abercrombie-fitch");
    expect(aandf.agentName).toBe("Abercrombie & Fitch agent");
    expect(aandf.specialistName).toBe("Purchase History Specialist");
    expect(verticalsWithSpecialist()).toContain("abercrombie-fitch");
  });

  test("the vertical's own A2A manifest chip leads, then its canned questions", () => {
    expect(a2aDemoProfile("retail").questions).toEqual(["access my sensitive order history", ...A2A_DEMO_PROFILES.retail.questions]);
    // A white-label vertical uses its own chip wording, not the shared domain's.
    expect(a2aDemoProfile("abercrombie-fitch").questions[0]).toBe("show my sensitive A&F order history");
    // No manifest chip: only the canned questions.
    expect(a2aDemoProfile("investment").questions).toEqual(A2A_DEMO_PROFILES.investment.questions);
  });

  test("returns null when the vertical has no specialist", () => {
    expect(a2aDemoProfile("oauth-teaching")).toBeNull();
    expect(a2aDemoProfile("")).toBeNull();
    expect(a2aDemoProfile(undefined)).toBeNull();
  });

  test("returns copies, so a caller cannot change the registry", () => {
    const profile = a2aDemoProfile("banking");
    profile.questions.push("x");
    profile.tools.push("y");
    expect(a2aDemoProfile("banking").questions).toHaveLength(4);
    expect(a2aDemoProfile("banking").tools).toHaveLength(4);
  });
});
