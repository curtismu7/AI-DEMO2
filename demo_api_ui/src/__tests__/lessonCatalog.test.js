import {
  getLesson,
  lessonCatalog,
} from "../learning/lessonCatalog";
import {
  isLessonContractValid,
  validateLesson,
} from "../learning/lessonTypes";
import { PROVENANCE } from "../learning/provenance";

const REQUIRED_IDS = [
  "agent-landscape",
  "login",
  "delegation",
  "multi-party-delegation",
  "consumer-agent",
  "customer-service-agent",
  "mcp",
  "authorize",
  "hitl-step-up",
  "a2a-delegation",
  "privilege-mcp",
  "privilege-a2a",
  "threat-defense",
  "lifecycle",
  "evidence-timeline",
];

const NON_EMPTY_STRING = expect.stringMatching(/\S/);

describe("AI Security Academy lesson catalog", () => {
  test("exports an ordered catalog with complete launch and teaching contracts", () => {
    const ids = lessonCatalog.map((lesson) => lesson.id);

    expect(ids).toEqual(REQUIRED_IDS);
    expect(new Set(ids).size).toBe(ids.length);

    for (const lesson of lessonCatalog) {
      expect(lesson.id).toEqual(NON_EMPTY_STRING);
      expect(lesson.title).toEqual(NON_EMPTY_STRING);
      expect(lesson.audience).toEqual(NON_EMPTY_STRING);
      expect(lesson.category).toEqual(NON_EMPTY_STRING);
      expect(lesson.route).toEqual(expect.stringMatching(/^\/\S/));
      expect(lesson.standaloneRoute).toEqual(expect.stringMatching(/^\/\S/));
      expect(lesson.run).toEqual({
        action: NON_EMPTY_STRING,
        exposesRawBearerToken: false,
        result: {
          kind: "redacted",
          valuesRedacted: true,
          fields: expect.arrayContaining([NON_EMPTY_STRING]),
        },
      });
      expect(lesson.evidence).toEqual({
        events: expect.arrayContaining([NON_EMPTY_STRING]),
        result: {
          kind: "redacted",
          valuesRedacted: true,
          fields: expect.arrayContaining([NON_EMPTY_STRING]),
        },
      });
      expect(lesson.fallback).toEqual({
        provenance: expect.any(String),
        label: NON_EMPTY_STRING,
      });
      expect(lesson.provenance).toEqual({
        primary: PROVENANCE.LIVE_CLOUD,
        fallback: expect.arrayContaining([
          PROVENANCE.LIVE_LOCAL,
          PROVENANCE.RECORDED,
          PROVENANCE.SIMULATED,
        ]),
      });
      expect(lesson.talkingPoints).toEqual(
        expect.arrayContaining([NON_EMPTY_STRING]),
      );
      expect(lesson.walkthrough).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: NON_EMPTY_STRING,
            explain: NON_EMPTY_STRING,
            demonstrate: NON_EMPTY_STRING,
          }),
        ]),
      );
      expect(lesson.walkthrough.length).toBeGreaterThanOrEqual(3);
      expect(isLessonContractValid(lesson)).toBe(true);
    }
  });

  test("returns a catalog entry by ID and null for an unknown lesson", () => {
    expect(getLesson(lessonCatalog[0].id)).toBe(lessonCatalog[0]);
    expect(getLesson("does-not-exist")).toBeNull();
  });

  test("describes multi-party delegation as a domain-neutral consumer lesson", () => {
    const lesson = getLesson("multi-party-delegation");

    expect(lesson.title).toBe("Multi-party consumer delegation");
    expect(lesson.talkingPoints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/consumer/i),
        expect.stringMatching(/delegate/i),
        expect.stringMatching(/agent/i),
      ]),
    );
    expect(lesson.walkthrough).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringMatching(/delegate/i),
          demonstrate: expect.stringMatching(/healthcare|caregiver/i),
        }),
      ]),
    );
  });

  test("maps each lesson to the company maturity journey and agent taxonomy", () => {
    expect(lessonCatalog.every((lesson) => lesson.maturityStages.length > 0)).toBe(true);
    expect(lessonCatalog.every((lesson) => lesson.agentCategory.length > 0)).toBe(true);
    expect(lessonCatalog.every((lesson) => lesson.productRoles.length > 0)).toBe(true);
    expect(getLesson("ai-architecture").id).toBe("agent-landscape");
    expect(getLesson("product-map").id).toBe("evidence-timeline");
  });

  test("marks only the first live demos as executable", () => {
    expect(getLesson("mcp").execution).toEqual({
      kind: "mcp-read",
      label: "Run banking read tool",
    });
    expect(getLesson("authorize").execution).toEqual({
      kind: "policy-evaluation",
      label: "Evaluate policy",
    });
    expect(lessonCatalog.filter((lesson) => lesson.execution)).toHaveLength(2);
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
      "run.exposesRawBearerToken must be explicit boolean false",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });

  test.each([
    ["missing safety metadata", { exposesRawBearerToken: undefined }],
    ["non-boolean safety metadata", { exposesRawBearerToken: "false" }],
  ])("rejects %s", (_name, safety) => {
    const invalidLesson = {
      ...lessonCatalog[0],
      run: { ...lessonCatalog[0].run, ...safety },
    };

    expect(validateLesson(invalidLesson)).toContain(
      "run.exposesRawBearerToken must be explicit boolean false",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });

  test.each([
    ["missing id", { id: "" }],
    ["missing run", { run: undefined }],
    ["missing evidence", { evidence: undefined }],
    ["malformed fallback", { fallback: { provenance: PROVENANCE.RECORDED } }],
    ["empty talking point", { talkingPoints: ["   "] }],
  ])("rejects %s", (_name, change) => {
    const invalidLesson = { ...lessonCatalog[0], ...change };

    expect(isLessonContractValid(invalidLesson)).toBe(false);
    expect(validateLesson(invalidLesson).length).toBeGreaterThan(0);
  });

  test.each([
    "access_token",
    "refresh_token",
    "Authorization: Bearer secret",
    "client_secret",
    "raw_session_credential",
  ])("rejects token-shaped evidence declarations: %s", (field) => {
    const invalidLesson = {
      ...lessonCatalog[0],
      evidence: {
        ...lessonCatalog[0].evidence,
        result: {
          ...lessonCatalog[0].evidence.result,
          fields: [field],
        },
      },
    };

    expect(validateLesson(invalidLesson)).toContain(
      "run and evidence results must use redacted, non-credential fields",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });

  test("rejects an authorization header added to the run descriptor", () => {
    const invalidLesson = {
      ...lessonCatalog[0],
      run: {
        ...lessonCatalog[0].run,
        headers: { Authorization: "Bearer raw-secret" },
      },
    };

    expect(isLessonContractValid(invalidLesson)).toBe(false);
    expect(validateLesson(invalidLesson)).toContain(
      "run contains unknown property: headers",
    );
  });

  test("rejects a raw access token added to the evidence descriptor", () => {
    const invalidLesson = {
      ...lessonCatalog[0],
      evidence: {
        ...lessonCatalog[0].evidence,
        rawAccessToken: "secret",
      },
    };

    expect(isLessonContractValid(invalidLesson)).toBe(false);
    expect(validateLesson(invalidLesson)).toContain(
      "evidence contains unknown property: rawAccessToken",
    );
  });

  test("requires the selected fallback to be allowed by its provenance policy", () => {
    const invalidLesson = {
      ...lessonCatalog[0],
      provenance: {
        ...lessonCatalog[0].provenance,
        fallback: [PROVENANCE.SIMULATED],
      },
    };

    expect(validateLesson(invalidLesson)).toContain(
      "selected fallback provenance must be allowed by the fallback policy",
    );
    expect(isLessonContractValid(invalidLesson)).toBe(false);
  });

  test("uses the live workbench as the direct HITL standalone launch target", () => {
    expect(getLesson("hitl-step-up").standaloneRoute).toBe("/use-cases/live");
  });
});
