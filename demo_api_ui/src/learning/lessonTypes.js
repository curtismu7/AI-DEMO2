import { PROVENANCE } from "./provenance";

const REQUIRED_PROVENANCE = Object.values(PROVENANCE);

export function validateLesson(lesson) {
  const errors = [];

  if (!lesson || typeof lesson !== "object") {
    return ["lesson must be an object"];
  }

  if (lesson.fallback?.provenance === PROVENANCE.LIVE_CLOUD) {
    errors.push("fallback provenance cannot be LIVE_CLOUD");
  }

  if (lesson.run?.exposesRawBearerToken === true) {
    errors.push("run must not expose a raw bearer token");
  }

  if (lesson.provenance?.primary !== PROVENANCE.LIVE_CLOUD) {
    errors.push("primary provenance must be LIVE_CLOUD");
  }

  if (!Array.isArray(lesson.provenance?.fallback)) {
    errors.push("provenance fallback policy must be an array");
  } else if (
    lesson.provenance.fallback.some((value) => !REQUIRED_PROVENANCE.includes(value))
  ) {
    errors.push("provenance fallback policy contains an unknown value");
  }

  return errors;
}

export function isLessonContractValid(lesson) {
  return validateLesson(lesson).length === 0;
}
