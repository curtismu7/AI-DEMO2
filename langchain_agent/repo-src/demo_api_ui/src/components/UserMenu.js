import React, { useState, useRef, useEffect } from 'react';
import { MdPerson, MdSettings, MdNotifications, MdLogout, MdLogin, MdArrowDropDown } from 'react-icons/md';
import './UserMenu.css';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import { useSessionToken } from '../context/SessionTokenContext';

export default function UserMenu({ user, onLogout, isAdminView = false, onSwitchView }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const { tokenSecondsLeft, tokenLoading } = useSessionToken();
  const hasActiveToken = !tokenLoading && tokenSecondsLeft !== null && tokenSecondsLeft > 0;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    setIsOpen(false);
    onLogout();
  };

  const handleLogin = () => {
    setIsOpen(false);
    navigateToCustomerOAuthLogin();
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="User menu"
        type="button"
      >
        <div className="user-menu-avatar">
          {user?.firstName?.[0] ? user.firstName[0].toUpperCase() : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M12 14c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z" />
            </svg>
          )}
        </div>
        <MdArrowDropDown className="user-menu-dropdown-icon" />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-avatar user-menu-avatar-large">
              {user?.firstName?.[0] ? user.firstName[0].toUpperCase() : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z" />
                </svg>
              )}
            </div>
            <div className="user-menu-info">
              <div className="user-menu-name">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="user-menu-email">{user?.email || ''}</div>
              {user?.id && (
                <div className="user-menu-userid" title="User ID">{user.id}</div>
              )}
              <div className="user-menu-role">
                {user?.role === 'admin' ? 'Admin' : 'Customer'}
              </div>
            </div>
          </div>

          <div className="user-menu-divider"></div>

          <div className="user-menu-items">
            <button className="user-menu-item" type="button">
              <MdPerson className="user-menu-item-icon" />
              <span>Profile</span>
            </button>
            <button className="user-menu-item" type="button">
              <MdNotifications className="user-menu-item-icon" />
              <span>Notifications</span>
              <span className="user-menu-badge">3</span>
            </button>
            <button className="user-menu-item" type="button">
              <MdSettings className="user-menu-item-icon" />
              <span>Settings</span>
            </button>
          </div>

          {user?.role === 'admin' && onSwitchView && (
            <button
              className="user-menu-item"
              type="button"
              onClick={() => { setIsOpen(false); onSwitchView(); }}
            >
              <span className="user-menu-item-icon">↔</span>
              <span>{isAdminView ? 'Switch to Customer View' : 'Switch to Admin View'}</span>
            </button>
          )}

          <div className="user-menu-divider"></div>

          {hasActiveToken ? (
            <button className="user-menu-item user-menu-item-danger" onClick={handleLogout} type="button">
              <MdLogout className="user-menu-item-icon" />
              <span>Sign Out</span>
            </button>
          ) : (
            <button className="user-menu-item user-menu-item-primary" onClick={handleLogin} type="button">
              <MdLogin className="user-menu-item-icon" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
