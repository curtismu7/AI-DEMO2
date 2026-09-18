import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SimpleStepperBar from '../SimpleStepperBar';

let mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => mockCtx,
}));

function makeChildWindow() {
  const childDocument = document.implementation.createHTMLDocument('Simple Stepper');
  const nativeWrite = childDocument.write.bind(childDocument);
  Object.defineProperty(childDocument, 'defaultView', { value: window });
  childDocument.write = vi.fn((markup) => {
    nativeWrite(markup);
    const theme = /<html data-theme="([^"]+)">/.exec(markup)?.[1];
    if (theme) childDocument.documentElement.dataset.theme = theme;
  });
  return {
    closed: false,
    document: childDocument,
    addEventListener: vi.fn(),
    close: vi.fn(function close() {
      this.closed = true;
    }),
    focus: vi.fn(),
  };
}

beforeEach(() => {
  mockCtx = {
    events: [{
      id: 'step-1',
      label: 'User Token',
      status: 'success',
      timestamp: '2026-09-18T00:00:00.000Z',
    }],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SimpleStepperBar pop-out lifecycle', () => {
  it.each([
    ['the child Close action', async (childDocument) => {
      fireEvent.click(childDocument.querySelector('button[title="Close"]'));
    }],
    ['the bar Hide action', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    }],
  ])('closes the child window and removes its placeholder after %s', async (_action, closeStepper) => {
    const childWindow = makeChildWindow();
    vi.spyOn(window, 'open').mockReturnValue(childWindow);

    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(screen.getByTitle('Pop out to new window'));

    await waitFor(() => {
      expect(childWindow.document.querySelector('button[title="Close"]')).toBeTruthy();
    });
    expect(screen.getByText(/Simple Stepper — open in separate window/)).toBeTruthy();

    await closeStepper(childWindow.document);

    await waitFor(() => {
      expect(childWindow.close).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Simple Stepper — open in separate window/)).toBeNull();
    });
  });
});
