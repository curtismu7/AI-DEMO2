import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ArchitectureFlowPage from '../ArchitectureFlowPage';

global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ArchitectureFlowPage.js'), 'utf8');

describe('ArchitectureFlowPage diagram controls', () => {
  it('has Simulate, a speed selector and a walkthrough Reset', () => {
    render(<ArchitectureFlowPage user={null} />);
    expect(screen.getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy();
    expect(screen.getByTitle('Time each step takes during Simulate')).toBeTruthy();
  });

  it('declares its boxes draggable explicitly', () => {
    expect(SRC).toMatch(/<ReactFlow[^>]*\bnodesDraggable\b/);
  });
});
