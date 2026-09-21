import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const previewPath = path.resolve(process.cwd(), "public/academy-preview.html");

function loadPreview() {
  expect(
    fs.existsSync(previewPath),
    "the reviewable Academy mock should ship as public/academy-preview.html",
  ).toBe(true);

  return new JSDOM(fs.readFileSync(previewPath, "utf8"), {
    runScripts: "dangerously",
    url: "https://local.ping-devops.com:4000/academy-preview.html",
  });
}

describe("Academy HTML preview", () => {
  it("switches between the OAuth and A2A concept workbenches", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const oauthPanel = document.querySelector('[data-concept-panel="oauth"]');
    const a2aPanel = document.querySelector('[data-concept-panel="a2a"]');
    const a2aTab = document.querySelector('[data-concept-target="a2a"]');

    expect(oauthPanel.hidden).toBe(false);
    expect(a2aPanel.hidden).toBe(true);

    a2aTab.click();

    expect(oauthPanel.hidden).toBe(true);
    expect(a2aPanel.hidden).toBe(false);
    expect(a2aTab.getAttribute("aria-selected")).toBe("true");
  });

  it("switches the presentation between guided and standalone timing", () => {
    const dom = loadPreview();
    const { document } = dom.window;
    const standaloneButton = document.querySelector('[data-mode-target="standalone"]');

    expect(document.body.dataset.mode).toBe("guided");

    standaloneButton.click();

    expect(document.body.dataset.mode).toBe("standalone");
    expect(standaloneButton.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-mode-copy="standalone"]').hidden).toBe(false);
    expect(document.querySelector('[data-mode-copy="guided"]').hidden).toBe(true);
  });

  it("links each mock concept to its corresponding live application surface", () => {
    const dom = loadPreview();
    const { document } = dom.window;

    expect(document.querySelector('[data-live-link="oauth"]').getAttribute("href"))
      .toBe("/academy/delegation/guided");
    expect(document.querySelector('[data-live-link="a2a"]').getAttribute("href"))
      .toBe("/a2a-protocol-learning");
  });
});
