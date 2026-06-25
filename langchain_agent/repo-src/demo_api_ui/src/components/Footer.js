import React from 'react';
import { useIndustryBranding } from '../context/IndustryBrandingContext';
import BrandLogo from './BrandLogo';
import './Footer.css';

function Footer() {
  const { preset } = useIndustryBranding();

  return (
    <footer className="footer">
      <div className="footer-content">
        <BrandLogo className="footer-logo" style={{ marginRight: 8, verticalAlign: 'middle' }} height={32} width={32} />
        <span className="footer-brand-text" style={{ fontWeight: 'bold', fontSize: 18, verticalAlign: 'middle' }}>{preset.shortName} Demo</span>
        <span className="footer-copyright" style={{ marginLeft: 16, fontSize: 14 }}>
          &copy; {new Date().getFullYear()} All rights reserved.
        </span>
      </div>
    </footer>
  );
}

export default Footer;
