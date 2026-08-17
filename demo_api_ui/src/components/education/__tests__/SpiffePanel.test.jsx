import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SpiffePanel from '../SpiffePanel';

test('opens on the What & Why tab and explains what an SVID is', () => {
  render(<SpiffePanel isOpen onClose={() => {}} />);

  expect(screen.getAllByText(/SPIFFE Verifiable Identity Document/i).length).toBeGreaterThan(0);
  // The ID-vs-document distinction is the load-bearing concept of the tab.
  expect(screen.getAllByText(/X\.509-SVID/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/JWT-SVID/).length).toBeGreaterThan(0);
});

test('the "In this repo" tab labels the SPIFFE routes as illustrative, not real', () => {
  render(<SpiffePanel isOpen onClose={() => {}} />);

  // EducationDrawer renders only the active tab, so switch first.
  fireEvent.click(screen.getByRole('tab', { name: /in this repo/i }));

  // EduImplIntro renders "Illustrative" for mock, "This repo" for real code.
  expect(screen.getAllByText(/Illustrative/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/spiffeDemo\.js/).length).toBeGreaterThan(0);
  // The genuinely-implemented seam must be named, or the tab is misleading.
  expect(screen.getAllByText(/clientAssertionService\.js/).length).toBeGreaterThan(0);
});

test('the PingOne tab states the two hard blockers', () => {
  render(<SpiffePanel isOpen onClose={() => {}} />);

  fireEvent.click(screen.getByRole('tab', { name: /what pingone can consume/i }));

  // Both blockers must be visible: no external issuer, no cert-bound tokens.
  expect(screen.getAllByText(/Not supported/).length).toBeGreaterThan(1);
  expect(screen.getAllByText(/actor_token/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/PingFederate/).length).toBeGreaterThan(0);
});

test('initialTabId selects the requested tab on open', () => {
  render(<SpiffePanel isOpen onClose={() => {}} initialTabId="pingone" />);

  expect(screen.getByRole('tab', { name: /what pingone can consume/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
