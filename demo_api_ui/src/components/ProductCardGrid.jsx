import "./ProductCardGrid.css";

// One hand-drawn line icon per product type this pass ships with. Unknown
// icon keys fall back to a plain box so a bad seed entry never breaks render.
const ICONS = {
  boots: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v6.5l-3.6 2.7A2 2 0 0 0 2.6 14v3a2 2 0 0 0 2 2h14a2.5 2.5 0 0 0 0-5c-2.3 0-4.6-.6-6.6-1.8V3H7Z"/>
      <path d="M7 6.5h5M7 9h4.4"/>
    </svg>
  ),
  backpack: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
      <path d="M6 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z"/>
      <path d="M9 12.5h6v5.5H9z"/>
      <path d="M6 12H5M18 12h1"/>
    </svg>
  ),
  poles: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 5 18 19"/><path d="M18 5 6 19"/><path d="M6 5H3M18 5h3"/>
      <circle cx="9.4" cy="15.4" r="1.5"/><circle cx="14.6" cy="15.4" r="1.5"/>
    </svg>
  ),
  bottle: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5h5v1.7"/>
      <rect x="9.5" y="1.3" width="5" height="1.8" rx="0.5"/>
      <path d="M9.8 4.2v2.2c0 .5-.2 1-.6 1.4l-.7.7c-.5.5-.8 1.2-.8 1.9V19a2 2 0 0 0 2 2h4.6a2 2 0 0 0 2-2v-8.6c0-.7-.3-1.4-.8-1.9l-.7-.7c-.4-.4-.6-.9-.6-1.4V4.2"/>
      <path d="M8 13.5h8"/>
    </svg>
  ),
  tent: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19h18"/><path d="M4 19 12 5l8 14"/>
      <path d="M9.3 19v-5.2L12 11.6l2.7 2.2V19"/>
    </svg>
  ),
  shirt: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3.3 6 5.6v3.1l2-.9V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7.8l2 .9V5.6l-3-2.3-.9.8a3.1 3.1 0 0 1-4.2 0L9 3.3Z"/>
    </svg>
  ),
  location: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10 12 4l9 6"/><path d="M4 10h16v1.5H4z"/>
      <path d="M6 12v6M10 12v6M14 12v6M18 12v6"/><path d="M3 20h18"/>
    </svg>
  ),
};

function icon(key) {
  return ICONS[key] || <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>;
}

function mapUrlFor(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function ProductCard({ item, onAction, action }) {
  const actionLabel = action?.label || "Add to Cart";
  const actionTool = action?.tool || "add_to_cart";
  return (
    <div className="pcg-card">
      <div className="pcg-thumb pcg-thumb--product">{icon(item.icon)}</div>
      <div className="pcg-body">
        <div className="pcg-price-row">
          <span className="pcg-price">${item.price.toFixed(2)}</span>
          {item.priceWas != null && <span className="pcg-price-strike">${item.priceWas.toFixed(2)}</span>}
        </div>
        <p className="pcg-title">{item.name}</p>
        <div className="pcg-meta">
          {item.rating != null && <>{item.rating}★ ({item.reviewCount})<span className="pcg-dot" /></>}
          {item.stock}
        </div>
        <div className="pcg-btn">
          <button
            type="button"
            onClick={() => onAction?.(actionTool, { productId: item.id })}
            disabled={!onAction}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationCard({ item }) {
  const [imgError, setImgError] = React.useState(false);
  return (
    <div className="pcg-card">
      <div className="pcg-thumb pcg-thumb--location">
        {item.image && !imgError ? (
          <img
            src={item.image}
            alt={item.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
          />
        ) : (
          icon("location")
        )}
      </div>
      <div className="pcg-body">
        <div className="pcg-price-row">
          <span className="pcg-status">{item.hours}</span>
        </div>
        <p className="pcg-title">{item.name}</p>
        <div className="pcg-meta">{item.city}, {item.state}{item.atm ? <><span className="pcg-dot" />ATM</> : null}</div>
        <div className="pcg-btn">
          <a href={mapUrlFor(item.address)} target="_blank" rel="noopener">Get Directions</a>
        </div>
      </div>
    </div>
  );
}

export default function ProductCardGrid({ kind, title, items, onAction, action }) {
  return (
    <div className="pcg">
      {title && <div className="pcg-title-bar">{title}</div>}
      <div className="pcg-grid">
        {items.map((item) =>
          kind === "locations"
            ? <LocationCard key={item.id} item={item} />
            : <ProductCard key={item.id} item={item} onAction={onAction} action={action} />,
        )}
      </div>
    </div>
  );
}
