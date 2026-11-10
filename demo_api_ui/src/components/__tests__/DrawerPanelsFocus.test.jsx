/**
 * CIBAPanel and CimdSimPanel are aria-modal drawers that stay mounted. Opening one (for example from the customer
 * dashboard's explainer buttons) must move focus into it, keep Tab inside it, and give focus back to the trigger when it
 * closes. They use the shared useDialogFocus hook; the drawers slide out, so focus is still inside at the moment of
 * closing and the hook is told to restore from within.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('axios', () => {
  const ok = () => Promise.resolve({ data: {} });
  const inst = { get: vi.fn(ok), post: vi.fn(ok), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  return { default: { ...inst, create: () => inst } };
});
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifyInfo: vi.fn(), notifySuccess: vi.fn() }));

const { default: CIBAPanel } = await import('../CIBAPanel');
const { default: CimdSimPanel } = await import('../CimdSimPanel');
const { getTabbables } = await import('../../hooks/useDialogFocus');

const PANELS = [
  { name: "CIBAPanel", Panel: CIBAPanel, event: "education-open-ciba" },
  { name: "CimdSimPanel", Panel: CimdSimPanel, event: "education-open-cimd" },
];

describe.each(PANELS)("$name focus handling", ({ Panel, event }) => {
  function setup() {
    render(
      <>
        <button type="button" data-testid="trigger">Open</button>
        <Panel />
      </>,
    );
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    act(() => { window.dispatchEvent(new CustomEvent(event, { detail: {} })); });
    return { trigger, dialog: screen.getByRole("dialog") };
  }

  it("moves focus into the dialog when it opens", () => {
    const { dialog } = setup();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("[data-autofocus]"));
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    const { dialog } = setup();
    const items = getTabbables(dialog);
    expect(items.length).toBeGreaterThan(1);
    items[items.length - 1].focus();
    fireEvent.keyDown(document.activeElement, { key: "Tab" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const { trigger } = setup();
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.getByRole("dialog", { hidden: true }).getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes with the close button and gives focus back to the trigger", () => {
    const { trigger, dialog } = setup();
    fireEvent.click(dialog.querySelector("[data-autofocus]"));
    expect(document.activeElement).toBe(trigger);
  });
});
