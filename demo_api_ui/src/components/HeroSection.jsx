export function HeroSection({
  avatar,
  title,
  description,
  subtitle,
  isEmpty,
  variant,
}) {
  const compactClass = isEmpty ? '' : ' hero-section--compact';
  return (
    <div className={`hero-section hero-section--${variant}${compactClass}`}>
      <div className="hero-avatar">{avatar}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {subtitle && <p className="hero-subtitle">{subtitle}</p>}
    </div>
  );
}
