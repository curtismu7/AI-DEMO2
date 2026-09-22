import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const previewPath = path.resolve(
  process.cwd(),
  "public/academy-identity-preview.html",
);

const lessonIds = [
  "landscape",
  "login",
  "delegation",
  "personal-agent",
  "digital-assistant",
  "mcp",
  "authorize",
  "human-approval",
  "a2a",
  "privilege-mcp",
  "threat-defense",
  "lifecycle",
  "evidence-map",
];

function loadPreview({ storedDarkMode, embedded = false } = {}) {
  expect(
    fs.existsSync(previewPath),
    "the ID4AI Academy mock should ship as public/academy-identity-preview.html",
  ).toBe(true);

  return new JSDOM(fs.readFileSync(previewPath, "utf8"), {
    runScripts: "dangerously",
    url: `https://local.ping-devops.com:4000/academy-identity-preview.html${embedded ? "?embedded=1" : ""}`,
    beforeParse(window) {
      if (storedDarkMode !== undefined) {
        window.localStorage.setItem("ba_dark_mode", String(storedDarkMode));
      }
    },
  });
}

describe("ID4AI Academy HTML preview", () => {
  it("organizes all thirteen lessons around the five maturity stages", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    expect(
      [...document.querySelectorAll("[data-maturity-stage]")].map(
        (node) => node.dataset.maturityStage,
      ),
    ).toEqual(["discover", "register", "authenticate", "authorize", "govern"]);
    expect(
      [...document.querySelectorAll("[data-lesson-target]")].map(
        (node) => node.dataset.lessonTarget,
      ),
    ).toEqual(lessonIds);
  });

  it("uses the approved Personal Agent and Digital Assistant taxonomy", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    const personal = document.querySelector(
      '[data-lesson-target="personal-agent"]',
    );
    const digital = document.querySelector(
      '[data-lesson-target="digital-assistant"]',
    );

    expect(personal.textContent).toContain("Personal Agent");
    expect(personal.textContent).toContain("Consumer & Partner Agent");
    expect(digital.textContent).toContain("Digital Assistant");
    expect(digital.textContent).toContain("Enterprise / Workload Agent");
  });

  it("switches lessons and updates the active maturity path", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const personal = document.querySelector(
      '[data-lesson-target="personal-agent"]',
    );

    personal.click();

    expect(document.body.dataset.lesson).toBe("personal-agent");
    expect(personal.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-lesson-title]").textContent).toContain(
      "Personal Agent",
    );
    expect(
      document
        .querySelector('[data-maturity-stage="discover"]')
        .getAttribute("data-state"),
    ).toBe("active");
  });

  it("marks every stage shown in a lesson reel as active", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    lessonIds.forEach((lessonId) => {
      document.querySelector(`[data-lesson-target="${lessonId}"]`).click();
      const frameStages = new Set(
        [...document.querySelectorAll("[data-frame-index]")].map(
          (frame) => frame.dataset.stage,
        ),
      );

      frameStages.forEach((stage) => {
        expect(
          document.querySelector(`[data-maturity-stage="${stage}"]`).dataset
            .state,
          `${lessonId} should activate its ${stage} reel stage`,
        ).toBe("active");
      });
    });
  });

  it("keeps Mock available while clearly disabling an unready Real run", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const mockButton = document.querySelector('[data-source-target="mock"]');
    const realButton = document.querySelector('[data-source-target="real"]');

    expect(document.body.dataset.runSource).toBe("mock");
    expect(mockButton.disabled).toBe(false);

    realButton.click();

    expect(document.body.dataset.runSource).toBe("real");
    expect(document.querySelector("[data-run-action]").disabled).toBe(true);
    expect(document.querySelector("[data-readiness-copy]").textContent).toContain(
      "Real mode is not configured",
    );
    expect(document.querySelector("[data-source-badge]").textContent).toBe(
      "REAL — UNAVAILABLE",
    );
    expect(document.querySelector('[data-source-target="mock"]').disabled).toBe(
      false,
    );

    document.querySelector('[data-lesson-target="login"]').click();
    expect(document.querySelector("[data-run-status]").textContent).toContain(
      "Real mode selected",
    );

    document.querySelector('[data-source-target="recorded"]').click();
    expect(document.querySelector("[data-run-action]").disabled).toBe(true);
    expect(document.querySelector("[data-source-badge]").textContent).toBe(
      "RECORDED — UNAVAILABLE",
    );
    expect(document.querySelector("[data-readiness-copy]").textContent).toContain(
      "No recorded fixture",
    );
  });

  it("runs a deterministic mock reel and exposes evidence for each frame", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    document.querySelector('[data-lesson-target="a2a"]').click();
    document.querySelector("[data-run-action]").click();

    expect(document.querySelector("[data-run-status]").textContent).toContain(
      "Running mock",
    );
    expect(document.querySelector("[data-reel-counter]").textContent).toContain(
      "1 /",
    );
    expect(document.querySelector("[data-frame-evidence]").textContent).toContain(
      "MOCK",
    );

    document.querySelector('[data-reel-action="next"]').click();

    expect(document.querySelector("[data-reel-counter]").textContent).toContain(
      "2 /",
    );
    expect(document.querySelector("[data-frame-evidence]").textContent.length).toBeGreaterThan(
      40,
    );
  });

  it("bounds reel navigation and preserves accessible frame focus", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const previous = document.querySelector('[data-reel-action="previous"]');
    const next = document.querySelector('[data-reel-action="next"]');

    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    document.querySelector("[data-run-action]").click();
    next.focus();
    next.click();
    expect(document.activeElement).toBe(next);
    const frames = [...document.querySelectorAll("[data-frame-index]")];
    frames.at(-1).click();

    const selected = document.querySelector(
      `[data-frame-index="${frames.length - 1}"]`,
    );
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(selected);
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    expect(document.querySelector("[data-run-status]").textContent).toContain(
      "Mock complete",
    );
  });

  it("avoids smooth imperative scrolling when reduced motion is requested", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    let scrollOptions;
    dom.window.matchMedia = () => ({ matches: true });
    dom.window.HTMLElement.prototype.scrollIntoView = (options) => {
      scrollOptions = options;
    };

    document.querySelector("[data-run-action]").click();
    document.querySelector('[data-frame-index="1"]').click();

    expect(scrollOptions.behavior).toBe("auto");
  });

  it("switches guided and standalone presenter timing", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const standalone = document.querySelector(
      '[data-mode-target="standalone"]',
    );

    standalone.click();

    expect(document.body.dataset.mode).toBe("standalone");
    expect(standalone.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-presenter-time]").textContent).toBe(
      "5 minute demo",
    );
    expect(document.querySelector("[data-journey-controls]").hidden).toBe(true);
  });

  it("advances, skips, completes, and restarts the guided journey", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const journey = document.querySelector("[data-journey-controls]");

    expect(journey.hidden).toBe(false);
    expect(document.querySelector("[data-journey-progress]").textContent).toContain(
      "Lesson 1 of 13",
    );
    expect(
      document.querySelector('[data-journey-action="previous"]').disabled,
    ).toBe(true);
    expect(document.querySelector('[data-journey-action="next"]').disabled).toBe(
      true,
    );
    [...document.querySelectorAll("[data-frame-index]")].at(-1).click();
    expect(document.querySelector('[data-journey-action="next"]').disabled).toBe(
      true,
    );

    document.querySelector('[data-journey-action="skip"]').click();
    expect(document.body.dataset.lesson).toBe("login");
    expect(document.querySelector("[data-journey-progress]").textContent).toContain(
      "Lesson 2 of 13",
    );
    expect(document.querySelector("[data-journey-progress]").textContent).toContain(
      "1 skipped",
    );

    document.querySelector("[data-run-action]").click();
    [...document.querySelectorAll("[data-frame-index]")].at(-1).click();
    expect(document.querySelector('[data-journey-action="next"]').disabled).toBe(
      false,
    );
    document.querySelector('[data-journey-action="next"]').click();
    expect(document.body.dataset.lesson).toBe("delegation");

    while (document.body.dataset.lesson !== "evidence-map") {
      document.querySelector('[data-journey-action="skip"]').click();
    }
    document.querySelector("[data-run-action]").click();
    [...document.querySelectorAll("[data-frame-index]")].at(-1).click();
    document.querySelector('[data-journey-action="next"]').click();

    expect(document.querySelector("[data-journey-summary]").hidden).toBe(false);
    expect(document.querySelector("[data-journey-summary]").textContent).toContain(
      "Journey complete",
    );
    expect(document.querySelectorAll("[data-journey-summary-item]")).toHaveLength(
      13,
    );
    expect(document.querySelector("[data-journey-summary]").textContent).toContain(
      "Skipped by presenter",
    );
    expect(document.querySelector("[data-journey-summary]").textContent).toContain(
      "Session established",
    );
    expect(document.querySelector("[data-journey-summary]").textContent).toContain(
      "MOCK",
    );

    document.querySelector('[data-journey-action="restart"]').click();
    expect(document.body.dataset.lesson).toBe("landscape");
    expect(document.querySelector("[data-journey-summary]").hidden).toBe(true);
  });

  it("can skip the final guided lesson and still produce a complete summary", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    while (document.body.dataset.lesson !== "evidence-map") {
      document.querySelector('[data-journey-action="skip"]').click();
    }

    const finalSkip = document.querySelector('[data-journey-action="skip"]');
    expect(finalSkip.disabled).toBe(false);
    finalSkip.click();

    expect(document.querySelector("[data-journey-summary]").hidden).toBe(false);
    expect(document.querySelectorAll("[data-journey-summary-item]")).toHaveLength(
      13,
    );
    expect(
      document.querySelector('[data-journey-summary-item="evidence-map"]')
        .textContent,
    ).toContain("Skipped by presenter");
  });

  it("persists the shared light and dark preference", () => {
    const dom = loadPreview({ storedDarkMode: true });
    const { document, localStorage } = dom.window;
    const toggle = document.querySelector("[data-theme-toggle]");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle.textContent).toBe("☀️ Light mode");

    toggle.click();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ba_dark_mode")).toBe("false");
    expect(toggle.textContent).toBe("🌙 Dark mode");
  });

  it("hides the prototype header when hosted by the application shell", () => {
    const dom = loadPreview({ embedded: true });
    const { document } = dom.window;

    expect(document.documentElement.dataset.embedded).toBe("true");
    expect(document.querySelector(".topbar")).toHaveAttribute("hidden");
  });

  it("accepts same-origin theme updates from the application shell", () => {
    const dom = loadPreview({ embedded: true });

    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      origin: dom.window.location.origin,
      data: { type: "academy-theme", theme: "dark" },
    }));

    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
  });

  it("links to the Education Hub and matching live deep dives", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const deepDives = {
      landscape: "/ai-products/core",
      login: "/oauth-academy",
      delegation: "/token-exchange-tester",
      "personal-agent": "/pingone-mcp-inspector",
      "digital-assistant": "/use-cases/live",
      mcp: "/mcp-discovery",
      authorize: "/agent-gateway-authorization",
      "human-approval": "/use-cases/live",
      a2a: "/a2a-protocol-learning",
      "privilege-mcp": "/privilege-mcp-client",
      "threat-defense": "/llm-gateway",
      lifecycle: "/agent-lifecycle",
      "evidence-map": "/architecture/token-flow",
    };

    expect(document.querySelector('[data-link="education-hub"]').href).toBe(
      "https://local.ping-devops.com:4000/learning",
    );

    Object.entries(deepDives).forEach(([lessonId, expectedPath]) => {
      document.querySelector(`[data-lesson-target="${lessonId}"]`).click();
      expect(
        document.querySelector('[data-link="deep-dive"]').getAttribute("href"),
        `${lessonId} deep dive`,
      ).toBe(expectedPath);
    });
  });

  it("maps every movie frame to an explicit product or standard", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    lessonIds.forEach((lessonId) => {
      document.querySelector(`[data-lesson-target="${lessonId}"]`).click();
      expect(
        document.querySelectorAll("[data-frame-product]").length,
        `${lessonId} product mapping count`,
      ).toBe(document.querySelectorAll("[data-frame-index]").length);
    });

    document.querySelector('[data-lesson-target="personal-agent"]').click();
    expect(document.querySelector("[data-product-map]").textContent).toContain(
      "unsupported by PingOne",
    );
    document.querySelector('[data-lesson-target="a2a"]').click();
    expect(document.querySelector("[data-product-map]").textContent).toContain(
      "A2A",
    );
    document.querySelector('[data-lesson-target="privilege-mcp"]').click();
    expect(document.querySelector("[data-product-map]").textContent).toContain(
      "PingOne Privilege",
    );
  });

  it("offers the matching 15-min demo beat only on lessons that have one", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const liveDemo = document.querySelector('[data-link="live-demo"]');
    const demoSay = document.querySelector("[data-demo-say]");

    const withBeat = {
      delegation: "UC1",
      a2a: "UC2",
      authorize: "UC6",
      "human-approval": "UC8",
      "threat-defense": "UC12",
      lifecycle: "UC5",
    };
    Object.entries(withBeat).forEach(([lessonId, ucId]) => {
      document.querySelector(`[data-lesson-target="${lessonId}"]`).click();
      expect(liveDemo.hidden, `${lessonId} live link hidden`).toBe(false);
      expect(liveDemo.getAttribute("href"), `${lessonId} live link href`).toBe(
        "/use-cases/live",
      );
      expect(liveDemo.textContent, `${lessonId} live link names ${ucId}`).toContain(ucId);
      expect(demoSay.hidden, `${lessonId} say line hidden`).toBe(false);
      expect(demoSay.textContent, `${lessonId} say line content`).toContain("demo script");
    });

    const withoutBeat = [
      "landscape", "login", "personal-agent", "digital-assistant", "mcp",
      "privilege-mcp", "evidence-map",
    ];
    withoutBeat.forEach((lessonId) => {
      document.querySelector(`[data-lesson-target="${lessonId}"]`).click();
      expect(liveDemo.hidden, `${lessonId} live link hidden`).toBe(true);
      expect(demoSay.hidden, `${lessonId} say line hidden`).toBe(true);
    });
  });
});
