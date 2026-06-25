// banking_api_ui/src/components/UIDesignNav.js
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './UIDesignNav.css';

/**
 * Compact menu to jump between app screens when reviewing UI (dashboard, config, static mocks).
 */
export default function UIDesignNav({ user }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === 'admin';

  const items = [
    { to: '/', label: isAdmin ? 'Admin home' : 'Home', show: true },
    { to: '/dashboard', label: 'Customer dashboard', show: true },
    { to: '/config', label: 'PingOne config', show: true },
    { to: '/demo-data', label: 'Demo config', show: true },
    { to: '/mcp-inspector', label: 'MCP Inspector', show: true },
    { to: '/api-traffic', label: 'API traffic', show: true, newWindow: true },
    { href: '/design/customer-dashboard-2026.html', label: 'Static mock · Customer', show: true, newWindow: true, external: true },
    { href: '/design/customer-dashboard-2026-agent-ui.html', label: 'Static mock · Agent UI (floating / embedded)', show: true, newWindow: true, external: true },
    { href: '/design/admin-dashboard-2026.html', label: 'Static mock · Admin', show: isAdmin, newWindow: true, external: true },
  ].filter((x) => x.show);

  return (
    <div className={`ui-design-nav${open ? ' ui-design-nav--open' : ''}`}>
      <button
        type="button"
        className="ui-design-nav__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ui-design-nav-menu"
        title="Jump to UI pages"
      >
        UI
      </button>
      {open && (
        <nav id="ui-design-nav-menu" className="ui-design-nav__menu" aria-label="UI design pages">
          <div className="ui-design-nav__title">Pages</div>
          <ul className="ui-design-nav__list">
            {items.map((item) => {
              const active = !item.external && item.to === pathname;
              if (item.external) {
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="ui-design-nav__link"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              }
              if (item.newWindow) {
                return (
                  <li key={item.to}>
                    <button
                      type="button"
                      className="ui-design-nav__link ui-design-nav__link--btn"
                      onClick={() => {
                        window.open(item.to, 'BXUI', 'width=1200,height=900,scrollbars=yes,resizable=yes');
                        setOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              }
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={`ui-design-nav__link${active ? ' ui-design-nav__link--active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
