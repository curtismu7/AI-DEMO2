import { describe, expect, it } from "vitest";
import UC11 from "../UC11";
import UC12 from "../UC12";
import UC13 from "../UC13";
import UC14 from "../UC14";
import UC14b from "../UC14b";
import UC15 from "../UC15";
import UC16 from "../UC16";
import UC16b from "../UC16b";
import UC17 from "../UC17";
import UC18 from "../UC18";
import UC19 from "../UC19";
import UC2 from "../UC2";
import UC2_5 from "../UC2.5";
import UC2_6 from "../UC2.6";
import UC2_7 from "../UC2.7";
import UC20 from "../UC20";
import UC21 from "../UC21";
import { validateConfig } from "../validate";

// Ping diagram style: a dashed arrow is a token or a decision handed back, a solid one is a request.
// Labels of the arrows that must be dashed, per config.
const DASHED = [
  [UC11, ["401"]],
  [UC12, ["401 invalid_dpop_proof"]],
  [UC13, ["DENY", "refused"]],
  [UC14, ["DENY", "no tool ran"]],
  [UC14b, ["request_uri -> token", "PERMIT"]],
  [UC15, ["intent token in play", "401 — tamper detected"]],
  [UC16, ["401 — blocked"]],
  [UC16b, ["raw token, no exchange", "403 before any hop", "user token never leaves"]],
  [UC17, ["forward with live token"]],
  [UC18, ["429"]],
  [UC19, ["token minted — PERMIT", "exchange fails"]],
  [UC2, ["consent at sign-in", "narrowed token"]],
  [UC2_5, ["delegated token"]],
  [UC2_6, ["invalid_a2a_generalist"]],
  [UC2_7, ["401 no bearer"]],
  [UC20, []],
  [UC21, ["PERMIT — premium tier"]],
];

describe("Ping-style use-case diagram configs (UC11-UC21, UC2.x)", () => {
  it.each(DASHED.map(([cfg, labels]) => [cfg.id, cfg, labels]))("%s: valid, dashed arrows are exactly the token/decision hops", (_id, cfg, labels) => {
    expect(validateConfig(cfg).errors).toEqual([]);
    const dashed = cfg.EDGES.filter((e) => e[3] && e[3].dashed).map((e) => e[2]);
    expect(dashed.sort()).toEqual([...labels].sort());
  });

  it.each(DASHED.map(([cfg]) => [cfg.id, cfg]))("%s: boxes run left to right on one row, x on the shared grid", (_id, cfg) => {
    const grid = [40, 340, 640, 940, 1240];
    cfg.NODES.forEach((n, i) => {
      expect(grid).toContain(n.x);
      if (i) expect(n.x).toBeGreaterThan(cfg.NODES[i - 1].x);
    });
  });
});
