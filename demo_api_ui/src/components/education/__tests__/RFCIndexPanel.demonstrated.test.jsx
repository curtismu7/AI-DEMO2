// Demonstrated-by column on the RFC & Spec Index panel (coverage plan row
// "RFC & Spec Index" — LINK: add a "Demonstrated by" column from the coverage map).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import RFCIndexPanel from '../RFCIndexPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';

const renderPanel = () => render(
  <EducationUIProvider>
    <RFCIndexPanel isOpen onClose={() => {}} />
  </EducationUIProvider>,
);

describe('RFCIndexPanel — Demonstrated by column', () => {
  it('has a Demonstrated by column header', () => {
    const { baseElement } = renderPanel();
    expect(baseElement.textContent).toContain('Demonstrated by');
  });

  it('maps live demo proofs for the core standards rows', () => {
    const { baseElement } = renderPanel();
    const text = baseElement.textContent;
    // PKCE → the live login flow; Token Exchange → the live exchange tester
    expect(text).toContain('Live login flow');
    expect(text).toContain('Live exchange tester');
    // Spec rows the demo does not prove are marked, not invented.
    expect(text).toContain('Not proven live');
  });
});
