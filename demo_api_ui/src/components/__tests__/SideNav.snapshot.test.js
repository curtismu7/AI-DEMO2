// banking_api_ui/src/components/__tests__/SideNav.snapshot.test.js
// Layer 1 regression snapshot — run `npm run test:unit -- --updateSnapshot` only when a change is intentional.
import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SideNav from '../SideNav';

vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({ preset: { shortName: 'Super Banking', id: 'banking' } }),
}));

vi.mock('../../context/EducationUIContext', () => ({
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn(), panel: null, tab: null }),
}));

// education IDs are string constants — just passthrough
vi.mock('../education/educationIds', () => ({
  EDU: new Proxy({}, { get: (_, k) => k }),
}));

const renderSideNav = (userOverrides = {}) =>
  render(
    <BrowserRouter>
      <SideNav
        user={{ sub: 'u1', email: 'test@example.com', role: 'user', ...userOverrides }}
        onLogout={jest.fn()}
      />
    </BrowserRouter>
  );

describe('SideNav snapshot', () => {
  it('renders user nav without change', () => {
    const { container } = renderSideNav({ role: 'user' });
    expect(container).toMatchSnapshot();
  });

  it('renders admin nav without change', () => {
    const { container } = renderSideNav({ role: 'admin' });
    expect(container).toMatchSnapshot();
  });
});
