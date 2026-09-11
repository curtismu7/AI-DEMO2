import { useState, useRef, useEffect } from 'react';
import { MdStar, MdArrowDropDown, MdClose, MdAdd } from 'react-icons/md';
import { useNavigate, useLocation } from 'react-router-dom';
import { getFavorites, addFavorite, removeFavorite, labelForPath, FAVORITES_CHANGED_EVENT } from '../utils/favorites';
import './FavoritesMenu.css';

// Header dropdown of pages you jump to a lot while testing/demoing. Per-browser
// (localStorage via utils/favorites.js). Same open/close pattern as UserMenu.
export default function FavoritesMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [favorites, setFavorites] = useState(getFavorites);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onChange = (e) => setFavorites(e.detail?.favorites || getFavorites());
    window.addEventListener(FAVORITES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const goTo = (path) => { setIsOpen(false); navigate(path); };
  const alreadyFavorited = favorites.some((f) => f.path === location.pathname);

  return (
    <div className="fav-menu" ref={menuRef}>
      <button
        className="fav-menu-trigger"
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Favorites"
        title="Favorites — pages you run a lot"
        type="button"
      >
        <MdStar className="fav-menu-trigger-icon" />
        <span className="fav-menu-trigger-label">Favorites</span>
        <MdArrowDropDown className="fav-menu-dropdown-icon" />
      </button>

      {isOpen && (
        <div className="fav-menu-dropdown">
          <div className="fav-menu-title">Favorites</div>
          {favorites.length === 0 ? (
            <div className="fav-menu-empty">No favorites yet — add the current page below.</div>
          ) : (
            favorites.map((f) => (
              <div className="fav-menu-row" key={f.path}>
                <button className="fav-menu-item" type="button" onClick={() => goTo(f.path)}>
                  <MdStar className="fav-menu-item-icon" />
                  <span>{f.label}</span>
                </button>
                <button
                  className="fav-menu-remove"
                  type="button"
                  aria-label={`Remove ${f.label} from favorites`}
                  title="Remove"
                  onClick={() => setFavorites(removeFavorite(f.path))}
                >
                  <MdClose />
                </button>
              </div>
            ))
          )}

          <div className="fav-menu-divider" />
          <button
            className="fav-menu-add"
            type="button"
            disabled={alreadyFavorited}
            onClick={() => setFavorites(addFavorite({ label: labelForPath(location.pathname), path: location.pathname }))}
          >
            <MdAdd className="fav-menu-item-icon" />
            <span>{alreadyFavorited ? 'This page is a favorite' : 'Add this page'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
