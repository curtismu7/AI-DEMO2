import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getPageGuide } from "../config/pageGuides";
import { claimHeaderButton, openPageGuide } from "./pageGuideStore";

// Header "Guide" button. Renders only on routes that have a guide, and only in
// the first header on screen; the modal itself lives in PageGuide.
export default function PageGuideButton() {
  const { pathname } = useLocation();
  const has = Boolean(getPageGuide(pathname));
  const [primary, setPrimary] = useState(false);
  useEffect(() => {
    if (!has) return undefined;
    const claim = claimHeaderButton();
    setPrimary(claim.primary);
    return () => {
      claim.release();
      setPrimary(false);
    };
  }, [has]);
  if (!has || !primary) return null;
  return (
    <button
      type="button"
      className="topnav-use-cases-btn topnav-guide-btn"
      onClick={openPageGuide}
      title="Learning Guide for this page"
      data-testid="topnav-guide"
    >
      Guide
    </button>
  );
}
