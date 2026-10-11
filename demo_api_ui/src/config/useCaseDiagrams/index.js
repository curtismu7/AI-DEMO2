/**
 * Registry of use-case diagram configs. A new diagram = a new file here + one
 * line below. The drift test (useCaseDiagrams.drift.test.js) fails when a
 * demo-script use case has no config, so this list cannot go stale silently.
 */
import UC1 from "./UC1";
import UC7 from "./UC7";
import UC6 from "./UC6";
import UC24 from "./UC24";
import UC23 from "./UC23";
import UC8 from "./UC8";
import UC14b from "./UC14b";
import UC14 from "./UC14";
import UC12 from "./UC12";
import UC2 from "./UC2";
import UC2_5 from "./UC2.5";
import UC2_7 from "./UC2.7";
import UC3 from "./UC3";
import UC22 from "./UC22";
import UC5 from "./UC5";
import UC10 from "./UC10";
import UC13 from "./UC13";
import UC11 from "./UC11";
import UC20 from "./UC20";
import UC18 from "./UC18";
import UC17 from "./UC17";
import UC29 from "./UC29";
import UC30 from "./UC30";
import UC31 from "./UC31";
import UC32 from "./UC32";
import UC40 from "./UC40";
import UC38 from "./UC38";
import UC43 from "./UC43";
import UC_TOOL1 from "./UC-TOOL1";
import UC_TOOL3 from "./UC-TOOL3";
import UC44 from "./UC44";
import UC46 from "./UC46";
import UC46A from "./UC46A";
import UC47 from "./UC47";
import UC_MUSE1 from "./UC-MUSE1";
import UC_MUSE2 from "./UC-MUSE2";
import UC_LEARN11 from "./UC-LEARN11";
import UC16b from "./UC16b";
import UC_LOGIN from "./UC-LOGIN";
import UC37 from "./UC37";
import UC_NHI1 from "./UC-NHI1";
import UC_NHI2 from "./UC-NHI2";
import UC_LEARN15 from "./UC-LEARN15";
import UC4 from "./UC4";
import UC9 from "./UC9";
import UC15 from "./UC15";
import UC16 from "./UC16";
import UC19 from "./UC19";
import UC21 from "./UC21";
import UC25 from "./UC25";
import UC26 from "./UC26";
import UC27 from "./UC27";
import UC28 from "./UC28";
import UC2_6 from "./UC2.6";
import UC33 from "./UC33";
import UC34 from "./UC34";
import UC35 from "./UC35";
import UC39 from "./UC39";
import UC41 from "./UC41";
import UC42 from "./UC42";
import UC45 from "./UC45";
import UC48 from "./UC48";
import UC_PRIVB from "./UC-PRIVB";
import UC_PRIVC from "./UC-PRIVC";
import UC_PRIVD from "./UC-PRIVD";

export const CONFIGS = [
  UC1, UC7, UC6, UC24, UC23, UC8, UC14b, UC14, UC12, UC2, UC2_5, UC2_7, UC3, UC22,
  UC5, UC10, UC13, UC11, UC20, UC18, UC17, UC29, UC30, UC31, UC32, UC40, UC38,
  UC_TOOL1, UC_TOOL3, UC43, UC44, UC46, UC46A, UC47, UC_MUSE1, UC_MUSE2, UC_NHI1, UC_NHI2, UC_LEARN11, UC_LEARN15, UC37, UC16b,
  UC_LOGIN,
  UC4, UC9, UC15, UC16, UC19, UC21, UC25,
  UC26, UC27, UC28, UC2_6, UC33, UC34, UC35,
  UC39, UC41, UC42, UC45, UC48,
  UC_PRIVB, UC_PRIVC, UC_PRIVD,
];

export function getConfig(id) {
  const key = String(id || "").toUpperCase();
  return CONFIGS.find((c) => c.id.toUpperCase() === key) || null;
}

/** Canonical share URL for a use-case diagram. */
export const useCaseDiagramPath = (id) => `/use-case-diagrams/${id}`;
