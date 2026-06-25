// banking_api_ui/src/components/dashboard/MobileNavigation.js
import React from "react";
import "./MobileNavigation.css";

const MobileNavigation = ({
  activeTab,
  onTabChange,
  isAuthenticated,
  currentVertical,
}) => {
  const getNavItems = () => {
    const baseItems = [
      {
        id: "home",
        label: "Home",
        icon: (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
        ),
        alwaysVisible: true,
      },
      {
        id: "accounts",
        label: "Accounts",
        icon: (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
          </svg>
        ),
        alwaysVisible: true,
      },
      {
        id: "agent",
        label: "AI",
        icon: "🤖",
        alwaysVisible: true,
      },
      {
        id: "more",
        label: "More",
        icon: "⋯",
        alwaysVisible: true,
      },
    ];

    // Add vertical-specific items if needed
    if (currentVertical === "retail") {
      baseItems.splice(2, 0, {
        id: "sales",
        label: "Sales",
        icon: (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z" />
          </svg>
        ),
        alwaysVisible: false,
      });
    } else if (currentVertical === "workforce") {
      baseItems.splice(2, 0, {
        id: "employees",
        label: "Staff",
        icon: (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
        ),
        alwaysVisible: false,
      });
    }

    return baseItems;
  };

  const navItems = getNavItems();

  return (
    <nav className="mobile-navigation">
      <div className="mobile-navigation__container">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-navigation__item ${activeTab === item.id ? "mobile-navigation__item--active" : ""}`}
            onClick={() => onTabChange(item.id)}
            aria-label={item.label}
            aria-current={activeTab === item.id ? "page" : undefined}
          >
            <span className="mobile-navigation__icon">{item.icon}</span>
            <span className="mobile-navigation__label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

export default MobileNavigation;
