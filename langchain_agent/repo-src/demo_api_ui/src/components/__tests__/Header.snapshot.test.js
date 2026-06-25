// banking_api_ui/src/components/__tests__/Header.snapshot.test.js
// Layer 1 regression snapshot — run `npm run test:unit -- --updateSnapshot` only when a change is intentional.
import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Header from '../Header';

// stub out fetch so the switch-role call never fires
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ redirectUrl: '/' }) }));

vi.mock('../BrandLogo', () => ({ default: () => <svg data-testid="brand-logo" /> }));

const renderHeader = (userOverrides = {}) =>
  render(
    <BrowserRouter>
      <Header user={{ sub: 'u1', email: 'test@example.com', role: 'user', ...userOverrides }} onLogout={jest.fn()} />
    </BrowserRouter>
  );

describe('Header snapshot', () => {
  it('renders user nav without change', () => {
    const { container } = renderHeader({ role: 'user' });
    expect(container).toMatchSnapshot();
  });

  it('renders admin nav without change', () => {
    const { container } = renderHeader({ role: 'admin' });
    expect(container).toMatchSnapshot();
  });
});
