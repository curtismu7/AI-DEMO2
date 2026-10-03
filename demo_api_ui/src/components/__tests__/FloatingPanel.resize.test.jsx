import React from 'react';
import { render, act } from '@testing-library/react';
import FloatingPanel from '../FloatingPanel';

const setWindowWidth = (w) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
};

describe('FloatingPanel window resize', () => {
  const original = window.innerWidth;
  afterEach(() => setWindowWidth(original));

  it('pulls a panel back on-screen when the window narrows', () => {
    setWindowWidth(1200);
    render(
      <FloatingPanel title="T" defaultWidth={480} defaultHeight={300} defaultX={704} defaultY={52}>
        body
      </FloatingPanel>
    );
    // The panel portals out of the render container, so query the document.
    const panel = document.querySelector('.fp-panel');
    expect(panel.style.left).toBe('704px');
    setWindowWidth(900);
    expect(panel.style.left).toBe('420px');
  });

  it('leaves a null (CSS-placed) position alone', () => {
    setWindowWidth(1200);
    render(
      <FloatingPanel title="T" defaultWidth={480} defaultHeight={300} defaultX={null} defaultY={null}>
        body
      </FloatingPanel>
    );
    const panel = document.querySelector('.fp-panel');
    setWindowWidth(900);
    expect(panel.style.left).toBe('');
  });
});
