import {
  getLesson,
  lessonCatalog,
} from "../learning/lessonCatalog";
import {
  isLessonContractValid,
  validateLesson,
} from "../learning/lessonTypes";
import { PROVENANCE } from "../learning/provenance";

describe("AI Security Academy lesson catalog", () => {
  test("exports an ordered catalog with complete launch and teaching contracts", () => {
    const ids = lessonCatalog.map((lesson) => lesson.id);

    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ids).size).toBe(ids.length);

    for (const lesson of lessonCatalog) {
      expect(lesson.title).toEqual(expect.any(String));
      expect(lesson.audience).toEqual(expect.any(String));
      expect(lesson.category).toEqual(expect.any(String));
      expect(lesson.route).toMatch(/^\//);
      expect(lesson.standaloneRoute).toMatch(/^\//);
      expect(lesson.provenance).toEqual({
        primary: PROVENANCE.LIVE_CLOUD,
        fallback: expect.arrayContaining([
          PROVENANCE.LIVE_LOCAL,
          PROVENANCE.RECORDED,
          PROVENANCE.SIMULATED,
        ]),
      });
      expect(lesson.talkingPoints.length).toBeGreaterThan(0);
      expect(isLessonContractValid(lesson)).toBe(true);
    }
  });

  test("returns a catalog entry by ID and null for an unknown lesson", () => {
    expect(getLesson(lessonCatalog[0].id)).toBe(lessonCatalog[0]);
    expect(getLesson("does-not-exist")).toBeNull();
  });

  test("rejects a fallback that is mislabeled as live cloud", () => {
    const invalidLesson = {
      ...lessonCatalog[0],
      fallback: { ...lessonCatalog[0].fallback, provenance: PROVENANCE.LIVE_CLOUD },
    };

    expect(validateLesson(invalidLesson)).toContain(
      "fallback provenance cannot be LIVE_CLOUD",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });

  test("rejects a run descriptor that could expose a raw bearer token", () => {
    const invalidLesson = {
      ...lessonCatalog[0],
      run: { ...lessonCatalog[0].run, exposesRawBearerToken: true },
    };

    expect(validateLesson(invalidLesson)).toContain(
      "run must not expose a raw bearer token",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });
});
