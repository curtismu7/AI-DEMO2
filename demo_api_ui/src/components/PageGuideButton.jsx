import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getPageGuide } from "../config/pageGuides";
import { openPageGuide, registerHeaderButton } from "./pageGuideStore";

// Header "Guide" button. Renders only on routes that have a guide; the modal
// itself lives in PageGuide.
export default function PageGuideButton() {
  const { pathname } = useLocation();
  const has = Boolean(getPageGuide(pathname));
  useEffect(() => (has ? registerHeaderButton() : undefined), [has]);
  if (!has) return null;
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
