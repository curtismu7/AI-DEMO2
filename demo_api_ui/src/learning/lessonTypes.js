import { PROVENANCE } from "./provenance";

const REQUIRED_PROVENANCE = Object.values(PROVENANCE);
const REQUIRED_FIELDS = [
  "id",
  "title",
  "audience",
  "category",
  "route",
  "standaloneRoute",
  "run",
  "evidence",
  "fallback",
  "talkingPoints",
  "provenance",
];
const CREDENTIAL_DECLARATION =
  /(access[\s_-]*token|refresh[\s_-]*token|bearer|client[\s_-]*secret|raw[\s_-]*session[\s_-]*credential|session[\s_-]*credential)/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function containsCredentialDeclaration(value, key = "") {
  if (CREDENTIAL_DECLARATION.test(key)) return true;
  if (typeof value === "string") return CREDENTIAL_DECLARATION.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsCredentialDeclaration(entry));
  if (isObject(value)) {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsCredentialDeclaration(entryValue, entryKey),
    );
  }
  return false;
}

function validateRedactedResult(result, label) {
  const errors = [];

  if (!isObject(result)) {
    return [`${label} must be a redacted result object`];
  }
  if (result.kind !== "redacted") {
    errors.push(`${label}.kind must be redacted`);
  }
  if (result.valuesRedacted !== true) {
    errors.push(`${label}.valuesRedacted must be true`);
  }
  if (
    !Array.isArray(result.fields) ||
    result.fields.length === 0 ||
    result.fields.some((field) => !isNonEmptyString(field))
  ) {
    errors.push(`${label}.fields must be a non-empty string array`);
  }
  if (containsCredentialDeclaration(result)) {
    errors.push("run and evidence results must use redacted, non-credential fields");
  }

  return errors;
}

export function validateLesson(lesson) {
  const errors = [];

  if (!isObject(lesson)) return ["lesson must be an object"];

  for (const field of REQUIRED_FIELDS) {
    if (!(field in lesson)) errors.push(`lesson.${field} is required`);
  }

  for (const field of [
    "id",
    "title",
    "audience",
    "category",
    "route",
    "standaloneRoute",
  ]) {
    if (!isNonEmptyString(lesson[field])) {
      errors.push(`lesson.${field} must be a non-empty string`);
    }
  }

  if (isNonEmptyString(lesson.route) && !lesson.route.startsWith("/")) {
    errors.push("lesson.route must be an absolute app route");
  }
  if (isNonEmptyString(lesson.standaloneRoute) && !lesson.standaloneRoute.startsWith("/")) {
    errors.push("lesson.standaloneRoute must be an absolute app route");
  }

  if (!isObject(lesson.run)) {
    errors.push("lesson.run must be an object");
  } else {
    if (!isNonEmptyString(lesson.run.action)) {
      errors.push("run.action must be a non-empty string");
    }
    if (lesson.run.exposesRawBearerToken !== false) {
      errors.push("run.exposesRawBearerToken must be explicit boolean false");
    }
    errors.push(...validateRedactedResult(lesson.run.result, "run.result"));
  }

  if (!isObject(lesson.evidence)) {
    errors.push("lesson.evidence must be an object");
  } else {
    if (
      !Array.isArray(lesson.evidence.events) ||
      lesson.evidence.events.length === 0 ||
      lesson.evidence.events.some((event) => !isNonEmptyString(event))
    ) {
      errors.push("evidence.events must be a non-empty string array");
    }
    errors.push(...validateRedactedResult(lesson.evidence.result, "evidence.result"));
  }

  if (!isObject(lesson.fallback)) {
    errors.push("lesson.fallback must be an object");
  } else {
    if (!REQUIRED_PROVENANCE.includes(lesson.fallback.provenance)) {
      errors.push("fallback provenance must be a known value");
    }
    if (lesson.fallback.provenance === PROVENANCE.LIVE_CLOUD) {
      errors.push("fallback provenance cannot be LIVE_CLOUD");
    }
    if (!isNonEmptyString(lesson.fallback.label)) {
      errors.push("fallback.label must be a non-empty string");
    }
  }

  if (!Array.isArray(lesson.talkingPoints) || lesson.talkingPoints.length === 0) {
    errors.push("talkingPoints must be a non-empty string array");
  } else if (lesson.talkingPoints.some((point) => !isNonEmptyString(point))) {
    errors.push("talkingPoints must contain only non-empty strings");
  }

  if (!isObject(lesson.provenance)) {
    errors.push("lesson.provenance must be an object");
  } else {
    if (lesson.provenance.primary !== PROVENANCE.LIVE_CLOUD) {
      errors.push("primary provenance must be LIVE_CLOUD");
    }
    if (
      !Array.isArray(lesson.provenance.fallback) ||
      lesson.provenance.fallback.length === 0 ||
      lesson.provenance.fallback.some((value) => !REQUIRED_PROVENANCE.includes(value))
    ) {
      errors.push("provenance fallback policy must be a non-empty known-value array");
    } else {
      if (lesson.provenance.fallback.includes(PROVENANCE.LIVE_CLOUD)) {
        errors.push("provenance fallback policy cannot include LIVE_CLOUD");
      }
      if (
        isObject(lesson.fallback) &&
        !lesson.provenance.fallback.includes(lesson.fallback.provenance)
      ) {
        errors.push("selected fallback provenance must be allowed by the fallback policy");
      }
    }
  }

  return errors;
}

export function isLessonContractValid(lesson) {
  return validateLesson(lesson).length === 0;
}
