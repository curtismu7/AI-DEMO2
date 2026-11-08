import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';
import { getAppZoom, getViewportCssSize } from '../../utils/appZoom';

// jsdom has no layout, so the measured effect (panel right edge and buttons inside the window at zoom 1, 1.125 and 1.25 on
// 375/768/1280 wide) is in tests/e2e/modalFocusZoom.spec.js. These pin the causes.

const css = readFileSync(path.resolve(__dirname, '../DraggableModal.css'), 'utf8');

describe('DraggableModal under the app zoom', () => {
  const realW = window.innerWidth;
  const realH = window.innerHeight;
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
  });
  afterEach(() => {
    window.innerWidth = realW;
    window.innerHeight = realH;
    document.documentElement.style.removeProperty('zoom');
    vi.restoreAllMocks();
  });

  it('reads the zoom the app applies to <html>', () => {
    expect(getAppZoom()).toBe(1);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '1.125' });
    expect(getAppZoom()).toBe(1.125);
    expect(getViewportCssSize().w).toBeCloseTo(1280 / 1.125);
  });

  it('centres the panel in the zoomed viewport, not the window-pixel one', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '1.25' });
    render(<DraggableModal isOpen onClose={vi.fn()} title="Z" defaultWidth={500} defaultHeight={300}><p>x</p></DraggableModal>);
    // (1280 / 1.25 - 500) / 2 = 262; the old window-pixel maths gave 390 and, drawn at 1.25x, sat 195px right of centre.
    expect(screen.getByRole('dialog').style.left).toBe('262px');
  });

  it('shrinks the centring width to what fits on a phone (375 at 1.125 is a 333px page)', () => {
    window.innerWidth = 375;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '1.125' });
    render(<DraggableModal isOpen onClose={vi.fn()} title="Z" defaultWidth={520}><p>x</p></DraggableModal>);
    const left = parseFloat(screen.getByRole('dialog').style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + Math.min(520, 375 / 1.125 - 16)).toBeLessThanOrEqual(375 / 1.125);
  });

  it('is unchanged at zoom 1', () => {
    render(<DraggableModal isOpen onClose={vi.fn()} title="Z" defaultWidth={500}><p>x</p></DraggableModal>);
    expect(screen.getByRole('dialog').style.left).toBe('390px');
  });

  it('sizes against the window divided by --app-zoom (vw/vh are not zoom-aware)', () => {
    expect(css).toMatch(/max-width:\s*calc\(100vw\s*\/\s*var\(--app-zoom,\s*1\)\s*-\s*16px\)/);
    expect(css).not.toMatch(/max-width:\s*calc\(100vw\s*-\s*16px\)/);
    expect(css).toMatch(/data-placement="right"\][^{]*\{[^}]*height:\s*calc\(100vh\s*\/\s*var\(--app-zoom,\s*1\)\)/);
  });
});

describe('CIBA drawer education styles (CO-6)', () => {
  const src = readFileSync(path.resolve(__dirname, '../CIBAPanel.js'), 'utf8');
  it('CIBAPanel loads the sheet that defines .edu-code itself', () => {
    expect(src).toMatch(/import\s+'\.\/shared\/EducationDrawer\.css'/);
    expect(readFileSync(path.resolve(__dirname, '../shared/EducationDrawer.css'), 'utf8')).toMatch(/\.edu-code\b/);
  });
});
