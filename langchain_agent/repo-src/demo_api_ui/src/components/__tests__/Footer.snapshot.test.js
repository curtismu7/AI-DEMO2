// banking_api_ui/src/components/__tests__/Footer.snapshot.test.js
// Layer 1 regression snapshot — run `npm run test:unit -- --updateSnapshot` only when a change is intentional.
import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Footer from '../Footer';

vi.mock('../BrandLogo', () => ({ default: () => <svg data-testid="brand-logo" /> }));

vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({ preset: { shortName: 'Super Banking', id: 'banking' } }),
}));

const renderFooter = (userOverrides = {}) =>
  render(
    <BrowserRouter>
      <Footer user={{ sub: 'u1', email: 'test@example.com', ...userOverrides }} />
    </BrowserRouter>
  );

describe('Footer snapshot', () => {
  it('renders light theme without change', () => {
    const { container } = renderFooter();
    expect(container).toMatchSnapshot();
  });

  it('renders without user (logged out) without change', () => {
    const { container } = render(
      <BrowserRouter>
        <Footer user={null} />
      </BrowserRouter>
    );
    expect(container).toMatchSnapshot();
  });
});
